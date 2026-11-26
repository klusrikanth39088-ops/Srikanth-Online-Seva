const fs = require('fs');
const path = require('path');
const express = require('express');
const archiver = require('archiver');
const { db, SERVICES_DIR } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  parseJsonSafe,
  getAppUploadDir,
  getAdminSiteSettings,
  sanitizeSlug
} = require('../utils/helpers');

const router = express.Router();

router.use(authenticateToken, requireRole('admin'));

function formatAdminApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    unique_app_id: row.unique_app_id,
    user_id: row.user_id,
    customer_name: row.customer_name || 'Customer',
    customer_phone: row.customer_phone || '',
    customer_email: row.customer_email || '',
    service_slug: row.service_slug,
    service_name: row.service_name || row.service_slug,
    form_data: parseJsonSafe(row.form_data_json, {}),
    files: parseJsonSafe(row.files_json, {}),
    order_id: row.order_id,
    gateway_payment_id: row.gateway_payment_id,
    payment_amount: Number(row.payment_amount || 0),
    payment_status: row.payment_status,
    status: row.status,
    is_locked: Boolean(row.is_locked),
    downloaded_at: row.downloaded_at,
    tracking_link: row.tracking_link,
    application_number: row.application_number,
    tracking_dob: row.tracking_dob,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// Dashboard Statistics
router.get('/stats', (req, res) => {
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN payment_status = 'Paid' AND status = 'Pending' THEN 1 ELSE 0 END) AS todo_count,
      SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) AS total_paid_applications,
      SUM(CASE WHEN status = 'Applied' THEN 1 ELSE 0 END) AS applied_count,
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
      COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN payment_amount ELSE 0 END), 0) AS total_revenue
    FROM applications
  `).get();

  res.json({
    stats: {
      todo_count: Number(counts.todo_count || 0),
      total_applications: Number(counts.total_paid_applications || 0),
      applied_count: Number(counts.applied_count || 0),
      completed_count: Number(counts.completed_count || 0),
      total_revenue: Number(counts.total_revenue || 0)
    }
  });
});

// Admin To-Do List (Paid applications with status = 'Pending', oldest-first FIFO)
router.get('/todo', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
           s.service_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN services s ON s.folder_slug = a.service_slug
    WHERE a.payment_status = 'Paid' AND a.status = 'Pending'
    ORDER BY a.created_at ASC, a.id ASC
  `).all();

  res.json({
    todo_count: rows.length,
    applications: rows.map(formatAdminApplication)
  });
});

// Full searchable list of applications
router.get('/applications', (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();
  const serviceSlug = String(req.query.service || '').trim();
  const includeDrafts = req.query.include_drafts === '1';

  const clauses = [];
  const params = [];

  if (!includeDrafts) {
    clauses.push("a.payment_status = 'Paid'");
  }
  if (status && status !== 'All') {
    clauses.push('a.status = ?');
    params.push(status);
  }
  if (serviceSlug && serviceSlug !== 'All') {
    clauses.push('a.service_slug = ?');
    params.push(serviceSlug);
  }
  if (search) {
    clauses.push(`(
      LOWER(a.unique_app_id) LIKE ?
      OR LOWER(COALESCE(u.name, '')) LIKE ?
      OR LOWER(COALESCE(u.phone, '')) LIKE ?
      OR LOWER(COALESCE(a.order_id, '')) LIKE ?
      OR LOWER(COALESCE(a.gateway_payment_id, '')) LIKE ?
      OR LOWER(COALESCE(a.application_number, '')) LIKE ?
      OR LOWER(a.form_data_json) LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT a.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
           s.service_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN services s ON s.folder_slug = a.service_slug
    ${whereSql}
    ORDER BY a.created_at DESC, a.id DESC
  `).all(...params);

  res.json({
    applications: rows.map(formatAdminApplication)
  });
});

// Single application details
router.get('/applications/:uniqueAppId', (req, res) => {
  const uniqueAppId = String(req.params.uniqueAppId || '').trim();
  const row = db.prepare(`
    SELECT a.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
           s.service_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN services s ON s.folder_slug = a.service_slug
    WHERE a.unique_app_id = ?
  `).get(uniqueAppId);

  if (!row) {
    return res.status(404).json({ error: 'Application not found.' });
  }
  return res.json({ application: formatAdminApplication(row) });
});

// Protected preview/download of individual file
router.get('/applications/:uniqueAppId/files/:storedName', (req, res) => {
  const uniqueAppId = String(req.params.uniqueAppId || '').trim();
  const storedName = path.basename(String(req.params.storedName || ''));

  const appRow = db.prepare('SELECT * FROM applications WHERE unique_app_id = ?').get(uniqueAppId);
  if (!appRow) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  const filePath = path.join(getAppUploadDir(uniqueAppId), storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  if (req.query.download === '1') {
    // Individual download also locks & moves Pending -> Applied
    if (appRow.status === 'Pending') {
      db.prepare(`
        UPDATE applications
        SET status = 'Applied', is_locked = 1, downloaded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE unique_app_id = ?
      `).run(uniqueAppId);
    }
    return res.download(filePath, storedName);
  }
  return res.sendFile(filePath);
});

// Download All Documents (ZIP) named <unique_app_id>.zip + Auto-Status Trigger (Pending -> Applied)
router.get('/applications/:uniqueAppId/download-zip', (req, res) => {
  const uniqueAppId = String(req.params.uniqueAppId || '').trim();
  const row = db.prepare(`
    SELECT a.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
           s.service_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN services s ON s.folder_slug = a.service_slug
    WHERE a.unique_app_id = ?
  `).get(uniqueAppId);

  if (!row) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  // Auto-Status Trigger: Pending -> Applied, lock customer editing, log timestamp
  if (row.status === 'Pending') {
    db.prepare(`
      UPDATE applications
      SET status = 'Applied',
          is_locked = 1,
          downloaded_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE unique_app_id = ?
    `).run(uniqueAppId);
  } else if (!row.is_locked) {
    db.prepare(`
      UPDATE applications
      SET is_locked = 1,
          downloaded_at = COALESCE(downloaded_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE unique_app_id = ?
    `).run(uniqueAppId);
  }

  const uploadDir = getAppUploadDir(uniqueAppId);
  const filesMap = parseJsonSafe(row.files_json, {});
  const formData = parseJsonSafe(row.form_data_json, {});

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${uniqueAppId}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });

  archive.pipe(res);

  // Add application summary text file inside ZIP
  const summaryLines = [
    `Unique Application ID: ${row.unique_app_id}`,
    `Service: ${row.service_name || row.service_slug}`,
    `Customer Name: ${row.customer_name || ''}`,
    `Customer Phone: ${row.customer_phone || ''}`,
    `Customer Email: ${row.customer_email || ''}`,
    `Payment Status: ${row.payment_status} (INR ${Number(row.payment_amount || 0).toFixed(2)})`,
    `Order ID: ${row.order_id || ''}`,
    `Gateway Payment ID: ${row.gateway_payment_id || ''}`,
    `Submitted At: ${row.created_at}`,
    `Downloaded At: ${new Date().toISOString()}`,
    '',
    '--- Form Data ---',
    ...Object.entries(formData).map(([k, v]) => `${k}: ${v}`)
  ];
  archive.append(summaryLines.join('\n'), { name: `${uniqueAppId}-details.txt` });

  // Add all uploaded document files
  for (const [fieldName, meta] of Object.entries(filesMap)) {
    if (!meta || !meta.storedName) continue;
    const filePath = path.join(uploadDir, path.basename(meta.storedName));
    if (fs.existsSync(filePath)) {
      const ext = path.extname(meta.storedName);
      archive.file(filePath, { name: `${fieldName}${ext}` });
    }
  }

  archive.finalize();
});

// Mark application Completed with official tracking details
router.put('/applications/:uniqueAppId/complete', (req, res) => {
  const uniqueAppId = String(req.params.uniqueAppId || '').trim();
  const trackingLink = String(req.body.tracking_link || '').trim();
  const applicationNumber = String(req.body.application_number || '').trim();
  const trackingDob = String(req.body.tracking_dob || '').trim();

  if (!trackingLink || !applicationNumber || !trackingDob) {
    return res.status(400).json({
      error: 'Tracking Link, Official Application Number, and Date of Birth are all required.'
    });
  }

  const existing = db.prepare('SELECT * FROM applications WHERE unique_app_id = ?').get(uniqueAppId);
  if (!existing) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  db.prepare(`
    UPDATE applications
    SET status = 'Completed',
        is_locked = 1,
        tracking_link = ?,
        application_number = ?,
        tracking_dob = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE unique_app_id = ?
  `).run(trackingLink, applicationNumber, trackingDob, uniqueAppId);

  const updated = db.prepare(`
    SELECT a.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
           s.service_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN services s ON s.folder_slug = a.service_slug
    WHERE a.unique_app_id = ?
  `).get(uniqueAppId);

  return res.json({
    message: 'Application marked as Completed.',
    application: formatAdminApplication(updated)
  });
});

// --- Dynamic Service Manager (Folder-Based Service Builder) ---
router.get('/services', (req, res) => {
  const rows = db.prepare('SELECT * FROM services ORDER BY id ASC').all();
  const services = rows.map((row) => ({
    id: row.id,
    service_name: row.service_name,
    folder_slug: row.folder_slug,
    id_prefix: row.id_prefix,
    service_fee: Number(row.service_fee),
    payment_enabled: Boolean(row.payment_enabled),
    is_active: Boolean(row.is_active),
    config: parseJsonSafe(row.config_json, {}),
    created_at: row.created_at
  }));
  res.json({ services });
});

router.post('/services', (req, res) => {
  try {
    const serviceName = String(req.body.service_name || '').trim();
    const rawSlug = String(req.body.folder_slug || serviceName);
    const folderSlug = sanitizeSlug(rawSlug);
    const idPrefix = String(req.body.id_prefix || folderSlug.slice(0, 3)).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'DOC';
    const serviceFee = Number(req.body.service_fee ?? 100);
    const paymentEnabled = req.body.payment_enabled !== false;
    const isActive = req.body.is_active !== false;
    const description = String(req.body.description || '').trim();
    const estimatedTime = String(req.body.estimated_time || '3 - 5 Working Days').trim();
    const fields = Array.isArray(req.body.fields) ? req.body.fields : [];

    if (!serviceName || !folderSlug || folderSlug.startsWith('_')) {
      return res.status(400).json({ error: 'Valid Service Name and Slug are required.' });
    }
    if (Number.isNaN(serviceFee) || serviceFee < 0) {
      return res.status(400).json({ error: 'Service fee must be a valid non-negative number.' });
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Please define at least one form field for the service.' });
    }

    const exists = db.prepare('SELECT id FROM services WHERE folder_slug = ?').get(folderSlug);
    if (exists) {
      return res.status(409).json({ error: `A service with slug "${folderSlug}" already exists.` });
    }

    const configObj = {
      service_name: serviceName,
      folder_slug: folderSlug,
      id_prefix: idPrefix,
      service_fee: serviceFee,
      payment_enabled: paymentEnabled,
      is_active: isActive,
      description,
      estimated_time: estimatedTime,
      fields
    };

    // Create /services/<folder_slug>/ directory + config.json + form.html from _template
    const newServiceDir = path.join(SERVICES_DIR, folderSlug);
    fs.mkdirSync(newServiceDir, { recursive: true });
    fs.writeFileSync(path.join(newServiceDir, 'config.json'), JSON.stringify(configObj, null, 2), 'utf8');

    const templateFormPath = path.join(SERVICES_DIR, '_template', 'form.html');
    if (fs.existsSync(templateFormPath)) {
      fs.copyFileSync(templateFormPath, path.join(newServiceDir, 'form.html'));
    }

    db.prepare(`
      INSERT INTO services (service_name, folder_slug, id_prefix, service_fee, payment_enabled, config_json, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      serviceName,
      folderSlug,
      idPrefix,
      serviceFee,
      paymentEnabled ? 1 : 0,
      JSON.stringify(configObj),
      isActive ? 1 : 0
    );

    return res.status(201).json({
      message: `Service "${serviceName}" created in /services/${folderSlug}/`,
      service: configObj
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to create service.' });
  }
});

router.put('/services/:slug', (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const existing = db.prepare('SELECT * FROM services WHERE folder_slug = ?').get(slug);
    if (!existing) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    const currentConfig = parseJsonSafe(existing.config_json, {});
    const serviceName = req.body.service_name !== undefined ? String(req.body.service_name).trim() : existing.service_name;
    const idPrefix = req.body.id_prefix !== undefined
      ? String(req.body.id_prefix).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)
      : existing.id_prefix;
    const serviceFee = req.body.service_fee !== undefined ? Number(req.body.service_fee) : Number(existing.service_fee);
    const paymentEnabled = req.body.payment_enabled !== undefined ? Boolean(req.body.payment_enabled) : Boolean(existing.payment_enabled);
    const isActive = req.body.is_active !== undefined ? Boolean(req.body.is_active) : Boolean(existing.is_active);
    const description = req.body.description !== undefined ? String(req.body.description).trim() : (currentConfig.description || '');
    const estimatedTime = req.body.estimated_time !== undefined ? String(req.body.estimated_time).trim() : (currentConfig.estimated_time || '3 - 5 Working Days');
    const fields = Array.isArray(req.body.fields) ? req.body.fields : (currentConfig.fields || []);

    if (Number.isNaN(serviceFee) || serviceFee < 0) {
      return res.status(400).json({ error: 'Invalid service_fee.' });
    }

    const updatedConfig = {
      ...currentConfig,
      service_name: serviceName,
      folder_slug: slug,
      id_prefix: idPrefix,
      service_fee: serviceFee,
      payment_enabled: paymentEnabled,
      is_active: isActive,
      description,
      estimated_time: estimatedTime,
      fields
    };

    const configPath = path.join(SERVICES_DIR, slug, 'config.json');
    if (fs.existsSync(path.dirname(configPath))) {
      fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
    }

    db.prepare(`
      UPDATE services
      SET service_name = ?, id_prefix = ?, service_fee = ?, payment_enabled = ?, config_json = ?, is_active = ?
      WHERE folder_slug = ?
    `).run(
      serviceName,
      idPrefix,
      serviceFee,
      paymentEnabled ? 1 : 0,
      JSON.stringify(updatedConfig),
      isActive ? 1 : 0,
      slug
    );

    return res.json({ message: 'Service updated successfully.', service: updatedConfig });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update service.' });
  }
});

// --- Payment & Site Customizer Settings ---
router.get('/settings', (req, res) => {
  const settings = getAdminSiteSettings();
  const services = db.prepare('SELECT id, service_name, folder_slug, id_prefix, service_fee, payment_enabled, is_active FROM services ORDER BY id ASC').all();
  res.json({
    settings,
    services: services.map((s) => ({
      ...s,
      service_fee: Number(s.service_fee),
      payment_enabled: Boolean(s.payment_enabled),
      is_active: Boolean(s.is_active)
    }))
  });
});

router.put('/settings/payment', (req, res) => {
  try {
    const {
      payment_gateway,
      gateway_key_id,
      gateway_key_secret,
      webhook_secret,
      test_mode,
      upi_id,
      upi_merchant_name,
      service_pricing
    } = req.body;

    const current = getAdminSiteSettings();

    db.prepare(`
      UPDATE site_settings
      SET payment_gateway = ?,
          gateway_key_id = ?,
          gateway_key_secret = ?,
          webhook_secret = ?,
          test_mode = ?,
          upi_id = ?,
          upi_merchant_name = ?
      WHERE id = 1
    `).run(
      payment_gateway || current.payment_gateway,
      gateway_key_id !== undefined ? String(gateway_key_id).trim() : current.gateway_key_id,
      gateway_key_secret !== undefined ? String(gateway_key_secret).trim() : current.gateway_key_secret,
      webhook_secret !== undefined && String(webhook_secret).trim() ? String(webhook_secret).trim() : current.webhook_secret,
      test_mode !== undefined ? (test_mode ? 1 : 0) : (current.test_mode ? 1 : 0),
      upi_id !== undefined ? String(upi_id).trim() : current.upi_id,
      upi_merchant_name !== undefined ? String(upi_merchant_name).trim() : current.upi_merchant_name
    );

    // Update per-service pricing & payment toggles immediately
    if (Array.isArray(service_pricing)) {
      for (const item of service_pricing) {
        if (!item.folder_slug) continue;
        const row = db.prepare('SELECT * FROM services WHERE folder_slug = ?').get(item.folder_slug);
        if (!row) continue;
        const fee = Number(item.service_fee);
        if (Number.isNaN(fee) || fee < 0) continue;
        const payEnabled = item.payment_enabled !== false;
        const cfg = parseJsonSafe(row.config_json, {});
        cfg.service_fee = fee;
        cfg.payment_enabled = payEnabled;

        db.prepare(`
          UPDATE services SET service_fee = ?, payment_enabled = ?, config_json = ? WHERE folder_slug = ?
        `).run(fee, payEnabled ? 1 : 0, JSON.stringify(cfg), item.folder_slug);

        const cfgPath = path.join(SERVICES_DIR, item.folder_slug, 'config.json');
        if (fs.existsSync(cfgPath)) {
          fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
        }
      }
    }

    return res.json({
      message: 'Payment gateway settings & service pricing saved.',
      settings: getAdminSiteSettings()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save payment settings.' });
  }
});

router.put('/settings/site', (req, res) => {
  try {
    const current = getAdminSiteSettings();
    const b = req.body || {};

    const customTexts = {
      ...(current.custom_texts || {}),
      ...(b.custom_texts || {})
    };
    const featureFlags = {
      ...(current.feature_flags || {}),
      ...(b.feature_flags || {})
    };

    db.prepare(`
      UPDATE site_settings
      SET site_name = ?,
          support_whatsapp = ?,
          support_email = ?,
          font_family = ?,
          font_size = ?,
          text_format = ?,
          primary_color = ?,
          secondary_color = ?,
          background_color = ?,
          custom_texts_json = ?,
          feature_flags_json = ?
      WHERE id = 1
    `).run(
      b.site_name !== undefined ? String(b.site_name).trim() : current.site_name,
      b.support_whatsapp !== undefined ? String(b.support_whatsapp).replace(/\D/g, '') : current.support_whatsapp,
      b.support_email !== undefined ? String(b.support_email).trim() : current.support_email,
      b.font_family !== undefined ? String(b.font_family).trim() : current.font_family,
      b.font_size !== undefined ? String(b.font_size).trim() : current.font_size,
      b.text_format !== undefined ? String(b.text_format).trim() : current.text_format,
      b.primary_color !== undefined ? String(b.primary_color).trim() : current.primary_color,
      b.secondary_color !== undefined ? String(b.secondary_color).trim() : current.secondary_color,
      b.background_color !== undefined ? String(b.background_color).trim() : current.background_color,
      JSON.stringify(customTexts),
      JSON.stringify(featureFlags)
    );

    return res.json({
      message: 'Website appearance & support settings updated live.',
      settings: getAdminSiteSettings()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save site settings.' });
  }
});

module.exports = router;

