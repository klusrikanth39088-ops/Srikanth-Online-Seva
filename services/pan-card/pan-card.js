/**
 * PAN Card Service Module Controller
 * Handles conditional "Others" DOB proof input, numeric phone guard,
 * camera capture triggers, file validation/preview, and prefill/edit mode.
 */
(function () {
  window.ServiceModuleHandlers = window.ServiceModuleHandlers || {};

  window.ServiceModuleHandlers['pan-card'] = {
    init(container, options = {}) {
      const dobSelect = container.querySelector('#field_dob_proof_type');
      const otherGroup = container.querySelector('#dobOtherNameGroup');
      const otherInput = container.querySelector('#field_dob_proof_other_name');
      const phoneInput = container.querySelector('#field_phone_number');

      const syncOtherVisibility = () => {
        const isOthers = dobSelect && dobSelect.value === 'Others';
        if (otherGroup) {
          otherGroup.classList.toggle('hidden', !isOthers);
        }
        if (otherInput) {
          otherInput.required = Boolean(isOthers);
          if (!isOthers) otherInput.value = '';
        }
      };

      if (dobSelect) {
        dobSelect.addEventListener('change', syncOtherVisibility);
      }

      if (phoneInput) {
        phoneInput.addEventListener('input', () => {
          phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 10);
        });
      }

      // Prefill if editing an existing application
      if (options.initialData) {
        const data = options.initialData;
        ['father_name', 'mother_name', 'phone_number', 'email', 'dob_proof_type', 'dob_proof_other_name'].forEach((key) => {
          const el = container.querySelector(`[name="${key}"]`);
          if (el && data[key] !== undefined && data[key] !== null) {
            el.value = data[key];
          }
        });
      }

      syncOtherVisibility();
    },

    validate(container, fileStore, isEditMode = false, existingFiles = {}) {
      const errors = [];
      const father = container.querySelector('#field_father_name')?.value.trim();
      const mother = container.querySelector('#field_mother_name')?.value.trim();
      const phone = container.querySelector('#field_phone_number')?.value.trim();
      const email = container.querySelector('#field_email')?.value.trim();
      const dobType = container.querySelector('#field_dob_proof_type')?.value;
      const dobOther = container.querySelector('#field_dob_proof_other_name')?.value.trim();

      if (!father) errors.push('Full Name of Father is mandatory.');
      if (!mother) errors.push('Full Name of Mother is mandatory.');
      if (!phone || !/^\d{10}$/.test(phone)) errors.push('Valid 10-digit Phone Number is mandatory.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Please enter a valid Email ID.');
      if (!dobType) errors.push('Date of Birth Proof Type is mandatory.');
      if (dobType === 'Others' && !dobOther) errors.push('Please specify the Other DOB Proof document name.');

      const mandatoryFiles = [
        { key: 'aadhaar_front', label: 'Aadhaar Card Front' },
        { key: 'aadhaar_back', label: 'Aadhaar Card Back' },
        { key: 'passport_photo', label: 'Passport Photo' },
        { key: 'signature', label: 'Signature' },
        { key: 'dob_proof_file', label: 'Date of Birth Proof Document' }
      ];

      mandatoryFiles.forEach(({ key, label }) => {
        const hasNewFile = Boolean(fileStore[key]);
        const hasExisting = isEditMode && Boolean(existingFiles[key]);
        if (!hasNewFile && !hasExisting) {
          errors.push(`${label} upload is mandatory.`);
        }
      });

      return errors;
    }
  };
})();

