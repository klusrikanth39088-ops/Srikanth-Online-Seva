/**
 * Admin Control Panel Controller
 * Handles Admin RBAC Login, Live To-Do Badge, Quick Find Search,
 * One-Click ZIP Download (Auto-Status Pending -> Applied),
 * Completion Tracking Form, Service Builder, Payment Settings & Site Customizer.
 */
(function () {
  function formatDateTime(val) {
    if (!val) return '-';
    const d = new Date(val.includes('T') ? val : val.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? val : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function refreshTodoBadge() {
    try {
      const res = await window.PortalCommon.apiFetch('/api/admin/stats', { adminAuth: true });
      const count = res.stats ? res.stats.todo_count : 0;
      document.querySelectorAll('[data-todo-badge]').forEach((el) => {
        el.textContent = count;
        el.style.display = count > 0 ? 'inline-block' : 'none';
      });
      return res.stats;
    } catch {
      return null;
    }
  }

  function wireQuickFindBar() {
    const input = document.getElementById('quickFindInput');
    const btn = document.getElementById('quickFindBtn');
    if (!input || !btn) return;

    const go = () => {
      const q = input.value.trim();
      window.location.href = `/admin/applications.html${q ? `?search=${encodeURIComponent(q)}` : ''}`;
    };

    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
  }

  function triggerZipDownload(uniqueAppId, onDone) {
    const token = window.PortalCommon.getToken(true);
    const url = `/api/admin/applications/${encodeURIComponent(uniqueAppId)}/download-zip?token=${encodeURIComponent(token)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${uniqueAppId}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.PortalCommon.showToast(`Downloading ${uniqueAppId}.zip — status updated to Applied!`, 'success');
    setTimeout(() => {
      refreshTodoBadge();
      if (typeof onDone === 'function') onDone();
    }, 900);
  }

  // --- Page: Admin Login ---
  function initAdminLogin() {
    const token = window.PortalCommon.getToken(true);
    const user = window.PortalCommon.getUser(true);
    if (token && user && user.role === 'admin') {
      window.location.href = '/admin/dashboard.html';
      return;
    }

    const form = document.getElementById('adminLoginForm');
    const errBox = document.getElementById('adminLoginAlert');
    const btn = document.getElementById('adminLoginBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Verifying Admin Access...';

      try {
        const identifier = document.getElementById('adminIdentifier').value.trim();
        const password = document.getElementById('adminPassword').value;
        const res = await window.PortalCommon.apiFetch('/api/auth/admin/login', {
          method: 'POST',
          skipAuthRedirect: true,
          body: JSON.stringify({ identifier, password })
        });
        window.PortalCommon.saveAuth(res.token, res.user, true);
        window.location.href = '/admin/dashboard.html';
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Sign In to Admin Panel';
      }
    });
  }

  // --- Page: Admin Dashboard ---
  async function initAdminDashboard() {
    const loadDashboard = async () => {
      const [stats, todoRes] = await Promise.all([
        refreshTodoBadge(),
        window.PortalCommon.apiFetch('/api/admin/todo', { adminAuth: true })
      ]);

      if (stats) {
        document.getElementById('statTodoCount').textContent = stats.todo_count;
        document.getElementById('statTotalApps').textContent = stats.total_applications;
        document.getElementById('statAppliedCount').textContent = stats.applied_count;
        document.getElementById('statCompletedCount').textContent = stats.completed_count;
        document.getElementById('statRevenue').innerHTML = `&#8377;${Number(stats.total_revenue).toFixed(2)}`;
      }

      const tbody = document.getElementById('dashboardTodoPreviewBody');
      const items = (todoRes.applications || []).slice(0, 8);
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-muted">All caught up! No pending paid applications in the To-Do Queue.</td></tr>`;
      } else {
        tbody.innerHTML = items.map((app) => `
          <tr>
            <td><span class="app-id-chip">${app.unique_app_id}</span></td>
            <td><strong>${app.customer_name}</strong><div class="text-muted" style="font-size:0.8rem;">${app.customer_phone}</div></td>
            <td>${app.service_name}</td>
            <td>&#8377;${Number(app.payment_amount).toFixed(2)}</td>
            <td style="font-size:0.82rem; color:var(--text-muted);">${formatDateTime(app.created_at)}</td>
            <td>
              <button type="button" class="btn btn-primary btn-sm dash-dl-btn" data-id="${app.unique_app_id}">Download &amp; Apply</button>
              <a href="/admin/applications.html?search=${encodeURIComponent(app.unique_app_id)}" class="btn btn-outline btn-sm">Inspect</a>
            </td>
          </tr>
        `).join('');

        tbody.querySelectorAll('.dash-dl-btn').forEach((btn) => {
          btn.addEventListener('click', () => triggerZipDownload(btn.getAttribute('data-id'), loadDashboard));
        });
      }
    };

    await loadDashboard();
  }

  // --- Page: Admin To-Do List ---
  async function initAdminTodo() {
    const loadTodo = async () => {
      const res = await window.PortalCommon.apiFetch('/api/admin/todo', { adminAuth: true });
      await refreshTodoBadge();

      const items = res.applications || [];
      document.getElementById('todoHeaderCount').textContent = `${items.length} Pending`;
      const tbody = document.getElementById('todoTableBody');

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Zero pending items! Every paid application has been downloaded and processed.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map((app) => `
        <tr>
          <td><span class="app-id-chip">${app.unique_app_id}</span></td>
          <td><strong>${app.customer_name}</strong><div class="text-muted" style="font-size:0.8rem;">${app.customer_phone}</div></td>
          <td>${app.service_name}</td>
          <td><span class="badge badge-paid">&#8377;${Number(app.payment_amount).toFixed(2)}</span></td>
          <td style="font-size:0.82rem; color:var(--text-muted);">${formatDateTime(app.created_at)}</td>
          <td>
            <button type="button" class="btn btn-primary btn-sm todo-dl-btn" data-id="${app.unique_app_id}">Download &amp; Apply</button>
            <a href="/admin/applications.html?search=${encodeURIComponent(app.unique_app_id)}" class="btn btn-outline btn-sm">Inspect</a>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.todo-dl-btn').forEach((btn) => {
        btn.addEventListener('click', () => triggerZipDownload(btn.getAttribute('data-id'), loadTodo));
      });
    };

    await loadTodo();
    document.getElementById('refreshTodoBtn').addEventListener('click', loadTodo);
  }

  // --- Page: Admin Applications & Inspector Modal ---
  async function initAdminApplications() {
    const params = new URLSearchParams(window.location.search);
    const searchInput = document.getElementById('appSearchInput');
    const statusFilter = document.getElementById('appStatusFilter');
    const serviceFilter = document.getElementById('appServiceFilter');
    const searchBtn = document.getElementById('appSearchBtn');
    const modal = document.getElementById('appInspectorModal');
    const closeModalBtn = document.getElementById('inspectorCloseBtn');

    if (params.get('search')) {
      searchInput.value = params.get('search');
    }

    // Populate service filter dropdown
    const svcRes = await window.PortalCommon.apiFetch('/api/admin/services', { adminAuth: true });
    (svcRes.services || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.folder_slug;
      opt.textContent = s.service_name;
      serviceFilter.appendChild(opt);
    });

    const closeModal = () => modal.classList.add('hidden');
    closeModalBtn.addEventListener('click', closeModal);

    const openInspector = async (uniqueAppId) => {
      const res = await window.PortalCommon.apiFetch(`/api/admin/applications/${encodeURIComponent(uniqueAppId)}`, { adminAuth: true });
      const app = res.application;
      const token = window.PortalCommon.getToken(true);

      document.getElementById('inspectorTitle').innerHTML = `${app.service_name} <span class="app-id-chip">${app.unique_app_id}</span>`;
      document.getElementById('inspectorSubtitle').textContent = `Customer: ${app.customer_name} (${app.customer_phone}) | Status: ${app.status} | Paid: ₹${Number(app.payment_amount).toFixed(2)}`;

      const formRowsHtml = Object.entries(app.form_data || {})
        .map(([k, v]) => `<tr><th style="width:35%;">${k.replace(/_/g, ' ')}</th><td>${v || '-'}</td></tr>`)
        .join('');

      const filesHtml = Object.entries(app.files || {}).map(([fieldKey, meta]) => {
        const previewUrl = `/api/admin/applications/${encodeURIComponent(app.unique_app_id)}/files/${encodeURIComponent(meta.storedName)}?token=${encodeURIComponent(token)}`;
        const dlUrl = `${previewUrl}&download=1`;
        const isPdf = (meta.mimeType || '').includes('pdf') || (meta.storedName || '').toLowerCase().endsWith('.pdf');
        return `
          <div class="doc-preview-item">
            <strong style="font-size:0.86rem;">${fieldKey.replace(/_/g, ' ').toUpperCase()}</strong>
            ${isPdf
              ? `<div style="padding:1.25rem; background:#fff; border-radius:6px; text-align:center; font-size:0.84rem;">PDF Document<br><a href="${previewUrl}" target="_blank" rel="noopener">Preview PDF</a></div>`
              : `<a href="${previewUrl}" target="_blank" rel="noopener"><img src="${previewUrl}" alt="${fieldKey}" /></a>`
            }
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
              <span style="font-size:0.75rem; color:var(--text-muted);">${meta.originalName || meta.storedName}</span>
              <a href="${dlUrl}" class="btn btn-outline btn-sm individual-dl-link">Download</a>
            </div>
          </div>
        `;
      }).join('');

      document.getElementById('inspectorBody').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:0.9rem; margin-bottom:1rem;">
          <div>
            <strong>Payment Verified:</strong> &#8377;${Number(app.payment_amount).toFixed(2)}<br/>
            <span style="font-size:0.8rem; color:#475569;">Order: <code>${app.order_id || '-'}</code> &middot; Gateway Txn: <code>${app.gateway_payment_id || '-'}</code></span>
          </div>
          <button type="button" class="btn btn-primary" id="inspectorZipDownloadBtn">
            Download All Documents (ZIP)
          </button>
        </div>

        <h3>Submitted Form Details</h3>
        <div class="table-wrap" style="margin-bottom:1.25rem;">
          <table><tbody>${formRowsHtml || '<tr><td class="text-muted">No form data</td></tr>'}</tbody></table>
        </div>

        <h3>Uploaded Documents</h3>
        <div class="doc-preview-grid">${filesHtml || '<p class="text-muted">No files uploaded.</p>'}</div>

        <div style="border-top:1px solid var(--border); padding-top:1.15rem; margin-top:1.15rem;">
          <h3>Update Tracking &amp; Mark Completed</h3>
          <p class="text-muted" style="font-size:0.84rem; margin-bottom:0.85rem;">Once applied on the official portal, save the official tracking details below to notify the customer.</p>
          <form id="completeApplicationForm">
            <div class="form-grid-2">
              <div class="form-group">
                <label for="completeAppNumber">Official Application Number <span class="req-star">*</span></label>
                <input type="text" id="completeAppNumber" required value="${app.application_number || ''}" placeholder="e.g. NSDL123456789" />
              </div>
              <div class="form-group">
                <label for="completeDob">Date of Birth for Tracking <span class="req-star">*</span></label>
                <input type="text" id="completeDob" required value="${app.tracking_dob || ''}" placeholder="e.g. 15/08/1998 or 1998-08-15" />
              </div>
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label for="completeTrackingLink">Official Tracking Link (URL) <span class="req-star">*</span></label>
              <input type="url" id="completeTrackingLink" required value="${app.tracking_link || ''}" placeholder="https://tin.tin.nsdl.com/pantan/StatusTrack.html" />
            </div>
            <button type="submit" class="btn btn-success" id="saveCompleteBtn">Save &amp; Mark Completed</button>
          </form>
        </div>
      `;

      modal.classList.remove('hidden');

      document.getElementById('inspectorZipDownloadBtn').addEventListener('click', () => {
        triggerZipDownload(app.unique_app_id, async () => {
          await loadApplications();
          openInspector(app.unique_app_id);
        });
      });

      document.getElementById('completeApplicationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('saveCompleteBtn');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          await window.PortalCommon.apiFetch(`/api/admin/applications/${encodeURIComponent(app.unique_app_id)}/complete`, {
            method: 'PUT',
            adminAuth: true,
            body: JSON.stringify({
              application_number: document.getElementById('completeAppNumber').value.trim(),
              tracking_dob: document.getElementById('completeDob').value.trim(),
              tracking_link: document.getElementById('completeTrackingLink').value.trim()
            })
          });
          window.PortalCommon.showToast(`${app.unique_app_id} marked as Completed!`, 'success');
          closeModal();
          await loadApplications();
          await refreshTodoBadge();
        } catch (err) {
          window.PortalCommon.showToast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Save & Mark Completed';
        }
      });
    };

    const loadApplications = async () => {
      const qs = new URLSearchParams({
        search: searchInput.value.trim(),
        status: statusFilter.value,
        service: serviceFilter.value
      });
      const res = await window.PortalCommon.apiFetch(`/api/admin/applications?${qs.toString()}`, { adminAuth: true });
      const apps = res.applications || [];
      const tbody = document.getElementById('adminApplicationsBody');

      if (apps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-muted">No matching paid applications found.</td></tr>`;
        return;
      }

      tbody.innerHTML = apps.map((app) => `
        <tr>
          <td>
            <span class="app-id-chip">${app.unique_app_id}</span>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">${formatDateTime(app.created_at)}</div>
          </td>
          <td><strong>${app.customer_name}</strong><div class="text-muted" style="font-size:0.8rem;">${app.customer_phone}</div></td>
          <td>${app.service_name}</td>
          <td>
            <strong>&#8377;${Number(app.payment_amount).toFixed(2)}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted);">${app.gateway_payment_id || app.order_id || '-'}</div>
          </td>
          <td>${window.PortalCommon.statusBadgeHtml(app.status)}</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm inspect-app-btn" data-id="${app.unique_app_id}">Inspect / Complete</button>
            <button type="button" class="btn btn-primary btn-sm zip-dl-btn" data-id="${app.unique_app_id}">ZIP</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.inspect-app-btn').forEach((b) => {
        b.addEventListener('click', () => openInspector(b.getAttribute('data-id')));
      });
      tbody.querySelectorAll('.zip-dl-btn').forEach((b) => {
        b.addEventListener('click', () => triggerZipDownload(b.getAttribute('data-id'), loadApplications));
      });
    };

    await refreshTodoBadge();
    await loadApplications();

    searchBtn.addEventListener('click', loadApplications);
    statusFilter.addEventListener('change', loadApplications);
    serviceFilter.addEventListener('change', loadApplications);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadApplications();
      }
    });
  }

  // --- Page: Admin Service Manager ---
  async function initServiceManager() {
    await refreshTodoBadge();

    const loadServices = async () => {
      const res = await window.PortalCommon.apiFetch('/api/admin/services', { adminAuth: true });
      const tbody = document.getElementById('serviceManagerTableBody');
      const services = res.services || [];
      tbody.innerHTML = services.map((s) => `
        <tr>
          <td><strong>${s.service_name}</strong></td>
          <td><code>/services/${s.folder_slug}/</code></td>
          <td><span class="app-id-chip">${s.id_prefix}</span></td>
          <td>&#8377;${Number(s.service_fee).toFixed(2)}</td>
          <td>
            <span class="badge ${s.is_active ? 'badge-completed' : 'badge-draft'}">${s.is_active ? 'Active' : 'Disabled'}</span>
          </td>
          <td>
            <button type="button" class="btn btn-outline btn-sm toggle-svc-active" data-slug="${s.folder_slug}" data-active="${s.is_active ? '1' : '0'}">
              ${s.is_active ? 'Disable' : 'Enable'}
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.toggle-svc-active').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const slug = btn.getAttribute('data-slug');
          const currentlyActive = btn.getAttribute('data-active') === '1';
          await window.PortalCommon.apiFetch(`/api/admin/services/${encodeURIComponent(slug)}`, {
            method: 'PUT',
            adminAuth: true,
            body: JSON.stringify({ is_active: !currentlyActive })
          });
          window.PortalCommon.showToast('Service status updated.', 'success');
          loadServices();
        });
      });
    };

    await loadServices();

    // Auto-slugify service name
    const nameInput = document.getElementById('newServiceName');
    const slugInput = document.getElementById('newServiceSlug');
    const prefixInput = document.getElementById('newServicePrefix');
    nameInput.addEventListener('input', () => {
      const slug = nameInput.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      slugInput.value = slug;
      if (!prefixInput.dataset.touched) {
        prefixInput.value = slug.replace(/[^a-z0-9]/g, '').toUpperCase().slice(0, 3);
      }
    });
    prefixInput.addEventListener('input', () => {
      prefixInput.dataset.touched = '1';
    });

    // Dynamic fields builder
    const builderWrap = document.getElementById('builderFieldsContainer');
    const addFieldRow = (defaults = {}) => {
      const row = document.createElement('div');
      row.className = 'builder-field-row';
      row.innerHTML = `
        <div class="form-group">
          <label>Field Label</label>
          <input type="text" class="bf-label" required value="${defaults.label || ''}" placeholder="e.g. Full Name" />
        </div>
        <div class="form-group">
          <label>Field Key</label>
          <input type="text" class="bf-name" required value="${defaults.name || ''}" placeholder="e.g. full_name" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select class="bf-type">
            <option value="text" ${defaults.type === 'text' ? 'selected' : ''}>Text</option>
            <option value="tel" ${defaults.type === 'tel' ? 'selected' : ''}>Phone (10-digit)</option>
            <option value="email" ${defaults.type === 'email' ? 'selected' : ''}>Email</option>
            <option value="number" ${defaults.type === 'number' ? 'selected' : ''}>Number</option>
            <option value="date" ${defaults.type === 'date' ? 'selected' : ''}>Date</option>
            <option value="select" ${defaults.type === 'select' ? 'selected' : ''}>Dropdown</option>
            <option value="file" ${defaults.type === 'file' ? 'selected' : ''}>File / Camera Upload</option>
          </select>
        </div>
        <div class="form-group">
          <label class="toggle-switch" style="padding-bottom:0.5rem;">
            <input type="checkbox" class="bf-required" ${defaults.required !== false ? 'checked' : ''} />
            <span>Mandatory</span>
          </label>
        </div>
        <button type="button" class="btn btn-danger btn-sm bf-remove">Remove</button>
        <div class="form-group bf-options-wrap ${defaults.type === 'select' ? '' : 'hidden'}" style="grid-column: 1 / -1;">
          <label>Dropdown Options (comma-separated)</label>
          <input type="text" class="bf-options" value="${(defaults.options || []).join(', ')}" placeholder="Option 1, Option 2, Option 3" />
        </div>
      `;

      const lblEl = row.querySelector('.bf-label');
      const keyEl = row.querySelector('.bf-name');
      const typeEl = row.querySelector('.bf-type');
      const optWrap = row.querySelector('.bf-options-wrap');

      lblEl.addEventListener('input', () => {
        if (!keyEl.dataset.touched) {
          keyEl.value = lblEl.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        }
      });
      keyEl.addEventListener('input', () => { keyEl.dataset.touched = '1'; });
      typeEl.addEventListener('change', () => {
        optWrap.classList.toggle('hidden', typeEl.value !== 'select');
      });
      row.querySelector('.bf-remove').addEventListener('click', () => row.remove());
      builderWrap.appendChild(row);
    };

    // Seed two starter fields
    addFieldRow({ label: 'Applicant Full Name', name: 'applicant_name', type: 'text', required: true });
    addFieldRow({ label: 'Phone Number', name: 'phone_number', type: 'tel', required: true });
    addFieldRow({ label: 'Supporting Document', name: 'supporting_document', type: 'file', required: true });

    document.getElementById('addBuilderFieldBtn').addEventListener('click', () => addFieldRow());

    document.getElementById('createServiceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('createServiceAlert');
      errBox.classList.add('hidden');

      const fields = [];
      builderWrap.querySelectorAll('.builder-field-row').forEach((row) => {
        const label = row.querySelector('.bf-label').value.trim();
        const name = row.querySelector('.bf-name').value.trim();
        const type = row.querySelector('.bf-type').value;
        const required = row.querySelector('.bf-required').checked;
        if (!label || !name) return;
        const def = { name, label, type, required };
        if (type === 'tel') def.pattern = '^[0-9]{10}$';
        if (type === 'file') {
          def.accept = '.pdf,.jpg,.jpeg,.png';
          def.allow_camera = true;
        }
        if (type === 'select') {
          def.options = row.querySelector('.bf-options').value.split(',').map((s) => s.trim()).filter(Boolean);
        }
        fields.push(def);
      });

      const btn = document.getElementById('createServiceSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Creating Service Folder...';

      try {
        const res = await window.PortalCommon.apiFetch('/api/admin/services', {
          method: 'POST',
          adminAuth: true,
          body: JSON.stringify({
            service_name: nameInput.value.trim(),
            folder_slug: slugInput.value.trim(),
            id_prefix: prefixInput.value.trim(),
            service_fee: Number(document.getElementById('newServiceFee').value),
            estimated_time: document.getElementById('newServiceTime').value.trim(),
            description: document.getElementById('newServiceDesc').value.trim(),
            payment_enabled: document.getElementById('newServicePaymentEnabled').checked,
            fields
          })
        });
        window.PortalCommon.showToast(res.message, 'success');
        e.target.reset();
        await loadServices();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Service Folder & Publish';
      }
    });
  }

  // --- Page: Admin Payment Settings ---
  async function initPaymentSettings() {
    await refreshTodoBadge();
    const res = await window.PortalCommon.apiFetch('/api/admin/settings', { adminAuth: true });
    const s = res.settings;
    const services = res.services || [];

    document.getElementById('pgProvider').value = s.payment_gateway || 'razorpay';
    document.getElementById('pgTestMode').checked = Boolean(s.test_mode);
    document.getElementById('pgKeyId').value = s.gateway_key_id || '';
    document.getElementById('pgKeySecret').value = s.gateway_key_secret || '';
    document.getElementById('pgWebhookSecret').value = s.webhook_secret || '';
    document.getElementById('pgUpiId').value = s.upi_id || '';
    document.getElementById('pgMerchantName').value = s.upi_merchant_name || '';

    const tbody = document.getElementById('servicePricingBody');
    tbody.innerHTML = services.map((svc) => `
      <tr data-pricing-slug="${svc.folder_slug}">
        <td><strong>${svc.service_name}</strong></td>
        <td><code>${svc.folder_slug}</code></td>
        <td><input type="number" class="svc-fee-input" min="0" step="1" value="${Number(svc.service_fee)}" style="max-width:140px;" /></td>
        <td>
          <label class="toggle-switch">
            <input type="checkbox" class="svc-pay-toggle" ${svc.payment_enabled ? 'checked' : ''} />
            <span>Require Payment</span>
          </label>
        </td>
      </tr>
    `).join('');

    document.getElementById('paymentSettingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('savePaymentSettingsBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const service_pricing = [];
      tbody.querySelectorAll('tr[data-pricing-slug]').forEach((row) => {
        service_pricing.push({
          folder_slug: row.getAttribute('data-pricing-slug'),
          service_fee: Number(row.querySelector('.svc-fee-input').value),
          payment_enabled: row.querySelector('.svc-pay-toggle').checked
        });
      });

      try {
        await window.PortalCommon.apiFetch('/api/admin/settings/payment', {
          method: 'PUT',
          adminAuth: true,
          body: JSON.stringify({
            payment_gateway: document.getElementById('pgProvider').value,
            test_mode: document.getElementById('pgTestMode').checked,
            gateway_key_id: document.getElementById('pgKeyId').value.trim(),
            gateway_key_secret: document.getElementById('pgKeySecret').value.trim(),
            webhook_secret: document.getElementById('pgWebhookSecret').value.trim(),
            upi_id: document.getElementById('pgUpiId').value.trim(),
            upi_merchant_name: document.getElementById('pgMerchantName').value.trim(),
            service_pricing
          })
        });
        window.PortalCommon.showToast('Payment settings & service fees updated!', 'success');
      } catch (err) {
        window.PortalCommon.showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save All Payment Settings';
      }
    });
  }

  // --- Page: Admin Site Customizer ---
  async function initSiteCustomizer() {
    await refreshTodoBadge();
    const res = await window.PortalCommon.apiFetch('/api/admin/settings', { adminAuth: true });
    const s = res.settings;
    const texts = s.custom_texts || {};
    const flags = s.feature_flags || {};

    document.getElementById('custSupportWhatsapp').value = s.support_whatsapp || '7997284383';
    document.getElementById('custSupportEmail').value = s.support_email || 'ffpunjugaming@gmail.com';
    document.getElementById('custSiteName').value = s.site_name || 'Srikanth Online Seva';
    document.getElementById('custLogoText').value = texts.logo_text || s.site_name || 'Srikanth Online Seva';
    document.getElementById('custAnnouncement').value = texts.announcement_banner || '';
    document.getElementById('custApplyCta').value = texts.apply_cta_label || 'Submit Application';
    document.getElementById('custWelcomeTitle').value = texts.welcome_title || '';
    document.getElementById('custWelcomeSubtitle').value = texts.welcome_subtitle || '';
    document.getElementById('custFooterNote').value = texts.footer_note || '';

    document.getElementById('custFontFamily').value = s.font_family || 'Inter';
    document.getElementById('custFontSize').value = s.font_size || '16px';
    document.getElementById('custHeadingWeight').value = flags.heading_weight || '700';
    document.getElementById('custTextFormat').value = s.text_format || 'none';
    document.getElementById('custTextAlign').value = flags.text_align || 'left';
    document.getElementById('custPrimaryColor').value = s.primary_color || '#1d4ed8';
    document.getElementById('custSecondaryColor').value = s.secondary_color || '#0f766e';
    document.getElementById('custBackgroundColor').value = s.background_color || '#f8fafc';

    document.getElementById('flagCameraCapture').checked = flags.camera_capture !== false;
    document.getElementById('flagShowEmail').checked = flags.show_email_field !== false;
    document.getElementById('flagAllowReg').checked = flags.allow_registration !== false;
    document.getElementById('flagFloatingSupport').checked = flags.floating_support_widget !== false;

    document.getElementById('siteCustomizerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('saveCustomizerBtn');
      btn.disabled = true;
      btn.textContent = 'Publishing...';

      const payload = {
        site_name: document.getElementById('custSiteName').value.trim(),
        support_whatsapp: document.getElementById('custSupportWhatsapp').value.trim(),
        support_email: document.getElementById('custSupportEmail').value.trim(),
        font_family: document.getElementById('custFontFamily').value,
        font_size: document.getElementById('custFontSize').value,
        text_format: document.getElementById('custTextFormat').value,
        primary_color: document.getElementById('custPrimaryColor').value,
        secondary_color: document.getElementById('custSecondaryColor').value,
        background_color: document.getElementById('custBackgroundColor').value,
        custom_texts: {
          logo_text: document.getElementById('custLogoText').value.trim(),
          announcement_banner: document.getElementById('custAnnouncement').value.trim(),
          apply_cta_label: document.getElementById('custApplyCta').value.trim(),
          welcome_title: document.getElementById('custWelcomeTitle').value.trim(),
          welcome_subtitle: document.getElementById('custWelcomeSubtitle').value.trim(),
          footer_note: document.getElementById('custFooterNote').value.trim()
        },
        feature_flags: {
          heading_weight: document.getElementById('custHeadingWeight').value,
          text_align: document.getElementById('custTextAlign').value,
          camera_capture: document.getElementById('flagCameraCapture').checked,
          show_email_field: document.getElementById('flagShowEmail').checked,
          allow_registration: document.getElementById('flagAllowReg').checked,
          floating_support_widget: document.getElementById('flagFloatingSupport').checked
        }
      };

      try {
        const saved = await window.PortalCommon.apiFetch('/api/admin/settings/site', {
          method: 'PUT',
          adminAuth: true,
          body: JSON.stringify(payload)
        });
        window.PortalCommon.applySettingsToDom(saved.settings);
        window.PortalCommon.showToast('Site customization & support details published live!', 'success');
      } catch (err) {
        window.PortalCommon.showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save & Publish Live';
      }
    });
  }

  // --- Boot Admin Pages ---
  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.getAttribute('data-page');
    await window.PortalCommon.loadAndApplySiteSettings();

    if (page === 'admin-login') {
      initAdminLogin();
      return;
    }

    const admin = window.PortalCommon.requireAdminAuth();
    if (!admin) return;

    const logoutBtn = document.getElementById('adminLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => window.PortalCommon.logout(true));
    }

    wireQuickFindBar();

    if (page === 'admin-dashboard') await initAdminDashboard();
    if (page === 'admin-todo') await initAdminTodo();
    if (page === 'admin-applications') await initAdminApplications();
    if (page === 'admin-services') await initServiceManager();
    if (page === 'admin-payments') await initPaymentSettings();
    if (page === 'admin-customizer') await initSiteCustomizer();
  });
})();

