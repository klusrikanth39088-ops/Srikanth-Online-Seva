const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');

const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');

function ensureUploadsRoot() {
  if (!fs.existsSync(UPLOADS_ROOT)) {
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
  }
}

function getAppUploadDir(uniqueAppId) {
  ensureUploadsRoot();
  const safeId = String(uniqueAppId).replace(/[^A-Za-z0-9_-]/g, '');
  const dir = path.join(UPLOADS_ROOT, safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function generateUniqueAppId(prefix = 'APP') {
  const cleanPrefix = String(prefix || 'APP').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'APP';
  const year = new Date().getFullYear();
  const pattern = `${cleanPrefix}-${year}-%`;

  const rows = db
    .prepare('SELECT unique_app_id FROM applications WHERE unique_app_id LIKE ?')
    .all(pattern);

  let maxSeq = 0;
  for (const row of rows) {
    const parts = String(row.unique_app_id).split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  }

  let nextSeq = maxSeq + 1;
  while (true) {
    const candidate = `${cleanPrefix}-${year}-${String(nextSeq).padStart(4, '0')}`;
    const exists = db.prepare('SELECT 1 FROM applications WHERE unique_app_id = ?').get(candidate);
    if (!exists) return candidate;
    nextSeq += 1;
  }
}

function parseJsonSafe(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function getRawSettings() {
  return db.prepare('SELECT * FROM site_settings WHERE id = 1').get() || {};
}

function getPublicSiteSettings() {
  const row = getRawSettings();
  return {
    site_name: row.site_name || 'Srikanth Online Seva',
    support_whatsapp: row.support_whatsapp || '7997284383',
    support_email: row.support_email || 'ffpunjugaming@gmail.com',
    payment_gateway: row.payment_gateway || 'razorpay',
    test_mode: Boolean(row.test_mode),
    font_family: row.font_family || 'Inter',
    font_size: row.font_size || '16px',
    text_format: row.text_format || 'none',
    primary_color: row.primary_color || '#1d4ed8',
    secondary_color: row.secondary_color || '#0f766e',
    background_color: row.background_color || '#f8fafc',
    custom_texts: parseJsonSafe(row.custom_texts_json, {}),
    feature_flags: parseJsonSafe(row.feature_flags_json, {})
  };
}

function getAdminSiteSettings() {
  const row = getRawSettings();
  return {
    ...getPublicSiteSettings(),
    gateway_key_id: row.gateway_key_id || '',
    gateway_key_secret: row.gateway_key_secret || '',
    webhook_secret: row.webhook_secret || '',
    upi_id: row.upi_id || '7997284383@ybl',
    upi_merchant_name: row.upi_merchant_name || 'Srikanth Online Seva'
  };
}

function sanitizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  UPLOADS_ROOT,
  ensureUploadsRoot,
  getAppUploadDir,
  generateUniqueAppId,
  parseJsonSafe,
  getRawSettings,
  getPublicSiteSettings,
  getAdminSiteSettings,
  sanitizeSlug
};

