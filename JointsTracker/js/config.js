/**
 * 33-Node MediaPipe Pose Topology Configuration
 * Maps indices to standard names, categories, and anatomical connections.
 */

export const LANDMARK_DEFINITIONS = {
  // Facial Nodes (0 - 10)
  0:  { name: 'nose', category: 'facial_nodes' },
  1:  { name: 'left_eye_inner', category: 'facial_nodes' },
  2:  { name: 'left_eye', category: 'facial_nodes' },
  3:  { name: 'left_eye_outer', category: 'facial_nodes' },
  4:  { name: 'right_eye_inner', category: 'facial_nodes' },
  5:  { name: 'right_eye', category: 'facial_nodes' },
  6:  { name: 'right_eye_outer', category: 'facial_nodes' },
  7:  { name: 'left_ear', category: 'facial_nodes' },
  8:  { name: 'right_ear', category: 'facial_nodes' },
  9:  { name: 'mouth_left', category: 'facial_nodes' },
  10: { name: 'mouth_right', category: 'facial_nodes' },

  // Upper Body (11 - 22)
  11: { name: 'left_shoulder', category: 'upper_body' },
  12: { name: 'right_shoulder', category: 'upper_body' },
  13: { name: 'left_elbow', category: 'upper_body' },
  14: { name: 'right_elbow', category: 'upper_body' },
  15: { name: 'left_wrist', category: 'upper_body' },
  16: { name: 'right_wrist', category: 'upper_body' },
  17: { name: 'left_pinky', category: 'upper_body' },
  18: { name: 'right_pinky', category: 'upper_body' },
  19: { name: 'left_index', category: 'upper_body' },
  20: { name: 'right_index', category: 'upper_body' },
  21: { name: 'left_thumb', category: 'upper_body' },
  22: { name: 'right_thumb', category: 'upper_body' },

  // Lower Body (23 - 32)
  23: { name: 'left_hip', category: 'lower_body' },
  24: { name: 'right_hip', category: 'lower_body' },
  25: { name: 'left_knee', category: 'lower_body' },
  26: { name: 'right_knee', category: 'lower_body' },
  27: { name: 'left_ankle', category: 'lower_body' },
  28: { name: 'right_ankle', category: 'lower_body' },
  29: { name: 'left_heel', category: 'lower_body' },
  30: { name: 'right_heel', category: 'lower_body' },
  31: { name: 'left_foot_index', category: 'lower_body' },
  32: { name: 'right_foot_index', category: 'lower_body' }
};

export const POSE_CONNECTIONS = [
  // Face connections
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],

  // Upper body / Torso
  [11, 12], // Shoulders
  [11, 23], // Left torso
  [12, 24], // Right torso
  [23, 24], // Hips

  // Left Arm
  [11, 13], [13, 15],
  [15, 17], [15, 19], [15, 21], [17, 19],

  // Right Arm
  [12, 14], [14, 16],
  [16, 18], [16, 20], [16, 22], [18, 20],

  // Left Leg
  [23, 25], [25, 27],
  [27, 29], [27, 31], [29, 31],

  // Right Leg
  [24, 26], [26, 28],
  [28, 30], [28, 32], [30, 32]
];

export const CATEGORY_COLORS = {
  facial_nodes: {
    stroke: 'rgba(56, 189, 248, 0.85)', // Sky blue
    fill: '#38bdf8'
  },
  upper_body: {
    stroke: 'rgba(52, 211, 153, 0.85)', // Emerald green
    fill: '#34d399'
  },
  lower_body: {
    stroke: 'rgba(168, 85, 247, 0.85)', // Purple
    fill: '#a855f7'
  }
};

export const CONFIG = {
  MODEL_ASSET_PATH: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  WASM_CDN_PATH: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  MIN_DETECTION_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
  MIN_PRESENCE_CONFIDENCE: 0.5,
  MAX_POSES: 4,
  STICKY_RESET_TIMEOUT_MS: 1500 // Reset sticky target lock after 1.5s without detection
};
