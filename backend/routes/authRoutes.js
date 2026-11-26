const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { signToken, authenticateToken } = require('../middleware/auth');
const { getPublicSiteSettings } = require('../utils/helpers');

const router = express.Router();

// Customer Registration
router.post('/signup', (req, res) => {
  try {
    const settings = getPublicSiteSettings();
    if (settings.feature_flags && settings.feature_flags.allow_registration === false) {
      return res.status(403).json({ error: 'New customer registration is currently disabled by administrator.' });
    }

    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Full Name is required (at least 2 characters).' });
    }
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Valid 10-digit Mobile Number is required.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid Email ID.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (existing) {
      return res.status(409).json({ error: 'An account with this Mobile Number already exists.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, phone, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'customer')
    `).run(name, phone, email || null, passwordHash);

    const user = db.prepare('SELECT id, name, phone, email, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = signToken(user);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Signup failed.' });
  }
});

// Shared login handler with optional role enforcement
function handleLogin(req, res, expectedRole = null) {
  try {
    const identifier = String(req.body.identifier || req.body.phone || req.body.email || '').trim();
    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Mobile Number (or Email) and Password are required.' });
    }

    const userRow = db
      .prepare('SELECT id, name, phone, email, password_hash, role, created_at FROM users WHERE phone = ? OR LOWER(email) = LOWER(?)')
      .get(identifier, identifier);

    if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (expectedRole && userRow.role !== expectedRole) {
      return res.status(403).json({
        error: expectedRole === 'admin'
          ? 'Access denied. Administrator account required.'
          : 'Please use the Admin Login portal for administrator accounts.'
      });
    }

    const user = {
      id: userRow.id,
      name: userRow.name,
      phone: userRow.phone,
      email: userRow.email,
      role: userRow.role,
      created_at: userRow.created_at
    };

    const token = signToken(user);
    return res.json({ message: 'Login successful.', token, user });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Login failed.' });
  }
}

router.post('/login', (req, res) => handleLogin(req, res, 'customer'));
router.post('/admin/login', (req, res) => handleLogin(req, res, 'admin'));

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;

