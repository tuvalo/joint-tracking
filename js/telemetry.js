/**
 * Telemetry State Manager with Pre-allocated Memory
 * Strictly adheres to the PRD JSON topology structure and prevents GC stutter.
 */

import { LANDMARK_DEFINITIONS } from './config.js';

// Pre-allocate the complete structured object hierarchy once
function createPreallocatedTelemetry() {
  const telemetry = {
    timestamp: 0,
    trackingStatus: 'INITIALIZING',
    frameMetadata: {
      fps: 0,
      dimensions: { width: 0, height: 0 }
    },
    landmarks: {
      facial_nodes: {},
      upper_body: {},
      lower_body: {}
    }
  };

  for (const [idStr, def] of Object.entries(LANDMARK_DEFINITIONS)) {
    telemetry.landmarks[def.category][idStr] = {
      name: def.name,
      x: 0,
      y: 0,
      z: 0,
      visibility: 0
    };
  }

  return telemetry;
}

// Global hook for developers
window.currentMotionTelemetry = createPreallocatedTelemetry();

export class TelemetryManager {
  constructor() {
    this.telemetry = window.currentMotionTelemetry;
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.currentFps = 0;
    this.fpsTimer = performance.now();
    this.activeCategoryFilter = 'all';
    this.domElementsCached = false;
    this.domRowRefs = {};
    this.activeTab = 'table'; // 'table' or 'json'
  }

  initDomBindings(containerId, jsonContainerId) {
    this.tableContainer = document.getElementById(containerId);
    this.jsonContainer = document.getElementById(jsonContainerId);
    this.buildTableStructure();
  }

  buildTableStructure() {
    if (!this.tableContainer) return;

    this.tableContainer.innerHTML = `
      <table class="w-full text-left text-xs text-slate-300 border-collapse">
        <thead class="bg-slate-800/80 sticky top-0 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-slate-700">
          <tr>
            <th class="py-2 px-2.5">ID</th>
            <th class="py-2 px-2.5">Joint</th>
            <th class="py-2 px-2.5 text-right font-mono">X</th>
            <th class="py-2 px-2.5 text-right font-mono">Y</th>
            <th class="py-2 px-2.5 text-right font-mono">Z</th>
            <th class="py-2 px-2.5 text-right">Confidence</th>
          </tr>
        </thead>
        <tbody id="telemetryTbody" class="divide-y divide-slate-800/60 font-mono">
        </tbody>
      </table>
    `;

    const tbody = document.getElementById('telemetryTbody');
    this.domRowRefs = {};

    for (let i = 0; i < 33; i++) {
      const def = LANDMARK_DEFINITIONS[i];
      const tr = document.createElement('tr');
      tr.id = `telemetry-row-${i}`;
      tr.dataset.category = def.category;
      tr.className = 'hover:bg-slate-800/40 transition-colors';

      tr.innerHTML = `
        <td class="py-1.5 px-2.5 text-slate-500 font-semibold">${i}</td>
        <td class="py-1.5 px-2.5 text-slate-200 font-sans truncate max-w-[120px]" title="${def.name}">
          <span class="inline-block w-2 h-2 rounded-full mr-1.5 ${
            def.category === 'facial_nodes' ? 'bg-sky-400' :
            def.category === 'upper_body' ? 'bg-emerald-400' : 'bg-purple-400'
          }"></span>
          ${def.name}
        </td>
        <td class="py-1.5 px-2.5 text-right text-emerald-400 font-mono val-x">0.000</td>
        <td class="py-1.5 px-2.5 text-right text-sky-400 font-mono val-y">0.000</td>
        <td class="py-1.5 px-2.5 text-right text-indigo-300 font-mono val-z">0.000</td>
        <td class="py-1.5 px-2.5 text-right">
          <div class="inline-flex items-center gap-1.5">
            <div class="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div class="val-bar h-full bg-cyan-400 rounded-full transition-all duration-75" style="width: 0%"></div>
            </div>
            <span class="val-vis text-[10px] text-slate-400 w-7 text-right">0%</span>
          </div>
        </td>
      `;

      tbody.appendChild(tr);

      this.domRowRefs[i] = {
        row: tr,
        x: tr.querySelector('.val-x'),
        y: tr.querySelector('.val-y'),
        z: tr.querySelector('.val-z'),
        vis: tr.querySelector('.val-vis'),
        bar: tr.querySelector('.val-bar'),
        category: def.category
      };
    }

    this.domElementsCached = true;
    this.filterRows(this.activeCategoryFilter);
  }

  filterRows(category) {
    this.activeCategoryFilter = category;
    if (!this.domElementsCached) return;

    for (let i = 0; i < 33; i++) {
      const rowRef = this.domRowRefs[i];
      if (!rowRef) continue;
      if (category === 'all' || rowRef.category === category) {
        rowRef.row.classList.remove('hidden');
      } else {
        rowRef.row.classList.add('hidden');
      }
    }
  }

  updateMetrics(videoWidth, videoHeight) {
    const now = performance.now();
    this.frameCount++;

    if (now - this.fpsTimer >= 500) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.fpsTimer) * 10) / 10;
      this.frameCount = 0;
      this.fpsTimer = now;
    }

    this.telemetry.timestamp = Date.now();
    this.telemetry.frameMetadata.fps = this.currentFps;
    this.telemetry.frameMetadata.dimensions.width = videoWidth;
    this.telemetry.frameMetadata.dimensions.height = videoHeight;
  }

  updateStatus(status) {
    this.telemetry.trackingStatus = status;
  }

  /**
   * Overwrite existing pre-allocated landmark objects directly
   * Avoids GC allocation overhead entirely.
   */
  updateLandmarks(landmarksArray) {
    if (!landmarksArray) return;

    const count = Math.min(landmarksArray.length, 33);
    for (let i = 0; i < count; i++) {
      const src = landmarksArray[i];
      const def = LANDMARK_DEFINITIONS[i];
      const target = this.telemetry.landmarks[def.category][i];

      if (target) {
        target.x = Math.round(src.x * 1000) / 1000;
        target.y = Math.round(src.y * 1000) / 1000;
        target.z = Math.round((src.z || 0) * 1000) / 1000;
        target.visibility = Math.round((src.visibility !== undefined ? src.visibility : 1.0) * 100) / 100;
      }
    }
  }

  /**
   * Fast DOM sync: directly mutate textContent of cached element references
   */
  renderDom() {
    if (!this.domElementsCached) return;

    if (this.activeTab === 'table') {
      for (let i = 0; i < 33; i++) {
        const def = LANDMARK_DEFINITIONS[i];
        const data = this.telemetry.landmarks[def.category][i];
        const refs = this.domRowRefs[i];
        if (!data || !refs) continue;

        refs.x.textContent = data.x.toFixed(3);
        refs.y.textContent = data.y.toFixed(3);
        refs.z.textContent = data.z.toFixed(3);

        const visPct = Math.round(data.visibility * 100);
        refs.vis.textContent = `${visPct}%`;
        refs.bar.style.width = `${visPct}%`;
      }
    } else if (this.activeTab === 'json' && this.jsonContainer) {
      this.jsonContainer.textContent = JSON.stringify(this.telemetry, null, 2);
    }
  }

  getSnapshotJson() {
    return JSON.stringify(this.telemetry, null, 2);
  }
}
