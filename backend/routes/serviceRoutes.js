const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, SERVICES_DIR, syncServiceFolders } = require('../db/database');
const { parseJsonSafe, getPublicSiteSettings } = require('../utils/helpers');

const router = express.Router();

// Public Site Settings (for theme-loader.js & customer support)
router.get('/settings/public', (req, res) => {
  res.json({ settings: getPublicSiteSettings() });
});

// List all active folder-based services
router.get('/services', (req, res) => {
  syncServiceFolders();
  const includeInactive = req.query.all === '1';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM services ORDER BY id ASC').all()
    : db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY id ASC').all();

  const services = rows.map((row) => {
    const config = parseJsonSafe(row.config_json, {});
    const serviceFolder = path.join(SERVICES_DIR, row.folder_slug);
    const hasCustomForm = fs.existsSync(path.join(serviceFolder, 'form.html'));
    const hasCustomScript = fs.existsSync(path.join(serviceFolder, `${row.folder_slug}.js`));

    return {
      id: row.id,
      service_name: row.service_name,
      folder_slug: row.folder_slug,
      id_prefix: row.id_prefix,
      service_fee: Number(row.service_fee),
      payment_enabled: Boolean(row.payment_enabled),
      is_active: Boolean(row.is_active),
      description: config.description || '',
      estimated_time: config.estimated_time || '3 - 5 Working Days',
      fields: Array.isArray(config.fields) ? config.fields : [],
      has_custom_form: hasCustomForm,
      has_custom_script: hasCustomScript,
      created_at: row.created_at
    };
  });

  res.json({ services });
});

// Get single service config
router.get('/services/:slug', (req, res) => {
  const slug = String(req.params.slug || '').trim();
  const row = db.prepare('SELECT * FROM services WHERE folder_slug = ?').get(slug);
  if (!row) {
    return res.status(404).json({ error: 'Service not found.' });
  }

  const config = parseJsonSafe(row.config_json, {});
  const serviceFolder = path.join(SERVICES_DIR, row.folder_slug);

  return res.json({
    service: {
      id: row.id,
      service_name: row.service_name,
      folder_slug: row.folder_slug,
      id_prefix: row.id_prefix,
      service_fee: Number(row.service_fee),
      payment_enabled: Boolean(row.payment_enabled),
      is_active: Boolean(row.is_active),
      description: config.description || '',
      estimated_time: config.estimated_time || '3 - 5 Working Days',
      fields: Array.isArray(config.fields) ? config.fields : [],
      has_custom_form: fs.existsSync(path.join(serviceFolder, 'form.html')),
      has_custom_script: fs.existsSync(path.join(serviceFolder, `${row.folder_slug}.js`)),
      config
    }
  });
});

module.exports = router;

