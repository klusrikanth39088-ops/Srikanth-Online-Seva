const fs = require('fs');
const path = require('path');
const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadMiddleware, saveFilesForApplication } = require('../middleware/upload');
const { generateUniqueAppId, parseJsonSafe, getAppUploadDir } = require('../utils/helpers');

const router = express.Router();

router.use(authenticateToken, requireRole('customer', 'admin'));

function formatApplicationRow(row) {
  if (!row) return null;
  const service = db
    .prepare('SELECT service_name, folder_slug, id_prefix, service_fee, payment_enabled FROM services WHERE folder_slug = ?')
    .get(row.service_slug);

  return {
    id: row.id,
    unique_app_id: row.unique_app_id,
    user_id: row.user_id,
    service_slug: row.service_slug,
    service_name: service ? service.service_name : row.service_slug,
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

function validateServiceSubmission(serviceRow, body, uploadedFiles, isEdit = false, existingFiles = {}) {
  const config = parseJsonSafe(serviceRow.config_json, {});
  const fields = Array.isArray(config.fields) ? config.fields : [];
  const errors = [];
  const uploadedFieldSet = new Set(uploadedFiles.map((f) => f.fieldname));

  for (const field of fields) {
    const val = body[field.name] !== undefined ? String(body[field.name]).trim() : '';

    // Conditional requirement check
    let isRequired = Boolean(field.required);
    if (field.conditional_on && field.conditional_on.field) {
      const parentVal = body[field.conditional_on.field] !== undefined
        ? String(body[field.conditional_on.field]).trim()
        : '';
      if (parentVal === String(field.conditional_on.value)) {
        isRequired = true;
      } else {
        isRequired = false;
      }
    }

    if (field.type === 'file') {
      const hasNew = uploadedFieldSet.has(field.name);
      const hasExisting = isEdit && Boolean(existingFiles[field.name]);
      if (isRequired && !hasNew && !hasExisting) {
        errors.push(`${field.label} is mandatory.`);
      }
      continue;
    }

    if (isRequired && !val) {
      errors.push(`${field.label} is mandatory.`);
      continue;
    }

    if (val && field.pattern) {
      const regex = new RegExp(field.pattern);
      if (!regex.test(val)) {
        errors.push(`${field.label} format is invalid.`);
      }
    }

    if (val && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      errors.push(`${field.label} must be a valid email address.`);
    }
  }

  return errors;
}

// List logged-in customer's applications
router.get('/applications', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(req.user.id);

  res.json({
    applications: rows.map(formatApplicationRow)
  });
});

// Get single application for logged-in customer
router.get('/applications/:uniqueAppId', (req, res) => {
  const uniqueAppId = String(req.params.uniqueAppId || '').trim();
  const row = db
    .prepare('SELECT * FROM applications WHERE unique_app_id = ? AND user_id = ?')
    .get(uniqueAppId, req.user.id);

  if (!row) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  return res.json({ application: formatApplicationRow(row) });
});

// Submit new application (creates Draft/Unpaid state or Pending if payment disabled)
router.post('/applications', (req, res) => {
  uploadMiddleware.any()(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'File upload validation failed.' });
    }

    try {
      const serviceSlug = String(req.body.service_slug || '').trim();
      if (!serviceSlug) {
        return res.status(400).json({ error: 'service_slug is required.' });
      }

      const service = db
        .prepare('SELECT * FROM services WHERE folder_slug = ? AND is_active = 1')
        .get(serviceSlug);
      if (!service) {
        return res.status(404).json({ error: 'Selected service is unavailable or inactive.' });
      }

      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      const validationErrors = validateServiceSubmission(service, req.body, uploadedFiles, false, {});
      if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors[0], errors: validationErrors });
      }

      const uniqueAppId = generateUniqueAppId(service.id_prefix);
      const savedFiles = saveFilesForApplication(uniqueAppId, uploadedFiles, {});

      // Build clean form_data object excluding internal keys
      const formData = {};
      for (const [k, v] of Object.entries(req.body || {})) {
        if (k === 'service_slug') continue;
        formData[k] = typeof v === 'string' ? v.trim() : v;
      }

      const paymentRequired = Boolean(service.payment_enabled) && Number(service.service_fee) > 0;
      const paymentAmount = paymentRequired ? Number(service.service_fee) : 0;
      const paymentStatus = paymentRequired ? 'Unpaid' : 'Paid';
      const status = paymentRequired ? 'Draft' : 'Pending';

      db.prepare(`
        INSERT INTO applications (
          unique_app_id, user_id, service_slug, form_data_json, files_json,
          payment_amount, payment_status, status, is_locked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        uniqueAppId,
        req.user.id,
        service.folder_slug,
        JSON.stringify(formData),
        JSON.stringify(savedFiles),
        paymentAmount,
        paymentStatus,
        status
      );

      const created = db.prepare('SELECT * FROM applications WHERE unique_app_id = ?').get(uniqueAppId);

      return res.status(201).json({
        message: paymentRequired
          ? 'Application draft saved. Proceed to Dynamic UPI QR payment.'
          : 'Application submitted successfully.',
        payment_required: paymentRequired,
        application: formatApplicationRow(created)
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to submit application.' });
    }
  });
});

// Edit application before Admin downloads documents
router.put('/applications/:uniqueAppId', (req, res) => {
  uploadMiddleware.any()(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'File upload validation failed.' });
    }

    try {
      const uniqueAppId = String(req.params.uniqueAppId || '').trim();
      const existing = db
        .prepare('SELECT * FROM applications WHERE unique_app_id = ? AND user_id = ?')
        .get(uniqueAppId, req.user.id);

      if (!existing) {
        return res.status(404).json({ error: 'Application not found.' });
      }

      if (existing.is_locked || (existing.status !== 'Pending' && existing.status !== 'Draft')) {
        return res.status(403).json({
          error: 'Application locked — documents downloaded and under processing.'
        });
      }

      const service = db
        .prepare('SELECT * FROM services WHERE folder_slug = ?')
        .get(existing.service_slug);
      if (!service) {
        return res.status(404).json({ error: 'Service definition not found.' });
      }

      const currentFiles = parseJsonSafe(existing.files_json, {});
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      const validationErrors = validateServiceSubmission(service, req.body, uploadedFiles, true, currentFiles);
      if (validationErrors.length > 0) {
        return res.status(400).json({ error: validationErrors[0], errors: validationErrors });
      }

      const updatedFiles = saveFilesForApplication(uniqueAppId, uploadedFiles, currentFiles);
      const currentFormData = parseJsonSafe(existing.form_data_json, {});
      const nextFormData = { ...currentFormData };
      for (const [k, v] of Object.entries(req.body || {})) {
        if (k === 'service_slug') continue;
        nextFormData[k] = typeof v === 'string' ? v.trim() : v;
      }

      db.prepare(`
        UPDATE applications
        SET form_data_json = ?, files_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE unique_app_id = ? AND user_id = ?
      `).run(JSON.stringify(nextFormData), JSON.stringify(updatedFiles), uniqueAppId, req.user.id);

      const updated = db.prepare('SELECT * FROM applications WHERE unique_app_id = ?').get(uniqueAppId);
      return res.json({
        message: 'Application updated successfully.',
        application: formatApplicationRow(updated)
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to update application.' });
    }
  });
});

// Protected file access for owning customer
router.get('/applications/:uniqueAppId/files/:storedName', (req, res) => {
  const uniqueAppId = String(req.params.uniqueAppId || '').trim();
  const storedName = path.basename(String(req.params.storedName || ''));

  const appRow = db
    .prepare('SELECT * FROM applications WHERE unique_app_id = ?')
    .get(uniqueAppId);

  if (!appRow) {
    return res.status(404).json({ error: 'Application not found.' });
  }
  if (appRow.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied to this document.' });
  }

  const filePath = path.join(getAppUploadDir(uniqueAppId), storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Requested file not found.' });
  }

  if (req.query.download === '1') {
    return res.download(filePath, storedName);
  }
  return res.sendFile(filePath);
});

module.exports = router;

