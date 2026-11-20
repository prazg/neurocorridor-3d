/**
 * NeuroCorridor-3D — Application Controller, Reactive State Store & DOM Event Wiring
 *
 * Pure ES Module · Zero Build · 100% Browser-Local (Zero Uploads).
 * Educational & Research Sandbox — Not Approved for Clinical Neuronavigation.
 */

import {
  MNI_BOUNDS,
  RISK_THRESHOLDS,
  densifyAtlasTracts,
  analyzeSurgicalCorridor,
  optimizeEntryCorridor,
  parseMniNiftiMask,
  projectToCorticalSurface,
} from './geometryEngine.js';

import { NeuroCorridorRenderer } from './renderer3d.js';

import {
  NeuroQuizEngine,
  generateEducationalReportMarkdown,
  generateEducationalReportJson,
} from './quizEngine.js';

// ============================================================================
// Constants & Tract System Grouping
// ============================================================================

const TRACT_SYSTEM_GROUPS = Object.freeze([
  { key: 'CST', label: 'Corticospinal Tract', system: 'Projection', ids: ['cst_left', 'cst_right'] },
  { key: 'AF', label: 'Arcuate Fasciculus', system: 'Association', ids: ['af_left'] },
  { key: 'SLF', label: 'Superior Longitudinal Fasc.', system: 'Association', ids: ['slf_left', 'slf_right'] },
  { key: 'IFOF', label: 'Inferior Fronto-Occipital Fasc.', system: 'Association', ids: ['ifof_left', 'ifof_right'] },
  { key: 'OR', label: 'Optic Radiation (Meyer Loop)', system: 'Projection', ids: ['or_left', 'or_right'] },
  { key: 'CC', label: 'Corpus Callosum', system: 'Commissural', ids: ['cc_commissure'] },
]);

const STRUCTURE_CATEGORY_LABELS = Object.freeze({
  eloquent_cortex: 'Cortex',
  deep_gray: 'Deep Gray',
  cranial_nerve: 'CN II',
  vascular: 'Vascular',
});

const RISK_DISPLAY = Object.freeze({
  safe: {
    banner: 'SAFE MARGIN (>10 mm)',
    hud: 'SAFE MARGIN >10 mm',
    short: 'SAFE',
  },
  caution: {
    banner: 'HIGH CAUTION (5–10 mm)',
    hud: 'HIGH CAUTION 5–10 mm',
    short: 'CAUT',
  },
  critical: {
    banner: 'CRITICAL HAZARD (<5 mm)',
    hud: 'CRITICAL HAZARD <5 mm',
    short: 'CRIT',
  },
});

const CASE_SHORT_TITLES = Object.freeze({
  case01_right_frontal_gbm: { short: 'R Frontal GBM', tag: 'SMA · CST' },
  case02_left_insular_lgg: { short: 'L Insular LGG', tag: 'IFOF · AF' },
  case03_left_tpo_met: { short: 'L TPO Metastasis', tag: 'OR · Wern' },
  case04_left_parasagittal_meningioma: { short: 'L Parasagittal Men.', tag: 'SSS · M1' },
  case05_sellar_pituitary: { short: 'Sellar Pituitary', tag: 'ICA · Chiasm' },
});

const CAMERA_SHORTCUT_MAP = Object.freeze({
  '1': 'oblique',
  '2': 'superior',
  '3': 'anterior',
  '4': 'left',
  '5': 'right',
  '6': 'skull_base',
  '7': 'corridor_view',
});

// ============================================================================
// Pure Utility & XSS-Safe Formatting Helpers
// ============================================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeHexColor(value, fallback = '#38bdf8') {
  const str = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(str) ? str : fallback;
}

function isEditableTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.isContentEditable);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function roundTo(v, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

function formatSignedMm(val, decimals = 0) {
  const num = Number.isFinite(val) ? val : 0;
  const fixed = Math.abs(num) < 0.05 && decimals === 0 ? '0' : num.toFixed(decimals);
  if (fixed === '-0' || fixed === '-0.0') return '0 mm';
  return `${num > 0 && !fixed.startsWith('+') ? '+' : ''}${fixed} mm`;
}

function formatMm(val, decimals = 1) {
  return Number.isFinite(val) ? `${Number(val).toFixed(decimals)} mm` : '—';
}

function cloneEllipsoid(ell) {
  if (!ell) return null;
  return {
    center: [Number(ell.center[0]), Number(ell.center[1]), Number(ell.center[2])],
    radii: [Number(ell.radii[0]), Number(ell.radii[1]), Number(ell.radii[2])],
  };
}

function cloneLesion(lesion) {
  if (!lesion) return null;
  return {
    primaryEllipsoid: cloneEllipsoid(lesion.primaryEllipsoid),
    secondaryEllipsoid: cloneEllipsoid(lesion.secondaryEllipsoid),
    edemaEllipsoid: cloneEllipsoid(lesion.edemaEllipsoid),
    color: lesion.color || '#ec4899',
    edemaColor: lesion.edemaColor || '#38bdf8',
    pointCloudMni: Array.isArray(lesion.pointCloudMni)
      ? lesion.pointCloudMni.map((p) => [p[0], p[1], p[2]])
      : null,
  };
}

function cloneCorridor(corridor) {
  if (!corridor) return null;
  return {
    entryMni: [Number(corridor.entryMni[0]), Number(corridor.entryMni[1]), Number(corridor.entryMni[2])],
    targetMni: [Number(corridor.targetMni[0]), Number(corridor.targetMni[1]), Number(corridor.targetMni[2])],
    radiusMm: Number(corridor.radiusMm) || 6,
    approachMode: corridor.approachMode === 'endonasal' ? 'endonasal' : 'transcortical',
  };
}

function computeEllipsoidVolumeCm3(ell) {
  if (!ell || !Array.isArray(ell.radii)) return 0;
  const [rx, ry, rz] = ell.radii;
  return ((4 / 3) * Math.PI * rx * ry * rz) / 1000;
}

function triggerLocalDownload(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// Application State & DOM Cache
// ============================================================================

const appState = {
  atlasData: null,
  densifiedTracts: [],
  cases: [],
  quizQuestions: [],
  structureById: new Map(),
  tractById: new Map(),
  caseById: new Map(),
  quizEngine: null,
  renderer: null,

  activeCaseId: null,
  appMode: 'sandbox', // 'sandbox' | 'quiz'
  activeTab: 'planner', // 'planner' | 'atlas' | 'pearls' | 'quiz'
  lastSandboxTab: 'planner',
  sliceClickMode: 'inspect', // 'inspect' | 'target' | 'entry'
  hazardFilter: 'all', // 'all' | 'warnings' | 'tract' | 'structure'

  lesion: null,
  isCustomLesion: false,
  customNiftiInfo: null,

  corridor: null,
  ghostCorridor: null,
  optimizerResult: null,
  analysis: null,

  sliceMni: [0, -14, 10],
  probeDepthFraction: 0.5,
  probeDepthTouched: false,
  isFlyingCorridor: false,
  flyRafId: null,
  flyLastTime: 0,
  legendOpen: false,

  tractColorMode: 'anatomical', // 'anatomical' | 'dec'
  visibleStructures: {},
  visibleTracts: {},
  highlightIds: [],
  selectedHazardId: null,

  showBrainShell: true,
  showVentricles: true,
  showEdema: true,
  showLabels: true,
  showCorridor: true,
  brainOpacity: 0.24,
};

const dom = {};

function cacheDomElements() {
  const ids = [
    'cors-error-banner',
    'toast-region',
    // Top bar & mode
    'mode-btn-sandbox',
    'mode-btn-quiz',
    'mode-quiz-score',
    'btn-export-json',
    'btn-export-md',
    'btn-reset-case',
    'case-selector-list',
    'case-selector-select',
    // Viewports
    'viewport-3d',
    'slice-axial',
    'slice-coronal',
    'slice-sagittal',
    'viewport-probe',
    // 3D HUD & floating controls
    'hud-risk-badge',
    'hud-case-title',
    'hud-trajectory-stats',
    'btn-toggle-legend',
    'hud-legend-panel',
    'hud-legend-chevron',
    'btn-color-anatomical',
    'btn-color-dec',
    'dec-legend',
    'slider-brain-opacity',
    'val-brain-opacity',
    'toggle-brain-shell',
    'toggle-labels',
    'toggle-edema',
    'toggle-ventricles',
    'toggle-corridor',
    'camera-presets',
    'hover-tooltip',
    // Slices & Probe
    'probe-live-hazard',
    'click-mode-group',
    'slider-slice-z',
    'val-slice-z',
    'slider-slice-y',
    'val-slice-y',
    'slider-slice-x',
    'val-slice-x',
    'btn-fly-corridor',
    'fly-corridor-icon',
    'fly-corridor-label',
    'slider-probe-depth',
    'val-probe-depth',
    // Right Panel Tabs
    'tab-btn-planner',
    'tab-btn-atlas',
    'tab-btn-pearls',
    'tab-btn-quiz',
    'tab-panel-planner',
    'tab-panel-atlas',
    'tab-panel-pearls',
    'tab-panel-quiz',
    // Tab 1: Corridor & Risk
    'risk-status-banner',
    'risk-banner-label',
    'risk-banner-mode',
    'metric-traj-length',
    'metric-entry-depth',
    'metric-min-clearance',
    'metric-hazard-counts',
    'approach-mode-group',
    'slider-corridor-radius',
    'val-corridor-radius',
    'slider-entry-x',
    'input-entry-x',
    'slider-entry-y',
    'input-entry-y',
    'slider-entry-z',
    'input-entry-z',
    'btn-snap-entry',
    'slider-target-x',
    'input-target-x',
    'slider-target-y',
    'input-target-y',
    'slider-target-z',
    'input-target-z',
    'btn-center-target',
    'btn-optimize-corridor',
    'btn-reset-corridor',
    'optimizer-result-banner',
    'opt-eval-count',
    'opt-summary-text',
    'opt-delta-pills',
    'btn-apply-optimized',
    'btn-dismiss-optimized',
    'anatomy-inspector-card',
    'hazard-filter-group',
    'hazard-matrix-body',
    // Tab 2: Atlas & Lesion
    'btn-show-all-atlas',
    'btn-hazards-only',
    'btn-case-hazards',
    'tract-toggle-list',
    'structure-toggle-list',
    'lesion-volume-badge',
    'slider-lesion-cx',
    'input-lesion-cx',
    'slider-lesion-cy',
    'input-lesion-cy',
    'slider-lesion-cz',
    'input-lesion-cz',
    'slider-lesion-rx',
    'input-lesion-rx',
    'slider-lesion-ry',
    'input-lesion-ry',
    'slider-lesion-rz',
    'input-lesion-rz',
    'btn-reset-lesion',
    'nifti-dropzone',
    'nifti-file-input',
    'nifti-status-card',
    // Tab 3: Case Pearls
    'pearls-content',
    // Tab 4: Quiz
    'quiz-score-badge',
    'quiz-progress-bar',
    'quiz-progress-text',
    'quiz-dots',
    'quiz-question-card',
    'btn-quiz-prev',
    'btn-quiz-next',
    'btn-quiz-restart',
    'quiz-summary-card',
  ];

  for (const id of ids) {
    dom[id] = document.getElementById(id);
  }
}

// ============================================================================
// Toast & CORS Diagnostics
// ============================================================================

function showToast(message, variant = 'info') {
  if (!dom['toast-region']) return;
  const el = document.createElement('div');
  el.className = `toast-item${variant === 'error' ? ' toast-error' : variant === 'success' ? ' toast-success' : ''}`;
  el.textContent = message;
  dom['toast-region'].appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

function showCorsBootstrapError(err) {
  const banner = dom['cors-error-banner'];
  if (!banner) return;
  const detail = escapeHtml(err?.message || String(err));
  banner.hidden = false;
  banner.innerHTML = `
    <strong>Unable to load local JSON atlas files.</strong>
    Browsers block <code>fetch()</code> requests when opening <code>index.html</code> directly via <code>file://</code>.
    Start a zero-dependency local server from this repository folder using:
    <code>python -m http.server 8000</code> and open <code>localhost:8000</code> in your browser.
    <span style="opacity:0.78"> (Detail: ${detail})</span>
  `;
}

// ============================================================================
// Active Case & Visibility Helpers
// ============================================================================

function getActiveCase() {
  return appState.caseById.get(appState.activeCaseId) || appState.cases[0] || null;
}

function resetVisibilityAll(visible = true) {
  const vs = {};
  const vt = {};
  for (const s of appState.atlasData?.structures || []) {
    vs[s.id] = visible;
  }
  for (const t of appState.atlasData?.tracts || []) {
    vt[t.id] = visible;
  }
  appState.visibleStructures = vs;
  appState.visibleTracts = vt;
}

function ensureIdsVisible(ids) {
  let changed = false;
  const vs = { ...appState.visibleStructures };
  const vt = { ...appState.visibleTracts };
  for (const id of ids || []) {
    if (appState.structureById.has(id) && vs[id] === false) {
      vs[id] = true;
      changed = true;
    }
    if (appState.tractById.has(id) && vt[id] === false) {
      vt[id] = true;
      changed = true;
    }
  }
  if (changed) {
    appState.visibleStructures = vs;
    appState.visibleTracts = vt;
    syncAtlasToggleInputs();
  }
}

function loadCase(caseId, { flyCamera = true, preserveQuizHighlights = false } = {}) {
  const caseObj = appState.caseById.get(caseId);
  if (!caseObj) return;

  stopCorridorFlight();

  appState.activeCaseId = caseObj.id;
  appState.lesion = cloneLesion(caseObj.lesion);
  appState.isCustomLesion = false;
  appState.customNiftiInfo = null;
  appState.corridor = cloneCorridor(caseObj.defaultCorridor);
  appState.ghostCorridor = null;
  appState.optimizerResult = null;
  appState.selectedHazardId = null;

  if (!preserveQuizHighlights) {
    appState.highlightIds = [];
  }

  // Center tri-planar slices on target / primary lesion center
  const tgt = appState.corridor.targetMni;
  appState.sliceMni = [Math.round(tgt[0]), Math.round(tgt[1]), Math.round(tgt[2])];
  appState.probeDepthFraction = 0.5;
  appState.probeDepthTouched = false;

  // Hide optimizer banner & NIfTI card
  if (dom['optimizer-result-banner']) dom['optimizer-result-banner'].hidden = true;
  if (dom['nifti-status-card']) dom['nifti-status-card'].hidden = true;
  if (dom['anatomy-inspector-card']) dom['anatomy-inspector-card'].hidden = true;

  syncCaseSelectorUi();
  syncCorridorControlsUi();
  syncLesionControlsUi();
  syncSliceAndProbeControlsUi();
  recomputeAndRender();
  renderCasePearls();

  if (flyCamera && appState.renderer && caseObj.defaultCamera) {
    const { yaw, pitch, zoom } = caseObj.defaultCamera;
    appState.renderer.flyToCamera(yaw, pitch, zoom, 480);
    setActiveCameraPresetButton(null);
  }
}

// ============================================================================
// Core Reactive Recompute & Render Pipeline
// ============================================================================

function recomputeAndRender() {
  if (!appState.atlasData || !appState.corridor || !appState.lesion) return;

  const analysis = analyzeSurgicalCorridor(
    appState.corridor,
    appState.lesion,
    appState.atlasData,
    appState.densifiedTracts
  );
  appState.analysis = analysis;

  updateHudAndRiskBanner();
  renderHazardTable();
  updateProbeDepthReadout();

  if (appState.selectedHazardId) {
    renderAnatomyInspector(appState.selectedHazardId);
  }

  // Keep Case Pearls key-hazard clearance badges live
  if (appState.activeTab === 'pearls') {
    renderCasePearls();
  }

  syncRendererState();
}

function syncRendererState() {
  if (!appState.renderer) return;
  appState.renderer.setState({
    lesion: appState.lesion,
    corridor: appState.corridor,
    ghostCorridor: appState.ghostCorridor,
    analysis: appState.analysis,
    sliceMni: appState.sliceMni,
    probeDepthFraction: appState.probeDepthFraction,
    tractColorMode: appState.tractColorMode,
    visibleStructures: appState.visibleStructures,
    visibleTracts: appState.visibleTracts,
    highlightIds: appState.highlightIds,
    selectedHazardId: appState.selectedHazardId,
    showBrainShell: appState.showBrainShell,
    showVentricles: appState.showVentricles,
    showEdema: appState.showEdema,
    showLabels: appState.showLabels,
    showCorridor: appState.showCorridor,
    brainOpacity: appState.brainOpacity,
  });
}

// ============================================================================
// UI Renderers (Strictly XSS-Escaped)
// ============================================================================

function renderCaseSelector() {
  const pillStrip = dom['case-selector-list'];
  const selectEl = dom['case-selector-select'];
  if (!pillStrip || !selectEl) return;

  pillStrip.innerHTML = appState.cases
    .map((c, idx) => {
      const meta = CASE_SHORT_TITLES[c.id] || { short: c.title, tag: '' };
      const num = String(idx + 1).padStart(2, '0');
      return `
        <button
          type="button"
          class="case-pill"
          role="option"
          aria-selected="false"
          data-case-id="${escapeHtml(c.id)}"
          title="${escapeHtml(c.title)} — ${escapeHtml(c.pathology)}"
        >
          <span class="case-pill-num">${num}</span>
          <span>${escapeHtml(meta.short)}</span>
          ${meta.tag ? `<span class="case-pill-tag">${escapeHtml(meta.tag)}</span>` : ''}
        </button>
      `;
    })
    .join('');

  selectEl.innerHTML = appState.cases
    .map((c, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      return `<option value="${escapeHtml(c.id)}">${num} · ${escapeHtml(c.title)}</option>`;
    })
    .join('');
}

function syncCaseSelectorUi() {
  const pillStrip = dom['case-selector-list'];
  if (pillStrip) {
    for (const btn of pillStrip.querySelectorAll('.case-pill')) {
      const active = btn.dataset.caseId === appState.activeCaseId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
  }
  if (dom['case-selector-select']) {
    dom['case-selector-select'].value = appState.activeCaseId || '';
  }
}

function updateHudAndRiskBanner() {
  const analysis = appState.analysis;
  const activeCase = getActiveCase();
  if (!analysis) return;

  const tier = analysis.overallRiskTier || 'safe';
  const labels = RISK_DISPLAY[tier] || RISK_DISPLAY.safe;
  const minHazard = analysis.sortedHazards[0] || null;
  const minClearance = minHazard ? minHazard.corridorClearanceMm : Infinity;
  const diamMm = (appState.corridor?.radiusMm || 0) * 2;
  const critCount = analysis.criticalViolations.length;
  const cautCount = analysis.cautionStructures.length;

  // 3D Viewport HUD
  const hudRisk = dom['hud-risk-badge'];
  if (hudRisk) {
    hudRisk.className = `hud-risk-pill tier-${tier}`;
    hudRisk.textContent = labels.hud;
  }

  if (dom['hud-case-title']) {
    const customSuffix = appState.customNiftiInfo
      ? ` · NIfTI: ${appState.customNiftiInfo.fileName || 'Custom Mask'}`
      : appState.isCustomLesion
        ? ' · Custom Lesion'
        : '';
    dom['hud-case-title'].textContent = `${activeCase ? activeCase.title : 'Custom Plan'}${customSuffix}`;
  }

  if (dom['hud-trajectory-stats']) {
    const minStr = Number.isFinite(minClearance)
      ? `${minClearance.toFixed(1)} mm (${minHazard.shortName})`
      : '—';
    dom['hud-trajectory-stats'].textContent =
      `LEN ${analysis.trajectoryLengthMm.toFixed(1)} mm · DEPTH ${analysis.corticalEntryDepthMm.toFixed(1)} mm · Ø ${diamMm.toFixed(0)} mm · MIN ${minStr}`;
  }

  // Right Panel Risk Banner
  const banner = dom['risk-status-banner'];
  if (banner) {
    banner.className = `risk-banner tier-${tier}`;
  }
  if (dom['risk-banner-label']) {
    dom['risk-banner-label'].textContent = labels.banner;
  }
  if (dom['risk-banner-mode']) {
    dom['risk-banner-mode'].textContent = (appState.corridor?.approachMode || 'transcortical').toUpperCase();
  }
  if (dom['metric-traj-length']) {
    dom['metric-traj-length'].textContent = `${analysis.trajectoryLengthMm.toFixed(1)} mm`;
  }
  if (dom['metric-entry-depth']) {
    dom['metric-entry-depth'].textContent = `${analysis.corticalEntryDepthMm.toFixed(1)} mm`;
  }
  if (dom['metric-min-clearance']) {
    dom['metric-min-clearance'].textContent = Number.isFinite(minClearance)
      ? `${minClearance.toFixed(1)} mm`
      : '—';
  }
  if (dom['metric-hazard-counts']) {
    dom['metric-hazard-counts'].textContent = `${critCount} Crit · ${cautCount} Caut`;
  }
}

function renderHazardTable() {
  const tbody = dom['hazard-matrix-body'];
  const analysis = appState.analysis;
  if (!tbody || !analysis) return;

  const filter = appState.hazardFilter;
  const rows = analysis.sortedHazards.filter((h) => {
    if (filter === 'warnings') return h.corridorClearanceMm <= RISK_THRESHOLDS.cautionMm;
    if (filter === 'tract') return h.kind === 'tract';
    if (filter === 'structure') return h.kind === 'structure';
    return true;
  });

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; padding:14px; color:var(--text-muted);">
          No structures match the active filter (${escapeHtml(filter)}).
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map((h) => {
      const selected = appState.selectedHazardId === h.id;
      const tier = h.riskTier || 'safe';
      const tierLabel = (RISK_DISPLAY[tier] || RISK_DISPLAY.safe).short;
      const kindTag = h.kind === 'tract' ? 'WM' : STRUCTURE_CATEGORY_LABELS[h.category] || 'STR';
      const corrColor =
        tier === 'critical'
          ? 'color:#fda4af; font-weight:700;'
          : tier === 'caution'
            ? 'color:#fcd34d; font-weight:700;'
            : 'color:#cbd5e1;';

      return `
        <tr class="hazard-row${selected ? ' is-selected' : ''}" data-hazard-id="${escapeHtml(h.id)}" tabindex="0">
          <td>
            <div class="hazard-name-cell">
              <span class="hazard-swatch" style="background:${sanitizeHexColor(h.color)};"></span>
              <div class="hazard-name-stack">
                <div class="hazard-short-line">
                  <span class="hazard-short">${escapeHtml(h.shortName)}</span>
                  <span class="hazard-kind-pill">${escapeHtml(kindTag)}</span>
                </div>
                <span class="hazard-full" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</span>
              </div>
            </div>
          </td>
          <td class="num-col" style="${corrColor}">${escapeHtml(formatMm(h.corridorClearanceMm, 1))}</td>
          <td class="num-col">${escapeHtml(formatMm(h.lesionClearanceMm, 1))}</td>
          <td class="risk-col">
            <span class="risk-pill tier-${escapeHtml(tier)}">${escapeHtml(tierLabel)}</span>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderAnatomyInspector(hazardId) {
  const card = dom['anatomy-inspector-card'];
  if (!card) return;

  if (!hazardId) {
    card.hidden = true;
    card.innerHTML = '';
    return;
  }

  const hazard = (appState.analysis?.sortedHazards || []).find((h) => h.id === hazardId) || null;
  const tract = appState.tractById.get(hazardId) || null;
  const structure = appState.structureById.get(hazardId) || null;
  const record = tract || structure;

  if (!record) {
    card.hidden = true;
    return;
  }

  const isTract = Boolean(tract);
  const tier = hazard ? hazard.riskTier : 'safe';
  const tierLabel = (RISK_DISPLAY[tier] || RISK_DISPLAY.safe).short;
  const depthPct = hazard ? Math.round((hazard.depthFraction || 0) * 100) : 0;

  card.hidden = false;
  card.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-title-wrap">
        <span class="inspector-swatch" style="background:${sanitizeHexColor(record.color)};"></span>
        <div>
          <h3 class="inspector-title">${escapeHtml(record.name)}</h3>
          <div class="inspector-sub">
            ${escapeHtml(record.shortName)} · ${escapeHtml(isTract ? `White-Matter (${record.system})` : record.category.replace('_', ' '))} · ${escapeHtml(record.hemisphere)}
          </div>
        </div>
      </div>
      <button type="button" class="btn-micro" data-inspector-action="close" aria-label="Close anatomy pearl inspector">✕</button>
    </div>

    ${
      hazard
        ? `
      <div class="inspector-metrics">
        <span class="risk-pill tier-${escapeHtml(tier)}">${escapeHtml(tierLabel)}</span>
        <span class="inspector-metric-chip">Corridor: ${escapeHtml(formatMm(hazard.corridorClearanceMm, 1))}</span>
        <span class="inspector-metric-chip">Lesion: ${escapeHtml(formatMm(hazard.lesionClearanceMm, 1))}</span>
        <span class="inspector-metric-chip">Depth: ${depthPct}%</span>
      </div>
    `
        : ''
    }

    <div class="inspector-grid">
      <div class="inspector-field">
        <strong>Neuroanatomical Function</strong>
        ${escapeHtml(record.function)}
      </div>
      <div class="inspector-field">
        <strong>Deficit if Injured</strong>
        ${escapeHtml(record.deficitIfInjured)}
      </div>
      <div class="inspector-field field-des">
        <strong>${isTract ? 'Subcortical DES Sign' : 'Intraoperative Monitoring / Mapping'}</strong>
        ${escapeHtml(isTract ? record.desSign : record.monitoringModality)}
      </div>
      <div class="inspector-field field-pearl">
        <strong>Surgical Pearl</strong>
        ${escapeHtml(record.surgicalPearl)}
      </div>
    </div>

    ${
      hazard
        ? `
      <div class="inspector-actions">
        <button type="button" class="btn btn-cyan-sm" data-inspector-action="jump-slices" data-hazard-id="${escapeHtml(hazard.id)}">
          Center Slices at Closest Point
        </button>
        <button type="button" class="btn btn-ghost-sm" data-inspector-action="jump-probe" data-hazard-id="${escapeHtml(hazard.id)}">
          Jump Probe to ${depthPct}%
        </button>
      </div>
    `
        : ''
    }
  `;
}

function renderAtlasToggles() {
  const tractList = dom['tract-toggle-list'];
  const structList = dom['structure-toggle-list'];
  if (!tractList || !structList || !appState.atlasData) return;

  // 6 Major Tract Systems with group checkbox + individual hemisphere checkboxes
  tractList.innerHTML = TRACT_SYSTEM_GROUPS.map((group) => {
    const members = group.ids.map((id) => appState.tractById.get(id)).filter(Boolean);
    if (members.length === 0) return '';
    const primaryColor = members[0].color;

    const memberChips = members
      .map(
        (t) => `
        <label class="atlas-chip-toggle" title="${escapeHtml(t.name)}">
          <input type="checkbox" data-tract-id="${escapeHtml(t.id)}" ${appState.visibleTracts[t.id] !== false ? 'checked' : ''}>
          <span class="hazard-swatch" style="background:${sanitizeHexColor(t.color)};"></span>
          <span>${escapeHtml(t.shortName)}</span>
        </label>
      `
      )
      .join('');

    return `
      <div class="tract-system-group" data-tract-group="${escapeHtml(group.key)}">
        <div class="tract-system-head">
          <label class="atlas-check-label">
            <input type="checkbox" data-tract-system="${escapeHtml(group.key)}" checked>
            <span class="hazard-swatch" style="background:${sanitizeHexColor(primaryColor)};"></span>
            <span>${escapeHtml(group.key)} — ${escapeHtml(group.label)}</span>
          </label>
          <div class="atlas-row-right">
            <span class="atlas-cat-tag">${escapeHtml(group.system)}</span>
            <button type="button" class="btn-micro" data-inspect-id="${escapeHtml(members[0].id)}" title="Highlight & view DES pearls">Pearl</button>
          </div>
        </div>
        ${members.length > 1 ? `<div class="tract-hemi-row">${memberChips}</div>` : ''}
      </div>
    `;
  }).join('');

  // 11 Eloquent Structures / Deep Gray / Cranial Nerves / Vascular
  structList.innerHTML = (appState.atlasData.structures || [])
    .map((s) => {
      const cat = STRUCTURE_CATEGORY_LABELS[s.category] || s.category;
      return `
        <div class="atlas-item-row">
          <label class="atlas-check-label">
            <input type="checkbox" data-structure-id="${escapeHtml(s.id)}" ${appState.visibleStructures[s.id] !== false ? 'checked' : ''}>
            <span class="hazard-swatch" style="background:${sanitizeHexColor(s.color)};"></span>
            <span>${escapeHtml(s.name)}</span>
          </label>
          <div class="atlas-row-right">
            <span class="atlas-cat-tag">${escapeHtml(cat)}</span>
            <button type="button" class="btn-micro" data-inspect-id="${escapeHtml(s.id)}" title="Highlight & view surgical pearl">Pearl</button>
          </div>
        </div>
      `;
    })
    .join('');

  syncAtlasToggleInputs();
}

function syncAtlasToggleInputs() {
  const tractList = dom['tract-toggle-list'];
  if (tractList) {
    for (const cb of tractList.querySelectorAll('input[data-tract-id]')) {
      const id = cb.dataset.tractId;
      cb.checked = appState.visibleTracts[id] !== false;
    }
    for (const group of TRACT_SYSTEM_GROUPS) {
      const master = tractList.querySelector(`input[data-tract-system="${group.key}"]`);
      if (!master) continue;
      const onCount = group.ids.filter((id) => appState.visibleTracts[id] !== false).length;
      master.checked = onCount === group.ids.length;
      master.indeterminate = onCount > 0 && onCount < group.ids.length;
    }
  }

  const structList = dom['structure-toggle-list'];
  if (structList) {
    for (const cb of structList.querySelectorAll('input[data-structure-id]')) {
      const id = cb.dataset.structureId;
      cb.checked = appState.visibleStructures[id] !== false;
    }
  }
}

function renderCasePearls() {
  const container = dom['pearls-content'];
  const c = getActiveCase();
  if (!container || !c) return;

  const hazardById = new Map((appState.analysis?.sortedHazards || []).map((h) => [h.id, h]));

  const hazardChipsHtml = (c.keyHazards || [])
    .map((id) => {
      const rec = appState.structureById.get(id) || appState.tractById.get(id);
      if (!rec) return '';
      const h = hazardById.get(id);
      const tier = h ? h.riskTier : 'safe';
      const distText = h ? `${h.corridorClearanceMm.toFixed(1)} mm` : '—';
      return `
        <button type="button" class="key-hazard-chip" data-pearl-hazard-id="${escapeHtml(id)}" title="Click to highlight ${escapeHtml(rec.name)} and inspect pearls">
          <span class="hazard-swatch" style="background:${sanitizeHexColor(rec.color)};"></span>
          <span>${escapeHtml(rec.shortName)}</span>
          <span class="risk-pill tier-${escapeHtml(tier)}">${escapeHtml(distText)}</span>
        </button>
      `;
    })
    .join('');

  const pearlsHtml = (c.surgicalPearls || [])
    .map(
      (pearl, idx) => `
      <li>
        <span class="pearl-index">${String(idx + 1).padStart(2, '0')}</span>
        <span>${escapeHtml(pearl)}</span>
      </li>
    `
    )
    .join('');

  const customNote = appState.customNiftiInfo
    ? `<div class="nifti-status-card"><strong>Active Local NIfTI Mask:</strong> ${escapeHtml(appState.customNiftiInfo.fileName || 'Custom Mask')} (${appState.customNiftiInfo.volumeCm3.toFixed(2)} cm³) is currently overriding the teaching case lesion geometry.</div>`
    : appState.isCustomLesion
      ? `<div class="nifti-status-card"><strong>Custom Lesion Active:</strong> Lesion coordinates/radii were customized in the Atlas &amp; Lesion tab. Use "Reset Case" to restore default teaching geometry.</div>`
      : '';

  container.innerHTML = `
    <div class="case-brief-hero">
      <h2 class="case-brief-title">${escapeHtml(c.title)}</h2>
      <div class="case-brief-pathology">${escapeHtml(c.pathology)}</div>
      <div class="case-brief-approach">${escapeHtml(c.approachName)}</div>
    </div>

    ${customNote}

    <div class="panel-card">
      <h3 class="brief-section-label">Clinical Presentation</h3>
      <p class="brief-prose">${escapeHtml(c.clinicalPresentation)}</p>
    </div>

    <div class="monitoring-callout">
      <h3 class="brief-section-label">Intraoperative Monitoring &amp; Awake DES Protocol</h3>
      <p class="brief-prose">${escapeHtml(c.recommendedMapping)}</p>
    </div>

    <div class="panel-card">
      <h3 class="brief-section-label">Key Anatomical Hazards (Click to Highlight &amp; Inspect)</h3>
      <div class="key-hazard-chips">
        ${hazardChipsHtml}
      </div>
    </div>

    <div class="panel-card">
      <h3 class="brief-section-label">Operative &amp; Literature Pearls</h3>
      <ol class="pearls-list">
        ${pearlsHtml}
      </ol>
    </div>
  `;
}

// ============================================================================
// Control Value Synchronization Helpers
// ============================================================================

function syncCorridorControlsUi() {
  const corr = appState.corridor;
  if (!corr) return;

  const setPair = (sliderId, inputId, val) => {
    const rounded = roundTo(val, 1);
    if (dom[sliderId]) dom[sliderId].value = String(rounded);
    if (dom[inputId]) dom[inputId].value = String(rounded);
  };

  setPair('slider-entry-x', 'input-entry-x', corr.entryMni[0]);
  setPair('slider-entry-y', 'input-entry-y', corr.entryMni[1]);
  setPair('slider-entry-z', 'input-entry-z', corr.entryMni[2]);
  setPair('slider-target-x', 'input-target-x', corr.targetMni[0]);
  setPair('slider-target-y', 'input-target-y', corr.targetMni[1]);
  setPair('slider-target-z', 'input-target-z', corr.targetMni[2]);

  if (dom['slider-corridor-radius']) {
    dom['slider-corridor-radius'].value = String(corr.radiusMm);
  }
  if (dom['val-corridor-radius']) {
    dom['val-corridor-radius'].textContent = `${corr.radiusMm.toFixed(1)} mm (Ø ${(corr.radiusMm * 2).toFixed(0)} mm)`;
  }

  if (dom['approach-mode-group']) {
    for (const btn of dom['approach-mode-group'].querySelectorAll('[data-approach]')) {
      const active = btn.dataset.approach === corr.approachMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }
}

function syncLesionControlsUi() {
  const primary = appState.lesion?.primaryEllipsoid;
  if (!primary) return;

  const setPair = (sliderId, inputId, val) => {
    const rounded = Math.round(val);
    if (dom[sliderId]) dom[sliderId].value = String(rounded);
    if (dom[inputId]) dom[inputId].value = String(rounded);
  };

  setPair('slider-lesion-cx', 'input-lesion-cx', primary.center[0]);
  setPair('slider-lesion-cy', 'input-lesion-cy', primary.center[1]);
  setPair('slider-lesion-cz', 'input-lesion-cz', primary.center[2]);
  setPair('slider-lesion-rx', 'input-lesion-rx', primary.radii[0]);
  setPair('slider-lesion-ry', 'input-lesion-ry', primary.radii[1]);
  setPair('slider-lesion-rz', 'input-lesion-rz', primary.radii[2]);

  if (dom['lesion-volume-badge']) {
    const vol = appState.customNiftiInfo
      ? appState.customNiftiInfo.volumeCm3
      : computeEllipsoidVolumeCm3(primary);
    dom['lesion-volume-badge'].textContent = `${vol.toFixed(1)} cm³`;
  }
}

function syncSliceAndProbeControlsUi() {
  const [sx, sy, sz] = appState.sliceMni;
  if (dom['slider-slice-x']) dom['slider-slice-x'].value = String(Math.round(sx));
  if (dom['slider-slice-y']) dom['slider-slice-y'].value = String(Math.round(sy));
  if (dom['slider-slice-z']) dom['slider-slice-z'].value = String(Math.round(sz));

  if (dom['val-slice-x']) dom['val-slice-x'].textContent = formatSignedMm(sx, 0);
  if (dom['val-slice-y']) dom['val-slice-y'].textContent = formatSignedMm(sy, 0);
  if (dom['val-slice-z']) dom['val-slice-z'].textContent = formatSignedMm(sz, 0);

  if (dom['slider-probe-depth']) {
    dom['slider-probe-depth'].value = String(roundTo(appState.probeDepthFraction * 100, 1));
  }
  updateProbeDepthReadout();
}

function updateProbeDepthReadout() {
  const pct = Math.round(appState.probeDepthFraction * 100);
  const len = appState.analysis?.trajectoryLengthMm;
  const dMm = Number.isFinite(len) ? len * appState.probeDepthFraction : null;

  if (dom['val-probe-depth']) {
    dom['val-probe-depth'].textContent = dMm !== null ? `${pct}% · ${dMm.toFixed(0)}mm` : `${pct}%`;
  }

  const liveBadge = dom['probe-live-hazard'];
  if (!liveBadge) return;

  let sliceData = null;
  if (appState.analysis && typeof appState.analysis.probeCrossSection === 'function') {
    try {
      sliceData = appState.analysis.probeCrossSection(appState.probeDepthFraction);
    } catch (_) {
      sliceData = null;
    }
  }

  const closest = sliceData?.closestAtSlice || null;
  const depthTag = dMm !== null ? `${pct}% (${dMm.toFixed(0)} mm)` : `${pct}%`;

  if (closest && Number.isFinite(closest.clearanceMm)) {
    const tier = closest.riskTier || 'safe';
    const label = closest.shortName || closest.name || 'Hazard';
    liveBadge.className = `probe-hazard-readout tier-${tier}`;
    liveBadge.textContent = `Probe ${depthTag} · ${label} ${closest.clearanceMm.toFixed(1)} mm`;
  } else {
    liveBadge.className = 'probe-hazard-readout tier-safe';
    liveBadge.textContent = `Probe ${depthTag} · Clear`;
  }
}

function syncSliceCrosshairToProbeDepth(depthFrac) {
  if (!appState.corridor) return;
  const [ex, ey, ez] = appState.corridor.entryMni;
  const [tx, ty, tz] = appState.corridor.targetMni;
  const t = clamp(depthFrac, 0, 1);
  appState.sliceMni = [
    roundTo(ex + (tx - ex) * t, 1),
    roundTo(ey + (ty - ey) * t, 1),
    roundTo(ez + (tz - ez) * t, 1),
  ];
}

function syncFlyButtonUi() {
  const btn = dom['btn-fly-corridor'];
  if (!btn) return;
  const playing = Boolean(appState.isFlyingCorridor);
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-pressed', String(playing));
  btn.setAttribute(
    'aria-label',
    playing
      ? 'Pause surgical corridor advancement'
      : 'Fly Along Corridor from cortical entry (0%) to target (100%)'
  );
  if (dom['fly-corridor-icon']) {
    dom['fly-corridor-icon'].textContent = playing ? '⏸' : '▶';
  }
  if (dom['fly-corridor-label']) {
    dom['fly-corridor-label'].textContent = playing ? 'Pause' : 'Fly';
  }
}

function stopCorridorFlight() {
  if (appState.flyRafId !== null) {
    cancelAnimationFrame(appState.flyRafId);
    appState.flyRafId = null;
  }
  if (appState.isFlyingCorridor) {
    appState.isFlyingCorridor = false;
  }
  syncFlyButtonUi();
}

function stepCorridorFlight(now) {
  appState.flyRafId = null;
  if (!appState.isFlyingCorridor || !appState.corridor) {
    stopCorridorFlight();
    return;
  }

  const dt = clamp(now - appState.flyLastTime, 0, 64);
  appState.flyLastTime = now;

  const trajLen = appState.analysis?.trajectoryLengthMm || 55;
  const durationMs = clamp(trajLen * 95, 4200, 7200);
  const nextFrac = clamp(appState.probeDepthFraction + dt / durationMs, 0, 1);

  appState.probeDepthFraction = nextFrac;
  syncSliceCrosshairToProbeDepth(nextFrac);
  syncSliceAndProbeControlsUi();
  syncRendererState();

  if (nextFrac >= 1) {
    stopCorridorFlight();
    return;
  }

  appState.flyRafId = requestAnimationFrame(stepCorridorFlight);
}

function startCorridorFlight() {
  if (!appState.corridor || !appState.analysis) return;

  if (!appState.probeDepthTouched || appState.probeDepthFraction >= 0.995) {
    appState.probeDepthFraction = 0;
  }
  appState.probeDepthTouched = true;
  appState.isFlyingCorridor = true;
  appState.flyLastTime = performance.now();

  syncFlyButtonUi();
  syncSliceCrosshairToProbeDepth(appState.probeDepthFraction);
  syncSliceAndProbeControlsUi();
  syncRendererState();

  if (appState.flyRafId === null) {
    appState.flyRafId = requestAnimationFrame(stepCorridorFlight);
  }
}

function toggleCorridorFlight() {
  if (appState.isFlyingCorridor) {
    stopCorridorFlight();
  } else {
    startCorridorFlight();
  }
}

function setLegendOpen(open) {
  const next = Boolean(open);
  appState.legendOpen = next;
  const btn = dom['btn-toggle-legend'];
  const panel = dom['hud-legend-panel'];
  if (btn) {
    btn.classList.toggle('is-open', next);
    btn.setAttribute('aria-expanded', String(next));
  }
  if (panel) {
    panel.hidden = !next;
  }
}

function setActiveCameraPresetButton(presetKey) {
  if (!dom['camera-presets']) return;
  for (const btn of dom['camera-presets'].querySelectorAll('[data-preset]')) {
    btn.classList.toggle('is-active', Boolean(presetKey) && btn.dataset.preset === presetKey);
  }
}

// ============================================================================
// Tab & Mode Switching (Corridor Sandbox vs. Guided Neuroanatomy Quiz)
// ============================================================================

function activateTab(tabName, { syncMode = true } = {}) {
  const validTabs = ['planner', 'atlas', 'pearls', 'quiz'];
  if (!validTabs.includes(tabName)) return;

  appState.activeTab = tabName;
  if (tabName !== 'quiz') {
    appState.lastSandboxTab = tabName;
  }

  for (const name of validTabs) {
    const btn = dom[`tab-btn-${name}`];
    const panel = dom[`tab-panel-${name}`];
    const isActive = name === tabName;
    if (btn) {
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    }
    if (panel) {
      panel.hidden = !isActive;
      panel.classList.toggle('is-active', isActive);
    }
  }

  if (syncMode) {
    const targetMode = tabName === 'quiz' ? 'quiz' : 'sandbox';
    setAppMode(targetMode, { fromTab: true });
  }

  if (tabName === 'pearls') {
    renderCasePearls();
  }
}

function setAppMode(mode, { fromTab = false } = {}) {
  const nextMode = mode === 'quiz' ? 'quiz' : 'sandbox';
  const wasQuiz = appState.appMode === 'quiz';
  appState.appMode = nextMode;

  if (dom['mode-btn-sandbox']) {
    const active = nextMode === 'sandbox';
    dom['mode-btn-sandbox'].classList.toggle('is-active', active);
    dom['mode-btn-sandbox'].setAttribute('aria-selected', String(active));
  }
  if (dom['mode-btn-quiz']) {
    const active = nextMode === 'quiz';
    dom['mode-btn-quiz'].classList.toggle('is-active', active);
    dom['mode-btn-quiz'].setAttribute('aria-selected', String(active));
  }

  if (nextMode === 'quiz') {
    if (!fromTab) activateTab('quiz', { syncMode: false });
    syncQuizQuestionToViewport();
  } else {
    if (!fromTab) activateTab(appState.lastSandboxTab || 'planner', { syncMode: false });
    if (wasQuiz) {
      appState.highlightIds = [];
      syncRendererState();
    }
  }
}

// ============================================================================
// Corridor Optimizer Workflow
// ============================================================================

function runCorridorOptimizer() {
  if (!appState.corridor || !appState.lesion || !appState.atlasData) return;

  const beforeAnalysis = appState.analysis;
  const beforeMin = beforeAnalysis?.sortedHazards?.[0]?.corridorClearanceMm ?? 0;
  const beforeCrit = beforeAnalysis?.criticalViolations?.length ?? 0;

  const result = optimizeEntryCorridor(
    appState.corridor.targetMni,
    appState.lesion,
    appState.atlasData,
    appState.densifiedTracts,
    {
      approachMode: appState.corridor.approachMode,
      radiusMm: appState.corridor.radiusMm,
      currentCorridor: appState.corridor,
    }
  );

  appState.optimizerResult = result;
  appState.ghostCorridor = cloneCorridor(result.bestCorridor);
  syncRendererState();

  const banner = dom['optimizer-result-banner'];
  if (!banner) return;

  const afterMin = result.bestAnalysis?.sortedHazards?.[0]?.corridorClearanceMm ?? 0;
  const afterCrit = result.bestAnalysis?.criticalViolations?.length ?? 0;
  const delta = result.comparisonDelta;
  const minDelta = delta ? delta.minClearanceDeltaMm : afterMin - beforeMin;
  const lenDelta = delta ? delta.trajectoryLengthDeltaMm : 0;
  const sign = (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

  if (dom['opt-eval-count']) {
    dom['opt-eval-count'].textContent = `${result.candidatesEvaluated} candidates`;
  }
  if (dom['opt-summary-text']) {
    dom['opt-summary-text'].textContent = delta ? delta.summary : result.improvementSummary;
  }
  if (dom['opt-delta-pills']) {
    dom['opt-delta-pills'].innerHTML = `
      <span class="delta-pill ${minDelta >= 0.1 ? 'is-good' : ''}">
        Min Margin: ${beforeMin.toFixed(1)} → ${afterMin.toFixed(1)} mm (${sign(minDelta)} mm)
      </span>
      <span class="delta-pill ${afterCrit < beforeCrit ? 'is-good' : afterCrit > 0 ? 'is-warn' : 'is-good'}">
        Critical: ${beforeCrit} → ${afterCrit}
      </span>
      <span class="delta-pill">
        Length: ${sign(lenDelta)} mm
      </span>
    `;
  }

  banner.hidden = false;
  showToast('Optimized entry previewed in cyan — click Apply to commit.', 'info');
}

function applyOptimizedCorridor() {
  if (!appState.optimizerResult?.bestCorridor) return;
  stopCorridorFlight();
  appState.corridor = cloneCorridor(appState.optimizerResult.bestCorridor);
  appState.ghostCorridor = null;
  appState.optimizerResult = null;
  if (dom['optimizer-result-banner']) dom['optimizer-result-banner'].hidden = true;
  syncCorridorControlsUi();
  recomputeAndRender();
  showToast('Applied optimized low-risk surgical corridor.', 'success');
}

function dismissOptimizedCorridor() {
  appState.ghostCorridor = null;
  appState.optimizerResult = null;
  if (dom['optimizer-result-banner']) dom['optimizer-result-banner'].hidden = true;
  syncRendererState();
}

// ============================================================================
// Local Browser-Only NIfTI-1 (.nii / .nii.gz) Mask Loader
// ============================================================================

function renderNiftiError(message) {
  const card = dom['nifti-status-card'];
  const dropzone = dom['nifti-dropzone'];
  const safeMsg = escapeHtml(message || 'Unable to parse NIfTI-1 file.');
  if (dropzone) {
    dropzone.classList.add('is-error');
    setTimeout(() => dropzone.classList.remove('is-error'), 2200);
  }
  if (card) {
    card.hidden = false;
    card.classList.add('is-error');
    card.setAttribute('role', 'alert');
    card.innerHTML = `
      <div class="nifti-status-head">
        <div><strong>NIfTI Parse Error:</strong> ${safeMsg}</div>
        <button type="button" class="btn-micro" data-nifti-action="dismiss" aria-label="Dismiss NIfTI error message">✕</button>
      </div>
    `;
  }
  showToast(`NIfTI error: ${message || 'Invalid file'}`, 'error');
}

async function handleNiftiFile(file) {
  if (!file) return;
  stopCorridorFlight();

  const fileName = String(file.name || 'mask.nii');
  const lowerName = fileName.toLowerCase();

  if (file.size === 0) {
    renderNiftiError(`"${fileName}" is empty (0 bytes). Provide a non-empty MNI-152 .nii or .nii.gz binary mask.`);
    return;
  }
  if (file.size > 160 * 1024 * 1024) {
    renderNiftiError(`"${fileName}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 160 MB browser-local safety limit.`);
    return;
  }
  if (lowerName.endsWith('.dcm') || lowerName.endsWith('.dicom')) {
    renderNiftiError(`"${fileName}" appears to be a DICOM slice. Convert to a single-file MNI-152 .nii or .nii.gz binary lesion mask.`);
    return;
  }
  if (lowerName.endsWith('.hdr') || lowerName.endsWith('.img')) {
    renderNiftiError(`Dual-file NIfTI/Analyze (${fileName}) is unsupported. Export a single-file .nii or .nii.gz mask.`);
    return;
  }
  if (!lowerName.endsWith('.nii') && !lowerName.endsWith('.nii.gz') && !lowerName.endsWith('.gz')) {
    renderNiftiError(`Unsupported file extension on "${fileName}". Expected a .nii or .nii.gz MNI-152 binary mask.`);
    return;
  }

  const card = dom['nifti-status-card'];
  if (card) {
    card.hidden = false;
    card.classList.remove('is-error');
    card.removeAttribute('role');
    card.innerHTML = `<span class="mono-mini">Parsing "${escapeHtml(fileName)}" locally in browser memory…</span>`;
  }

  try {
    const buffer = await file.arrayBuffer();
    const parsed = await parseMniNiftiMask(buffer, { fileName });
    appState.customNiftiInfo = parsed;
    appState.isCustomLesion = true;

    appState.lesion = {
      primaryEllipsoid: cloneEllipsoid(parsed.primaryEllipsoid),
      secondaryEllipsoid: null,
      edemaEllipsoid: null,
      color: '#ec4899',
      edemaColor: '#38bdf8',
      pointCloudMni: parsed.pointCloudMni,
    };

    // Re-center target and tri-planar slices on the parsed mask centroid
    const c = parsed.centroidMni;
    const clampedTarget = [
      roundTo(clamp(c[0], MNI_BOUNDS.x[0], MNI_BOUNDS.x[1]), 1),
      roundTo(clamp(c[1], MNI_BOUNDS.y[0], MNI_BOUNDS.y[1]), 1),
      roundTo(clamp(c[2], MNI_BOUNDS.z[0], MNI_BOUNDS.z[1]), 1),
    ];

    appState.corridor.targetMni = clampedTarget;
    if (appState.corridor.approachMode === 'transcortical') {
      const projected = projectToCorticalSurface(clampedTarget);
      appState.corridor.entryMni = [
        roundTo(projected[0], 1),
        roundTo(projected[1], 1),
        roundTo(projected[2], 1),
      ];
    }
    appState.sliceMni = [Math.round(clampedTarget[0]), Math.round(clampedTarget[1]), Math.round(clampedTarget[2])];
    appState.probeDepthFraction = 0.5;
    appState.probeDepthTouched = false;
    appState.ghostCorridor = null;
    appState.optimizerResult = null;
    if (dom['optimizer-result-banner']) dom['optimizer-result-banner'].hidden = true;

    if (card) {
      const warnHtml =
        parsed.warnings.length > 0
          ? `<ul class="nifti-warn-list">${parsed.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
          : '';
      card.hidden = false;
      card.classList.remove('is-error');
      card.removeAttribute('role');
      card.innerHTML = `
        <div class="nifti-status-head">
          <div><strong>Loaded Locally:</strong> <code>${escapeHtml(parsed.fileName || fileName)}</code></div>
          <button type="button" class="btn-micro" data-nifti-action="dismiss" aria-label="Hide NIfTI status summary">✕</button>
        </div>
        <div class="nifti-kv-grid">
          <span>Matrix: ${escapeHtml(parsed.dimensions.join('×'))}</span>
          <span>Affine: ${escapeHtml(parsed.affineSource)}</span>
          <span>Volume: ${parsed.volumeCm3.toFixed(2)} cm³</span>
          <span>Voxels: ${parsed.voxelCount.toLocaleString()}</span>
          <span>Spacing: ${parsed.voxelSpacingMm.map((v) => v.toFixed(1)).join('×')} mm</span>
          <span>Centroid: [${parsed.centroidMni.map((v) => v.toFixed(0)).join(', ')}]</span>
        </div>
        ${warnHtml}
      `;
    }

    syncLesionControlsUi();
    syncCorridorControlsUi();
    syncSliceAndProbeControlsUi();
    recomputeAndRender();
    renderCasePearls();
    showToast(`Parsed ${fileName} (${parsed.volumeCm3.toFixed(2)} cm³) locally in RAM.`, 'success');
  } catch (err) {
    const rawMsg = err?.message || String(err);
    const friendlyMsg =
      lowerName.endsWith('.gz') && /decompress|gzip|fetch|stream/i.test(rawMsg)
        ? `Corrupted or invalid gzip stream in "${fileName}" (${rawMsg}).`
        : rawMsg;
    renderNiftiError(friendlyMsg);
  }
}

// ============================================================================
// Guided Neuroanatomy & Surgical Approach Quiz Controller
// ============================================================================

function syncQuizQuestionToViewport() {
  const engine = appState.quizEngine;
  if (!engine) return;
  const q = engine.getCurrentQuestion();
  if (!q) return;

  if (q.caseId && q.caseId !== appState.activeCaseId) {
    loadCase(q.caseId, { flyCamera: false, preserveQuizHighlights: true });
  }

  ensureIdsVisible(q.highlightStructureIds);
  appState.highlightIds = Array.isArray(q.highlightStructureIds) ? q.highlightStructureIds.slice() : [];
  appState.selectedHazardId = null;
  if (dom['anatomy-inspector-card']) dom['anatomy-inspector-card'].hidden = true;

  syncRendererState();

  if (appState.renderer && q.focusCamera) {
    appState.renderer.flyToCamera(q.focusCamera.yaw, q.focusCamera.pitch, q.focusCamera.zoom, 520);
    setActiveCameraPresetButton(null);
  }

  renderQuizUi();
}

function renderQuizUi() {
  const engine = appState.quizEngine;
  if (!engine) return;

  const progress = engine.getProgress();
  const q = engine.getCurrentQuestion();
  const total = progress.totalCount;
  const curIdx = progress.currentIndex;

  if (dom['quiz-score-badge']) {
    dom['quiz-score-badge'].textContent = `${progress.correctCount} / ${total}`;
  }
  if (dom['mode-quiz-score']) {
    dom['mode-quiz-score'].textContent = `${progress.correctCount}/${total}`;
  }
  if (dom['quiz-progress-bar']) {
    dom['quiz-progress-bar'].style.width = `${progress.percentComplete}%`;
  }
  if (dom['quiz-progress-text']) {
    dom['quiz-progress-text'].textContent =
      `Question ${curIdx + 1} of ${total} · ${progress.answeredCount} answered (${progress.accuracyPercent}% accuracy)`;
  }

  // Q1..Q10 jump dots
  if (dom['quiz-dots']) {
    const dotsHtml = [];
    for (let i = 0; i < total; i++) {
      const qId = appState.quizQuestions[i]?.id || `q${String(i + 1).padStart(2, '0')}`;
      const rec = progress.answersById[qId];
      const cls = ['quiz-dot-btn'];
      if (i === curIdx) cls.push('is-current');
      if (rec) cls.push(rec.isCorrect ? 'is-correct' : 'is-wrong');
      dotsHtml.push(
        `<button type="button" class="${cls.join(' ')}" data-quiz-jump="${i}" aria-label="Jump to question ${i + 1}">${i + 1}</button>`
      );
    }
    dom['quiz-dots'].innerHTML = dotsHtml.join('');
  }

  // Nav buttons
  if (dom['btn-quiz-prev']) dom['btn-quiz-prev'].disabled = curIdx <= 0;
  if (dom['btn-quiz-next']) {
    dom['btn-quiz-next'].disabled = curIdx >= total - 1;
    dom['btn-quiz-next'].textContent = curIdx >= total - 1 ? 'End of Quiz' : 'Next Question →';
  }

  // Question Card
  const card = dom['quiz-question-card'];
  if (card && q) {
    const answerRec = engine.getAnswerRecord(q.id);
    const linkedCase = appState.caseById.get(q.caseId);
    const letters = ['A', 'B', 'C', 'D'];

    const hlChips = (q.highlightStructureIds || [])
      .map((id) => {
        const rec = appState.structureById.get(id) || appState.tractById.get(id);
        return `<span class="quiz-hl-chip">${escapeHtml(rec ? rec.shortName : id)}</span>`;
      })
      .join('');

    const optionsHtml = q.options
      .map((optText, idx) => {
        const classes = ['quiz-option-btn'];
        if (answerRec) {
          if (idx === q.correctIndex) {
            classes.push('opt-correct');
          } else if (idx === answerRec.selectedIndex) {
            classes.push('opt-wrong');
          } else {
            classes.push('opt-dim');
          }
        }
        return `
          <button type="button" class="${classes.join(' ')}" data-quiz-option="${idx}" ${answerRec ? 'disabled' : ''}>
            <span class="quiz-opt-letter">${letters[idx] || idx + 1}</span>
            <span>${escapeHtml(optText)}</span>
          </button>
        `;
      })
      .join('');

    const feedbackHtml = answerRec
      ? `
        <div class="quiz-feedback ${answerRec.isCorrect ? 'is-correct' : 'is-wrong'}">
          <div class="quiz-feedback-verdict">
            ${answerRec.isCorrect ? '✓ Correct Stereotactic Assessment' : `✕ Incorrect — Correct Answer: ${letters[q.correctIndex]}`}
          </div>
          <div>${escapeHtml(q.explanation)}</div>
          <div class="quiz-pearl-box">
            <strong>Clinical Pearl:</strong> ${escapeHtml(q.pearl)}
          </div>
        </div>
      `
      : '';

    card.innerHTML = `
      <div class="quiz-case-strip">
        <span class="quiz-case-tag">${escapeHtml(linkedCase ? linkedCase.title : q.caseId)}</span>
        <div class="quiz-highlight-chips">${hlChips}</div>
      </div>
      <p class="quiz-stem">${escapeHtml(q.question)}</p>
      <div class="quiz-options">${optionsHtml}</div>
      ${feedbackHtml}
    `;
  }

  // Completion Summary Card
  const summaryCard = dom['quiz-summary-card'];
  if (summaryCard) {
    if (progress.isComplete) {
      const summary = engine.getSummary();
      const domainRows = (summary.categoryBreakdown || [])
        .map(
          (cat) => `
          <tr>
            <td>${escapeHtml(cat.category)}</td>
            <td>${cat.correct}/${cat.total} (${cat.accuracyPercent}%)</td>
          </tr>
        `
        )
        .join('');

      summaryCard.hidden = false;
      summaryCard.innerHTML = `
        <div class="panel-card-header">
          <h3 class="panel-title">Quiz Assessment Complete</h3>
          <span class="quiz-score-badge">${summary.score} / ${summary.totalCount} (${summary.accuracyPercent}%)</span>
        </div>
        <div class="summary-tier">${escapeHtml(summary.tierLabel)}</div>
        <table class="summary-domain-table">
          <thead>
            <tr>
              <th>Neurosurgical Domain</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>${domainRows}</tbody>
        </table>
      `;
    } else {
      summaryCard.hidden = true;
      summaryCard.innerHTML = '';
    }
  }
}

// ============================================================================
// Hover Tooltip & Slice Click Callbacks from NeuroCorridorRenderer
// ============================================================================

function handleStructureHover(hit) {
  const tip = dom['hover-tooltip'];
  if (!tip) return;
  if (!hit) {
    tip.hidden = true;
    return;
  }

  const clearText = Number.isFinite(hit.clearanceMm) ? formatMm(hit.clearanceMm, 1) : '—';
  const tier = hit.riskTier || 'safe';
  const tierLabel = (RISK_DISPLAY[tier] || RISK_DISPLAY.safe).short;

  tip.innerHTML = `
    <div class="tt-head">
      <span class="tt-dot" style="background:${sanitizeHexColor(hit.color, '#38bdf8')};"></span>
      <span>${escapeHtml(hit.name || hit.shortName || hit.id)}</span>
    </div>
    <div class="tt-meta">
      <span>Corridor: ${escapeHtml(clearText)}</span>
      <span class="risk-pill tier-${escapeHtml(tier)}">${escapeHtml(tierLabel)}</span>
    </div>
  `;
  tip.hidden = false;

  const stage = dom['viewport-3d']?.parentElement;
  if (stage) {
    const pad = 12;
    const maxX = Math.max(pad, stage.clientWidth - tip.offsetWidth - pad);
    const maxY = Math.max(pad, stage.clientHeight - tip.offsetHeight - pad);
    const left = clamp((hit.screenX || 0) + 14, pad, maxX);
    const top = clamp((hit.screenY || 0) - tip.offsetHeight - 10, pad, maxY);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
}

function handleSliceClick({ mniPoint, shiftKey }) {
  if (!Array.isArray(mniPoint) || !appState.corridor) return;
  if (appState.isFlyingCorridor) stopCorridorFlight();

  const effectiveMode = shiftKey ? 'entry' : appState.sliceClickMode;
  appState.sliceMni = [roundTo(mniPoint[0], 1), roundTo(mniPoint[1], 1), roundTo(mniPoint[2], 1)];

  if (effectiveMode === 'target') {
    appState.corridor.targetMni = [...appState.sliceMni];
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    syncSliceAndProbeControlsUi();
    recomputeAndRender();
  } else if (effectiveMode === 'entry') {
    appState.corridor.entryMni = [...appState.sliceMni];
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    syncSliceAndProbeControlsUi();
    recomputeAndRender();
  } else {
    syncSliceAndProbeControlsUi();
    syncRendererState();
  }
}

// ============================================================================
// Event Wiring
// ============================================================================

function bindPairedAxisControl(sliderId, inputId, min, max, onValue) {
  const slider = dom[sliderId];
  const input = dom[inputId];
  if (slider) {
    slider.addEventListener('input', () => {
      const val = clamp(Number(slider.value), min, max);
      if (input) input.value = String(val);
      onValue(val);
    });
  }
  if (input) {
    input.addEventListener('input', () => {
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      const val = clamp(raw, min, max);
      if (slider) slider.value = String(val);
      onValue(val);
    });
    input.addEventListener('blur', () => {
      const raw = Number(input.value);
      const val = clamp(Number.isFinite(raw) ? raw : min, min, max);
      input.value = String(val);
      if (slider) slider.value = String(val);
    });
  }
}

function selectAndInspectHazard(hazardId, { switchToPlanner = false } = {}) {
  if (!hazardId) return;
  const nextId = appState.selectedHazardId === hazardId && !switchToPlanner ? null : hazardId;
  appState.selectedHazardId = nextId;
  if (nextId) {
    ensureIdsVisible([nextId]);
  }
  if (switchToPlanner && appState.activeTab !== 'planner') {
    activateTab('planner');
  }
  renderHazardTable();
  renderAnatomyInspector(appState.selectedHazardId);
  syncRendererState();

  if (appState.selectedHazardId && dom['anatomy-inspector-card']) {
    dom['anatomy-inspector-card'].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function wireAllEvents() {
  // 1. Top Mode Switcher (+ Keyboard Tab Arrow Navigation)
  dom['mode-btn-sandbox']?.addEventListener('click', () => setAppMode('sandbox'));
  dom['mode-btn-quiz']?.addEventListener('click', () => setAppMode('quiz'));
  for (const [id, nextMode, nextId] of [
    ['mode-btn-sandbox', 'quiz', 'mode-btn-quiz'],
    ['mode-btn-quiz', 'sandbox', 'mode-btn-sandbox'],
  ]) {
    dom[id]?.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setAppMode(nextMode);
      dom[nextId]?.focus();
    });
  }

  // 2. Export Plan JSON & Markdown Summary + Reset Case
  dom['btn-export-json']?.addEventListener('click', () => {
    const activeCase = getActiveCase();
    const quizProg = appState.quizEngine?.getProgress();
    const quizSummary = quizProg && quizProg.answeredCount > 0 ? appState.quizEngine.getSummary() : null;
    const report = generateEducationalReportJson({
      caseData: activeCase,
      corridor: appState.corridor,
      analysis: appState.analysis,
      customNiftiInfo: appState.customNiftiInfo,
      quizSummary,
    });
    const fileName = `neurocorridor-plan-${activeCase?.id || 'custom'}.json`;
    triggerLocalDownload(JSON.stringify(report, null, 2), 'application/json;charset=utf-8', fileName);
    showToast(`Exported ${fileName} (100% browser-local).`, 'success');
  });

  dom['btn-export-md']?.addEventListener('click', () => {
    const activeCase = getActiveCase();
    const quizProg = appState.quizEngine?.getProgress();
    const quizSummary = quizProg && quizProg.answeredCount > 0 ? appState.quizEngine.getSummary() : null;
    const md = generateEducationalReportMarkdown({
      caseData: activeCase,
      corridor: appState.corridor,
      analysis: appState.analysis,
      customNiftiInfo: appState.customNiftiInfo,
      quizSummary,
    });
    const fileName = `neurocorridor-summary-${activeCase?.id || 'custom'}.md`;
    triggerLocalDownload(md, 'text/markdown;charset=utf-8', fileName);
    showToast(`Exported ${fileName} (100% browser-local).`, 'success');
  });

  dom['btn-reset-case']?.addEventListener('click', () => {
    resetVisibilityAll(true);
    syncAtlasToggleInputs();
    loadCase(appState.activeCaseId || appState.cases[0]?.id, { flyCamera: true });
    showToast('Reset case geometry, corridor, layers, and camera.', 'info');
  });

  // 3. Curated Teaching Case Selector (Pills + Compact Dropdown)
  dom['case-selector-list']?.addEventListener('click', (e) => {
    const btn = e.target.closest('.case-pill[data-case-id]');
    if (!btn) return;
    if (appState.appMode === 'quiz') {
      setAppMode('sandbox');
    }
    loadCase(btn.dataset.caseId, { flyCamera: true });
  });

  dom['case-selector-list']?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const pills = Array.from(dom['case-selector-list'].querySelectorAll('.case-pill[data-case-id]'));
    if (pills.length === 0) return;
    const curBtn = e.target.closest('.case-pill[data-case-id]');
    const curIdx = curBtn ? pills.indexOf(curBtn) : 0;
    const nextIdx = (curIdx + (e.key === 'ArrowRight' ? 1 : -1) + pills.length) % pills.length;
    e.preventDefault();
    const nextBtn = pills[nextIdx];
    if (appState.appMode === 'quiz') setAppMode('sandbox');
    loadCase(nextBtn.dataset.caseId, { flyCamera: true });
    nextBtn.focus();
  });

  dom['case-selector-select']?.addEventListener('change', (e) => {
    if (appState.appMode === 'quiz') {
      setAppMode('sandbox');
    }
    loadCase(e.target.value, { flyCamera: true });
  });

  // 4. 3D Floating Display Controls & Camera Presets
  dom['btn-color-anatomical']?.addEventListener('click', () => {
    appState.tractColorMode = 'anatomical';
    dom['btn-color-anatomical'].classList.add('is-active');
    dom['btn-color-anatomical'].setAttribute('aria-pressed', 'true');
    dom['btn-color-dec']?.classList.remove('is-active');
    dom['btn-color-dec']?.setAttribute('aria-pressed', 'false');
    if (dom['dec-legend']) dom['dec-legend'].hidden = true;
    syncRendererState();
  });

  dom['btn-color-dec']?.addEventListener('click', () => {
    appState.tractColorMode = 'dec';
    dom['btn-color-dec'].classList.add('is-active');
    dom['btn-color-dec'].setAttribute('aria-pressed', 'true');
    dom['btn-color-anatomical']?.classList.remove('is-active');
    dom['btn-color-anatomical']?.setAttribute('aria-pressed', 'false');
    if (dom['dec-legend']) dom['dec-legend'].hidden = false;
    syncRendererState();
  });

  dom['slider-brain-opacity']?.addEventListener('input', (e) => {
    const val = clamp(Number(e.target.value), 0.05, 0.6);
    appState.brainOpacity = val;
    if (dom['val-brain-opacity']) dom['val-brain-opacity'].textContent = `${Math.round(val * 100)}%`;
    syncRendererState();
  });

  dom['slider-brain-opacity']?.addEventListener('dblclick', () => {
    appState.brainOpacity = 0.24;
    if (dom['slider-brain-opacity']) dom['slider-brain-opacity'].value = '0.24';
    if (dom['val-brain-opacity']) dom['val-brain-opacity'].textContent = '24%';
    syncRendererState();
  });

  dom['btn-toggle-legend']?.addEventListener('click', (e) => {
    e.stopPropagation();
    setLegendOpen(!appState.legendOpen);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!appState.legendOpen) return;
    if (e.target.closest?.('.hud-legend-wrap')) return;
    setLegendOpen(false);
  });

  const bindToggle = (id, stateKey) => {
    dom[id]?.addEventListener('change', (e) => {
      appState[stateKey] = Boolean(e.target.checked);
      syncRendererState();
    });
  };
  bindToggle('toggle-brain-shell', 'showBrainShell');
  bindToggle('toggle-labels', 'showLabels');
  bindToggle('toggle-edema', 'showEdema');
  bindToggle('toggle-ventricles', 'showVentricles');
  bindToggle('toggle-corridor', 'showCorridor');

  dom['camera-presets']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn || !appState.renderer) return;
    const preset = btn.dataset.preset;
    appState.renderer.setCameraPreset(preset);
    setActiveCameraPresetButton(preset);
  });

  // 5. Orthogonal Slice Scrubbers, Click Mode, Probe Depth & Fly Along Corridor
  dom['click-mode-group']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    appState.sliceClickMode = btn.dataset.mode;
    for (const b of dom['click-mode-group'].querySelectorAll('[data-mode]')) {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  });

  dom['slider-slice-x']?.addEventListener('input', (e) => {
    if (appState.isFlyingCorridor) stopCorridorFlight();
    appState.sliceMni = [Number(e.target.value), appState.sliceMni[1], appState.sliceMni[2]];
    if (dom['val-slice-x']) dom['val-slice-x'].textContent = formatSignedMm(appState.sliceMni[0], 0);
    syncRendererState();
  });

  dom['slider-slice-y']?.addEventListener('input', (e) => {
    if (appState.isFlyingCorridor) stopCorridorFlight();
    appState.sliceMni = [appState.sliceMni[0], Number(e.target.value), appState.sliceMni[2]];
    if (dom['val-slice-y']) dom['val-slice-y'].textContent = formatSignedMm(appState.sliceMni[1], 0);
    syncRendererState();
  });

  dom['slider-slice-z']?.addEventListener('input', (e) => {
    if (appState.isFlyingCorridor) stopCorridorFlight();
    appState.sliceMni = [appState.sliceMni[0], appState.sliceMni[1], Number(e.target.value)];
    if (dom['val-slice-z']) dom['val-slice-z'].textContent = formatSignedMm(appState.sliceMni[2], 0);
    syncRendererState();
  });

  dom['btn-fly-corridor']?.addEventListener('click', () => {
    toggleCorridorFlight();
  });

  dom['slider-probe-depth']?.addEventListener('input', (e) => {
    if (appState.isFlyingCorridor) stopCorridorFlight();
    appState.probeDepthTouched = true;
    appState.probeDepthFraction = clamp(Number(e.target.value) / 100, 0, 1);
    syncSliceCrosshairToProbeDepth(appState.probeDepthFraction);
    syncSliceAndProbeControlsUi();
    syncRendererState();
  });

  dom['slider-probe-depth']?.addEventListener('dblclick', () => {
    if (appState.isFlyingCorridor) stopCorridorFlight();
    appState.probeDepthTouched = true;
    appState.probeDepthFraction = 0.5;
    syncSliceCrosshairToProbeDepth(0.5);
    syncSliceAndProbeControlsUi();
    syncRendererState();
  });

  // 6. Right Control Console Tabs (+ Keyboard Arrow Navigation)
  const tabOrder = ['planner', 'atlas', 'pearls', 'quiz'];
  for (const name of tabOrder) {
    dom[`tab-btn-${name}`]?.addEventListener('click', () => activateTab(name));
    dom[`tab-btn-${name}`]?.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const idx = tabOrder.indexOf(name);
      const nextIdx =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabOrder.length - 1
            : (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabOrder.length) % tabOrder.length;
      const nextName = tabOrder[nextIdx];
      activateTab(nextName);
      dom[`tab-btn-${nextName}`]?.focus();
    });
  }

  // 7. Tab 1 — Corridor Geometry, Entry/Target Precision Sliders & Optimizer
  dom['approach-mode-group']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-approach]');
    if (!btn || !appState.corridor) return;
    stopCorridorFlight();
    appState.corridor.approachMode = btn.dataset.approach === 'endonasal' ? 'endonasal' : 'transcortical';
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    recomputeAndRender();
  });

  dom['slider-corridor-radius']?.addEventListener('input', (e) => {
    if (!appState.corridor) return;
    appState.corridor.radiusMm = clamp(Number(e.target.value), 3, 12);
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    recomputeAndRender();
  });

  dom['slider-corridor-radius']?.addEventListener('dblclick', () => {
    if (!appState.corridor) return;
    const defaultRadius = getActiveCase()?.defaultCorridor?.radiusMm || 6;
    appState.corridor.radiusMm = clamp(Number(defaultRadius), 3, 12);
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    recomputeAndRender();
  });

  const updateEntryAxis = (axisIdx, val) => {
    if (!appState.corridor) return;
    appState.corridor.entryMni[axisIdx] = val;
    dismissOptimizedCorridor();
    recomputeAndRender();
  };
  const updateTargetAxis = (axisIdx, val) => {
    if (!appState.corridor) return;
    appState.corridor.targetMni[axisIdx] = val;
    dismissOptimizedCorridor();
    recomputeAndRender();
  };

  bindPairedAxisControl('slider-entry-x', 'input-entry-x', MNI_BOUNDS.x[0], MNI_BOUNDS.x[1], (v) => updateEntryAxis(0, v));
  bindPairedAxisControl('slider-entry-y', 'input-entry-y', MNI_BOUNDS.y[0], MNI_BOUNDS.y[1], (v) => updateEntryAxis(1, v));
  bindPairedAxisControl('slider-entry-z', 'input-entry-z', MNI_BOUNDS.z[0], MNI_BOUNDS.z[1], (v) => updateEntryAxis(2, v));
  bindPairedAxisControl('slider-target-x', 'input-target-x', MNI_BOUNDS.x[0], MNI_BOUNDS.x[1], (v) => updateTargetAxis(0, v));
  bindPairedAxisControl('slider-target-y', 'input-target-y', MNI_BOUNDS.y[0], MNI_BOUNDS.y[1], (v) => updateTargetAxis(1, v));
  bindPairedAxisControl('slider-target-z', 'input-target-z', MNI_BOUNDS.z[0], MNI_BOUNDS.z[1], (v) => updateTargetAxis(2, v));

  dom['btn-snap-entry']?.addEventListener('click', () => {
    if (!appState.corridor) return;
    const snapped = projectToCorticalSurface(appState.corridor.entryMni);
    appState.corridor.entryMni = [roundTo(snapped[0], 1), roundTo(snapped[1], 1), roundTo(snapped[2], 1)];
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    recomputeAndRender();
    showToast('Entry point snapped to cortical surface.', 'info');
  });

  dom['btn-center-target']?.addEventListener('click', () => {
    const center = appState.lesion?.primaryEllipsoid?.center;
    if (!center || !appState.corridor) return;
    appState.corridor.targetMni = [roundTo(center[0], 1), roundTo(center[1], 1), roundTo(center[2], 1)];
    appState.sliceMni = [Math.round(center[0]), Math.round(center[1]), Math.round(center[2])];
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    syncSliceAndProbeControlsUi();
    recomputeAndRender();
  });

  dom['btn-optimize-corridor']?.addEventListener('click', runCorridorOptimizer);
  dom['btn-apply-optimized']?.addEventListener('click', applyOptimizedCorridor);
  dom['btn-dismiss-optimized']?.addEventListener('click', dismissOptimizedCorridor);

  dom['btn-reset-corridor']?.addEventListener('click', () => {
    const c = getActiveCase();
    if (!c) return;
    stopCorridorFlight();
    appState.corridor = cloneCorridor(c.defaultCorridor);
    appState.probeDepthFraction = 0.5;
    appState.probeDepthTouched = false;
    dismissOptimizedCorridor();
    syncCorridorControlsUi();
    syncSliceAndProbeControlsUi();
    recomputeAndRender();
    showToast('Restored default case surgical corridor.', 'info');
  });

  // 8. Proximity Table Filter, Row Selection & Anatomy Pearl Inspector Actions
  dom['hazard-filter-group']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    appState.hazardFilter = btn.dataset.filter;
    for (const b of dom['hazard-filter-group'].querySelectorAll('[data-filter]')) {
      b.classList.toggle('is-active', b === btn);
    }
    renderHazardTable();
  });

  dom['hazard-matrix-body']?.addEventListener('click', (e) => {
    const row = e.target.closest('.hazard-row[data-hazard-id]');
    if (!row) return;
    selectAndInspectHazard(row.dataset.hazardId);
  });

  dom['hazard-matrix-body']?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.hazard-row[data-hazard-id]');
    if (!row) return;
    e.preventDefault();
    selectAndInspectHazard(row.dataset.hazardId);
  });

  dom['anatomy-inspector-card']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inspector-action]');
    if (!btn) return;
    const action = btn.dataset.inspectorAction;
    if (action === 'close') {
      appState.selectedHazardId = null;
      renderAnatomyInspector(null);
      renderHazardTable();
      syncRendererState();
      return;
    }
    const hid = btn.dataset.hazardId;
    const hazard = (appState.analysis?.sortedHazards || []).find((h) => h.id === hid);
    if (!hazard) return;
    if (action === 'jump-slices' && Array.isArray(hazard.hazardClosestPoint)) {
      appState.sliceMni = [
        Math.round(hazard.hazardClosestPoint[0]),
        Math.round(hazard.hazardClosestPoint[1]),
        Math.round(hazard.hazardClosestPoint[2]),
      ];
      syncSliceAndProbeControlsUi();
      syncRendererState();
    } else if (action === 'jump-probe') {
      appState.probeDepthFraction = clamp(hazard.depthFraction || 0, 0, 1);
      syncSliceAndProbeControlsUi();
      syncRendererState();
    }
  });

  // 9. Tab 2 — Atlas Visibility Toggles & Shortcuts
  dom['btn-show-all-atlas']?.addEventListener('click', () => {
    resetVisibilityAll(true);
    syncAtlasToggleInputs();
    syncRendererState();
  });

  dom['btn-hazards-only']?.addEventListener('click', () => {
    const hazards = appState.analysis?.sortedHazards || [];
    const nearIds = new Set(
      hazards
        .filter((h) => h.corridorClearanceMm <= RISK_THRESHOLDS.cautionMm || h.lesionClearanceMm <= RISK_THRESHOLDS.cautionMm)
        .map((h) => h.id)
    );
    // Fallback to top 4 closest structures if corridor is globally wide-clear
    if (nearIds.size === 0) {
      for (const h of hazards.slice(0, 4)) nearIds.add(h.id);
    }

    const vs = {};
    const vt = {};
    for (const s of appState.atlasData?.structures || []) vs[s.id] = nearIds.has(s.id);
    for (const t of appState.atlasData?.tracts || []) vt[t.id] = nearIds.has(t.id);
    appState.visibleStructures = vs;
    appState.visibleTracts = vt;
    syncAtlasToggleInputs();
    syncRendererState();
  });

  dom['btn-case-hazards']?.addEventListener('click', () => {
    const keySet = new Set(getActiveCase()?.keyHazards || []);
    const vs = {};
    const vt = {};
    for (const s of appState.atlasData?.structures || []) vs[s.id] = keySet.has(s.id);
    for (const t of appState.atlasData?.tracts || []) vt[t.id] = keySet.has(t.id);
    appState.visibleStructures = vs;
    appState.visibleTracts = vt;
    syncAtlasToggleInputs();
    syncRendererState();
  });

  dom['tract-toggle-list']?.addEventListener('change', (e) => {
    const target = e.target;
    if (target.dataset.tractSystem) {
      const group = TRACT_SYSTEM_GROUPS.find((g) => g.key === target.dataset.tractSystem);
      if (!group) return;
      const vt = { ...appState.visibleTracts };
      for (const id of group.ids) vt[id] = target.checked;
      appState.visibleTracts = vt;
      syncAtlasToggleInputs();
      syncRendererState();
    } else if (target.dataset.tractId) {
      appState.visibleTracts = {
        ...appState.visibleTracts,
        [target.dataset.tractId]: target.checked,
      };
      syncAtlasToggleInputs();
      syncRendererState();
    }
  });

  dom['tract-toggle-list']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inspect-id]');
    if (!btn) return;
    selectAndInspectHazard(btn.dataset.inspectId, { switchToPlanner: true });
  });

  dom['structure-toggle-list']?.addEventListener('change', (e) => {
    const target = e.target;
    if (!target.dataset.structureId) return;
    appState.visibleStructures = {
      ...appState.visibleStructures,
      [target.dataset.structureId]: target.checked,
    };
    syncRendererState();
  });

  dom['structure-toggle-list']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inspect-id]');
    if (!btn) return;
    selectAndInspectHazard(btn.dataset.inspectId, { switchToPlanner: true });
  });

  // 10. Tab 2 — Custom Lesion Ellipsoid Editor
  const updateCustomLesion = (prop, axisIdx, val) => {
    if (!appState.lesion?.primaryEllipsoid) return;
    appState.isCustomLesion = true;
    appState.customNiftiInfo = null;
    appState.lesion.pointCloudMni = null;
    appState.lesion.secondaryEllipsoid = null;
    appState.lesion.primaryEllipsoid[prop][axisIdx] = val;

    if (appState.lesion.edemaEllipsoid) {
      const pe = appState.lesion.primaryEllipsoid;
      appState.lesion.edemaEllipsoid = {
        center: [...pe.center],
        radii: [pe.radii[0] + 6, pe.radii[1] + 6, pe.radii[2] + 5],
      };
    }

    if (dom['nifti-status-card']) dom['nifti-status-card'].hidden = true;
    if (dom['lesion-volume-badge']) {
      dom['lesion-volume-badge'].textContent = `${computeEllipsoidVolumeCm3(appState.lesion.primaryEllipsoid).toFixed(1)} cm³`;
    }
    dismissOptimizedCorridor();
    recomputeAndRender();
  };

  bindPairedAxisControl('slider-lesion-cx', 'input-lesion-cx', -64, 64, (v) => updateCustomLesion('center', 0, v));
  bindPairedAxisControl('slider-lesion-cy', 'input-lesion-cy', -95, 64, (v) => updateCustomLesion('center', 1, v));
  bindPairedAxisControl('slider-lesion-cz', 'input-lesion-cz', -48, 74, (v) => updateCustomLesion('center', 2, v));
  bindPairedAxisControl('slider-lesion-rx', 'input-lesion-rx', 3, 35, (v) => updateCustomLesion('radii', 0, v));
  bindPairedAxisControl('slider-lesion-ry', 'input-lesion-ry', 3, 35, (v) => updateCustomLesion('radii', 1, v));
  bindPairedAxisControl('slider-lesion-rz', 'input-lesion-rz', 3, 35, (v) => updateCustomLesion('radii', 2, v));

  dom['btn-reset-lesion']?.addEventListener('click', () => {
    const c = getActiveCase();
    if (!c) return;
    appState.lesion = cloneLesion(c.lesion);
    appState.isCustomLesion = false;
    appState.customNiftiInfo = null;
    if (dom['nifti-status-card']) dom['nifti-status-card'].hidden = true;
    syncLesionControlsUi();
    recomputeAndRender();
    renderCasePearls();
    showToast('Restored default teaching case lesion.', 'info');
  });

  // 11. Tab 2 — Local MNI-152 NIfTI Dropzone (.nii / .nii.gz)
  const dropzone = dom['nifti-dropzone'];
  const fileInput = dom['nifti-file-input'];
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handleNiftiFile(file);
      fileInput.value = '';
    });

    const setDrag = (active) => dropzone.classList.toggle('is-dragover', active);
    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      setDrag(true);
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      setDrag(true);
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      setDrag(false);
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      setDrag(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (files.length > 1) {
        const names = Array.from(files).map((f) => f.name.toLowerCase());
        if (names.some((n) => n.endsWith('.hdr')) && names.some((n) => n.endsWith('.img'))) {
          renderNiftiError('Dual-file NIfTI/Analyze (.hdr + .img) pairs are not supported. Export a single-file .nii or .nii.gz binary mask.');
          return;
        }
        showToast(`Multiple files dropped — loading first file (${files[0].name}).`, 'info');
      }
      handleNiftiFile(files[0]);
    });
  }

  dom['nifti-status-card']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nifti-action="dismiss"]');
    if (!btn || !dom['nifti-status-card']) return;
    dom['nifti-status-card'].hidden = true;
    dom['nifti-status-card'].classList.remove('is-error');
    dom['nifti-status-card'].removeAttribute('role');
  });

  // 12. Tab 3 — Case Brief Key-Hazard Chip Clicks
  dom['pearls-content']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pearl-hazard-id]');
    if (!btn) return;
    selectAndInspectHazard(btn.dataset.pearlHazardId, { switchToPlanner: true });
  });

  // 13. Tab 4 — Guided Neuroanatomy Quiz Controls
  dom['quiz-dots']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quiz-jump]');
    if (!btn || !appState.quizEngine) return;
    appState.quizEngine.selectQuestion(Number(btn.dataset.quizJump));
    syncQuizQuestionToViewport();
  });

  dom['quiz-question-card']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quiz-option]');
    if (!btn || btn.disabled || !appState.quizEngine) return;
    const optionIndex = Number(btn.dataset.quizOption);
    appState.quizEngine.submitAnswer(optionIndex);
    renderQuizUi();
  });

  dom['btn-quiz-prev']?.addEventListener('click', () => {
    if (!appState.quizEngine) return;
    appState.quizEngine.prevQuestion();
    syncQuizQuestionToViewport();
  });

  dom['btn-quiz-next']?.addEventListener('click', () => {
    if (!appState.quizEngine) return;
    appState.quizEngine.nextQuestion();
    syncQuizQuestionToViewport();
  });

  dom['btn-quiz-restart']?.addEventListener('click', () => {
    if (!appState.quizEngine) return;
    appState.quizEngine.reset();
    syncQuizQuestionToViewport();
    showToast('Quiz reset — starting from Question 1.', 'info');
  });

  // 14. 3D Canvas Keyboard Orbit/Zoom & Global Camera / Escape Shortcuts
  dom['viewport-3d']?.addEventListener('keydown', (e) => {
    if (!appState.renderer || e.ctrlKey || e.metaKey || e.altKey) return;
    const cam = appState.renderer.getCamera();
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      appState.renderer.setCamera(cam.yaw - 0.09, cam.pitch, cam.zoom);
      setActiveCameraPresetButton(null);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      appState.renderer.setCamera(cam.yaw + 0.09, cam.pitch, cam.zoom);
      setActiveCameraPresetButton(null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      appState.renderer.setCamera(cam.yaw, cam.pitch + 0.08, cam.zoom);
      setActiveCameraPresetButton(null);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      appState.renderer.setCamera(cam.yaw, cam.pitch - 0.08, cam.zoom);
      setActiveCameraPresetButton(null);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      appState.renderer.setCamera(cam.yaw, cam.pitch, cam.zoom * 1.12);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      appState.renderer.setCamera(cam.yaw, cam.pitch, cam.zoom / 1.12);
    } else if (e.key === '0' || e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      appState.renderer.setCameraPreset('oblique');
      setActiveCameraPresetButton('oblique');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (appState.legendOpen) {
        setLegendOpen(false);
      }
      if (appState.selectedHazardId) {
        appState.selectedHazardId = null;
        renderAnatomyInspector(null);
        renderHazardTable();
        syncRendererState();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;

    if (e.key === '?') {
      e.preventDefault();
      setLegendOpen(!appState.legendOpen);
      return;
    }

    const preset = CAMERA_SHORTCUT_MAP[e.key];
    if (preset && appState.renderer) {
      e.preventDefault();
      appState.renderer.setCameraPreset(preset);
      setActiveCameraPresetButton(preset);
    }
  });
}

// ============================================================================
// Application Bootstrap
// ============================================================================

async function bootstrap() {
  cacheDomElements();

  let atlasData;
  let casesData;
  try {
    const [atlasResp, casesResp] = await Promise.all([
      fetch('./data/atlas_anatomy.json'),
      fetch('./data/cases.json'),
    ]);
    if (!atlasResp.ok) throw new Error(`atlas_anatomy.json HTTP ${atlasResp.status}`);
    if (!casesResp.ok) throw new Error(`cases.json HTTP ${casesResp.status}`);
    [atlasData, casesData] = await Promise.all([atlasResp.json(), casesResp.json()]);
  } catch (err) {
    showCorsBootstrapError(err);
    return;
  }

  appState.atlasData = atlasData;
  appState.densifiedTracts = densifyAtlasTracts(atlasData, 10);
  appState.cases = Array.isArray(casesData.cases) ? casesData.cases : [];

  for (const s of atlasData.structures || []) appState.structureById.set(s.id, s);
  for (const t of atlasData.tracts || []) appState.tractById.set(t.id, t);
  for (const c of appState.cases) appState.caseById.set(c.id, c);

  resetVisibilityAll(true);
  appState.quizQuestions = Array.isArray(casesData.quiz) ? casesData.quiz : [];
  appState.quizEngine = new NeuroQuizEngine(appState.quizQuestions);

  // Initialize Pure HTML5 Canvas Multi-Viewport Renderer
  appState.renderer = new NeuroCorridorRenderer({
    canvas3d: dom['viewport-3d'],
    canvasAxial: dom['slice-axial'],
    canvasCoronal: dom['slice-coronal'],
    canvasSagittal: dom['slice-sagittal'],
    canvasProbe: dom['viewport-probe'],
    onSliceClick: handleSliceClick,
    onStructureHover: handleStructureHover,
    onStructureClick: (hit) => {
      if (hit?.id) selectAndInspectHazard(hit.id);
    },
    onCameraChange: (camInfo) => {
      if (camInfo?.userInteraction) setActiveCameraPresetButton(null);
    },
    onPresetSelect: (preset) => {
      setActiveCameraPresetButton(preset);
    },
  });
  appState.renderer.setAtlasData(appState.atlasData, appState.densifiedTracts);

  renderCaseSelector();
  renderAtlasToggles();
  renderQuizUi();
  wireAllEvents();

  if (appState.cases.length > 0) {
    loadCase(appState.cases[0].id, { flyCamera: false });
    const cam = appState.cases[0].defaultCamera;
    if (cam) {
      appState.renderer.setCamera(cam.yaw, cam.pitch, cam.zoom);
    }
  }

  // Ensure crisp initial backing store & paint across all 5 viewports
  appState.renderer.resize();
  appState.renderer.renderAll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
