/**
 * MediaPipe Pose Landmarker Wrapper & Sticky Tracking Matrix
 * Manages vision models, inference lifecycle, and sticky multi-person locking.
 */

import { CONFIG } from './config.js';

export class PoseTracker {
  constructor() {
    this.poseLandmarker = null;
    this.isModelLoaded = false;
    this.targetPersonHistoryVector = null;
    this.lastDetectedTimestamp = 0;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.trackedPersonIndex = -1;
  }

  /**
   * Initializes MediaPipe FilesetResolver and PoseLandmarker
   */
  async initModel(onProgressCallback = null) {
    try {
      if (onProgressCallback) onProgressCallback('Loading MediaPipe Vision WASM binaries...');

      let PoseLandmarkerModule, FilesetResolverModule;

      // Handle both global bundle script loading and ES module import
      if (window.PoseLandmarker && window.FilesetResolver) {
        PoseLandmarkerModule = window.PoseLandmarker;
        FilesetResolverModule = window.FilesetResolver;
      } else if (window.tasksVision) {
        PoseLandmarkerModule = window.tasksVision.PoseLandmarker;
        FilesetResolverModule = window.tasksVision.FilesetResolver;
      } else {
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
        PoseLandmarkerModule = vision.PoseLandmarker;
        FilesetResolverModule = vision.FilesetResolver;
      }

      if (onProgressCallback) onProgressCallback('Compiling WASM vision tasks...');

      const vision = await FilesetResolverModule.forVisionTasks(CONFIG.WASM_CDN_PATH);

      if (onProgressCallback) onProgressCallback('Fetching Pose Landmarker model weights...');

      this.poseLandmarker = await PoseLandmarkerModule.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: CONFIG.MODEL_ASSET_PATH,
          delegate: 'GPU' // Defaults to GPU/WebGL, gracefully falls back to CPU WASM
        },
        runningMode: 'VIDEO',
        numPoses: CONFIG.MAX_POSES,
        minPoseDetectionConfidence: CONFIG.MIN_DETECTION_CONFIDENCE,
        minPosePresenceConfidence: CONFIG.MIN_PRESENCE_CONFIDENCE,
        minTrackingConfidence: CONFIG.MIN_TRACKING_CONFIDENCE
      });

      this.isModelLoaded = true;
      if (onProgressCallback) onProgressCallback('Pose Landmarker initialized successfully.');
      return true;
    } catch (err) {
      console.error('Failed to initialize MediaPipe PoseLandmarker:', err);
      // Fallback try with CPU delegate if GPU initialization failed
      try {
        console.warn('Attempting CPU fallback for PoseLandmarker...');
        if (onProgressCallback) onProgressCallback('Attempting CPU fallback...');
        const vision = await window.FilesetResolver.forVisionTasks(CONFIG.WASM_CDN_PATH);
        this.poseLandmarker = await window.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: CONFIG.MODEL_ASSET_PATH,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numPoses: CONFIG.MAX_POSES,
          minPoseDetectionConfidence: CONFIG.MIN_DETECTION_CONFIDENCE,
          minPosePresenceConfidence: CONFIG.MIN_PRESENCE_CONFIDENCE,
          minTrackingConfidence: CONFIG.MIN_TRACKING_CONFIDENCE
        });
        this.isModelLoaded = true;
        return true;
      } catch (fallbackErr) {
        console.error('CPU fallback also failed:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  /**
   * Processes a video frame and applies the Sticky Tracking filter.
   * Returns: { landmarks: Array[33], allDetectionsCount: number, isStickyLocked: boolean }
   */
  detectPose(videoElement, timestamp) {
    if (!this.isModelLoaded || !this.poseLandmarker) {
      return null;
    }

    // Ensure timestamp passed to MediaPipe is strictly monotonically increasing
    if (!timestamp || timestamp <= this.lastTimestamp) {
      timestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = timestamp;

    let results = null;
    try {
      results = this.poseLandmarker.detectForVideo(videoElement, timestamp);
    } catch (err) {
      console.warn('MediaPipe detectForVideo frame skipped due to error:', err);
      return null;
    }

    if (!results || !results.landmarks || results.landmarks.length === 0) {
      // Check if timeout elapsed to reset target history
      if (Date.now() - this.lastDetectedTimestamp > CONFIG.STICKY_RESET_TIMEOUT_MS) {
        this.targetPersonHistoryVector = null;
        this.trackedPersonIndex = -1;
      }
      return {
        landmarks: null,
        allDetectionsCount: 0,
        isStickyLocked: false
      };
    }

    this.lastDetectedTimestamp = Date.now();
    const primaryLandmarks = this.processStickyTracking(results.landmarks);

    return {
      landmarks: primaryLandmarks,
      allDetectionsCount: results.landmarks.length,
      isStickyLocked: this.targetPersonHistoryVector !== null
    };
  }

  /**
   * Sticky Multi-Person Tracking Algorithm (PRD Section 4.1)
   * Locks onto the first person detected and minimizes hip-center displacement over sequential frames.
   */
  processStickyTracking(allDetectedPeople) {
    if (!allDetectedPeople || allDetectedPeople.length === 0) {
      this.targetPersonHistoryVector = null;
      this.trackedPersonIndex = -1;
      return null;
    }

    // Helper to safely extract landmark array regardless of wrapper
    const getLandmarks = (person) => (Array.isArray(person) ? person : person.landmarks);

    // Initial state: Lock onto the first detected individual
    if (this.targetPersonHistoryVector === null) {
      const primary = getLandmarks(allDetectedPeople[0]);
      this.targetPersonHistoryVector = this.calculateHipCenter(primary);
      this.trackedPersonIndex = 0;
      return primary;
    }

    // Subsequent states: Find candidate closest to targetPersonHistoryVector
    let closestPerson = getLandmarks(allDetectedPeople[0]);
    let minDistance = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < allDetectedPeople.length; i++) {
      const currentLandmarks = getLandmarks(allDetectedPeople[i]);
      const currentCenter = this.calculateHipCenter(currentLandmarks);

      const distance = Math.hypot(
        currentCenter.x - this.targetPersonHistoryVector.x,
        currentCenter.y - this.targetPersonHistoryVector.y
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestPerson = currentLandmarks;
        closestIndex = i;
      }
    }

    // Update history anchor for the next frame
    this.targetPersonHistoryVector = this.calculateHipCenter(closestPerson);
    this.trackedPersonIndex = closestIndex;
    return closestPerson;
  }

  /**
   * Computes center coordinates between left hip (23) and right hip (24)
   */
  calculateHipCenter(personLandmarks) {
    if (!personLandmarks || personLandmarks.length < 25) {
      return { x: 0.5, y: 0.5 };
    }
    const leftHip = personLandmarks[23];
    const rightHip = personLandmarks[24];
    return {
      x: (leftHip.x + rightHip.x) / 2,
      y: (leftHip.y + rightHip.y) / 2
    };
  }

  /**
   * Resets sticky tracking target lock manually (e.g. user clicks Re-lock)
   */
  resetTargetLock() {
    this.targetPersonHistoryVector = null;
    this.trackedPersonIndex = -1;
  }
}
