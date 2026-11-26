/**
 * Customer Authentication Controller (Login & Signup)
 */
(function () {
  function showAuthError(msg) {
    const box = document.getElementById('authAlert');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function clearAuthError() {
    const box = document.getElementById('authAlert');
    if (box) box.classList.add('hidden');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Redirect already-logged-in customers straight to dashboard
    const existingToken = window.PortalCommon.getToken(false);
    const existingUser = window.PortalCommon.getUser(false);
    if (existingToken && existingUser && existingUser.role === 'customer') {
      window.location.href = '/customer/dashboard.html';
      return;
    }

    const settings = await window.PortalCommon.loadAndApplySiteSettings();
    const allowReg = !settings || !settings.feature_flags || settings.feature_flags.allow_registration !== false;

    const navSignup = document.getElementById('navSignupLink');
    const signupPrompt = document.getElementById('signupPromptRow');
    if (!allowReg) {
      if (navSignup) navSignup.classList.add('hidden');
      if (signupPrompt) signupPrompt.classList.add('hidden');
    }

    const loginForm = document.getElementById('customerLoginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAuthError();
        const btn = document.getElementById('loginSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Signing in...';

        try {
          const identifier = document.getElementById('loginIdentifier').value.trim();
          const password = document.getElementById('loginPassword').value;
          const res = await window.PortalCommon.apiFetch('/api/auth/login', {
            method: 'POST',
            skipAuthRedirect: true,
            body: JSON.stringify({ identifier, password })
          });
          window.PortalCommon.saveAuth(res.token, res.user, false);
          window.location.href = '/customer/dashboard.html';
        } catch (err) {
          showAuthError(err.message);
          btn.disabled = false;
          btn.textContent = 'Sign In to Customer Portal';
        }
      });
    }

    const signupForm = document.getElementById('customerSignupForm');
    if (signupForm) {
      if (!allowReg) {
        showAuthError('New customer registration is currently disabled by administrator.');
        document.getElementById('signupSubmitBtn').disabled = true;
      }

      const phoneEl = document.getElementById('signupPhone');
      if (phoneEl) {
        phoneEl.addEventListener('input', () => {
          phoneEl.value = phoneEl.value.replace(/\D/g, '').slice(0, 10);
        });
      }

      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAuthError();
        const btn = document.getElementById('signupSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Creating Account...';

        try {
          const name = document.getElementById('signupName').value.trim();
          const phone = document.getElementById('signupPhone').value.trim();
          const email = document.getElementById('signupEmail')?.value.trim() || '';
          const password = document.getElementById('signupPassword').value;

          const res = await window.PortalCommon.apiFetch('/api/auth/signup', {
            method: 'POST',
            skipAuthRedirect: true,
            body: JSON.stringify({ name, phone, email, password })
          });
          window.PortalCommon.saveAuth(res.token, res.user, false);
          window.location.href = '/customer/dashboard.html';
        } catch (err) {
          showAuthError(err.message);
          btn.disabled = false;
          btn.textContent = 'Create Account & Continue';
        }
      });
    }
  });
})();

