/**
 * Main Application Orchestrator & State Machine
 * Coordinates camera, vision inference, canvas rendering, telemetry updates, and pause/resume states.
 */

import { CameraManager } from './camera.js';
import { PoseTracker } from './tracker.js';
import { CanvasRenderer } from './renderer.js';
import { TelemetryManager } from './telemetry.js';

// Global state flag mandated by PRD Section 4.2
window.isExecutionPaused = false;

export class App {
  constructor() {
    this.video = document.getElementById('webcamVideo');
    this.canvas = document.getElementById('skeletonCanvas');
    this.errorContainer = document.getElementById('cameraErrorContainer');
    this.loadingOverlay = document.getElementById('modelLoadingOverlay');
    this.loadingMessage = document.getElementById('loadingStatusText');

    this.cameraManager = new CameraManager(this.video, this.errorContainer);
    this.poseTracker = new PoseTracker();
    this.canvasRenderer = new CanvasRenderer(this.canvas);
    this.telemetryManager = new TelemetryManager();

    this.isMirrored = true;
    this.animationFrameId = null;
    this.videoCallbackId = null;
    this.hasRVFC = ('requestVideoFrameCallback' in HTMLVideoElement.prototype);
    this.isProcessing = false;
    this.lastInferenceTime = 0;
    this.domUpdateThrottleTimer = 0;
    this.latencyMs = 0;

    // Cache frozen snapshot state so resume cleanly picks up
    this.lastRenderedLandmarks = null;
    this.lastStickyState = false;
    this.lastDetectedCount = 0;
  }

  async init() {
    this.initUiBindings();
    this.telemetryManager.initDomBindings('telemetryTableWrapper', 'jsonTelemetryViewer');

    try {
      // 1. Initialize MediaPipe Model
      await this.poseTracker.initModel((msg) => {
        if (this.loadingMessage) this.loadingMessage.textContent = msg;
      });

      if (this.loadingOverlay) {
        this.loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => this.loadingOverlay.classList.add('hidden'), 300);
      }

      // 2. Start Camera Stream
      const cameraStarted = await this.cameraManager.startStream();
      if (!cameraStarted) {
        this.updateStatusBadge('CAMERA_ERROR', 'bg-red-500/20 text-red-400 border-red-500/30');
        this.telemetryManager.updateStatus('CAMERA_ERROR');
        return;
      }

      // 3. Populate device switcher if multiple cameras
      this.populateCameraSelector();

      // 4. Align canvas dimensions to video feed
      this.syncDimensions();

      // 5. Start main tracking loop
      this.updateStatusBadge('TRACKING_ACTIVE', 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30');
      this.telemetryManager.updateStatus('TRACKING_ACTIVE');
      this.startLoop();

    } catch (err) {
      console.error('Initialization failed:', err);
      if (this.loadingMessage) {
        this.loadingMessage.innerHTML = `
          <div class="text-red-400 font-semibold mb-2">Initialization Failed</div>
          <div class="text-xs text-slate-300 max-w-sm">${err.message || 'Error loading MediaPipe Vision WASM/model.'}</div>
        `;
      }
      this.updateStatusBadge('ERROR', 'bg-red-500/20 text-red-400 border-red-500/30');
      this.telemetryManager.updateStatus('ERROR');
    }
  }

  syncDimensions() {
    const videoWidth = this.video.videoWidth || 640;
    const videoHeight = this.video.videoHeight || 480;

    this.canvasRenderer.resize(videoWidth, videoHeight);
    this.telemetryManager.updateMetrics(videoWidth, videoHeight);

    // Update dimension display
    const dimEl = document.getElementById('videoResolutionText');
    if (dimEl) dimEl.textContent = `${videoWidth} × ${videoHeight}`;
  }

  startLoop() {
    this.scheduleNextFrame();
  }

  scheduleNextFrame() {
    if (window.isExecutionPaused) {
      return;
    }

    if (this.hasRVFC) {
      this.videoCallbackId = this.video.requestVideoFrameCallback((now, metadata) => {
        this.onVideoFrame(now, metadata);
      });
    } else {
      this.animationFrameId = requestAnimationFrame((timestamp) => {
        this.onVideoFrame(timestamp, null);
      });
    }
  }

  onVideoFrame(now, metadata) {
    if (window.isExecutionPaused) {
      return;
    }

    // Backpressure guard: if an inference is still executing, yield to keep video decoding smooth
    if (this.isProcessing) {
      this.scheduleNextFrame();
      return;
    }

    this.isProcessing = true;
    try {
      this.processFrame(now, metadata);
    } catch (err) {
      console.warn('Frame processing exception:', err);
    } finally {
      this.isProcessing = false;
      this.scheduleNextFrame();
    }
  }

  processFrame(now, metadata) {
    if (!this.cameraManager.isStreamReady || this.video.paused || this.video.ended) {
      return;
    }

    // Keep canvas dimensions synced if stream resolution adjusts
    if (this.canvas.width !== this.video.videoWidth && this.video.videoWidth > 0) {
      this.syncDimensions();
    }

    const t0 = performance.now();

    // Use presentationTime from metadata when available for perfect frame-sync, otherwise high-res clock
    const frameTimestamp = (metadata && metadata.presentationTime)
      ? metadata.presentationTime
      : performance.now();

    // 1. Run inference & sticky multi-person filter
    const detectionResult = this.poseTracker.detectPose(this.video, frameTimestamp);

    const inferenceDuration = performance.now() - t0;
    if (detectionResult !== null) {
      this.latencyMs = Math.round(inferenceDuration * 10) / 10;
    }

    if (detectionResult && detectionResult.landmarks) {
      const { landmarks, allDetectionsCount, isStickyLocked } = detectionResult;

      this.lastRenderedLandmarks = landmarks;
      this.lastStickyState = isStickyLocked;
      this.lastDetectedCount = allDetectionsCount;

      // 2. Render skeleton overlay
      this.canvasRenderer.renderSkeleton(landmarks, isStickyLocked, allDetectionsCount);

      // 3. Update telemetry pre-allocated object
      this.telemetryManager.updateLandmarks(landmarks);
      this.telemetryManager.updateStatus('TRACKING_ACTIVE');
      this.updateStatusBadge('TRACKING_ACTIVE', 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30');

    } else if (detectionResult && detectionResult.landmarks === null) {
      // No pose in current frame
      this.canvasRenderer.clear();
      this.telemetryManager.updateStatus('NO_POSE_DETECTED');
      this.updateStatusBadge('SEARCHING', 'bg-amber-500/20 text-amber-400 border-amber-500/30');
    }

    // 4. Update metrics (FPS, resolution)
    this.telemetryManager.updateMetrics(this.video.videoWidth, this.video.videoHeight);

    // 5. Throttled DOM UI updates (target 20-30Hz to prevent DOM reflow bottlenecking WASM)
    const nowTime = performance.now();
    if (nowTime - this.domUpdateThrottleTimer > 35) {
      this.telemetryManager.renderDom();
      this.updatePerformanceStats();
      this.domUpdateThrottleTimer = nowTime;
    }
  }

  togglePause() {
    window.isExecutionPaused = !window.isExecutionPaused;
    const pauseBtn = document.getElementById('pauseToggleBtn');
    const pauseIcon = document.getElementById('pauseBtnIcon');
    const pauseText = document.getElementById('pauseBtnText');

    if (window.isExecutionPaused) {
      // FREEZE FRAME ROUTINE (PRD Section 3.5 & 4.2)
      if (this.videoCallbackId !== null && this.hasRVFC) {
        this.video.cancelVideoFrameCallback(this.videoCallbackId);
        this.videoCallbackId = null;
      }
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.isProcessing = false;

      this.video.pause();
      this.telemetryManager.updateStatus('PAUSED');
      this.updateStatusBadge('PAUSED (FROZEN)', 'bg-amber-500/20 text-amber-300 border-amber-500/40 ring-1 ring-amber-400/30');

      // Preserve last skeleton overlay and add freeze watermark
      if (this.lastRenderedLandmarks) {
        this.canvasRenderer.renderSkeleton(this.lastRenderedLandmarks, this.lastStickyState, this.lastDetectedCount);
      }
      this.canvasRenderer.renderPausedWatermark();

      // Perform a final DOM update so telemetry reflects the frozen moment exactly
      this.telemetryManager.renderDom();

      // UI Button Update
      if (pauseText) pauseText.textContent = 'Resume Tracking';
      if (pauseBtn) {
        pauseBtn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
        pauseBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
      }
      if (pauseIcon) {
        pauseIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
      }

    } else {
      // RESUME ROUTINE
      this.isProcessing = false;
      this.video.play().catch(e => console.warn('Video play resume warning:', e));
      this.telemetryManager.updateStatus('TRACKING_ACTIVE');
      this.updateStatusBadge('TRACKING_ACTIVE', 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30');

      if (pauseText) pauseText.textContent = 'Pause & Freeze';
      if (pauseBtn) {
        pauseBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        pauseBtn.classList.add('bg-amber-600', 'hover:bg-amber-500');
      }
      if (pauseIcon) {
        pauseIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
      }

      this.startLoop();
    }
  }

  toggleMirror() {
    this.isMirrored = !this.isMirrored;
    this.canvasRenderer.setMirrored(this.isMirrored);

    if (this.isMirrored) {
      this.video.classList.add('scale-x-[-1]');
    } else {
      this.video.classList.remove('scale-x-[-1]');
    }

    const mirrorBtn = document.getElementById('mirrorToggleBtn');
    if (mirrorBtn) {
      mirrorBtn.classList.toggle('bg-sky-500/20', this.isMirrored);
      mirrorBtn.classList.toggle('text-sky-300', this.isMirrored);
      mirrorBtn.classList.toggle('border-sky-500/40', this.isMirrored);
    }

    // Re-render current frame if paused
    if (window.isExecutionPaused && this.lastRenderedLandmarks) {
      this.canvasRenderer.renderSkeleton(this.lastRenderedLandmarks, this.lastStickyState, this.lastDetectedCount);
      this.canvasRenderer.renderPausedWatermark();
    }
  }

  updatePerformanceStats() {
    const fps = this.telemetryManager.currentFps;
    const fpsEl = document.getElementById('fpsCounterText');
    const latencyEl = document.getElementById('latencyText');

    if (fpsEl) {
      fpsEl.textContent = `${fps.toFixed(1)} FPS`;
      if (fps >= 24) {
        fpsEl.className = 'text-emerald-400 font-mono font-bold';
      } else if (fps >= 15) {
        fpsEl.className = 'text-amber-400 font-mono font-bold';
      } else {
        fpsEl.className = 'text-red-400 font-mono font-bold';
      }
    }

    if (latencyEl) {
      latencyEl.textContent = `${this.latencyMs} ms`;
      if (this.latencyMs < 50) {
        latencyEl.className = 'text-emerald-400 font-mono font-bold';
      } else {
        latencyEl.className = 'text-amber-400 font-mono font-bold';
      }
    }
  }

  updateStatusBadge(text, classNames) {
    const badge = document.getElementById('trackingStatusBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = `px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${classNames}`;
  }

  async populateCameraSelector() {
    const select = document.getElementById('cameraDeviceSelect');
    if (!select) return;

    const devices = await this.cameraManager.listVideoDevices();
    select.innerHTML = '';

    if (devices.length <= 1) {
      select.parentElement.classList.add('hidden');
      return;
    }

    select.parentElement.classList.remove('hidden');
    devices.forEach((dev, idx) => {
      const option = document.createElement('option');
      option.value = dev.deviceId;
      option.textContent = dev.label || `Camera ${idx + 1}`;
      select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
      const deviceId = e.target.value;
      await this.cameraManager.startStream(deviceId);
      this.syncDimensions();
    });
  }

  initUiBindings() {
    // 1. Pause button & Spacebar shortcut
    const pauseBtn = document.getElementById('pauseToggleBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePause());
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.togglePause();
      }
    });

    // 2. Mirror Toggle
    const mirrorBtn = document.getElementById('mirrorToggleBtn');
    if (mirrorBtn) {
      mirrorBtn.addEventListener('click', () => this.toggleMirror());
    }

    // 3. Reset Sticky Lock button
    const resetLockBtn = document.getElementById('resetLockBtn');
    if (resetLockBtn) {
      resetLockBtn.addEventListener('click', () => {
        this.poseTracker.resetTargetLock();
        const toast = document.getElementById('actionToast');
        if (toast) {
          toast.textContent = 'Sticky lock reset — acquiring first person...';
          toast.classList.remove('opacity-0');
          setTimeout(() => toast.classList.add('opacity-0'), 2000);
        }
      });
    }

    // 4. Copy JSON Snapshot
    const copyJsonBtn = document.getElementById('copyJsonBtn');
    if (copyJsonBtn) {
      copyJsonBtn.addEventListener('click', async () => {
        const json = this.telemetryManager.getSnapshotJson();
        try {
          await navigator.clipboard.writeText(json);
          copyJsonBtn.textContent = 'Copied!';
          setTimeout(() => { copyJsonBtn.textContent = 'Copy JSON'; }, 1500);
        } catch (e) {
          console.warn('Clipboard write failed, falling back:', e);
          const textarea = document.createElement('textarea');
          textarea.value = json;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          copyJsonBtn.textContent = 'Copied!';
          setTimeout(() => { copyJsonBtn.textContent = 'Copy JSON'; }, 1500);
        }
      });
    }

    // 5. Category filter pills (All, Facial, Upper Body, Lower Body)
    const filterPills = document.querySelectorAll('.category-filter-pill');
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => {
          p.classList.remove('bg-sky-500', 'text-white');
          p.classList.add('bg-slate-800', 'text-slate-400');
        });
        pill.classList.remove('bg-slate-800', 'text-slate-400');
        pill.classList.add('bg-sky-500', 'text-white');

        const category = pill.dataset.category;
        this.telemetryManager.filterRows(category);
      });
    });

    // 6. View tab switcher (Table vs Raw JSON)
    const tabTableBtn = document.getElementById('tabTableBtn');
    const tabJsonBtn = document.getElementById('tabJsonBtn');
    const tableWrapper = document.getElementById('telemetryTableWrapper');
    const jsonWrapper = document.getElementById('jsonViewerWrapper');

    if (tabTableBtn && tabJsonBtn) {
      tabTableBtn.addEventListener('click', () => {
        tabTableBtn.classList.add('text-sky-400', 'border-b-2', 'border-sky-400');
        tabTableBtn.classList.remove('text-slate-400');
        tabJsonBtn.classList.remove('text-sky-400', 'border-b-2', 'border-sky-400');
        tabJsonBtn.classList.add('text-slate-400');

        tableWrapper.classList.remove('hidden');
        jsonWrapper.classList.add('hidden');
        this.telemetryManager.activeTab = 'table';
      });

      tabJsonBtn.addEventListener('click', () => {
        tabJsonBtn.classList.add('text-sky-400', 'border-b-2', 'border-sky-400');
        tabJsonBtn.classList.remove('text-slate-400');
        tabTableBtn.classList.remove('text-sky-400', 'border-b-2', 'border-sky-400');
        tabTableBtn.classList.add('text-slate-400');

        tableWrapper.classList.add('hidden');
        jsonWrapper.classList.remove('hidden');
        this.telemetryManager.activeTab = 'json';
        this.telemetryManager.renderDom();
      });
    }

    // 7. Table row hover effects on skeleton canvas
    const tbody = document.getElementById('telemetryTableWrapper');
    if (tbody) {
      tbody.addEventListener('mouseover', (e) => {
        const tr = e.target.closest('tr');
        if (tr && tr.id && tr.id.startsWith('telemetry-row-')) {
          const idx = parseInt(tr.id.replace('telemetry-row-', ''), 10);
          this.canvasRenderer.setHoveredLandmark(idx);
          if (window.isExecutionPaused && this.lastRenderedLandmarks) {
            this.canvasRenderer.renderSkeleton(this.lastRenderedLandmarks, this.lastStickyState, this.lastDetectedCount);
            this.canvasRenderer.renderPausedWatermark();
          }
        }
      });

      tbody.addEventListener('mouseleave', () => {
        this.canvasRenderer.setHoveredLandmark(null);
        if (window.isExecutionPaused && this.lastRenderedLandmarks) {
          this.canvasRenderer.renderSkeleton(this.lastRenderedLandmarks, this.lastStickyState, this.lastDetectedCount);
          this.canvasRenderer.renderPausedWatermark();
        }
      });
    }
  }
}

// Bootstrap on window load
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
