const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'portal.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SERVICES_DIR = path.resolve(__dirname, '../../services');

const db = new DatabaseSync(DB_PATH);

function initializeDatabase() {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schemaSql);

  // Seed default site_settings row (id = 1) if missing
  const existingSettings = db.prepare('SELECT id FROM site_settings WHERE id = 1').get();
  if (!existingSettings) {
    const defaultCustomTexts = JSON.stringify({
      logo_text: 'Srikanth Online Seva',
      announcement_banner: 'Fast, Trusted & Automated Online PAN Card and Document Services',
      welcome_title: 'Apply for PAN Card & Government Document Services Online',
      welcome_subtitle: 'Upload documents or capture with camera, pay via instant Dynamic UPI QR, and track status in real time.',
      apply_cta_label: 'Apply & Pay via UPI QR',
      footer_note: 'Authorized Digital Document Facilitation Center'
    });

    const defaultFeatureFlags = JSON.stringify({
      camera_capture: true,
      show_email_field: true,
      allow_registration: true,
      floating_support_widget: true,
      heading_weight: '700',
      text_align: 'left'
    });

    db.prepare(`
      INSERT INTO site_settings (
        id, site_name, support_whatsapp, support_email,
        payment_gateway, gateway_key_id, gateway_key_secret, webhook_secret, test_mode,
        upi_id, upi_merchant_name,
        font_family, font_size, text_format, primary_color, secondary_color, background_color,
        custom_texts_json, feature_flags_json
      ) VALUES (
        1, 'Srikanth Online Seva', '7997284383', 'ffpunjugaming@gmail.com',
        'razorpay', '', '', 'srikanth_seva_webhook_secret_2026', 1,
        '7997284383@ybl', 'Srikanth Online Seva',
        'Inter', '16px', 'none', '#1d4ed8', '#0f766e', '#f8fafc',
        ?, ?
      )
    `).run(defaultCustomTexts, defaultFeatureFlags);
  }

  // Seed default Admin user if no admin exists
  const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!existingAdmin) {
    const adminHash = bcrypt.hashSync('Admin@123', 10);
    db.prepare(`
      INSERT INTO users (name, phone, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'admin')
    `).run('Portal Administrator', '9999999999', 'ffpunjugaming@gmail.com', adminHash);
  }

  // Sync /services folders into services table
  syncServiceFolders();
}

function syncServiceFolders() {
  if (!fs.existsSync(SERVICES_DIR)) return;
  const entries = fs.readdirSync(SERVICES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) {
      continue;
    }
    const configPath = path.join(SERVICES_DIR, entry.name, 'config.json');
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);
      const slug = config.folder_slug || entry.name;
      const existing = db.prepare('SELECT id FROM services WHERE folder_slug = ?').get(slug);

      if (!existing) {
        db.prepare(`
          INSERT INTO services (service_name, folder_slug, id_prefix, service_fee, payment_enabled, config_json, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          config.service_name || slug,
          slug,
          (config.id_prefix || slug.slice(0, 3)).toUpperCase(),
          Number(config.service_fee ?? 100),
          config.payment_enabled === false ? 0 : 1,
          JSON.stringify(config),
          config.is_active === false ? 0 : 1
        );
      }
    } catch (err) {
      console.error(`Failed to sync service folder "${entry.name}":`, err.message);
    }
  }
}

module.exports = {
  db,
  initializeDatabase,
  syncServiceFolders,
  SERVICES_DIR
};

