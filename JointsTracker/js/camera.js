/**
 * Camera Stream & Device Lifecycle Manager
 * Handles WebRTC getUserMedia permissions, device selection, and error fallbacks.
 */

export class CameraManager {
  constructor(videoElement, errorContainer) {
    this.videoElement = videoElement;
    this.errorContainer = errorContainer;
    this.currentStream = null;
    this.selectedDeviceId = null;
    this.availableDevices = [];
    this.isStreamReady = false;
  }

  async listVideoDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableDevices = devices.filter(device => device.kind === 'videoinput');
      return this.availableDevices;
    } catch (err) {
      console.warn('Failed to enumerate video devices:', err);
      return [];
    }
  }

  async startStream(deviceId = null) {
    this.stopStream();
    this.clearError();
    this.isStreamReady = false;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.showError(
        'Browser API Unsupported',
        'Your browser does not support WebRTC camera access (navigator.mediaDevices.getUserMedia). Please try a modern version of Chrome, Firefox, Safari, or Edge.'
      );
      return false;
    }

    const constraints = {
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentStream = stream;
      this.videoElement.srcObject = stream;

      await new Promise((resolve, reject) => {
        let isResolved = false;

        const onReady = async () => {
          if (isResolved) return;
          try {
            await this.videoElement.play();
            this.isStreamReady = true;
            isResolved = true;
            this.videoElement.removeEventListener('loadeddata', onReady);
            this.videoElement.removeEventListener('canplay', onReady);
            resolve();
          } catch (playErr) {
            console.warn('Video play error on ready:', playErr);
            reject(playErr);
          }
        };

        if (this.videoElement.readyState >= 2) {
          onReady();
        } else {
          this.videoElement.addEventListener('loadeddata', onReady, { once: true });
          this.videoElement.addEventListener('canplay', onReady, { once: true });
        }

        // Safety timeout
        setTimeout(() => {
          if (!isResolved) {
            this.videoElement.play().catch(e => console.warn(e));
            this.isStreamReady = true;
            isResolved = true;
            resolve();
          }
        }, 3000);
      });

      // Update device list once permission is granted (labels become accessible)
      await this.listVideoDevices();
      return true;
    } catch (error) {
      this.handleCameraError(error);
      return false;
    }
  }

  stopStream() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.isStreamReady = false;
  }

  handleCameraError(error) {
    console.error('Camera stream access failed:', error);
    let title = 'Camera Access Error';
    let message = 'Unable to access your video camera.';

    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        title = 'Camera Permission Denied';
        message = 'Camera access was blocked by the browser or user. To grant permission, click the camera icon in your browser address bar and select "Always allow", then refresh this page.';
        break;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        title = 'No Camera Detected';
        message = 'No video capture hardware was detected on your machine. Please plug in a webcam and reload.';
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        title = 'Camera Hardware In Use';
        message = 'The camera is currently being used by another application (e.g. Zoom, Meet, or FaceTime). Please close other apps using the camera and retry.';
        break;
      case 'OverconstrainedError':
        title = 'Unsupported Camera Resolution';
        message = 'Your camera does not satisfy the requested resolution. Attempting fallback to standard resolution...';
        // Try fallback with loose constraints
        setTimeout(() => this.startFallbackStream(), 500);
        return;
      default:
        message = `${error.name}: ${error.message || 'Unknown camera error.'}`;
    }

    this.showError(title, message);
  }

  async startFallbackStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.currentStream = stream;
      this.videoElement.srcObject = stream;
      this.clearError();
      await this.videoElement.play();
      this.isStreamReady = true;
    } catch (err) {
      this.showError('Camera Fallback Failed', 'Could not open camera even with default fallback settings: ' + err.message);
    }
  }

  showError(title, message) {
    if (!this.errorContainer) return;
    this.errorContainer.innerHTML = `
      <div class="bg-red-950/80 border border-red-500/50 rounded-xl p-5 text-red-200 shadow-2xl backdrop-blur-md max-w-md mx-auto animate-fade-in text-center">
        <div class="w-12 h-12 mx-auto mb-3 bg-red-900/60 rounded-full flex items-center justify-center text-red-400">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <h3 class="text-base font-bold text-red-100 mb-1.5">${title}</h3>
        <p class="text-xs text-red-300 leading-relaxed mb-4">${message}</p>
        <button id="retryCameraBtn" class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold tracking-wide transition shadow-md">
          Retry Camera Connection
        </button>
      </div>
    `;
    this.errorContainer.classList.remove('hidden');

    const retryBtn = document.getElementById('retryCameraBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.startStream();
      });
    }
  }

  clearError() {
    if (this.errorContainer) {
      this.errorContainer.innerHTML = '';
      this.errorContainer.classList.add('hidden');
    }
  }
}
