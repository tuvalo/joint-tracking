# Real-Time Web Motion & Joint Tracker (33-Node MVP)

A lightweight, 100% client-side web application that captures live webcam video, processes full-body human pose tracking using Google MediaPipe Tasks-Vision (WASM), overlays a 33-point anatomical skeleton wireframe, and exposes real-time joint telemetry.

## Features

- **Full 33-Point MediaPipe Pose Topology:** Real-time normalized screen coordinates ($X$, $Y$), relative depth ($Z$), and confidence visibility for:
  - *Facial Nodes (0–10)*: Nose, eyes, ears, mouth
  - *Upper Body (11–22)*: Shoulders, elbows, wrists, hands/fingers
  - *Lower Body (23–32)*: Hips, knees, ankles, heels, foot indices
- **Multi-Person Resolution (Sticky Tracking Matrix):** Dynamically locks onto the first person detected via hip-center distance minimization over sequential frames, preventing the wireframe from sporadic jumping when multiple people are in view.
- **Freeze-Frame / Pause Inspection Mode:** Hit <kbd>Space</kbd> or click "Pause & Freeze" to instantly freeze the webcam feed, lock the skeleton canvas overlay, and halt the rolling telemetry stream for static coordinate inspection.
- **Pre-Allocated Memory Architecture:** Zero garbage collection stuttering during 30+ FPS streaming by mutating pre-allocated object references in-place.
- **Developer Inspection Hooks:**
  - `window.currentMotionTelemetry` adheres strictly to the PRD structured JSON schema.
  - `window.isExecutionPaused` reflects real-time state machine execution.
  - One-click "Copy JSON" snapshot to clipboard.
- **Hardware Fallback States:** Clear UI messages and retry logic for camera permission denial, device disconnected, or camera in-use errors.

---

## Quick Start & Local Execution

Because the application uses WebAssembly (WASM) and browser media streaming (`getUserMedia`), modern browsers require the files to be served via an HTTP/HTTPS origin (not `file://`).

### Running Locally

Run a lightweight local HTTP server from the project directory:

```bash
# Using Python 3
python3 -m http.server 8000
```

or using Node.js:
```bash
# Using npx serve or http-server
npx serve .
```

Open your browser to:
[http://localhost:8000](http://localhost:8000)

Grant webcam permissions when prompted by your browser.

---

## Developer Telemetry Schema

Open your browser's Developer Tools (`F12` or `Cmd+Opt+I`) and inspect the live telemetry at any time:

```javascript
console.log(window.currentMotionTelemetry);
```

The payload matches this specification:

```json
{
  "timestamp": 1718820000456,
  "trackingStatus": "TRACKING_ACTIVE",
  "frameMetadata": {
    "fps": 29.8,
    "dimensions": { "width": 640, "height": 480 }
  },
  "landmarks": {
    "facial_nodes": {
      "0":  { "name": "nose", "x": 0.51, "y": 0.23, "z": -0.12, "visibility": 0.99 },
      ...
    },
    "upper_body": {
      "11": { "name": "left_shoulder", "x": 0.38, "y": 0.35, "z": -0.08, "visibility": 0.99 },
      ...
    },
    "lower_body": {
      "23": { "name": "left_hip", "x": 0.41, "y": 0.65, "z": 0.00, "visibility": 0.99 },
      ...
    }
  }
}
```

---

## File Structure

```
JointsTracker/
├── index.html                 # Main application UI & CDN inclusions
├── css/
│   └── styles.css             # Video/canvas overlay positioning & styling
├── js/
│   ├── config.js              # Landmark indices, connections graph & constants
│   ├── camera.js              # WebRTC stream management & permission fallbacks
│   ├── tracker.js             # MediaPipe PoseLandmarker & Sticky Tracking Matrix
│   ├── renderer.js           # 2D canvas skeleton wireframe visualizer
│   ├── telemetry.js          # Pre-allocated state manager & DOM dashboard
│   └── app.js                 # App coordinator, state machine & pause loop
└── README.md
```
