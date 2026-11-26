/**
 * Dynamic UPI QR Code Payment Modal with Automatic Backend Polling (every 3 seconds)
 * Zero manual UTR/Transaction ID entry.
 */
(function () {
  let pollInterval = null;
  let countdownInterval = null;

  function clearTimers() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function ensureModalDom() {
    let modal = document.getElementById('autoUpiQrModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'autoUpiQrModal';
    modal.className = 'modal-backdrop hidden';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 id="upiModalTitle">Scan &amp; Pay via UPI</h3>
          <button type="button" class="modal-close" id="upiModalClose">&times;</button>
        </div>
        <div id="upiModalBody"></div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function formatSeconds(totalSec) {
    const mins = Math.floor(Math.max(0, totalSec) / 60);
    const secs = Math.max(0, totalSec) % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function renderConfirmedState(bodyEl, { uniqueAppId, paymentId, amount, onContinue }) {
    clearTimers();
    bodyEl.innerHTML = `
      <div class="payment-confirmed-box">
        <div class="checkmark-circle">&#10003;</div>
        <h3 style="color:#15803d; margin-bottom:0.35rem;">Payment Confirmed!</h3>
        <p class="text-muted" style="margin-bottom:0.9rem;">
          Your payment of <strong>&#8377;${Number(amount).toFixed(2)}</strong> has been automatically verified.
        </p>
        <div style="background:#fff; border:1px solid #bbf7d0; border-radius:10px; padding:0.9rem; margin-bottom:1rem;">
          <div style="font-size:0.78rem; color:#64748b; text-transform:uppercase; font-weight:700;">Unique Application ID</div>
          <div style="display:flex; align-items:center; justify-content:center; gap:0.5rem; margin-top:0.35rem;">
            <span class="app-id-chip" style="font-size:1.1rem;">${uniqueAppId}</span>
            <button type="button" class="btn btn-outline btn-sm" id="copyConfirmedAppId">Copy ID</button>
          </div>
          <div style="font-size:0.78rem; color:#64748b; margin-top:0.45rem;">
            Gateway Ref: <code>${paymentId || 'VERIFIED'}</code>
          </div>
        </div>
        <p style="font-size:0.84rem; color:#166534; margin-bottom:1rem;">
          Save this Unique Application ID for instant tracking and support. Redirecting to your Dashboard...
        </p>
        <button type="button" class="btn btn-primary" id="upiGoDashboardBtn" style="width:100%;">
          Go to My Dashboard
        </button>
      </div>
    `;

    bodyEl.querySelector('#copyConfirmedAppId').addEventListener('click', (e) => {
      window.PortalCommon.copyToClipboard(uniqueAppId, e.target);
    });
    bodyEl.querySelector('#upiGoDashboardBtn').addEventListener('click', () => {
      if (typeof onContinue === 'function') {
        onContinue(uniqueAppId);
      } else {
        window.location.href = '/customer/dashboard.html';
      }
    });

    setTimeout(() => {
      if (typeof onContinue === 'function') {
        onContinue(uniqueAppId);
      } else {
        window.location.href = '/customer/dashboard.html';
      }
    }, 2600);
  }

  async function open({ uniqueAppId, onSuccess, onClose }) {
    clearTimers();
    const modal = ensureModalDom();
    const bodyEl = modal.querySelector('#upiModalBody');
    const closeBtn = modal.querySelector('#upiModalClose');

    modal.classList.remove('hidden');
    bodyEl.innerHTML = `<p class="text-muted" style="text-align:center; padding:2rem 0;">Generating Dynamic UPI QR Code...</p>`;

    const closeModal = () => {
      clearTimers();
      modal.classList.add('hidden');
      if (typeof onClose === 'function') onClose();
    };
    closeBtn.onclick = closeModal;

    try {
      const order = await window.PortalCommon.apiFetch('/api/payment/create-order', {
        method: 'POST',
        body: JSON.stringify({ unique_app_id: uniqueAppId })
      });

      if (order.already_paid) {
        renderConfirmedState(bodyEl, {
          uniqueAppId: order.unique_app_id,
          paymentId: order.order_id,
          amount: order.amount,
          onContinue: onSuccess
        });
        return;
      }

      let remainingSeconds = order.expires_in_seconds || 300;
      const qrSrc = order.external_qr_url || order.qr_data_url;

      bodyEl.innerHTML = `
        <div class="qr-container">
          <div>
            <div style="font-weight:700; font-size:1rem;">${order.service_name}</div>
            <div class="text-muted" style="font-size:0.82rem;">App ID: <span class="app-id-chip">${order.unique_app_id}</span></div>
          </div>

          <div class="amount-highlight">&#8377;${Number(order.amount).toFixed(2)}</div>

          <div class="qr-frame">
            <img src="${qrSrc}" alt="Dynamic UPI QR Code" />
          </div>

          <div style="font-size:0.85rem; color:#475569;">
            QR expires in <strong id="upiCountdownTimer">${formatSeconds(remainingSeconds)}</strong>
          </div>

          <a href="${order.upi_uri}" class="btn btn-primary" style="width:100%;">
            Pay via UPI App
          </a>

          <div id="upiPollStatus" style="display:flex; align-items:center; justify-content:center; gap:0.5rem; font-size:0.88rem; color:#475569; padding:0.4rem 0;">
            <span class="pulse-dot"></span>
            <span>Waiting for payment confirmation...</span>
          </div>

          ${order.test_mode ? `
            <div style="width:100%; border-top:1px dashed #cbd5e1; padding-top:0.85rem; margin-top:0.25rem;">
              <div style="font-size:0.76rem; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:0.5rem; margin-bottom:0.5rem;">
                <strong>Test / Sandbox Mode Active:</strong> Use the simulator below to trigger a cryptographically signed webhook confirmation.
              </div>
              <button type="button" class="btn btn-success btn-sm" id="sandboxConfirmBtn" style="width:100%;">
                Simulate Successful UPI Payment
              </button>
            </div>
          ` : ''}
        </div>
      `;

      const timerEl = bodyEl.querySelector('#upiCountdownTimer');
      countdownInterval = setInterval(() => {
        remainingSeconds -= 1;
        if (timerEl) timerEl.textContent = formatSeconds(remainingSeconds);
        if (remainingSeconds <= 0) {
          clearTimers();
          const statusEl = bodyEl.querySelector('#upiPollStatus');
          if (statusEl) {
            statusEl.innerHTML = `<span style="color:#dc2626; font-weight:600;">QR expired. Close and submit again to generate a fresh QR.</span>`;
          }
        }
      }, 1000);

      const sandboxBtn = bodyEl.querySelector('#sandboxConfirmBtn');
      if (sandboxBtn) {
        sandboxBtn.addEventListener('click', async () => {
          sandboxBtn.disabled = true;
          sandboxBtn.textContent = 'Verifying Webhook Signature...';
          try {
            const simRes = await window.PortalCommon.apiFetch('/api/payment/sandbox/confirm', {
              method: 'POST',
              body: JSON.stringify({ order_id: order.order_id })
            });
            if (simRes.payment_status === 'Paid') {
              renderConfirmedState(bodyEl, {
                uniqueAppId: simRes.unique_app_id,
                paymentId: simRes.gateway_payment_id,
                amount: order.amount,
                onContinue: onSuccess
              });
            }
          } catch (err) {
            sandboxBtn.disabled = false;
            sandboxBtn.textContent = 'Simulate Successful UPI Payment';
            window.PortalCommon.showToast(err.message, 'error');
          }
        });
      }

      // Poll backend every 3 seconds
      pollInterval = setInterval(async () => {
        try {
          const st = await window.PortalCommon.apiFetch(`/api/payment/status/${encodeURIComponent(order.order_id)}`, {
            skipAuthRedirect: true
          });
          if (st.payment_status === 'Paid') {
            renderConfirmedState(bodyEl, {
              uniqueAppId: st.unique_app_id,
              paymentId: st.gateway_payment_id,
              amount: st.payment_amount || order.amount,
              onContinue: onSuccess
            });
          } else if (st.payment_status === 'Failed') {
            clearTimers();
            const statusEl = bodyEl.querySelector('#upiPollStatus');
            if (statusEl) {
              statusEl.innerHTML = `<span style="color:#dc2626; font-weight:700;">Payment Failed. Please try again.</span>`;
            }
          }
        } catch {
          // transient polling failure ignored until next tick
        }
      }, 3000);
    } catch (err) {
      bodyEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  }

  window.AutoUpiQrModal = { open };
})();

