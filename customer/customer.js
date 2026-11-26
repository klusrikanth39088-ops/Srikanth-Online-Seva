/**
 * Customer Panel Controller (Dashboard, Apply, Edit, Track Status, Support)
 */
(function () {
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];

  function formatDateTime(val) {
    if (!val) return '-';
    const d = new Date(val.includes('T') ? val : val.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? val : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function validateSelectedFile(file) {
    if (!file) return 'No file selected.';
    const name = (file.name || '').toLowerCase();
    const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
    if (!ALLOWED_EXTS.includes(ext)) {
      return `Invalid file format (${ext || 'unknown'}). Allowed: PDF, JPG, JPEG, PNG.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `File "${file.name}" exceeds the 5 MB limit.`;
    }
    return null;
  }

  function renderPreview(previewEl, statusEl, fileOrMeta, protectedUrl = null) {
    if (!previewEl) return;
    if (statusEl) {
      statusEl.textContent = 'Ready';
      statusEl.classList.add('ready');
    }

    if (fileOrMeta instanceof File) {
      if (fileOrMeta.type === 'application/pdf' || fileOrMeta.name.toLowerCase().endsWith('.pdf')) {
        previewEl.innerHTML = `<div class="pdf-chip">PDF: ${fileOrMeta.name} (${(fileOrMeta.size / 1024).toFixed(0)} KB)</div>`;
      } else {
        const url = URL.createObjectURL(fileOrMeta);
        previewEl.innerHTML = `<img src="${url}" alt="${fileOrMeta.name}" />`;
      }
      return;
    }

    if (fileOrMeta && protectedUrl) {
      const isPdf = (fileOrMeta.mimeType || '').includes('pdf') || (fileOrMeta.storedName || '').toLowerCase().endsWith('.pdf');
      if (isPdf) {
        previewEl.innerHTML = `<div class="pdf-chip">Uploaded PDF: <a href="${protectedUrl}" target="_blank" rel="noopener">${fileOrMeta.originalName || fileOrMeta.storedName}</a></div>`;
      } else {
        previewEl.innerHTML = `
          <img src="${protectedUrl}" alt="${fileOrMeta.originalName || 'Uploaded Document'}" />
          <div style="font-size:0.78rem; margin-top:0.25rem;"><a href="${protectedUrl}" target="_blank" rel="noopener">Open full document</a></div>
        `;
      }
    }
  }

  function loadScriptOnce(src) {
    return new Promise((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve(true);
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
  }

  function buildDynamicFieldsIntoContainer(container, service, initialData = {}) {
    const textWrap = container.querySelector('.dynamic-text-fields');
    const fileWrap = container.querySelector('.dynamic-file-fields');
    if (!textWrap || !fileWrap) return;

    textWrap.innerHTML = '';
    fileWrap.innerHTML = '';

    (service.fields || []).forEach((field) => {
      if (field.type === 'file') {
        const card = document.createElement('div');
        card.className = 'upload-card';
        card.setAttribute('data-upload-field', field.name);
        card.innerHTML = `
          <div class="upload-card-head">
            <strong>${field.label} ${field.required ? '<span class="req-star">*</span>' : ''}</strong>
            <span class="file-status-pill" id="status_${field.name}">${field.required ? 'Required' : 'Optional'}</span>
          </div>
          ${field.help_text ? `<div class="text-muted" style="font-size:0.78rem;">${field.help_text}</div>` : ''}
          <div class="upload-actions">
            <label class="btn btn-outline btn-sm">
              <input type="file" name="${field.name}" accept=".pdf,.jpg,.jpeg,.png" capture="environment" class="sr-only-input" data-file-input="${field.name}" />
              Upload / Mobile Cam
            </label>
            ${field.allow_camera !== false ? `<button type="button" class="btn btn-secondary btn-sm camera-trigger-btn" data-camera-for="${field.name}">Webcam Capture</button>` : ''}
          </div>
          <div class="upload-preview" id="preview_${field.name}"></div>
        `;
        fileWrap.appendChild(card);
        return;
      }

      const grp = document.createElement('div');
      grp.className = 'form-group';
      const val = initialData[field.name] ?? '';
      const reqStar = field.required ? '<span class="req-star">*</span>' : '<span class="badge-optional">Optional</span>';

      if (field.type === 'select') {
        const opts = (field.options || [])
          .map((opt) => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`)
          .join('');
        grp.innerHTML = `
          <label for="field_${field.name}">${field.label} ${reqStar}</label>
          <select id="field_${field.name}" name="${field.name}" ${field.required ? 'required' : ''}>
            <option value="">-- Select ${field.label} --</option>
            ${opts}
          </select>
        `;
      } else {
        const inputType = ['tel', 'email', 'number', 'date'].includes(field.type) ? field.type : 'text';
        grp.innerHTML = `
          <label for="field_${field.name}">${field.label} ${reqStar}</label>
          <input type="${inputType}" id="field_${field.name}" name="${field.name}"
                 value="${String(val).replace(/"/g, '&quot;')}"
                 ${field.required ? 'required' : ''}
                 ${field.pattern ? `pattern="${field.pattern}"` : ''}
                 placeholder="${field.placeholder || ''}" />
        `;
      }
      textWrap.appendChild(grp);
    });
  }

  async function mountServiceForm(container, service, { isEdit = false, initialData = {}, existingFiles = {}, uniqueAppId = '' } = {}) {
    const fileStore = {};
    let html = '';

    if (service.has_custom_form) {
      html = await fetch(`/services/${service.folder_slug}/form.html`).then((r) => r.text());
    } else {
      html = await fetch('/services/_template/form.html').then((r) => r.text());
    }

    container.innerHTML = html;

    if (container.querySelector('[data-dynamic-schema-form="true"]')) {
      buildDynamicFieldsIntoContainer(container, service, initialData);
    }

    if (service.has_custom_script) {
      await loadScriptOnce(`/services/${service.folder_slug}/${service.folder_slug}.js`);
    }

    const handler = window.ServiceModuleHandlers && window.ServiceModuleHandlers[service.folder_slug];
    if (handler && typeof handler.init === 'function') {
      handler.init(container, { isEdit, initialData, existingFiles });
    } else {
      // Prefill generic dynamic form values
      Object.entries(initialData || {}).forEach(([k, v]) => {
        const el = container.querySelector(`[name="${k}"]`);
        if (el && el.type !== 'file') el.value = v;
      });
    }

    // Apply existing uploaded file previews in Edit mode
    const token = window.PortalCommon.getToken(false);
    Object.entries(existingFiles || {}).forEach(([fieldKey, meta]) => {
      const previewEl = container.querySelector(`#preview_${fieldKey}`);
      const statusEl = container.querySelector(`#status_${fieldKey}`);
      if (meta && meta.storedName && previewEl) {
        const url = `/api/customer/applications/${encodeURIComponent(uniqueAppId)}/files/${encodeURIComponent(meta.storedName)}?token=${encodeURIComponent(token)}`;
        renderPreview(previewEl, statusEl, meta, url);
      }
    });

    // Respect admin feature flags (e.g. camera_capture, show_email_field)
    if (window.PORTAL_SETTINGS) {
      window.PortalCommon.applySettingsToDom(window.PORTAL_SETTINGS);
    }

    // Bind file inputs
    container.querySelectorAll('[data-file-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const fieldName = input.getAttribute('data-file-input');
        const file = input.files && input.files[0];
        if (!file) return;
        const err = validateSelectedFile(file);
        if (err) {
          window.PortalCommon.showToast(err, 'error');
          input.value = '';
          return;
        }
        fileStore[fieldName] = file;
        renderPreview(
          container.querySelector(`#preview_${fieldName}`),
          container.querySelector(`#status_${fieldName}`),
          file
        );
      });
    });

    // Bind WebRTC Camera Capture buttons
    container.querySelectorAll('[data-camera-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fieldName = btn.getAttribute('data-camera-for');
        const title = btn.closest('.upload-card')?.querySelector('strong')?.textContent || 'Capture Document';
        window.CameraCaptureModal.open({
          title,
          fieldName,
          onCapture: (capturedFile) => {
            const err = validateSelectedFile(capturedFile);
            if (err) {
              window.PortalCommon.showToast(err, 'error');
              return;
            }
            fileStore[fieldName] = capturedFile;
            renderPreview(
              container.querySelector(`#preview_${fieldName}`),
              container.querySelector(`#status_${fieldName}`),
              capturedFile
            );
            window.PortalCommon.showToast('Photo captured successfully!', 'success');
          }
        });
      });
    });

    return {
      fileStore,
      validateAndCollect() {
        const errors = [];
        if (handler && typeof handler.validate === 'function') {
          errors.push(...handler.validate(container, fileStore, isEdit, existingFiles));
        } else {
          for (const field of service.fields || []) {
            if (field.type === 'file') {
              const hasNew = Boolean(fileStore[field.name]);
              const hasExisting = isEdit && Boolean(existingFiles[field.name]);
              if (field.required && !hasNew && !hasExisting) {
                errors.push(`${field.label} upload is mandatory.`);
              }
            } else {
              const el = container.querySelector(`[name="${field.name}"]`);
              const val = el ? el.value.trim() : '';
              if (field.required && !val) errors.push(`${field.label} is mandatory.`);
              if (val && field.pattern && !new RegExp(field.pattern).test(val)) {
                errors.push(`${field.label} format is invalid.`);
              }
            }
          }
        }

        if (errors.length > 0) return { errors, formData: null };

        const fd = new FormData();
        fd.append('service_slug', service.folder_slug);
        container.querySelectorAll('input:not([type="file"]), select, textarea').forEach((el) => {
          if (el.name) fd.append(el.name, el.value.trim());
        });
        Object.entries(fileStore).forEach(([fieldName, file]) => {
          fd.append(fieldName, file, file.name);
        });
        return { errors: [], formData: fd };
      }
    };
  }

  // --- Page: Dashboard ---
  async function initDashboard(user) {
    document.getElementById('customerNameDisplay').textContent = user.name || user.phone;

    const loadAll = async () => {
      const [svcRes, appRes] = await Promise.all([
        window.PortalCommon.apiFetch('/api/services'),
        window.PortalCommon.apiFetch('/api/customer/applications')
      ]);

      const grid = document.getElementById('servicesGrid');
      const services = svcRes.services || [];
      if (services.length === 0) {
        grid.innerHTML = `<div class="card text-muted">No active services available right now.</div>`;
      } else {
        grid.innerHTML = services.map((svc) => `
          <article class="service-card">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                <h3 style="margin:0;">${svc.service_name}</h3>
                <span class="service-fee-pill">${svc.payment_enabled ? `&#8377;${Number(svc.service_fee).toFixed(0)}` : 'Free'}</span>
              </div>
              <p class="text-muted" style="margin:0.65rem 0 0;">${svc.description || 'Online document application service.'}</p>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.85rem;">
              <span style="font-size:0.8rem; color:var(--text-muted);">Est: ${svc.estimated_time || '3-5 Days'}</span>
              <a href="/customer/apply.html?service=${encodeURIComponent(svc.folder_slug)}" class="btn btn-primary btn-sm">
                Apply Now &rarr;
              </a>
            </div>
          </article>
        `).join('');
      }

      const tbody = document.getElementById('myApplicationsBody');
      const apps = appRes.applications || [];
      if (apps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-muted">You have not submitted any applications yet. Choose a service above to get started!</td></tr>`;
      } else {
        tbody.innerHTML = apps.map((app) => {
          const isLocked = app.is_locked || (app.status !== 'Pending' && app.status !== 'Draft');
          let actionButtons = '';

          if (app.payment_status !== 'Paid') {
            actionButtons += `<button type="button" class="btn btn-primary btn-sm pay-now-btn" data-app-id="${app.unique_app_id}">Pay &#8377;${Number(app.payment_amount).toFixed(0)} QR</button> `;
            actionButtons += `<a href="/customer/edit-application.html?id=${encodeURIComponent(app.unique_app_id)}" class="btn btn-outline btn-sm">Edit</a> `;
          } else if (!isLocked && app.status === 'Pending') {
            actionButtons += `<a href="/customer/edit-application.html?id=${encodeURIComponent(app.unique_app_id)}" class="btn btn-outline btn-sm">Edit Application</a> `;
            actionButtons += `<a href="/customer/track-status.html?id=${encodeURIComponent(app.unique_app_id)}" class="btn btn-secondary btn-sm">Track</a>`;
          } else if (app.status === 'Applied') {
            actionButtons += `<span class="text-muted" style="font-size:0.78rem; display:inline-block; margin-right:0.4rem;">Locked (Downloaded)</span>`;
            actionButtons += `<a href="/customer/track-status.html?id=${encodeURIComponent(app.unique_app_id)}" class="btn btn-secondary btn-sm">Track Status</a>`;
          } else if (app.status === 'Completed') {
            actionButtons += `<a href="/customer/track-status.html?id=${encodeURIComponent(app.unique_app_id)}" class="btn btn-success btn-sm">View Tracking Details</a>`;
          }

          return `
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                  <span class="app-id-chip">${app.unique_app_id}</span>
                  <button type="button" class="btn btn-outline btn-sm copy-app-id-btn" data-copy-id="${app.unique_app_id}">Copy</button>
                </div>
              </td>
              <td><strong>${app.service_name}</strong></td>
              <td>
                <span class="badge badge-${app.payment_status.toLowerCase()}">${app.payment_status}</span>
                <div style="font-size:0.8rem; color:var(--text-muted);">&#8377;${Number(app.payment_amount).toFixed(2)}</div>
              </td>
              <td>
                ${window.PortalCommon.statusBadgeHtml(app.status)}
                ${app.status === 'Applied' ? '<div style="font-size:0.75rem; color:#1d4ed8;">Under Process</div>' : ''}
                ${app.status === 'Completed' && app.application_number ? `<div style="font-size:0.75rem; color:#15803d;">Ref: ${app.application_number}</div>` : ''}
              </td>
              <td style="font-size:0.82rem; color:var(--text-muted);">${formatDateTime(app.created_at)}</td>
              <td>${actionButtons}</td>
            </tr>
          `;
        }).join('');

        tbody.querySelectorAll('.copy-app-id-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            window.PortalCommon.copyToClipboard(btn.getAttribute('data-copy-id'), btn);
          });
        });

        tbody.querySelectorAll('.pay-now-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const appId = btn.getAttribute('data-app-id');
            window.AutoUpiQrModal.open({
              uniqueAppId: appId,
              onSuccess: () => loadAll()
            });
          });
        });
      }
    };

    await loadAll();
    document.getElementById('refreshAppsBtn').addEventListener('click', loadAll);
  }

  // --- Page: Apply ---
  async function initApplyPage() {
    const params = new URLSearchParams(window.location.search);
    const svcListRes = await window.PortalCommon.apiFetch('/api/services');
    const services = svcListRes.services || [];
    if (services.length === 0) {
      document.getElementById('serviceFormContainer').innerHTML = `<div class="alert alert-warning">No active services are configured.</div>`;
      return;
    }

    let currentSlug = params.get('service') || services[0].folder_slug;
    if (!services.some((s) => s.folder_slug === currentSlug)) {
      currentSlug = services[0].folder_slug;
    }

    const switcher = document.getElementById('serviceSwitcher');
    switcher.innerHTML = services.map((s) => `<option value="${s.folder_slug}" ${s.folder_slug === currentSlug ? 'selected' : ''}>${s.service_name} (&#8377;${Number(s.service_fee).toFixed(0)})</option>`).join('');
    switcher.addEventListener('change', () => {
      window.location.href = `/customer/apply.html?service=${encodeURIComponent(switcher.value)}`;
    });

    const svcDetail = await window.PortalCommon.apiFetch(`/api/services/${encodeURIComponent(currentSlug)}`);
    const service = svcDetail.service;

    document.getElementById('applyServiceTitle').textContent = service.service_name;
    document.getElementById('applyServiceDesc').textContent = service.description || 'Complete the form below and verify via Dynamic UPI QR.';
    document.getElementById('applyServiceFee').innerHTML = service.payment_enabled
      ? `Fee: &#8377;${Number(service.service_fee).toFixed(2)}`
      : 'Free Service';

    const container = document.getElementById('serviceFormContainer');
    const mounted = await mountServiceForm(container, service);

    const form = document.getElementById('dynamicApplicationForm');
    const errBox = document.getElementById('applyErrorBox');
    const submitBtn = document.getElementById('submitApplicationBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');

      const { errors, formData } = mounted.validateAndCollect();
      if (errors.length > 0) {
        errBox.innerHTML = errors.map((msg) => `<div>&bull; ${msg}</div>`).join('');
        errBox.classList.remove('hidden');
        errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving Application...';

      try {
        const res = await window.PortalCommon.apiFetch('/api/customer/applications', {
          method: 'POST',
          body: formData
        });

        if (res.payment_required) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Application';
          window.AutoUpiQrModal.open({
            uniqueAppId: res.application.unique_app_id,
            onSuccess: () => {
              window.location.href = '/customer/dashboard.html';
            }
          });
        } else {
          window.PortalCommon.showToast(`Application ${res.application.unique_app_id} submitted!`, 'success');
          setTimeout(() => {
            window.location.href = '/customer/dashboard.html';
          }, 1200);
        }
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Application';
      }
    });
  }

  // --- Page: Edit Application ---
  async function initEditPage() {
    const params = new URLSearchParams(window.location.search);
    const uniqueAppId = params.get('id');
    if (!uniqueAppId) {
      window.location.href = '/customer/dashboard.html';
      return;
    }

    document.getElementById('editAppIdBadge').textContent = uniqueAppId;
    const appRes = await window.PortalCommon.apiFetch(`/api/customer/applications/${encodeURIComponent(uniqueAppId)}`);
    const app = appRes.application;
    const svcRes = await window.PortalCommon.apiFetch(`/api/services/${encodeURIComponent(app.service_slug)}`);
    const service = svcRes.service;

    const container = document.getElementById('editFormContainer');
    const mounted = await mountServiceForm(container, service, {
      isEdit: true,
      initialData: app.form_data,
      existingFiles: app.files,
      uniqueAppId: app.unique_app_id
    });

    const isLocked = app.is_locked || (app.status !== 'Pending' && app.status !== 'Draft');
    const lockBanner = document.getElementById('editLockBanner');
    const saveBtn = document.getElementById('saveEditBtn');

    if (isLocked) {
      lockBanner.textContent = 'Application locked — documents downloaded and under processing.';
      lockBanner.classList.remove('hidden');
      saveBtn.disabled = true;
      container.querySelectorAll('input, select, textarea, button').forEach((el) => {
        el.disabled = true;
      });
      return;
    }

    const form = document.getElementById('editApplicationForm');
    const errBox = document.getElementById('editErrorBox');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');
      const { errors, formData } = mounted.validateAndCollect();
      if (errors.length > 0) {
        errBox.innerHTML = errors.map((msg) => `<div>&bull; ${msg}</div>`).join('');
        errBox.classList.remove('hidden');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving Changes...';

      try {
        await window.PortalCommon.apiFetch(`/api/customer/applications/${encodeURIComponent(uniqueAppId)}`, {
          method: 'PUT',
          body: formData
        });
        window.PortalCommon.showToast('Application updated successfully!', 'success');
        setTimeout(() => {
          window.location.href = '/customer/dashboard.html';
        }, 900);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Application Changes';
      }
    });
  }

  // --- Page: Track Status ---
  async function initTrackPage() {
    const params = new URLSearchParams(window.location.search);
    const appsRes = await window.PortalCommon.apiFetch('/api/customer/applications');
    const apps = appsRes.applications || [];
    const selector = document.getElementById('trackAppSelector');
    const card = document.getElementById('trackDetailCard');

    if (apps.length === 0) {
      selector.classList.add('hidden');
      card.innerHTML = `<p class="text-muted">No applications found. <a href="/customer/apply.html">Apply for a service</a> first.</p>`;
      return;
    }

    let activeId = params.get('id') || apps[0].unique_app_id;
    if (!apps.some((a) => a.unique_app_id === activeId)) {
      activeId = apps[0].unique_app_id;
    }

    selector.innerHTML = apps.map((a) => `<option value="${a.unique_app_id}" ${a.unique_app_id === activeId ? 'selected' : ''}>${a.unique_app_id} — ${a.service_name} (${a.status})</option>`).join('');

    const renderSelected = (appId) => {
      const app = apps.find((a) => a.unique_app_id === appId);
      if (!app) return;

      const isPaid = app.payment_status === 'Paid';
      const step1 = isPaid ? 'done' : 'current';
      const step2 = isPaid ? (app.status === 'Pending' ? 'current' : 'done') : '';
      const step3 = app.status === 'Applied' ? 'current' : (app.status === 'Completed' ? 'done' : '');
      const step4 = app.status === 'Completed' ? 'done' : '';

      let statusBannerHtml = '';
      if (app.status === 'Draft' && app.payment_status !== 'Paid') {
        statusBannerHtml = `
          <div class="alert alert-warning" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
            <span>Payment is pending for this draft application. Complete payment to submit to the Admin Queue.</span>
            <button type="button" class="btn btn-primary btn-sm" id="trackPayNowBtn">Pay &#8377;${Number(app.payment_amount).toFixed(2)} via UPI QR</button>
          </div>
        `;
      } else if (app.status === 'Pending') {
        statusBannerHtml = `
          <div class="alert alert-info" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
            <span>Your payment is confirmed and your application is in the queue. You can still edit details before Admin downloads your documents.</span>
            <a href="/customer/edit-application.html?id=${encodeURIComponent(app.unique_app_id)}" class="btn btn-outline btn-sm">Edit Application</a>
          </div>
        `;
      } else if (app.status === 'Applied') {
        statusBannerHtml = `
          <div class="alert alert-info">
            <span class="badge badge-applied" style="margin-right:0.5rem;">Applied — Under Process</span>
            Documents downloaded and under processing. Editing is locked while we complete your filing.
          </div>
        `;
      } else if (app.status === 'Completed') {
        statusBannerHtml = `
          <div class="completed-highlight-card">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.85rem;">
              <h3 style="color:#15803d; margin:0;">Completed — Official Tracking Details</h3>
              <span class="badge badge-completed">Completed</span>
            </div>
            <div class="form-grid-2" style="margin-bottom:1rem;">
              <div style="background:#fff; border:1px solid #bbf7d0; border-radius:10px; padding:0.85rem;">
                <div class="text-muted" style="font-size:0.78rem;">Official Application Number</div>
                <div style="display:flex; align-items:center; gap:0.5rem; margin-top:0.25rem;">
                  <strong style="font-size:1.1rem; font-family:monospace;">${app.application_number || '-'}</strong>
                  ${app.application_number ? `<button type="button" class="btn btn-outline btn-sm" id="copyOfficialAppNum">Copy</button>` : ''}
                </div>
              </div>
              <div style="background:#fff; border:1px solid #bbf7d0; border-radius:10px; padding:0.85rem;">
                <div class="text-muted" style="font-size:0.78rem;">Date of Birth (for Portal Tracking)</div>
                <strong style="font-size:1.1rem; display:block; margin-top:0.25rem;">${app.tracking_dob || '-'}</strong>
              </div>
            </div>
            ${app.tracking_link ? `
              <a href="${app.tracking_link}" target="_blank" rel="noopener" class="btn btn-success">
                Open Official Tracking Portal &rarr;
              </a>
            ` : ''}
          </div>
        `;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem;">
          <div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <h2 style="margin:0;">${app.service_name}</h2>
              <span class="app-id-chip">${app.unique_app_id}</span>
              <button type="button" class="btn btn-outline btn-sm" id="copyTrackAppId">Copy ID</button>
            </div>
            <div class="text-muted" style="font-size:0.84rem; margin-top:0.25rem;">
              Submitted: ${formatDateTime(app.created_at)} &middot; Amount: &#8377;${Number(app.payment_amount).toFixed(2)} (${app.payment_status})
            </div>
          </div>
          <div>${window.PortalCommon.statusBadgeHtml(app.status)}</div>
        </div>

        <div class="tracking-stepper">
          <div class="step-box ${step1}"><strong>1. Payment</strong><div>${isPaid ? 'Confirmed' : 'Awaiting UPI'}</div></div>
          <div class="step-box ${step2}"><strong>2. Pending Queue</strong><div>${app.status === 'Pending' ? 'Ready for Admin' : (isPaid ? 'Queued Done' : 'Waiting')}</div></div>
          <div class="step-box ${step3}"><strong>3. Applied</strong><div>${app.status === 'Applied' ? 'Applied — Under Process' : (app.status === 'Completed' ? 'Processed' : 'Waiting')}</div></div>
          <div class="step-box ${step4}"><strong>4. Completed</strong><div>${app.status === 'Completed' ? 'Tracking Ready' : 'Waiting'}</div></div>
        </div>

        ${statusBannerHtml}
      `;

      const copyIdBtn = document.getElementById('copyTrackAppId');
      if (copyIdBtn) copyIdBtn.addEventListener('click', () => window.PortalCommon.copyToClipboard(app.unique_app_id, copyIdBtn));

      const copyOfficialBtn = document.getElementById('copyOfficialAppNum');
      if (copyOfficialBtn) copyOfficialBtn.addEventListener('click', () => window.PortalCommon.copyToClipboard(app.application_number, copyOfficialBtn));

      const payBtn = document.getElementById('trackPayNowBtn');
      if (payBtn) {
        payBtn.addEventListener('click', () => {
          window.AutoUpiQrModal.open({
            uniqueAppId: app.unique_app_id,
            onSuccess: () => window.location.reload()
          });
        });
      }
    };

    renderSelected(activeId);
    selector.addEventListener('change', () => renderSelected(selector.value));
  }

  // --- Boot Customer Pages ---
  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.getAttribute('data-page');
    await window.PortalCommon.loadAndApplySiteSettings();

    const logoutBtn = document.getElementById('customerLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => window.PortalCommon.logout(false));
    }

    if (page === 'customer-support') {
      const user = window.PortalCommon.getUser(false);
      const loginLink = document.getElementById('supportLoginLink');
      if (user && loginLink) {
        loginLink.textContent = 'Dashboard';
        loginLink.href = '/customer/dashboard.html';
      }
      return;
    }

    const user = window.PortalCommon.requireCustomerAuth();
    if (!user) return;

    if (page === 'customer-dashboard') await initDashboard(user);
    if (page === 'customer-apply') await initApplyPage();
    if (page === 'customer-edit') await initEditPage();
    if (page === 'customer-track') await initTrackPage();
  });
})();

