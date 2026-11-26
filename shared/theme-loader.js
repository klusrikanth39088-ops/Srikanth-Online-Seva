/**
 * Shared Theme Loader, Auth Utilities, Support Widget & API Helpers
 */
(function () {
  const TOKEN_KEY = 'seva_token';
  const USER_KEY = 'seva_user';
  const ADMIN_TOKEN_KEY = 'seva_admin_token';
  const ADMIN_USER_KEY = 'seva_admin_user';

  function isAdminContext() {
    return window.location.pathname.startsWith('/admin');
  }

  function getToken(adminOverride = null) {
    const useAdmin = adminOverride !== null ? adminOverride : isAdminContext();
    return localStorage.getItem(useAdmin ? ADMIN_TOKEN_KEY : TOKEN_KEY) || '';
  }

  function getUser(adminOverride = null) {
    const useAdmin = adminOverride !== null ? adminOverride : isAdminContext();
    const raw = localStorage.getItem(useAdmin ? ADMIN_USER_KEY : USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveAuth(token, user, isAdmin = false) {
    localStorage.setItem(isAdmin ? ADMIN_TOKEN_KEY : TOKEN_KEY, token);
    localStorage.setItem(isAdmin ? ADMIN_USER_KEY : USER_KEY, JSON.stringify(user));
  }

  function logout(isAdmin = null) {
    const useAdmin = isAdmin !== null ? isAdmin : isAdminContext();
    if (useAdmin) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_USER_KEY);
      window.location.href = '/admin/admin-login.html';
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = '/auth/login.html';
    }
  }

  async function apiFetch(url, options = {}) {
    const token = getToken(options.adminAuth ?? null);
    const headers = new Headers(options.headers || {});
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const resp = await fetch(url, { ...options, headers });
    const contentType = resp.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await resp.json() : await resp.text();

    if (!resp.ok) {
      if (resp.status === 401 && !options.skipAuthRedirect) {
        logout(isAdminContext());
      }
      const errMsg = (data && data.error) || (typeof data === 'string' ? data : 'Request failed');
      throw new Error(errMsg);
    }
    return data;
  }

  function showToast(message, type = 'info') {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3400);
  }

  async function copyToClipboard(text, btnEl = null) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied: ${text}`, 'success');
      if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.textContent = 'Copied!';
        setTimeout(() => {
          btnEl.textContent = orig;
        }, 1500);
      }
    } catch {
      showToast('Unable to copy automatically.', 'error');
    }
  }

  function loadGoogleFont(fontFamily) {
    const supported = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Lato'];
    if (!fontFamily || !supported.includes(fontFamily)) return;
    const id = 'dynamic-google-font';
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    const encoded = fontFamily.replace(/ /g, '+');
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700;800&display=swap`;
  }

  function formatWhatsappDigits(raw) {
    const digits = String(raw || '7997284383').replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`;
    return digits || '917997284383';
  }

  function renderFloatingSupportWidget(settings) {
    const existing = document.getElementById('floatingSupportWidget');
    if (existing) existing.remove();

    if (isAdminContext()) return;
    const flags = settings.feature_flags || {};
    if (flags.floating_support_widget === false) return;

    const waNumber = settings.support_whatsapp || '7997284383';
    const waHref = `https://wa.me/${formatWhatsappDigits(waNumber)}`;
    const email = settings.support_email || 'ffpunjugaming@gmail.com';

    const wrap = document.createElement('div');
    wrap.id = 'floatingSupportWidget';
    wrap.className = 'floating-support';
    wrap.innerHTML = `
      <div class="floating-support-menu hidden" id="floatingSupportMenu">
        <strong style="font-size:0.9rem;">Customer Support</strong>
        <a href="${waHref}" target="_blank" rel="noopener" class="btn btn-whatsapp btn-sm">
          WhatsApp: ${waNumber}
        </a>
        <a href="mailto:${email}" class="btn btn-outline btn-sm">
          Email: ${email}
        </a>
        <a href="/customer/support.html" class="btn btn-primary btn-sm">
          Support Center
        </a>
      </div>
      <button type="button" class="btn btn-whatsapp" id="floatingSupportToggle" style="border-radius:999px; box-shadow:0 8px 24px rgba(22,163,74,0.35);">
        Need Help?
      </button>
    `;
    document.body.appendChild(wrap);

    const toggleBtn = document.getElementById('floatingSupportToggle');
    const menu = document.getElementById('floatingSupportMenu');
    toggleBtn.addEventListener('click', () => {
      menu.classList.toggle('hidden');
    });
  }

  function applySettingsToDom(settings) {
    if (!settings) return;
    window.PORTAL_SETTINGS = settings;

    const root = document.documentElement;
    if (settings.primary_color) root.style.setProperty('--primary', settings.primary_color);
    if (settings.secondary_color) root.style.setProperty('--secondary', settings.secondary_color);
    if (settings.background_color) root.style.setProperty('--bg', settings.background_color);
    if (settings.font_family) {
      loadGoogleFont(settings.font_family);
      root.style.setProperty('--font-family', `'${settings.font_family}', system-ui, sans-serif`);
    }
    if (settings.font_size) root.style.setProperty('--font-size', settings.font_size);
    if (settings.text_format) root.style.setProperty('--text-transform', settings.text_format);

    const flags = settings.feature_flags || {};
    if (flags.heading_weight) root.style.setProperty('--heading-weight', flags.heading_weight);
    if (flags.text_align) root.style.setProperty('--text-align', flags.text_align);

    const texts = settings.custom_texts || {};
    document.querySelectorAll('[data-site-name]').forEach((el) => {
      el.textContent = settings.site_name || 'Srikanth Online Seva';
    });
    document.querySelectorAll('[data-logo-text]').forEach((el) => {
      el.textContent = texts.logo_text || settings.site_name || 'Srikanth Online Seva';
    });
    document.querySelectorAll('[data-announcement-banner]').forEach((el) => {
      const msg = texts.announcement_banner || '';
      el.textContent = msg;
      el.classList.toggle('hidden', !msg);
    });
    document.querySelectorAll('[data-welcome-title]').forEach((el) => {
      if (texts.welcome_title) el.textContent = texts.welcome_title;
    });
    document.querySelectorAll('[data-welcome-subtitle]').forEach((el) => {
      if (texts.welcome_subtitle) el.textContent = texts.welcome_subtitle;
    });
    document.querySelectorAll('[data-apply-cta]').forEach((el) => {
      if (texts.apply_cta_label) el.textContent = texts.apply_cta_label;
    });
    document.querySelectorAll('[data-footer-note]').forEach((el) => {
      if (texts.footer_note) el.textContent = texts.footer_note;
    });

    const waNumber = settings.support_whatsapp || '7997284383';
    const waHref = `https://wa.me/${formatWhatsappDigits(waNumber)}`;
    const email = settings.support_email || 'ffpunjugaming@gmail.com';

    document.querySelectorAll('[data-whatsapp-number]').forEach((el) => {
      el.textContent = waNumber;
    });
    document.querySelectorAll('[data-whatsapp-link]').forEach((el) => {
      el.setAttribute('href', waHref);
    });
    document.querySelectorAll('[data-email-address]').forEach((el) => {
      el.textContent = email;
    });
    document.querySelectorAll('[data-email-link]').forEach((el) => {
      el.setAttribute('href', `mailto:${email}`);
    });

    // Feature flags enforcement
    if (flags.camera_capture === false) {
      document.querySelectorAll('.camera-trigger-btn').forEach((btn) => btn.classList.add('hidden'));
    }
    if (flags.show_email_field === false) {
      document.querySelectorAll('[data-email-field-group="true"]').forEach((grp) => grp.classList.add('hidden'));
    }

    renderFloatingSupportWidget(settings);
  }

  async function loadAndApplySiteSettings() {
    try {
      const data = await fetch('/api/settings/public').then((r) => r.json());
      if (data && data.settings) {
        applySettingsToDom(data.settings);
        return data.settings;
      }
    } catch (err) {
      console.warn('Could not load site settings:', err.message);
    }
    return null;
  }

  function statusBadgeHtml(status) {
    const norm = String(status || 'Pending');
    const cls = norm.toLowerCase();
    return `<span class="badge badge-${cls}">${norm}</span>`;
  }

  function requireCustomerAuth() {
    const token = getToken(false);
    const user = getUser(false);
    if (!token || !user) {
      window.location.href = '/auth/login.html';
      return null;
    }
    return user;
  }

  function requireAdminAuth() {
    const token = getToken(true);
    const user = getUser(true);
    if (!token || !user || user.role !== 'admin') {
      window.location.href = '/admin/admin-login.html';
      return null;
    }
    return user;
  }

  window.PortalCommon = {
    getToken,
    getUser,
    saveAuth,
    logout,
    apiFetch,
    showToast,
    copyToClipboard,
    loadAndApplySiteSettings,
    applySettingsToDom,
    statusBadgeHtml,
    requireCustomerAuth,
    requireAdminAuth
  };

  function injectHomeNavLink() {
    const p = window.location.pathname;
    if (p === '/' || p === '/index.html') return;
    const nav = document.querySelector('.topbar .nav-links');
    if (!nav || nav.querySelector('a[href="/"]')) return;
    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.className = 'nav-link';
    homeLink.textContent = 'Home';
    nav.insertBefore(homeLink, nav.firstChild);
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectHomeNavLink();
    loadAndApplySiteSettings();
  });
})();

