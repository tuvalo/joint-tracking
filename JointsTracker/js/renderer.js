/**
 * Canvas Visualization Engine
 * Renders high-performance 2D skeleton wireframe, joints, and state overlays.
 */

import { POSE_CONNECTIONS, LANDMARK_DEFINITIONS, CATEGORY_COLORS } from './config.js';

export class CanvasRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.hoveredLandmarkIndex = null;
    this.isMirrored = true;
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setMirrored(mirrored) {
    this.isMirrored = mirrored;
  }

  setHoveredLandmark(index) {
    this.hoveredLandmarkIndex = index;
  }

  /**
   * Renders the 33-point skeleton overlay
   */
  renderSkeleton(landmarks, isStickyLocked = false, activeCount = 1) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    this.clear();

    if (!landmarks || landmarks.length === 0) return;

    ctx.save();

    // If mirrored, flip context horizontally so wireframe matches mirrored video feed
    if (this.isMirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    // 1. Draw Connection Lines
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
      const p1 = landmarks[startIdx];
      const p2 = landmarks[endIdx];

      if (!p1 || !p2) continue;

      // Skip drawing if visibility is very low
      const vis1 = p1.visibility !== undefined ? p1.visibility : 1;
      const vis2 = p2.visibility !== undefined ? p2.visibility : 1;
      if (vis1 < 0.3 || vis2 < 0.3) continue;

      const def1 = LANDMARK_DEFINITIONS[startIdx];
      const category = def1 ? def1.category : 'upper_body';
      const colorScheme = CATEGORY_COLORS[category] || CATEGORY_COLORS.upper_body;

      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.strokeStyle = colorScheme.stroke;
      ctx.stroke();
    }

    // 2. Draw Joint Nodes
    for (let i = 0; i < landmarks.length && i < 33; i++) {
      const p = landmarks[i];
      if (!p) continue;

      const vis = p.visibility !== undefined ? p.visibility : 1;
      if (vis < 0.2) continue;

      const def = LANDMARK_DEFINITIONS[i];
      const category = def ? def.category : 'upper_body';
      const colorScheme = CATEGORY_COLORS[category] || CATEGORY_COLORS.upper_body;
      const isHovered = this.hoveredLandmarkIndex === i;

      const px = p.x * width;
      const py = p.y * height;
      const radius = isHovered ? 8 : (vis > 0.8 ? 5 : 3.5);

      // Outer glow/ring for hovered or high-confidence key joints
      if (isHovered || i === 0 || i === 15 || i === 16 || i === 27 || i === 28) {
        ctx.beginPath();
        ctx.arc(px, py, radius + 3, 0, 2 * Math.PI);
        ctx.fillStyle = isHovered ? 'rgba(250, 204, 21, 0.4)' : 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
      }

      // Joint circle fill
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isHovered ? '#facc15' : colorScheme.fill;
      ctx.fill();

      // Border outline
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Optional text label if hovered
      if (isHovered) {
        ctx.save();
        // Un-mirror text if canvas is mirrored
        if (this.isMirrored) {
          ctx.translate(px, py);
          ctx.scale(-1, 1);
          ctx.translate(-px, -py);
        }
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 12px monospace';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(`${i}: ${def.name}`, px + 12, py + 4);
        ctx.restore();
      }
    }

    // 3. Draw Hip Center Anchor (Sticky Tracking Visual Indicator)
    if (landmarks.length > 24) {
      const pLeftHip = landmarks[23];
      const pRightHip = landmarks[24];
      if (pLeftHip && pRightHip) {
        const hipCenterX = ((pLeftHip.x + pRightHip.x) / 2) * width;
        const hipCenterY = ((pLeftHip.y + pRightHip.y) / 2) * height;

        ctx.beginPath();
        ctx.arc(hipCenterX, hipCenterY, 3, 0, 2 * Math.PI);
        ctx.fillStyle = isStickyLocked ? '#22c55e' : '#eab308';
        ctx.fill();
      }
    }

    ctx.restore();

    // 4. Draw Multi-person Indicator badge in corner
    if (activeCount > 1) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, 12, 12, 190, 28, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = '11px sans-serif';
      ctx.fillText(`👥 ${activeCount} Detected • Sticky Lock Active`, 20, 30);
      ctx.restore();
    }
  }

  /**
   * Renders the paused watermark indicator
   */
  renderPausedWatermark() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    ctx.save();
    // Dim background slightly to indicate frozen frame
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.fillRect(0, 0, width, height);

    // Floating banner
    const bannerW = 280;
    const bannerH = 46;
    const bannerX = (width - bannerW) / 2;
    const bannerY = height - 70;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    this.roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⏸ PAUSED / INSPECTION MODE', width / 2, bannerY + 22);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('Press SPACE or Resume to continue', width / 2, bannerY + 38);

    ctx.restore();
  }

  roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
