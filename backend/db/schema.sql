-- Database Schema for Online PAN Card & Document Service Portal
-- Compatible with SQLite (via Node.js built-in node:sqlite) and standard SQL databases

PRAGMA foreign_keys = ON;

-- 1. Users table (Customers & Admins)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Services table (Synced with /services/<folder_slug>/config.json)
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_name TEXT NOT NULL,
  folder_slug TEXT NOT NULL UNIQUE,
  id_prefix TEXT NOT NULL DEFAULT 'APP',
  service_fee REAL NOT NULL DEFAULT 150.00,
  payment_enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_services_slug ON services(folder_slug);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);

-- 3. Applications table
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unique_app_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  service_slug TEXT NOT NULL,
  form_data_json TEXT NOT NULL DEFAULT '{}',
  files_json TEXT NOT NULL DEFAULT '{}',
  order_id TEXT,
  gateway_payment_id TEXT,
  payment_amount REAL NOT NULL DEFAULT 0.00,
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Paid', 'Failed')),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending', 'Applied', 'Completed')),
  is_locked INTEGER NOT NULL DEFAULT 0,
  downloaded_at DATETIME,
  tracking_link TEXT,
  application_number TEXT,
  tracking_dob TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (service_slug) REFERENCES services(folder_slug) ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_app_id ON applications(unique_app_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_order_id ON applications(order_id);
CREATE INDEX IF NOT EXISTS idx_applications_payment_status ON applications(payment_status);

-- 4. Site Settings table (Singleton config row id = 1)
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT NOT NULL DEFAULT 'Srikanth Online Seva',
  support_whatsapp TEXT NOT NULL DEFAULT '7997284383',
  support_email TEXT NOT NULL DEFAULT 'ffpunjugaming@gmail.com',
  payment_gateway TEXT NOT NULL DEFAULT 'razorpay',
  gateway_key_id TEXT NOT NULL DEFAULT '',
  gateway_key_secret TEXT NOT NULL DEFAULT '',
  webhook_secret TEXT NOT NULL DEFAULT 'srikanth_seva_webhook_secret_2026',
  test_mode INTEGER NOT NULL DEFAULT 1,
  upi_id TEXT NOT NULL DEFAULT '7997284383@ybl',
  upi_merchant_name TEXT NOT NULL DEFAULT 'Srikanth Online Seva',
  font_family TEXT NOT NULL DEFAULT 'Inter',
  font_size TEXT NOT NULL DEFAULT '16px',
  text_format TEXT NOT NULL DEFAULT 'none',
  primary_color TEXT NOT NULL DEFAULT '#1d4ed8',
  secondary_color TEXT NOT NULL DEFAULT '#0f766e',
  background_color TEXT NOT NULL DEFAULT '#f8fafc',
  custom_texts_json TEXT NOT NULL DEFAULT '{}',
  feature_flags_json TEXT NOT NULL DEFAULT '{}'
);

