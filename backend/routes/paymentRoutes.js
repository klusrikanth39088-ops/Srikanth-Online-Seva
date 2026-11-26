const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { db } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { getAdminSiteSettings } = require('../utils/helpers');

const router = express.Router();

// In-memory TTL tracker for dynamic QR countdown (5 minutes)
const orderExpiryMap = new Map();

function buildUpiUri({ upiId, merchantName, amount, uniqueAppId, orderId }) {
  const params = new URLSearchParams({
    pa: upiId || '7997284383@ybl',
    pn: merchantName || 'Srikanth Online Seva',
    am: Number(amount).toFixed(2),
    cu: 'INR',
    tn: `${uniqueAppId} Service Fee`,
    tr: orderId
  });
  return `upi://pay?${params.toString()}`;
}

async function createLiveGatewayOrder({ settings, amount, uniqueAppId, receiptOrderId }) {
  const gateway = settings.payment_gateway || 'razorpay';

  if (gateway === 'razorpay' && settings.gateway_key_id && settings.gateway_key_secret) {
    const auth = Buffer.from(`${settings.gateway_key_id}:${settings.gateway_key_secret}`).toString('base64');
    const resp = await fetch('https://api.razorpay.com/v1/payments/qr_codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify({
        type: 'upi_qr',
        name: `${settings.site_name} - ${uniqueAppId}`,
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: Math.round(Number(amount) * 100),
        description: `Service fee for ${uniqueAppId}`,
        notes: { unique_app_id: uniqueAppId, receipt: receiptOrderId }
      })
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Razorpay QR API Error: ${errBody}`);
    }
    const data = await resp.json();
    return {
      orderId: data.id || receiptOrderId,
      upiUri: data.image_content || null,
      externalQrUrl: data.image_url || null
    };
  }

  if (gateway === 'cashfree' && settings.gateway_key_id && settings.gateway_key_secret) {
    const resp = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': settings.gateway_key_id,
        'x-client-secret': settings.gateway_key_secret,
        'x-api-version': '2023-08-01'
      },
      body: JSON.stringify({
        order_id: receiptOrderId,
        order_amount: Number(amount),
        order_currency: 'INR',
        order_note: `Application ${uniqueAppId}`
      })
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Cashfree API Error: ${errBody}`);
    }
    const data = await resp.json();
    return {
      orderId: data.order_id || receiptOrderId,
      upiUri: null,
      paymentSessionId: data.payment_session_id || null
    };
  }

  throw new Error(`Live gateway credentials for "${gateway}" are not configured. Enable Test/Sandbox Mode or add valid API keys in Admin Payment Settings.`);
}

// Create Dynamic UPI QR Order
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const uniqueAppId = String(req.body.unique_app_id || '').trim();
    if (!uniqueAppId) {
      return res.status(400).json({ error: 'unique_app_id is required.' });
    }

    const appRow = db
      .prepare('SELECT * FROM applications WHERE unique_app_id = ?')
      .get(uniqueAppId);

    if (!appRow) {
      return res.status(404).json({ error: 'Application not found.' });
    }
    if (appRow.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to pay for this application.' });
    }
    if (appRow.payment_status === 'Paid') {
      return res.json({
        already_paid: true,
        order_id: appRow.order_id,
        unique_app_id: appRow.unique_app_id,
        amount: Number(appRow.payment_amount),
        payment_status: 'Paid'
      });
    }

    const service = db
      .prepare('SELECT * FROM services WHERE folder_slug = ?')
      .get(appRow.service_slug);
    if (!service) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    // Authoritative fee comes from database, never from client request
    const amount = Number(service.service_fee);
    const settings = getAdminSiteSettings();
    const receiptOrderId = `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    let finalOrderId = receiptOrderId;
    let upiUri = buildUpiUri({
      upiId: settings.upi_id,
      merchantName: settings.upi_merchant_name || settings.site_name,
      amount,
      uniqueAppId,
      orderId: receiptOrderId
    });
    let externalQrUrl = null;

    if (!settings.test_mode) {
      const liveResult = await createLiveGatewayOrder({
        settings,
        amount,
        uniqueAppId,
        receiptOrderId
      });
      finalOrderId = liveResult.orderId || receiptOrderId;
      if (liveResult.upiUri && liveResult.upiUri.startsWith('upi://')) {
        upiUri = liveResult.upiUri;
      }
      externalQrUrl = liveResult.externalQrUrl || null;
    }

    const qrDataUrl = await QRCode.toDataURL(upiUri, {
      width: 280,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    db.prepare(`
      UPDATE applications
      SET order_id = ?, payment_amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE unique_app_id = ?
    `).run(finalOrderId, amount, uniqueAppId);

    const expiresAt = Date.now() + 5 * 60 * 1000;
    orderExpiryMap.set(finalOrderId, expiresAt);

    return res.json({
      order_id: finalOrderId,
      unique_app_id: uniqueAppId,
      service_name: service.service_name,
      amount,
      upi_uri: upiUri,
      qr_data_url: qrDataUrl,
      external_qr_url: externalQrUrl,
      gateway: settings.payment_gateway,
      test_mode: Boolean(settings.test_mode),
      expires_in_seconds: 300,
      expires_at: expiresAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to generate UPI QR order.' });
  }
});

// Shared cryptographic verification and order settlement
function verifyAndSettleWebhook(rawBody, signatureHeader) {
  const settings = getAdminSiteSettings();
  const secret = settings.webhook_secret || '';
  if (!secret) {
    throw new Error('Webhook secret is not configured.');
  }
  if (!signatureHeader) {
    throw new Error('Missing webhook signature header.');
  }

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const sigClean = String(signatureHeader).trim();
  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const receivedBuf = Buffer.from(sigClean, 'utf8');

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error('Invalid webhook signature.');
  }

  const payload = JSON.parse(rawBody);
  const orderId =
    payload.order_id ||
    payload?.payload?.payment?.entity?.order_id ||
    payload?.data?.order?.order_id;
  const paymentId =
    payload.gateway_payment_id ||
    payload.payment_id ||
    payload?.payload?.payment?.entity?.id ||
    payload?.data?.payment?.cf_payment_id ||
    `PAY-${Date.now()}`;
  const eventStatus = String(payload.status || payload.event || 'paid').toLowerCase();

  if (!orderId) {
    throw new Error('Webhook payload missing order_id.');
  }

  const appRow = db.prepare('SELECT * FROM applications WHERE order_id = ?').get(orderId);
  if (!appRow) {
    throw new Error('Application order not found.');
  }

  if (eventStatus.includes('fail')) {
    db.prepare(`
      UPDATE applications
      SET payment_status = 'Failed', updated_at = CURRENT_TIMESTAMP
      WHERE order_id = ?
    `).run(orderId);
    return { order_id: orderId, unique_app_id: appRow.unique_app_id, payment_status: 'Failed' };
  }

  db.prepare(`
    UPDATE applications
    SET payment_status = 'Paid',
        status = CASE WHEN status = 'Draft' THEN 'Pending' ELSE status END,
        gateway_payment_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE order_id = ?
  `).run(String(paymentId), orderId);

  return {
    order_id: orderId,
    unique_app_id: appRow.unique_app_id,
    payment_status: 'Paid',
    status: appRow.status === 'Draft' ? 'Pending' : appRow.status,
    gateway_payment_id: String(paymentId)
  };
}

// Cryptographically Verified Webhook Endpoint (Razorpay / Cashfree / PhonePe PG)
router.post('/webhook', (req, res) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const signature =
      req.headers['x-razorpay-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-cashfree-signature'];

    const result = verifyAndSettleWebhook(rawBody, signature);
    return res.json({ received: true, ...result });
  } catch (err) {
    return res.status(401).json({ error: err.message || 'Webhook verification failed.' });
  }
});

// Sandbox / Test Mode Simulator (ONLY available when Admin test_mode = 1)
// Signs a genuine HMAC-SHA256 webhook payload on the server so it passes full cryptographic verification
router.post('/sandbox/confirm', authenticateToken, (req, res) => {
  try {
    const settings = getAdminSiteSettings();
    if (!settings.test_mode) {
      return res.status(403).json({ error: 'Sandbox payment simulation is disabled in Live Mode.' });
    }

    const orderId = String(req.body.order_id || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'order_id is required.' });
    }

    const appRow = db.prepare('SELECT * FROM applications WHERE order_id = ?').get(orderId);
    if (!appRow) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (appRow.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const simulatedPayload = JSON.stringify({
      event: 'payment.captured',
      order_id: orderId,
      gateway_payment_id: `TESTUPI_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      amount: Number(appRow.payment_amount),
      status: 'paid'
    });

    const signature = crypto
      .createHmac('sha256', settings.webhook_secret)
      .update(simulatedPayload)
      .digest('hex');

    const result = verifyAndSettleWebhook(simulatedPayload, signature);
    return res.json({ simulated: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Sandbox confirmation failed.' });
  }
});

// Poll payment status every 3 seconds from Auto-UPI-QR modal
router.get('/status/:orderId', authenticateToken, (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  const appRow = db.prepare('SELECT * FROM applications WHERE order_id = ?').get(orderId);

  if (!appRow) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  if (appRow.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  return res.json({
    order_id: appRow.order_id,
    unique_app_id: appRow.unique_app_id,
    payment_status: appRow.payment_status,
    status: appRow.status,
    gateway_payment_id: appRow.gateway_payment_id,
    payment_amount: Number(appRow.payment_amount || 0),
    expires_at: orderExpiryMap.get(orderId) || null
  });
});

module.exports = router;

