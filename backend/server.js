const path = require('path');
const express = require('express');
const { initializeDatabase } = require('./db/database');
const { ensureUploadsRoot } = require('./utils/helpers');

const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

// Initialize DB & storage directories before registering routes
initializeDatabase();
ensureUploadsRoot();

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Capture raw body for cryptographic webhook signature verification
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  })
);
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api', serviceRoutes);

// Static Frontend Panels (Strictly excluding /backend so DB/uploads remain protected)
app.use('/auth', express.static(path.join(PROJECT_ROOT, 'auth')));
app.use('/customer', express.static(path.join(PROJECT_ROOT, 'customer')));
app.use('/admin', express.static(path.join(PROJECT_ROOT, 'admin')));
app.use('/services', express.static(path.join(PROJECT_ROOT, 'services')));
app.use('/shared', express.static(path.join(PROJECT_ROOT, 'shared')));

// Full-colour Index website at root
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'index.html'));
});

// Fallback JSON error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Srikanth Online Seva Portal running at http://localhost:${PORT}`);
  });
}

module.exports = app;

