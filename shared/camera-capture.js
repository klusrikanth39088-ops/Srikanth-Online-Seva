/**
 * Reusable WebRTC Camera Capture Modal for Desktop & Mobile
 */
(function () {
  let activeStream = null;
  let currentFacingMode = 'environment';
  let capturedBlob = null;

  function stopStream() {
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      activeStream = null;
    }
  }

  function ensureModalDom() {
    let modal = document.getElementById('cameraCaptureModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'cameraCaptureModal';
    modal.className = 'modal-backdrop hidden';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 id="cameraModalTitle">Capture Document</h3>
          <button type="button" class="modal-close" id="cameraModalClose">&times;</button>
        </div>
        <div id="cameraErrorBox" class="alert alert-error hidden"></div>
        <video id="cameraVideoPreview" class="camera-video" autoplay playsinline></video>
        <img id="cameraPhotoPreview" class="camera-video hidden" alt="Captured preview" />
        <canvas id="cameraCanvas" class="hidden"></canvas>
        <div style="display:flex; flex-wrap:wrap; gap:0.5rem; justify-content:space-between; margin-top:1rem;">
          <button type="button" class="btn btn-outline btn-sm" id="cameraSwitchBtn">Switch Camera</button>
          <div style="display:flex; gap:0.5rem;">
            <button type="button" class="btn btn-outline hidden" id="cameraRetakeBtn">Retake</button>
            <button type="button" class="btn btn-primary" id="cameraSnapBtn">Capture Photo</button>
            <button type="button" class="btn btn-success hidden" id="cameraUseBtn">Use This Photo</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  async function startCamera(videoEl, errBox) {
    stopStream();
    errBox.classList.add('hidden');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API is not supported on this browser/context. Please use file upload.');
      }
      activeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      videoEl.srcObject = activeStream;
    } catch (err) {
      errBox.textContent = err.message || 'Unable to access camera. Check browser permissions.';
      errBox.classList.remove('hidden');
    }
  }

  function open({ title = 'Capture Document', fieldName = 'document', onCapture }) {
    const modal = ensureModalDom();
    const titleEl = modal.querySelector('#cameraModalTitle');
    const closeBtn = modal.querySelector('#cameraModalClose');
    const videoEl = modal.querySelector('#cameraVideoPreview');
    const photoEl = modal.querySelector('#cameraPhotoPreview');
    const canvas = modal.querySelector('#cameraCanvas');
    const errBox = modal.querySelector('#cameraErrorBox');
    const switchBtn = modal.querySelector('#cameraSwitchBtn');
    const snapBtn = modal.querySelector('#cameraSnapBtn');
    const retakeBtn = modal.querySelector('#cameraRetakeBtn');
    const useBtn = modal.querySelector('#cameraUseBtn');

    titleEl.textContent = title;
    capturedBlob = null;
    videoEl.classList.remove('hidden');
    photoEl.classList.add('hidden');
    snapBtn.classList.remove('hidden');
    retakeBtn.classList.add('hidden');
    useBtn.classList.add('hidden');

    modal.classList.remove('hidden');
    startCamera(videoEl, errBox);

    const closeModal = () => {
      stopStream();
      modal.classList.add('hidden');
    };

    closeBtn.onclick = closeModal;

    switchBtn.onclick = () => {
      currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      startCamera(videoEl, errBox);
    };

    snapBtn.onclick = () => {
      if (!videoEl.videoWidth) return;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        capturedBlob = blob;
        photoEl.src = URL.createObjectURL(blob);
        videoEl.classList.add('hidden');
        photoEl.classList.remove('hidden');
        snapBtn.classList.add('hidden');
        retakeBtn.classList.remove('hidden');
        useBtn.classList.remove('hidden');
      }, 'image/jpeg', 0.9);
    };

    retakeBtn.onclick = () => {
      capturedBlob = null;
      photoEl.classList.add('hidden');
      videoEl.classList.remove('hidden');
      snapBtn.classList.remove('hidden');
      retakeBtn.classList.add('hidden');
      useBtn.classList.add('hidden');
    };

    useBtn.onclick = () => {
      if (!capturedBlob) return;
      const file = new File([capturedBlob], `${fieldName}-cam-${Date.now()}.jpg`, {
        type: 'image/jpeg'
      });
      closeModal();
      if (typeof onCapture === 'function') {
        onCapture(file);
      }
    };
  }

  window.CameraCaptureModal = { open };
})();

