/**
 * NeuroCorridor-3D — Pure HTML5 Canvas 3D Stereotactic, Tri-Planar & Probe's-Eye Renderer
 *
 * Zero-dependency ES Module exporting `NeuroCorridorRenderer` and `CAMERA_PRESETS`.
 * Implements:
 *   1. Interactive 60fps depth-sorted 3D stereotactic brain, ventricles, brainstem,
 *      eloquent structure ellipsoids, multi-streamline DTI tractography (Anatomical & DEC RGB),
 *      3D tumor core + peritumoral FLAIR halo + optional NIfTI point cloud,
 *      translucent 16-sided surgical corridor cylinder with 10 mm depth ticks & pulsing
 *      closest-approach hazard callouts, and rotating R/L/A/P/S/I orientation triad.
 *   2. Synchronized radiological orthogonal tri-planar MNI-152 slices (Axial Z, Coronal Y, Sagittal X)
 *      with exact Marching-Triangles cortical contours derived from `evaluateBrainShell`.
 *   3. Circular down-the-barrel Probe's-Eye neuronavigation view with concentric 5 mm / 10 mm
 *      safety rings and exact relative mm cross-sections.
 *
 * Educational & Research Sandbox — Not Approved for Clinical Neuronavigation.
 */

import {
  MNI_BOUNDS,
  BRAIN_CENTER,
  RISK_THRESHOLDS,
  getRiskTier,
  tangentToDecColor,
  evaluateBrainShell,
} from './geometryEngine.js';

// ---------------------------------------------------------------------------
// Public Camera Presets (Canonical ARCHITECTURE.md names + descriptive aliases)
// ---------------------------------------------------------------------------

export const CAMERA_PRESETS = Object.freeze({
  oblique: Object.freeze({ yaw: -0.68, pitch: 0.34, zoom: 1.0, label: 'Oblique 3/4' }),
  anterior: Object.freeze({ yaw: 0.0, pitch: 0.06, zoom: 1.0, label: 'Anterior' }),
  posterior: Object.freeze({ yaw: Math.PI, pitch: 0.08, zoom: 1.0, label: 'Posterior' }),
  left: Object.freeze({ yaw: -Math.PI / 2, pitch: 0.08, zoom: 1.05, label: 'Left Lateral' }),
  right: Object.freeze({ yaw: Math.PI / 2, pitch: 0.08, zoom: 1.05, label: 'Right Lateral' }),
  superior: Object.freeze({ yaw: 0.0, pitch: 1.42, zoom: 1.05, label: 'Superior' }),
  endonasal: Object.freeze({ yaw: 0.18, pitch: -0.38, zoom: 1.35, label: 'Endonasal' }),
  // Descriptive aliases
  left_lateral: Object.freeze({ yaw: -Math.PI / 2, pitch: 0.08, zoom: 1.05, label: 'Left Lateral' }),
  right_lateral: Object.freeze({ yaw: Math.PI / 2, pitch: 0.08, zoom: 1.05, label: 'Right Lateral' }),
  skull_base: Object.freeze({ yaw: 0.18, pitch: -0.38, zoom: 1.35, label: 'Skull Base' }),
  corridor_view: Object.freeze({ yaw: -0.68, pitch: 0.34, zoom: 1.28, label: 'Corridor View', dynamic: true }),
});

// ---------------------------------------------------------------------------
// Design Tokens & Constants
// ---------------------------------------------------------------------------

const LOOK_AT_DEFAULT = [0, -14, 10];
const BASE_CAMERA_DISTANCE = 310;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.6;
const PITCH_MIN = -1.48;
const PITCH_MAX = 1.48;
const PAN_MAX_MM = 85;
const NEAR_CLIP_MM = 14;

const RISK_COLORS = Object.freeze({
  safe: '#10b981',
  caution: '#f59e0b',
  critical: '#f43f5e',
});

const FONT_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_MONO = '"Cascadia Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace';

const FALLBACK_BRAINSTEM = [
  { label: 'Midbrain', center: [0, -24, -8], radii: [11, 9, 9] },
  { label: 'Pons', center: [0, -26, -24], radii: [14, 12, 11] },
  { label: 'Medulla', center: [0, -30, -44], radii: [8, 8, 12] },
];

const FALLBACK_VENTRICLES = [
  {
    id: 'lat_vent_left',
    hemisphere: 'left',
    ellipsoids: [
      { center: [-7, 14, 10], radii: [4.5, 11, 6] },
      { center: [-10, -8, 17], radii: [5, 16, 5.5] },
      { center: [-16, -34, 12], radii: [6, 12, 7] },
      { center: [-24, -18, -10], radii: [3.5, 11, 4] },
    ],
  },
  {
    id: 'lat_vent_right',
    hemisphere: 'right',
    ellipsoids: [
      { center: [7, 14, 10], radii: [4.5, 11, 6] },
      { center: [10, -8, 17], radii: [5, 16, 5.5] },
      { center: [16, -34, 12], radii: [6, 12, 7] },
      { center: [24, -18, -10], radii: [3.5, 11, 4] },
    ],
  },
  {
    id: 'third_vent',
    hemisphere: 'midline',
    ellipsoids: [{ center: [0, -14, 2], radii: [2.5, 11, 6] }],
  },
];

/**
 * Radiological orthogonal slice configurations matching ARCHITECTURE.md Section 3:
 *  - Axial (Z):    Left=+X (R) -> Right=-X (L), Top=+Y (A) -> Bottom=-Y (P)
 *  - Coronal (Y):  Left=+X (R) -> Right=-X (L), Top=+Z (S) -> Bottom=-Z (I)
 *  - Sagittal (X): Left=+Y (A) -> Right=-Y (P), Top=+Z (S) -> Bottom=-Z (I)
 */
const SLICE_CONFIGS = Object.freeze({
  axial: Object.freeze({
    plane: 'axial',
    title: 'AXIAL',
    axisLabel: 'Z',
    fixedAxis: 2,
    hAxis: 0,
    vAxis: 1,
    hSign: -1, // +X on left
    vSign: -1, // +Y at top (canvas Y grows down)
    hCenter: 0,
    vCenter: -16,
    hSpanMm: 162,
    vSpanMm: 192,
    edgeLeft: 'R',
    edgeRight: 'L',
    edgeTop: 'A',
    edgeBottom: 'P',
    accent: '#38bdf8',
  }),
  coronal: Object.freeze({
    plane: 'coronal',
    title: 'CORONAL',
    axisLabel: 'Y',
    fixedAxis: 1,
    hAxis: 0,
    vAxis: 2,
    hSign: -1, // +X on left
    vSign: -1, // +Z at top
    hCenter: 0,
    vCenter: 12,
    hSpanMm: 162,
    vSpanMm: 158,
    edgeLeft: 'R',
    edgeRight: 'L',
    edgeTop: 'S',
    edgeBottom: 'I',
    accent: '#818cf8',
  }),
  sagittal: Object.freeze({
    plane: 'sagittal',
    title: 'SAGITTAL',
    axisLabel: 'X',
    fixedAxis: 0,
    hAxis: 1,
    vAxis: 2,
    hSign: -1, // +Y (A) on left -> -Y (P) on right
    vSign: -1, // +Z at top
    hCenter: -16,
    vCenter: 12,
    hSpanMm: 192,
    vSpanMm: 158,
    edgeLeft: 'A',
    edgeRight: 'P',
    edgeTop: 'S',
    edgeBottom: 'I',
    accent: '#34d399',
  }),
});

// ---------------------------------------------------------------------------
// Math & Color Utilities
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function wrapAngleDelta(fromRad, toRad) {
  let d = (toRad - fromRad) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function v3Sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function v3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function v3Scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function v3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function v3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function v3Len(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function v3Norm(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function formatSignedMm(val, decimals = 0) {
  const rounded = Number.isFinite(val) ? val : 0;
  const fixed = Math.abs(rounded) < 0.05 && decimals === 0 ? '0' : rounded.toFixed(decimals);
  if (fixed === '-0' || fixed === '-0.0') return '0';
  return rounded > 0 && !fixed.startsWith('+') ? `+${fixed}` : fixed;
}

const _hexCache = new Map();

function parseHexRgb(hex) {
  if (!hex || typeof hex !== 'string') return [148, 163, 184];
  const cached = _hexCache.get(hex);
  if (cached) return cached;
  let clean = hex.trim();
  if (clean.startsWith('#')) clean = clean.slice(1);
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  if (clean.length !== 6) return [148, 163, 184];
  const n = parseInt(clean, 16);
  if (!Number.isFinite(n)) return [148, 163, 184];
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  _hexCache.set(hex, rgb);
  return rgb;
}

function hexToRgba(hex, alpha) {
  const [r, g, b] = parseHexRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1).toFixed(3)})`;
}

function brightenHex(hex, amount = 0.35, alpha = 1) {
  const [r, g, b] = parseHexRgb(hex);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `rgba(${nr},${ng},${nb},${clamp(alpha, 0, 1).toFixed(3)})`;
}

function darkenHex(hex, amount = 0.45, alpha = 1) {
  const [r, g, b] = parseHexRgb(hex);
  const nr = Math.round(r * (1 - amount));
  const ng = Math.round(g * (1 - amount));
  const nb = Math.round(b * (1 - amount));
  return `rgba(${nr},${ng},${nb},${clamp(alpha, 0, 1).toFixed(3)})`;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function pointToSegmentDist2D(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------------------------------------------------------------------------
// Analytical Brain Shell Mesh & Exact Marching-Triangles Slicer
// ---------------------------------------------------------------------------

/**
 * Builds a watertight manifold spherical triangle mesh evaluated via
 * `evaluateBrainShell(ux, uy, uz)` for exact 2D tri-planar contour slicing.
 */
function buildWatertightBrainMesh(latRings = 28, lonCols = 56) {
  const vertices = [];
  const southIdx = 0;
  vertices.push(evaluateBrainShell(0, 0, -1));

  for (let i = 1; i < latRings; i++) {
    const phi = -Math.PI / 2 + (i / latRings) * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    for (let j = 0; j < lonCols; j++) {
      const theta = (j / lonCols) * Math.PI * 2;
      const ux = cosP * Math.sin(theta);
      const uy = cosP * Math.cos(theta);
      const uz = sinP;
      vertices.push(evaluateBrainShell(ux, uy, uz));
    }
  }

  const northIdx = vertices.length;
  vertices.push(evaluateBrainShell(0, 0, 1));

  const ringIdx = (i, j) => 1 + (i - 1) * lonCols + ((j + lonCols) % lonCols);
  const triangles = [];

  // South pole cap
  for (let j = 0; j < lonCols; j++) {
    triangles.push([southIdx, ringIdx(1, j + 1), ringIdx(1, j)]);
  }
  // Middle bands
  for (let i = 1; i < latRings - 1; i++) {
    for (let j = 0; j < lonCols; j++) {
      const v00 = ringIdx(i, j);
      const v01 = ringIdx(i, j + 1);
      const v10 = ringIdx(i + 1, j);
      const v11 = ringIdx(i + 1, j + 1);
      triangles.push([v00, v01, v11]);
      triangles.push([v00, v11, v10]);
    }
  }
  // North pole cap
  for (let j = 0; j < lonCols; j++) {
    triangles.push([ringIdx(latRings - 1, j), ringIdx(latRings - 1, j + 1), northIdx]);
  }

  return { vertices, triangles };
}

/**
 * Extracts exact closed 2D contour loops where a watertight mesh intersects
 * the axis-aligned plane `p[axisIndex] === planeCoord`.
 */
function sliceWatertightMesh(mesh, axisIndex, planeCoord) {
  const { vertices, triangles } = mesh;
  const nVerts = vertices.length;
  const dists = new Float64Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const d = vertices[i][axisIndex] - planeCoord;
    // Symbolic perturbation eliminates vertex-on-plane degeneracy cleanly
    dists[i] = d === 0 ? 1e-5 : d;
  }

  const edgePoints = new Map();
  const adjacency = new Map();

  const getEdgePoint = (a, b) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * 65536 + hi;
    if (!edgePoints.has(key)) {
      const da = dists[lo];
      const db = dists[hi];
      const t = da / (da - db);
      const pa = vertices[lo];
      const pb = vertices[hi];
      edgePoints.set(key, [
        pa[0] + t * (pb[0] - pa[0]),
        pa[1] + t * (pb[1] - pa[1]),
        pa[2] + t * (pb[2] - pa[2]),
      ]);
    }
    return key;
  };

  for (let t = 0; t < triangles.length; t++) {
    const [i0, i1, i2] = triangles[t];
    const d0 = dists[i0];
    const d1 = dists[i1];
    const d2 = dists[i2];
    const s0 = d0 > 0;
    const s1 = d1 > 0;
    const s2 = d2 > 0;
    if (s0 === s1 && s1 === s2) continue;

    let kA;
    let kB;
    if (s0 !== s1 && s0 !== s2) {
      kA = getEdgePoint(i0, i1);
      kB = getEdgePoint(i0, i2);
    } else if (s1 !== s0 && s1 !== s2) {
      kA = getEdgePoint(i1, i0);
      kB = getEdgePoint(i1, i2);
    } else {
      kA = getEdgePoint(i2, i0);
      kB = getEdgePoint(i2, i1);
    }

    if (kA === kB) continue;
    let listA = adjacency.get(kA);
    if (!listA) {
      listA = [];
      adjacency.set(kA, listA);
    }
    listA.push(kB);

    let listB = adjacency.get(kB);
    if (!listB) {
      listB = [];
      adjacency.set(kB, listB);
    }
    listB.push(kA);
  }

  const visited = new Set();
  const loops = [];

  for (const startKey of adjacency.keys()) {
    if (visited.has(startKey)) continue;
    const loop = [];
    let curr = startKey;
    let prev = -1;
    let guard = 0;

    while (curr !== undefined && guard < 2048) {
      guard++;
      visited.add(curr);
      loop.push(edgePoints.get(curr));
      const neighbors = adjacency.get(curr);
      if (!neighbors || neighbors.length === 0) break;
      let next;
      for (let i = 0; i < neighbors.length; i++) {
        const cand = neighbors[i];
        if (cand !== prev && !visited.has(cand)) {
          next = cand;
          break;
        }
      }
      prev = curr;
      curr = next;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

/**
 * Builds lightweight 3D rendering primitives (translucent Fresnel glass quads +
 * hemispheric contour rings/ribs + midline longitudinal fissure curve) from `evaluateBrainShell`.
 */
function buildBrain3DPrimitives() {
  const latSteps = 11;
  const lonSteps = 26;
  const grid = [];

  for (let i = 0; i <= latSteps; i++) {
    const phi = lerp(-0.44 * Math.PI, 0.46 * Math.PI, i / latSteps);
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const row = [];
    for (let j = 0; j < lonSteps; j++) {
      const theta = (j / lonSteps) * Math.PI * 2;
      row.push(evaluateBrainShell(cosP * Math.sin(theta), cosP * Math.cos(theta), sinP));
    }
    grid.push(row);
  }

  const quads = [];
  for (let i = 0; i < latSteps; i++) {
    for (let j = 0; j < lonSteps; j++) {
      const jn = (j + 1) % lonSteps;
      const p00 = grid[i][j];
      const p10 = grid[i + 1][j];
      const p11 = grid[i + 1][jn];
      const p01 = grid[i][jn];
      const center = [
        (p00[0] + p10[0] + p11[0] + p01[0]) * 0.25,
        (p00[1] + p10[1] + p11[1] + p01[1]) * 0.25,
        (p00[2] + p10[2] + p11[2] + p01[2]) * 0.25,
      ];
      let normal = v3Norm(v3Cross(v3Sub(p01, p00), v3Sub(p10, p00)));
      if (v3Dot(normal, v3Sub(center, BRAIN_CENTER)) < 0) {
        normal = v3Scale(normal, -1);
      }
      quads.push({ p00, p10, p11, p01, center, normal });
    }
  }

  // Contour rib polylines (2-segment mini-arcs for clean depth sorting & high performance)
  const ribArcs = [];

  // Latitude cortical rings
  const latRingIndices = [1, 3, 5, 7, 9, 10];
  for (const rIdx of latRingIndices) {
    const row = grid[rIdx];
    const isEquator = rIdx === 5;
    for (let j = 0; j < lonSteps; j += 2) {
      const p0 = row[j];
      const p1 = row[(j + 1) % lonSteps];
      const p2 = row[(j + 2) % lonSteps];
      ribArcs.push({ p0, p1, p2, mid: p1, emphasis: isEquator ? 1.15 : 0.85, kind: 'lat' });
    }
  }

  // Hemispheric meridian ribs (including exact midline fissure at theta=0 and theta=PI)
  const meridianCount = 12;
  for (let m = 0; m < meridianCount; m++) {
    const theta = (m / meridianCount) * Math.PI * 2;
    const isMidline = m === 0 || m === meridianCount / 2;
    const pts = [];
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const phi = lerp(-0.42 * Math.PI, 0.47 * Math.PI, s / steps);
      pts.push(evaluateBrainShell(Math.cos(phi) * Math.sin(theta), Math.cos(phi) * Math.cos(theta), Math.sin(phi)));
    }
    for (let s = 0; s < steps; s += 2) {
      const p0 = pts[s];
      const p1 = pts[Math.min(s + 1, steps)];
      const p2 = pts[Math.min(s + 2, steps)];
      ribArcs.push({
        p0,
        p1,
        p2,
        mid: p1,
        emphasis: isMidline ? 1.55 : 0.82,
        kind: isMidline ? 'fissure' : 'lon',
      });
    }
  }

  return { quads, ribArcs };
}

// ---------------------------------------------------------------------------
// 3D Camera & Projection Math
// ---------------------------------------------------------------------------

function computeCameraBasis(camera, width, height) {
  const { yaw, pitch, zoom, panOffset } = camera;
  const lookAt = [
    LOOK_AT_DEFAULT[0] + panOffset[0],
    LOOK_AT_DEFAULT[1] + panOffset[1],
    LOOK_AT_DEFAULT[2] + panOffset[2],
  ];
  const dist = BASE_CAMERA_DISTANCE / zoom;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  // Exact eye formula from ARCHITECTURE.md Section 6
  const eye = [
    lookAt[0] + dist * cosP * sinY,
    lookAt[1] + dist * cosP * cosY,
    lookAt[2] + dist * sinP,
  ];

  // Orthonormal camera frame (right-handed, radiological anterior orientation)
  const fwd = [-cosP * sinY, -cosP * cosY, -sinP];
  const right = [-cosY, sinY, 0];
  const up = [-sinP * sinY, -sinP * cosY, cosP];

  const minDim = Math.min(width, height);
  const focal = minDim * 1.08;
  const cx = width * 0.5;
  const cy = height * 0.5;

  // Directional camera-locked key light (upper-left-front)
  const lightDir = v3Norm([
    -right[0] * 0.42 + up[0] * 0.62 - fwd[0] * 0.66,
    -right[1] * 0.42 + up[1] * 0.62 - fwd[1] * 0.66,
    -right[2] * 0.42 + up[2] * 0.62 - fwd[2] * 0.66,
  ]);

  return { eye, lookAt, fwd, right, up, focal, cx, cy, dist, lightDir };
}

function projectPoint(p, cam) {
  const dx = p[0] - cam.eye[0];
  const dy = p[1] - cam.eye[1];
  const dz = p[2] - cam.eye[2];
  const z = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (z <= NEAR_CLIP_MM) return null;
  const xCam = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const yCam = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const scale = cam.focal / z;
  return {
    sx: cam.cx + xCam * scale,
    sy: cam.cy - yCam * scale,
    z,
    scale,
  };
}

/**
 * Exact 2D projected silhouette ellipse of an axis-aligned 3D ellipsoid
 * `{ center, radii }` under camera basis `cam`.
 */
function projectEllipsoid2D(ellipsoid, cam) {
  const centerProj = projectPoint(ellipsoid.center, cam);
  if (!centerProj) return null;

  const [rx, ry, rz] = ellipsoid.radii;
  const [ux, uy, uz] = cam.right;
  const [vx, vy, vz] = cam.up;

  const m00 = rx * rx * ux * ux + ry * ry * uy * uy + rz * rz * uz * uz;
  const m11 = rx * rx * vx * vx + ry * ry * vy * vy + rz * rz * vz * vz;
  const m01 = -(rx * rx * ux * vx + ry * ry * uy * vy + rz * rz * uz * vz);

  const tr = m00 + m11;
  const diff = m00 - m11;
  const disc = Math.sqrt(diff * diff + 4 * m01 * m01);
  const lam1 = Math.max(0.25, 0.5 * (tr + disc));
  const lam2 = Math.max(0.25, 0.5 * (tr - disc));
  const angle = 0.5 * Math.atan2(2 * m01, diff);

  return {
    sx: centerProj.sx,
    sy: centerProj.sy,
    z: centerProj.z,
    scale: centerProj.scale,
    rxPx: Math.sqrt(lam1) * centerProj.scale,
    ryPx: Math.sqrt(lam2) * centerProj.scale,
    angle,
  };
}

function buildFallbackCorridorFrame(entryMni, targetMni) {
  const delta = v3Sub(targetMni, entryMni);
  const length = v3Len(delta);
  const axis = length > 1e-6 ? v3Scale(delta, 1 / length) : [0, 0, -1];
  const ref = Math.abs(axis[2]) < 0.92 ? [0, 0, 1] : [0, 1, 0];
  const uAxis = v3Norm(v3Cross(axis, ref));
  const vAxis = v3Norm(v3Cross(uAxis, axis));
  return { origin: entryMni, target: targetMni, axis, uAxis, vAxis, length };
}

// ---------------------------------------------------------------------------
// Main Renderer Class
// ---------------------------------------------------------------------------

export class NeuroCorridorRenderer {
  /**
   * @param {object} config
   * @param {HTMLCanvasElement} [config.canvas3d]
   * @param {HTMLCanvasElement} [config.canvasAxial]
   * @param {HTMLCanvasElement} [config.canvasCoronal]
   * @param {HTMLCanvasElement} [config.canvasSagittal]
   * @param {HTMLCanvasElement} [config.canvasProbe]
   * @param {HTMLCanvasElement} [config.probeCanvas] Alias for canvasProbe
   * @param {Function|null} [config.onSliceClick]
   * @param {Function|null} [config.onStructureHover]
   * @param {Function|null} [config.onCameraChange]
   */
  constructor(config = {}) {
    const {
      canvas3d = null,
      canvasAxial = null,
      canvasCoronal = null,
      canvasSagittal = null,
      canvasProbe = null,
      probeCanvas = null,
      onSliceClick = null,
      onStructureHover = null,
      onCameraChange = null,
    } = config;

    this.canvases = {
      view3d: canvas3d,
      axial: canvasAxial,
      coronal: canvasCoronal,
      sagittal: canvasSagittal,
      probe: canvasProbe || probeCanvas,
    };

    this.ctxs = {
      view3d: this.canvases.view3d ? this.canvases.view3d.getContext('2d') : null,
      axial: this.canvases.axial ? this.canvases.axial.getContext('2d') : null,
      coronal: this.canvases.coronal ? this.canvases.coronal.getContext('2d') : null,
      sagittal: this.canvases.sagittal ? this.canvases.sagittal.getContext('2d') : null,
      probe: this.canvases.probe ? this.canvases.probe.getContext('2d') : null,
    };

    this.sizes = {
      view3d: { w: 0, h: 0, dpr: 1 },
      axial: { w: 0, h: 0, dpr: 1 },
      coronal: { w: 0, h: 0, dpr: 1 },
      sagittal: { w: 0, h: 0, dpr: 1 },
      probe: { w: 0, h: 0, dpr: 1 },
    };

    this.callbacks = {
      onSliceClick: typeof onSliceClick === 'function' ? onSliceClick : null,
      onStructureHover: typeof onStructureHover === 'function' ? onStructureHover : null,
      onCameraChange: typeof onCameraChange === 'function' ? onCameraChange : null,
    };

    this.atlasData = null;
    this.densifiedTracts = [];
    this._tractCache = [];

    // Canonical renderState matching ARCHITECTURE.md Section 6
    this.state = {
      lesion: null,
      corridor: null,
      ghostCorridor: null,
      analysis: null,
      sliceMni: [0, -14, 10],
      probeDepthFraction: 0.5,
      tractColorMode: 'anatomical',
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

    // Orbit / zoom / pan camera state
    this.camera = {
      yaw: CAMERA_PRESETS.oblique.yaw,
      pitch: CAMERA_PRESETS.oblique.pitch,
      zoom: CAMERA_PRESETS.oblique.zoom,
      panOffset: [0, 0, 0],
    };

    this._cameraAnim = null;
    this._hoveredItem = null;
    this._hitTargets3D = [];
    this._sliceTransforms = {};

    // Dirty flags & RAF handle
    this._dirty = { view3d: true, slices: true, probe: true };
    this._rafId = null;
    this._destroyed = false;
    this._pulsePhase = 0;

    // Precompute analytical brain shell mesh & slice contour cache
    this._brain3D = buildBrain3DPrimitives();
    this._brainSliceMesh = buildWatertightBrainMesh(28, 56);
    this._sliceContourCache = new Map();

    // Pointer / touch tracking for 3D canvas & slice canvases
    this._pointers = new Map();
    this._dragMode = null; // 'orbit' | 'pan' | 'pinch'
    this._lastPointerPos = null;
    this._lastPinchDist = 0;
    this._lastPinchMid = null;
    this._activeSliceDrag = null;
    this._eventCleanups = [];
    this._resizeObserver = null;

    this._setupResizeObserver();
    this._bindEvents();
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  setAtlasData(atlasData, densifiedTracts = []) {
    this.atlasData = atlasData || null;
    this.densifiedTracts = Array.isArray(densifiedTracts) ? densifiedTracts : [];
    this._rebuildTractCache();
    this._markAllDirty();
    this._scheduleFrame();
  }

  setState(partialState) {
    if (!partialState || typeof partialState !== 'object') return;
    const prev = this.state;

    // Track which viewports actually need redrawing
    let slicesDirty = false;
    let probeDirty = false;

    if (
      partialState.lesion !== undefined ||
      partialState.corridor !== undefined ||
      partialState.ghostCorridor !== undefined ||
      partialState.analysis !== undefined ||
      partialState.tractColorMode !== undefined ||
      partialState.visibleStructures !== undefined ||
      partialState.visibleTracts !== undefined ||
      partialState.highlightIds !== undefined ||
      partialState.selectedHazardId !== undefined ||
      partialState.showVentricles !== undefined ||
      partialState.showEdema !== undefined ||
      partialState.showLabels !== undefined ||
      partialState.showCorridor !== undefined ||
      partialState.showBrainShell !== undefined
    ) {
      slicesDirty = true;
      probeDirty = true;
    }

    if (partialState.sliceMni !== undefined) {
      slicesDirty = true;
    }
    if (partialState.probeDepthFraction !== undefined) {
      probeDirty = true;
    }

    this.state = {
      ...prev,
      ...partialState,
      sliceMni: Array.isArray(partialState.sliceMni)
        ? [
            Number(partialState.sliceMni[0]) || 0,
            Number(partialState.sliceMni[1]) || 0,
            Number(partialState.sliceMni[2]) || 0,
          ]
        : prev.sliceMni,
      probeDepthFraction:
        partialState.probeDepthFraction !== undefined
          ? clamp(Number(partialState.probeDepthFraction) || 0, 0, 1)
          : prev.probeDepthFraction,
      brainOpacity:
        partialState.brainOpacity !== undefined
          ? clamp(Number(partialState.brainOpacity), 0.05, 0.6)
          : prev.brainOpacity,
    };

    this._dirty.view3d = true;
    if (slicesDirty) this._dirty.slices = true;
    if (probeDirty) this._dirty.probe = true;
    this._scheduleFrame();
  }

  setCamera(yaw, pitch, zoom) {
    this._cameraAnim = null;
    if (Number.isFinite(yaw)) this.camera.yaw = yaw;
    if (Number.isFinite(pitch)) this.camera.pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
    if (Number.isFinite(zoom)) this.camera.zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    this._dirty.view3d = true;
    this._emitCameraChange();
    this._scheduleFrame();
  }

  flyToCamera(yaw, pitch, zoom, durationMs = 420) {
    const targetYaw = Number.isFinite(yaw) ? yaw : this.camera.yaw;
    const targetPitch = clamp(Number.isFinite(pitch) ? pitch : this.camera.pitch, PITCH_MIN, PITCH_MAX);
    const targetZoom = clamp(Number.isFinite(zoom) ? zoom : this.camera.zoom, ZOOM_MIN, ZOOM_MAX);

    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      this.camera.panOffset = [0, 0, 0];
      this.setCamera(targetYaw, targetPitch, targetZoom);
      return;
    }

    const startYaw = this.camera.yaw;
    const deltaYaw = wrapAngleDelta(startYaw, targetYaw);

    this._cameraAnim = {
      startTime: performance.now(),
      durationMs,
      fromYaw: startYaw,
      deltaYaw,
      fromPitch: this.camera.pitch,
      toPitch: targetPitch,
      fromZoom: this.camera.zoom,
      toZoom: targetZoom,
      fromPan: [...this.camera.panOffset],
      toPan: [0, 0, 0],
    };

    this._dirty.view3d = true;
    this._scheduleFrame();
  }

  setCameraPreset(presetName) {
    const key = String(presetName || 'oblique').toLowerCase().trim();

    if (key === 'corridor_view' && this.state.corridor) {
      const { entryMni, targetMni } = this.state.corridor;
      if (Array.isArray(entryMni) && Array.isArray(targetMni)) {
        const toEntry = v3Sub(entryMni, targetMni);
        const len = v3Len(toEntry);
        if (len > 1e-3) {
          const d = v3Scale(toEntry, 1 / len);
          // Slight oblique offset (~10 deg) so the 3D tube, ticks, and depth cues stay readable
          const yaw = Math.atan2(d[0], d[1]) + 0.16;
          const pitch = clamp(Math.asin(clamp(d[2], -0.98, 0.98)) + 0.12, PITCH_MIN, PITCH_MAX);
          this.flyToCamera(yaw, pitch, 1.3, 460);
          return;
        }
      }
    }

    const preset = CAMERA_PRESETS[key] || CAMERA_PRESETS.oblique;
    this.flyToCamera(preset.yaw, preset.pitch, preset.zoom, 420);
  }

  getCamera() {
    return {
      yaw: this.camera.yaw,
      pitch: this.camera.pitch,
      zoom: this.camera.zoom,
    };
  }

  resize() {
    if (this._destroyed) return;
    let changed = false;
    for (const key of Object.keys(this.canvases)) {
      if (this._syncCanvasSize(key)) {
        changed = true;
      }
    }
    if (changed || this._dirty.view3d || this._dirty.slices || this._dirty.probe) {
      this._markAllDirty();
      this._scheduleFrame();
    }
  }

  renderAll() {
    if (this._destroyed) return;
    for (const key of Object.keys(this.canvases)) {
      this._syncCanvasSize(key);
    }
    this._pulsePhase = performance.now() * 0.004;
    this._render3D();
    this._renderSlice('axial');
    this._renderSlice('coronal');
    this._renderSlice('sagittal');
    this._renderProbeEye();
    this._dirty.view3d = false;
    this._dirty.slices = false;
    this._dirty.probe = false;
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    for (const cleanup of this._eventCleanups) {
      try {
        cleanup();
      } catch (_) {
        // Ignore cleanup errors on detached nodes
      }
    }
    this._eventCleanups = [];
    this._pointers.clear();
    this._sliceContourCache.clear();
  }

  // -------------------------------------------------------------------------
  // Internal Caching, Sizing & Animation Loop
  // -------------------------------------------------------------------------

  _rebuildTractCache() {
    this._tractCache = this.densifiedTracts.map((tract) => {
      const streamlines = Array.isArray(tract.streamlines) ? tract.streamlines : [];
      const tangents = Array.isArray(tract.tangents) ? tract.tangents : [];
      const preparedLines = streamlines.map((pts, sIdx) => {
        const lineTangents = tangents[sIdx] || null;
        const decColors = new Array(pts.length);
        for (let i = 0; i < pts.length; i++) {
          let tan;
          if (lineTangents && lineTangents[i]) {
            tan = lineTangents[i];
          } else {
            const pPrev = pts[Math.max(0, i - 1)];
            const pNext = pts[Math.min(pts.length - 1, i + 1)];
            tan = v3Norm(v3Sub(pNext, pPrev));
          }
          decColors[i] = tangentToDecColor(tan);
        }
        return { pts, decColors };
      });
      return { tract, preparedLines };
    });
  }

  _setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._destroyed) this.resize();
    });
    for (const canvas of Object.values(this.canvases)) {
      if (canvas) {
        this._resizeObserver.observe(canvas);
        if (canvas.parentElement) {
          this._resizeObserver.observe(canvas.parentElement);
        }
      }
    }
  }

  _syncCanvasSize(key) {
    const canvas = this.canvases[key];
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w <= 2 || h <= 2) return false;

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    const prev = this.sizes[key];

    if (canvas.width !== targetW || canvas.height !== targetH || prev.w !== w || prev.h !== h || prev.dpr !== dpr) {
      canvas.width = targetW;
      canvas.height = targetH;
      this.sizes[key] = { w, h, dpr };
      return true;
    }
    return false;
  }

  _markAllDirty() {
    this._dirty.view3d = true;
    this._dirty.slices = true;
    this._dirty.probe = true;
  }

  _needsContinuousAnimation() {
    if (this._cameraAnim !== null) return true;
    const warnings = this.state.analysis?.proximityWarnings;
    if (this.state.showCorridor && this.state.corridor && Array.isArray(warnings) && warnings.length > 0) {
      return true;
    }
    return false;
  }

  _scheduleFrame() {
    if (this._destroyed || this._rafId !== null) return;
    this._rafId = requestAnimationFrame((now) => this._tick(now));
  }

  _tick(now) {
    this._rafId = null;
    if (this._destroyed) return;

    this._pulsePhase = now * 0.0045;

    // Step smooth camera flight
    if (this._cameraAnim) {
      const a = this._cameraAnim;
      const rawT = clamp((now - a.startTime) / a.durationMs, 0, 1);
      const t = easeInOutCubic(rawT);
      this.camera.yaw = a.fromYaw + a.deltaYaw * t;
      this.camera.pitch = lerp(a.fromPitch, a.toPitch, t);
      this.camera.zoom = lerp(a.fromZoom, a.toZoom, t);
      this.camera.panOffset = [
        lerp(a.fromPan[0], a.toPan[0], t),
        lerp(a.fromPan[1], a.toPan[1], t),
        lerp(a.fromPan[2], a.toPan[2], t),
      ];
      this._dirty.view3d = true;
      this._emitCameraChange();
      if (rawT >= 1) {
        this._cameraAnim = null;
      }
    }

    const pulsing =
      this.state.showCorridor &&
      this.state.corridor &&
      Array.isArray(this.state.analysis?.proximityWarnings) &&
      this.state.analysis.proximityWarnings.length > 0;

    if (this._dirty.view3d || pulsing) {
      this._render3D();
      this._dirty.view3d = false;
    }
    if (this._dirty.slices) {
      this._renderSlice('axial');
      this._renderSlice('coronal');
      this._renderSlice('sagittal');
      this._dirty.slices = false;
    }
    if (this._dirty.probe) {
      this._renderProbeEye();
      this._dirty.probe = false;
    }

    if (this._needsContinuousAnimation() || this._dirty.view3d || this._dirty.slices || this._dirty.probe) {
      this._scheduleFrame();
    }
  }

  _emitCameraChange() {
    if (this.callbacks.onCameraChange) {
      this.callbacks.onCameraChange(this.getCamera());
    }
  }

  _getHighlightSet() {
    const h = this.state.highlightIds;
    if (h instanceof Set) return h;
    if (Array.isArray(h)) return new Set(h);
    return new Set();
  }

  _isStructureVisible(id) {
    return this.state.visibleStructures?.[id] !== false;
  }

  _isTractVisible(id) {
    return this.state.visibleTracts?.[id] !== false;
  }

  _getHazardLookup() {
    const map = new Map();
    const list = this.state.analysis?.sortedHazards;
    if (Array.isArray(list)) {
      for (const h of list) {
        map.set(h.id, h);
      }
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Event Binding & Pointer Interactions
  // -------------------------------------------------------------------------

  _listen(target, event, handler, options) {
    if (!target) return;
    target.addEventListener(event, handler, options);
    this._eventCleanups.push(() => target.removeEventListener(event, handler, options));
  }

  _bindEvents() {
    const c3d = this.canvases.view3d;
    if (c3d) {
      c3d.style.touchAction = 'none';
      this._listen(c3d, 'pointerdown', (e) => this._on3DPointerDown(e));
      this._listen(c3d, 'pointermove', (e) => this._on3DPointerMove(e));
      this._listen(c3d, 'pointerup', (e) => this._on3DPointerUp(e));
      this._listen(c3d, 'pointercancel', (e) => this._on3DPointerUp(e));
      this._listen(c3d, 'pointerleave', () => this._on3DPointerLeave());
      this._listen(c3d, 'wheel', (e) => this._on3DWheel(e), { passive: false });
      this._listen(c3d, 'dblclick', () => this.setCameraPreset('oblique'));
      this._listen(c3d, 'contextmenu', (e) => e.preventDefault());
    }

    for (const plane of ['axial', 'coronal', 'sagittal']) {
      this._bindSliceEvents(plane);
    }
  }

  _on3DPointerDown(e) {
    const c3d = this.canvases.view3d;
    if (!c3d) return;
    this._cameraAnim = null;
    try {
      c3d.setPointerCapture(e.pointerId);
    } catch (_) {
      // Ignore synthetic events without pointer capture
    }

    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 2) {
      const pts = Array.from(this._pointers.values());
      this._dragMode = 'pinch';
      this._lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this._lastPinchMid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    } else if (this._pointers.size === 1) {
      this._dragMode = e.button === 1 || e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      this._lastPointerPos = { x: e.clientX, y: e.clientY };
      c3d.style.cursor = 'grabbing';
    }

    // Clear hover tooltip while dragging
    if (this._hoveredItem) {
      this._hoveredItem = null;
      if (this.callbacks.onStructureHover) this.callbacks.onStructureHover(null);
      this._dirty.view3d = true;
      this._scheduleFrame();
    }
  }

  _on3DPointerMove(e) {
    const c3d = this.canvases.view3d;
    if (!c3d) return;

    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._dragMode === 'pinch' && this._pointers.size === 2) {
        const pts = Array.from(this._pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };

        if (this._lastPinchDist > 4 && dist > 4) {
          const factor = dist / this._lastPinchDist;
          this.camera.zoom = clamp(this.camera.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        }
        if (this._lastPinchMid) {
          this._applyScreenPan(mid.x - this._lastPinchMid.x, mid.y - this._lastPinchMid.y);
        }
        this._lastPinchDist = dist;
        this._lastPinchMid = mid;
        this._dirty.view3d = true;
        this._emitCameraChange();
        this._scheduleFrame();
        return;
      }

      if (this._lastPointerPos && this._pointers.size === 1) {
        const dx = e.clientX - this._lastPointerPos.x;
        const dy = e.clientY - this._lastPointerPos.y;
        this._lastPointerPos = { x: e.clientX, y: e.clientY };

        if (this._dragMode === 'pan') {
          this._applyScreenPan(dx, dy);
        } else {
          this.camera.yaw += dx * 0.0075;
          this.camera.pitch = clamp(this.camera.pitch + dy * 0.0075, PITCH_MIN, PITCH_MAX);
        }

        this._dirty.view3d = true;
        this._emitCameraChange();
        this._scheduleFrame();
        return;
      }
    }

    // Idle hover hit-testing
    const rect = c3d.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = this._hitTest3D(sx, sy);

    const prevId = this._hoveredItem ? this._hoveredItem.id : null;
    const nextId = hit ? hit.id : null;
    this._hoveredItem = hit;

    if (hit) {
      c3d.style.cursor = 'pointer';
      if (this.callbacks.onStructureHover) {
        this.callbacks.onStructureHover({
          id: hit.id,
          name: hit.name,
          shortName: hit.shortName,
          kind: hit.kind,
          category: hit.category,
          color: hit.color,
          clearanceMm: hit.clearanceMm,
          riskTier: hit.riskTier,
          screenX: sx,
          screenY: sy,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }
    } else {
      c3d.style.cursor = 'grab';
      if (prevId !== null && this.callbacks.onStructureHover) {
        this.callbacks.onStructureHover(null);
      }
    }

    if (prevId !== nextId) {
      this._dirty.view3d = true;
      this._scheduleFrame();
    }
  }

  _on3DPointerUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size === 0) {
      this._dragMode = null;
      this._lastPointerPos = null;
      this._lastPinchDist = 0;
      this._lastPinchMid = null;
      if (this.canvases.view3d) this.canvases.view3d.style.cursor = 'grab';
    } else if (this._pointers.size === 1) {
      const remaining = Array.from(this._pointers.values())[0];
      this._dragMode = 'orbit';
      this._lastPointerPos = { x: remaining.x, y: remaining.y };
    }
  }

  _on3DPointerLeave() {
    if (this._hoveredItem) {
      this._hoveredItem = null;
      if (this.callbacks.onStructureHover) {
        this.callbacks.onStructureHover(null);
      }
      this._dirty.view3d = true;
      this._scheduleFrame();
    }
  }

  _on3DWheel(e) {
    e.preventDefault();
    this._cameraAnim = null;
    const delta = clamp(e.deltaY, -120, 120);
    const zoomFactor = Math.exp(-delta * 0.0014);
    this.camera.zoom = clamp(this.camera.zoom * zoomFactor, ZOOM_MIN, ZOOM_MAX);
    this._dirty.view3d = true;
    this._emitCameraChange();
    this._scheduleFrame();
  }

  _applyScreenPan(dxPx, dyPx) {
    const { w, h } = this.sizes.view3d;
    if (w <= 2 || h <= 2) return;
    const cam = computeCameraBasis(this.camera, w, h);
    const mmPerPx = cam.dist / cam.focal;
    const pan = this.camera.panOffset;
    const nextX = pan[0] - dxPx * mmPerPx * cam.right[0] + dyPx * mmPerPx * cam.up[0];
    const nextY = pan[1] - dxPx * mmPerPx * cam.right[1] + dyPx * mmPerPx * cam.up[1];
    const nextZ = pan[2] - dxPx * mmPerPx * cam.right[2] + dyPx * mmPerPx * cam.up[2];
    this.camera.panOffset = [
      clamp(nextX, -PAN_MAX_MM, PAN_MAX_MM),
      clamp(nextY, -PAN_MAX_MM, PAN_MAX_MM),
      clamp(nextZ, -PAN_MAX_MM, PAN_MAX_MM),
    ];
  }

  _hitTest3D(sx, sy) {
    let best = null;
    let bestDepth = Infinity;

    for (let i = 0; i < this._hitTargets3D.length; i++) {
      const target = this._hitTargets3D[i];
      if (target.shape === 'ellipse') {
        const dx = sx - target.sx;
        const dy = sy - target.sy;
        const cosA = Math.cos(-target.angle);
        const sinA = Math.sin(-target.angle);
        const lx = dx * cosA - dy * sinA;
        const ly = dx * sinA + dy * cosA;
        const rx = Math.max(target.rxPx, 7);
        const ry = Math.max(target.ryPx, 7);
        if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1.0 && target.depth < bestDepth) {
          bestDepth = target.depth;
          best = target;
        }
      } else if (target.shape === 'segment') {
        const d = pointToSegmentDist2D(sx, sy, target.x0, target.y0, target.x1, target.y1);
        if (d <= 6.5 && target.depth < bestDepth) {
          bestDepth = target.depth;
          best = target;
        }
      }
    }

    return best;
  }

  _bindSliceEvents(plane) {
    const canvas = this.canvases[plane];
    if (!canvas) return;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';

    const emitFromEvent = (e) => {
      if (!this.callbacks.onSliceClick) return;
      const tr = this._sliceTransforms[plane];
      if (!tr) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const mniPoint = this._screenToSliceMni(plane, sx, sy, tr);
      if (mniPoint) {
        this.callbacks.onSliceClick({ plane, mniPoint, shiftKey: Boolean(e.shiftKey) });
      }
    };

    this._listen(canvas, 'pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        // Ignore
      }
      this._activeSliceDrag = { plane, pointerId: e.pointerId };
      emitFromEvent(e);
    });

    this._listen(canvas, 'pointermove', (e) => {
      if (
        this._activeSliceDrag &&
        this._activeSliceDrag.plane === plane &&
        this._activeSliceDrag.pointerId === e.pointerId
      ) {
        emitFromEvent(e);
      }
    });

    const endDrag = (e) => {
      if (
        this._activeSliceDrag &&
        this._activeSliceDrag.plane === plane &&
        this._activeSliceDrag.pointerId === e.pointerId
      ) {
        this._activeSliceDrag = null;
      }
    };
    this._listen(canvas, 'pointerup', endDrag);
    this._listen(canvas, 'pointercancel', endDrag);
  }

  _screenToSliceMni(plane, sx, sy, tr) {
    const cfg = SLICE_CONFIGS[plane];
    if (!cfg || !tr || tr.pxPerMm <= 0) return null;
    const mni = [...this.state.sliceMni];
    const hVal = cfg.hCenter + ((sx - tr.cx) / tr.pxPerMm) * cfg.hSign;
    const vVal = cfg.vCenter + ((sy - tr.cy) / tr.pxPerMm) * cfg.vSign;
    mni[cfg.hAxis] = hVal;
    mni[cfg.vAxis] = vVal;

    const bounds = this.atlasData?.bounds || MNI_BOUNDS;
    mni[0] = Math.round(clamp(mni[0], bounds.x[0], bounds.x[1]) * 10) / 10;
    mni[1] = Math.round(clamp(mni[1], bounds.y[0], bounds.y[1]) * 10) / 10;
    mni[2] = Math.round(clamp(mni[2], bounds.z[0], bounds.z[1]) * 10) / 10;
    return mni;
  }

  // -------------------------------------------------------------------------
  // 1. INTERACTIVE 3D STEREOTACTIC BRAIN & TRACTOGRAPHY VIEWPORT
  // -------------------------------------------------------------------------

  _render3D() {
    const ctx = this.ctxs.view3d;
    const { w, h, dpr } = this.sizes.view3d;
    if (!ctx || w <= 2 || h <= 2) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark surgical navigation backdrop with subtle vignette
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.08, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    bgGrad.addColorStop(0, '#0f1727');
    bgGrad.addColorStop(0.6, '#0a101b');
    bgGrad.addColorStop(1, '#060a10');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle background stereotactic grid ring cue
    this._draw3DBackdropReticule(ctx, w, h);

    const cam = computeCameraBasis(this.camera, w, h);
    const painter = [];
    const hitTargets = [];
    const labels = [];

    const highlightSet = this._getHighlightSet();
    const hoveredId = this._hoveredItem ? this._hoveredItem.id : null;
    const selectedId = this.state.selectedHazardId || null;
    const hasFocusFilter = highlightSet.size > 0 || selectedId !== null;
    const hazardLookup = this._getHazardLookup();

    // 1A. Parametric Anatomical Brain Shell (Glass Fresnel Quads + Hemispheric Ribs)
    if (this.state.showBrainShell) {
      this._collectBrainShell3D(painter, cam);
    }

    // 1B. Translucent Ventricles & Brainstem Reference Volumes
    if (this.state.showVentricles) {
      this._collectVentriclesAndBrainstem3D(painter, cam);
    }

    // 1C. Shaded 3D Eloquent Cortical / Subcortical / Vascular Structure Ellipsoids
    this._collectStructures3D(painter, hitTargets, labels, cam, highlightSet, hoveredId, selectedId, hasFocusFilter, hazardLookup);

    // 1D. Multi-Streamline White-Matter Fiber Tracts (Anatomical + DEC RGB)
    this._collectTracts3D(painter, hitTargets, labels, cam, highlightSet, hoveredId, selectedId, hasFocusFilter, hazardLookup);

    // 1E. 3D Tumor Core + Secondary Lobe + Peritumoral FLAIR Halo + Optional NIfTI Point Cloud
    this._collectLesion3D(painter, labels, cam);

    // 1F. 3D Surgical Corridor Cylinder + Entry Ring + 10mm Depth Ticks + Target Bullseye + Ghost Corridor
    if (this.state.showCorridor && this.state.corridor) {
      this._collectCorridor3D(painter, cam);
    }
    if (this.state.showCorridor && this.state.ghostCorridor) {
      this._collectGhostCorridor3D(painter, cam);
    }

    // Depth-sorted painter's algorithm: far -> near
    painter.sort((a, b) => b.depth - a.depth);
    for (let i = 0; i < painter.length; i++) {
      painter[i].draw(ctx);
    }

    this._hitTargets3D = hitTargets;

    // 1G. Post-pass: Pulsing Closest-Approach Hazard Callout Lines (< 10 mm)
    if (this.state.showCorridor && this.state.corridor && this.state.analysis) {
      this._drawHazardCallouts3D(ctx, cam, selectedId);
    }

    // 1H. Post-pass: Floating 3D Structure & Tract Labels (decluttered)
    if (this.state.showLabels && labels.length > 0) {
      this._draw3DLabels(ctx, labels, w, h);
    }

    // 1I. Interactive 3D Anatomical Orientation Triad (Lower-Left HUD) + Scale Bar (Lower-Right)
    this._drawOrientationTriad3D(ctx, cam, w, h);
    this._drawScaleBar3D(ctx, cam, w, h);

    ctx.restore();
  }

  _draw3DBackdropReticule(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
    ctx.lineWidth = 1;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.42;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.08, cy);
    ctx.lineTo(cx + r * 1.08, cy);
    ctx.moveTo(cx, cy - r * 1.08);
    ctx.lineTo(cx, cy + r * 1.08);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _collectBrainShell3D(painter, cam) {
    const opacity = this.state.brainOpacity;
    const { quads, ribArcs } = this._brain3D;

    // Translucent Fresnel-lit glass shell quads (front-facing only so interior stays crystal clear)
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      const viewVec = v3Norm(v3Sub(cam.eye, q.center));
      const ndotv = v3Dot(q.normal, viewVec);
      if (ndotv <= 0.02) continue;

      const cProj = projectPoint(q.center, cam);
      if (!cProj) continue;
      const s00 = projectPoint(q.p00, cam);
      const s10 = projectPoint(q.p10, cam);
      const s11 = projectPoint(q.p11, cam);
      const s01 = projectPoint(q.p01, cam);
      if (!s00 || !s10 || !s11 || !s01) continue;

      const rim = Math.pow(1 - clamp(ndotv, 0, 1), 1.65);
      const lit = 0.52 + 0.48 * Math.max(0, v3Dot(q.normal, cam.lightDir));
      const fillAlpha = clamp(opacity * (0.055 + 0.44 * rim) * lit, 0.008, 0.34);

      painter.push({
        depth: cProj.z + 1.5,
        draw(ctx) {
          ctx.beginPath();
          ctx.moveTo(s00.sx, s00.sy);
          ctx.lineTo(s10.sx, s10.sy);
          ctx.lineTo(s11.sx, s11.sy);
          ctx.lineTo(s01.sx, s01.sy);
          ctx.closePath();
          ctx.fillStyle = `rgba(125, 185, 245, ${fillAlpha.toFixed(3)})`;
          ctx.fill();
        },
      });
    }

    // Cortical latitude rings, hemispheric meridians, and midline longitudinal fissure curve
    for (let i = 0; i < ribArcs.length; i++) {
      const arc = ribArcs[i];
      const a0 = projectPoint(arc.p0, cam);
      const a1 = projectPoint(arc.p1, cam);
      const a2 = projectPoint(arc.p2, cam);
      if (!a0 || !a1 || !a2) continue;

      // Subtle depth fade: near hemisphere contours brighter than far hemisphere contours
      const depthNorm = clamp((cam.dist + 80 - a1.z) / 160, 0.22, 1.0);
      const isFissure = arc.kind === 'fissure';
      const alpha = clamp(opacity * (isFissure ? 1.45 : 0.92) * arc.emphasis * depthNorm, 0.03, 0.58);
      const lw = isFissure ? 1.25 : 0.85;
      const strokeStyle = isFissure
        ? `rgba(148, 210, 255, ${alpha.toFixed(3)})`
        : `rgba(148, 163, 184, ${alpha.toFixed(3)})`;

      painter.push({
        depth: a1.z,
        draw(ctx) {
          ctx.beginPath();
          ctx.moveTo(a0.sx, a0.sy);
          ctx.lineTo(a1.sx, a1.sy);
          ctx.lineTo(a2.sx, a2.sy);
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = lw;
          ctx.stroke();
        },
      });
    }
  }

  _collectVentriclesAndBrainstem3D(painter, cam) {
    const ref = this.atlasData?.brainReference;
    const brainstem = Array.isArray(ref?.brainstemEllipsoids) && ref.brainstemEllipsoids.length
      ? ref.brainstemEllipsoids
      : FALLBACK_BRAINSTEM;
    const ventricles = Array.isArray(ref?.ventricles) && ref.ventricles.length
      ? ref.ventricles
      : FALLBACK_VENTRICLES;

    // Brainstem tapered volumes
    for (const seg of brainstem) {
      const proj = projectEllipsoid2D(seg, cam);
      if (!proj) continue;
      painter.push({
        depth: proj.z,
        draw(ctx) {
          drawShadedEllipsoid3D(ctx, proj, '#64748b', {
            fillAlpha: 0.24,
            rimAlpha: 0.34,
            rimWidth: 0.9,
          });
        },
      });
    }

    // Lateral & 3rd ventricles in CSF cyan-blue
    for (const vent of ventricles) {
      const list = Array.isArray(vent.ellipsoids) ? vent.ellipsoids : [];
      for (const ell of list) {
        const proj = projectEllipsoid2D(ell, cam);
        if (!proj) continue;
        painter.push({
          depth: proj.z,
          draw(ctx) {
            drawShadedEllipsoid3D(ctx, proj, '#38bdf8', {
              fillAlpha: 0.19,
              rimAlpha: 0.34,
              rimWidth: 0.85,
            });
          },
        });
      }
    }
  }

  _collectStructures3D(painter, hitTargets, labels, cam, highlightSet, hoveredId, selectedId, hasFocusFilter, hazardLookup) {
    const structures = this.atlasData?.structures;
    if (!Array.isArray(structures)) return;

    for (const s of structures) {
      if (!this._isStructureVisible(s.id)) continue;
      const ellipsoids = Array.isArray(s.ellipsoids) ? s.ellipsoids : [];
      if (ellipsoids.length === 0) continue;

      const isHovered = hoveredId === s.id;
      const isSelected = selectedId === s.id;
      const isHighlighted = highlightSet.has(s.id);
      const isEmphasized = isHovered || isSelected || isHighlighted;
      const dimmed = hasFocusFilter && !isEmphasized;
      const hazard = hazardLookup.get(s.id) || null;
      const isCritical = hazard && hazard.riskTier === 'critical';

      let bestLabelAnchor = null;

      for (const ell of ellipsoids) {
        const proj = projectEllipsoid2D(ell, cam);
        if (!proj) continue;

        const fillAlpha = isEmphasized ? 0.72 : dimmed ? 0.2 : isCritical ? 0.58 : 0.46;
        const rimAlpha = isEmphasized ? 0.96 : dimmed ? 0.32 : 0.78;
        const rimWidth = isEmphasized ? 2.0 : isCritical ? 1.5 : 1.15;

        painter.push({
          depth: proj.z,
          draw(ctx) {
            drawShadedEllipsoid3D(ctx, proj, s.color, {
              fillAlpha,
              rimAlpha,
              rimWidth,
              glow: isEmphasized || isCritical,
              glowColor: isSelected ? '#ffffff' : isCritical ? RISK_COLORS.critical : s.color,
            });
          },
        });

        hitTargets.push({
          shape: 'ellipse',
          id: s.id,
          name: s.name,
          shortName: s.shortName,
          kind: 'structure',
          category: s.category,
          color: s.color,
          clearanceMm: hazard ? hazard.corridorClearanceMm : null,
          riskTier: hazard ? hazard.riskTier : null,
          sx: proj.sx,
          sy: proj.sy,
          rxPx: proj.rxPx,
          ryPx: proj.ryPx,
          angle: proj.angle,
          depth: proj.z,
        });

        if (!bestLabelAnchor || proj.z < bestLabelAnchor.z) {
          bestLabelAnchor = {
            sx: proj.sx,
            sy: proj.sy - Math.max(proj.rxPx, proj.ryPx) * 0.55,
            z: proj.z,
          };
        }
      }

      if (bestLabelAnchor && (!dimmed || isEmphasized)) {
        labels.push({
          text: s.shortName || s.name,
          color: s.color,
          sx: bestLabelAnchor.sx,
          sy: bestLabelAnchor.sy,
          z: bestLabelAnchor.z,
          priority: isEmphasized ? 3 : isCritical ? 2 : 1,
        });
      }
    }
  }

  _collectTracts3D(painter, hitTargets, labels, cam, highlightSet, hoveredId, selectedId, hasFocusFilter, hazardLookup) {
    const isDec = this.state.tractColorMode === 'dec';

    for (let tIdx = 0; tIdx < this._tractCache.length; tIdx++) {
      const { tract, preparedLines } = this._tractCache[tIdx];
      if (!this._isTractVisible(tract.id)) continue;

      const isHovered = hoveredId === tract.id;
      const isSelected = selectedId === tract.id;
      const isHighlighted = highlightSet.has(tract.id);
      const isEmphasized = isHovered || isSelected || isHighlighted;
      const dimmed = hasFocusFilter && !isEmphasized;
      const hazard = hazardLookup.get(tract.id) || null;
      const isCritical = hazard && hazard.riskTier === 'critical';

      const baseWidth = isEmphasized ? 2.8 : isCritical ? 2.15 : 1.7;
      const auraWidth = baseWidth * (isEmphasized ? 3.2 : 2.55);
      const coreAlphaBase = isEmphasized ? 0.96 : dimmed ? 0.24 : 0.86;
      const auraAlphaBase = isEmphasized ? 0.36 : dimmed ? 0.05 : 0.19;

      let labelAnchor = null;

      for (let sIdx = 0; sIdx < preparedLines.length; sIdx++) {
        const { pts, decColors } = preparedLines[sIdx];
        if (pts.length < 2) continue;

        // Project streamline points once
        const projected = new Array(pts.length);
        for (let i = 0; i < pts.length; i++) {
          projected[i] = projectPoint(pts[i], cam);
        }

        // Capture a clean midpoint label anchor on the primary streamline
        if (sIdx === 0) {
          const midProj = projected[Math.floor(pts.length * 0.5)];
          if (midProj) {
            labelAnchor = { sx: midProj.sx, sy: midProj.sy, z: midProj.z };
          }
        }

        // Group pairs of adjacent Catmull-Rom subsegments (3-point mini-polylines)
        // for razor-sharp curves, accurate depth-sorting, and 2x faster 60fps drawing
        for (let i = 0; i < pts.length - 1; i += 2) {
          const p0 = projected[i];
          const p1 = projected[Math.min(i + 1, pts.length - 1)];
          const p2 = projected[Math.min(i + 2, pts.length - 1)];
          if (!p0 || !p1 || !p2) continue;

          const depth = p1.z;
          const depthFactor = clamp((cam.dist + 90 - depth) / 185, 0.45, 1.05);
          const color = isDec ? decColors[Math.min(i + 1, decColors.length - 1)] : tract.color;
          const auraStroke = hexToRgba(color, auraAlphaBase * depthFactor);
          const coreStroke = isEmphasized
            ? brightenHex(color, 0.22, coreAlphaBase)
            : hexToRgba(color, coreAlphaBase * depthFactor);
          const wScale = clamp(p1.scale / 2.2, 0.72, 1.45);
          const lwAura = auraWidth * wScale;
          const lwCore = baseWidth * wScale;

          painter.push({
            depth,
            draw(ctx) {
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.beginPath();
              ctx.moveTo(p0.sx, p0.sy);
              ctx.lineTo(p1.sx, p1.sy);
              if (p2 !== p1) ctx.lineTo(p2.sx, p2.sy);

              ctx.strokeStyle = auraStroke;
              ctx.lineWidth = lwAura;
              ctx.stroke();

              ctx.strokeStyle = coreStroke;
              ctx.lineWidth = lwCore;
              ctx.stroke();
            },
          });

          if (i % 4 === 0) {
            hitTargets.push({
              shape: 'segment',
              id: tract.id,
              name: tract.name,
              shortName: tract.shortName,
              kind: 'tract',
              category: tract.system,
              color: tract.color,
              clearanceMm: hazard ? hazard.corridorClearanceMm : null,
              riskTier: hazard ? hazard.riskTier : null,
              x0: p0.sx,
              y0: p0.sy,
              x1: p2.sx,
              y1: p2.sy,
              depth,
            });
          }
        }
      }

      if (labelAnchor && (isEmphasized || isCritical)) {
        labels.push({
          text: tract.shortName || tract.name,
          color: tract.color,
          sx: labelAnchor.sx,
          sy: labelAnchor.sy - 8,
          z: labelAnchor.z,
          priority: isEmphasized ? 3 : 2,
        });
      }
    }
  }

  _collectLesion3D(painter, labels, cam) {
    const lesion = this.state.lesion;
    if (!lesion) return;

    const coreColor = lesion.color || '#ec4899';
    const edemaColor = lesion.edemaColor || '#fbbf24';

    // Translucent Peritumoral FLAIR / Edema Halo
    if (this.state.showEdema && lesion.edemaEllipsoid) {
      const eProj = projectEllipsoid2D(lesion.edemaEllipsoid, cam);
      if (eProj) {
        painter.push({
          depth: eProj.z + 2.0,
          draw(ctx) {
            ctx.save();
            ctx.translate(eProj.sx, eProj.sy);
            ctx.rotate(eProj.angle);
            ctx.beginPath();
            ctx.ellipse(0, 0, eProj.rxPx, eProj.ryPx, 0, 0, Math.PI * 2);
            ctx.fillStyle = hexToRgba(edemaColor, 0.13);
            ctx.fill();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = hexToRgba(edemaColor, 0.45);
            ctx.lineWidth = 1.1;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          },
        });
      }
    }

    // Tumor Primary & Optional Secondary Core Lobes
    const lobes = [lesion.primaryEllipsoid, lesion.secondaryEllipsoid].filter(Boolean);
    lobes.forEach((lobe, idx) => {
      const proj = projectEllipsoid2D(lobe, cam);
      if (!proj) return;

      painter.push({
        depth: proj.z,
        draw(ctx) {
          drawShadedEllipsoid3D(ctx, proj, coreColor, {
            fillAlpha: 0.72,
            rimAlpha: 0.95,
            rimWidth: 1.8,
            glow: true,
            glowColor: coreColor,
            isLesion: true,
          });
        },
      });

      if (idx === 0) {
        labels.push({
          text: lesion.pointCloudMni ? 'NIFTI LESION' : 'TUMOR',
          color: coreColor,
          sx: proj.sx,
          sy: proj.sy - Math.max(proj.rxPx, proj.ryPx) * 0.72,
          z: proj.z - 5,
          priority: 4,
        });
      }
    });

    // Optional Browser-Local MNI NIfTI Mask Point Cloud
    const pts = lesion.pointCloudMni;
    if (Array.isArray(pts) && pts.length > 0) {
      const stride = pts.length > 900 ? Math.ceil(pts.length / 900) : 1;
      for (let i = 0; i < pts.length; i += stride) {
        const pProj = projectPoint(pts[i], cam);
        if (!pProj) continue;
        const radius = clamp(pProj.scale * 0.72, 1.3, 3.2);
        const depthAlpha = clamp((cam.dist + 75 - pProj.z) / 160, 0.3, 0.85);
        painter.push({
          depth: pProj.z - 0.5,
          draw(ctx) {
            ctx.fillStyle = brightenHex(coreColor, 0.25, depthAlpha);
            ctx.beginPath();
            ctx.arc(pProj.sx, pProj.sy, radius, 0, Math.PI * 2);
            ctx.fill();
          },
        });
      }
    }
  }

  _collectCorridor3D(painter, cam) {
    const corridor = this.state.corridor;
    if (!corridor || !Array.isArray(corridor.entryMni) || !Array.isArray(corridor.targetMni)) return;

    const entry = corridor.entryMni;
    const target = corridor.targetMni;
    const radiusMm = Math.max(1.5, Number(corridor.radiusMm) || 6);
    const lengthMm = v3Len(v3Sub(target, entry));
    if (lengthMm < 0.5) return;

    const tier = this.state.analysis?.overallRiskTier || 'safe';
    const riskColor = RISK_COLORS[tier] || RISK_COLORS.safe;

    const frame =
      this.state.analysis?.corridorFrame &&
      Array.isArray(this.state.analysis.corridorFrame.uAxis) &&
      Array.isArray(this.state.analysis.corridorFrame.vAxis)
        ? this.state.analysis.corridorFrame
        : buildFallbackCorridorFrame(entry, target);

    const { uAxis, vAxis } = frame;
    const dir = v3Scale(v3Sub(target, entry), 1 / lengthMm);

    const sides = 16;
    const axialSegs = clamp(Math.ceil(lengthMm / 12), 4, 9);

    const ringPoint = (tFrac, theta, r = radiusMm) => {
      const c = Math.cos(theta) * r;
      const s = Math.sin(theta) * r;
      return [
        entry[0] + dir[0] * (tFrac * lengthMm) + uAxis[0] * c + vAxis[0] * s,
        entry[1] + dir[1] * (tFrac * lengthMm) + uAxis[1] * c + vAxis[1] * s,
        entry[2] + dir[2] * (tFrac * lengthMm) + uAxis[2] * c + vAxis[2] * s,
      ];
    };

    // Precompute ring vertices for 16-sided translucent surgical corridor cylinder
    const rings = [];
    for (let r = 0; r <= axialSegs; r++) {
      const tFrac = r / axialSegs;
      const ring = [];
      for (let s = 0; s < sides; s++) {
        const theta = (s / sides) * Math.PI * 2;
        const world = ringPoint(tFrac, theta);
        ring.push({ world, proj: projectPoint(world, cam), theta });
      }
      rings.push(ring);
    }

    // Translucent shaded cylinder facets (depth-sorted lengthwise & circumferentially)
    for (let r = 0; r < axialSegs; r++) {
      const r0 = rings[r];
      const r1 = rings[r + 1];
      for (let s = 0; s < sides; s++) {
        const sn = (s + 1) % sides;
        const v00 = r0[s];
        const v01 = r0[sn];
        const v11 = r1[sn];
        const v10 = r1[s];
        if (!v00.proj || !v01.proj || !v11.proj || !v10.proj) continue;

        const midTheta = ((s + 0.5) / sides) * Math.PI * 2;
        const normal = [
          uAxis[0] * Math.cos(midTheta) + vAxis[0] * Math.sin(midTheta),
          uAxis[1] * Math.cos(midTheta) + vAxis[1] * Math.sin(midTheta),
          uAxis[2] * Math.cos(midTheta) + vAxis[2] * Math.sin(midTheta),
        ];
        const centerWorld = [
          (v00.world[0] + v01.world[0] + v11.world[0] + v10.world[0]) * 0.25,
          (v00.world[1] + v01.world[1] + v11.world[1] + v10.world[1]) * 0.25,
          (v00.world[2] + v01.world[2] + v11.world[2] + v10.world[2]) * 0.25,
        ];
        const cProj = projectPoint(centerWorld, cam);
        if (!cProj) continue;

        const viewDir = v3Norm(v3Sub(cam.eye, centerWorld));
        const ndotv = v3Dot(normal, viewDir);
        const rim = Math.pow(1 - Math.abs(ndotv), 1.35);
        const lit = 0.55 + 0.45 * Math.max(0, v3Dot(normal, cam.lightDir));
        const alpha = (ndotv >= 0 ? 0.14 + 0.24 * rim : 0.06 + 0.1 * rim) * lit;

        painter.push({
          depth: cProj.z,
          draw(ctx) {
            ctx.beginPath();
            ctx.moveTo(v00.proj.sx, v00.proj.sy);
            ctx.lineTo(v01.proj.sx, v01.proj.sy);
            ctx.lineTo(v11.proj.sx, v11.proj.sy);
            ctx.lineTo(v10.proj.sx, v10.proj.sy);
            ctx.closePath();
            ctx.fillStyle = hexToRgba(riskColor, alpha);
            ctx.fill();
          },
        });
      }
    }

    // Longitudinal structural rails (4 cardinal ribs for crisp cylindrical edge readability)
    for (let r = 0; r < axialSegs; r++) {
      const r0 = rings[r];
      const r1 = rings[r + 1];
      for (let s = 0; s < sides; s += 4) {
        const a = r0[s];
        const b = r1[s];
        if (!a.proj || !b.proj) continue;
        painter.push({
          depth: (a.proj.z + b.proj.z) * 0.5 - 0.3,
          draw(ctx) {
            ctx.beginPath();
            ctx.moveTo(a.proj.sx, a.proj.sy);
            ctx.lineTo(b.proj.sx, b.proj.sy);
            ctx.strokeStyle = hexToRgba(riskColor, 0.36);
            ctx.lineWidth = 0.9;
            ctx.stroke();
          },
        });
      }
    }

    // Centerline axis (segmented for depth sorting)
    for (let r = 0; r < axialSegs; r++) {
      const pA = projectPoint(v3Add(entry, v3Scale(dir, (r / axialSegs) * lengthMm)), cam);
      const pB = projectPoint(v3Add(entry, v3Scale(dir, ((r + 1) / axialSegs) * lengthMm)), cam);
      if (!pA || !pB) continue;
      painter.push({
        depth: (pA.z + pB.z) * 0.5,
        draw(ctx) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pA.sx, pA.sy);
          ctx.lineTo(pB.sx, pB.sy);
          ctx.strokeStyle = brightenHex(riskColor, 0.45, 0.72);
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
        },
      });
    }

    // Helper to submit a 3D ring at a specific depth fraction
    const pushCorridorRing = (tFrac, rMm, strokeStyle, lineWidth, dashed = false) => {
      const pts = [];
      let avgZ = 0;
      for (let s = 0; s <= sides; s++) {
        const theta = ((s % sides) / sides) * Math.PI * 2;
        const pr = projectPoint(ringPoint(tFrac, theta, rMm), cam);
        if (!pr) return;
        pts.push(pr);
        if (s < sides) avgZ += pr.z;
      }
      avgZ /= sides;
      painter.push({
        depth: avgZ - 0.8,
        draw(ctx) {
          ctx.save();
          if (dashed) ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(pts[0].sx, pts[0].sy);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].sx, pts[i].sy);
          }
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
          ctx.restore();
        },
      });
    };

    // Cortical Entry Ring + Outer Flange
    pushCorridorRing(0, radiusMm, brightenHex(riskColor, 0.35, 0.96), 2.2);
    pushCorridorRing(0, radiusMm + 1.8, hexToRgba(riskColor, 0.55), 1.1, true);

    // 10 mm Depth Tick Rings along the surgical corridor
    for (let dMm = 10; dMm < lengthMm - 3; dMm += 10) {
      const tFrac = dMm / lengthMm;
      pushCorridorRing(tFrac, radiusMm + 0.35, brightenHex(riskColor, 0.3, 0.52), 1.0);
    }

    // Active Probe's-Eye Depth Plane Ring in 3D (links 3D viewport to Probe slider!)
    const probeT = clamp(this.state.probeDepthFraction, 0, 1);
    pushCorridorRing(probeT, radiusMm + 1.4, 'rgba(56, 189, 248, 0.92)', 1.8);

    // Target Ring & 3D Target Bullseye Crosshair
    pushCorridorRing(1, radiusMm, hexToRgba(riskColor, 0.78), 1.6);

    const entryProj = projectPoint(entry, cam);
    if (entryProj) {
      painter.push({
        depth: entryProj.z - 2,
        draw(ctx) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(entryProj.sx, entryProj.sy, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = '#f8fafc';
          ctx.fill();
          ctx.strokeStyle = riskColor;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.font = `600 9px ${FONT_MONO}`;
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText('ENTRY', entryProj.sx + 7, entryProj.sy - 5);
          ctx.restore();
        },
      });
    }

    const targetProj = projectPoint(target, cam);
    if (targetProj) {
      painter.push({
        depth: targetProj.z - 2.5,
        draw(ctx) {
          ctx.save();
          const rOuter = 7.5;
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(targetProj.sx, targetProj.sy, rOuter, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(targetProj.sx - rOuter - 3, targetProj.sy);
          ctx.lineTo(targetProj.sx - 2.5, targetProj.sy);
          ctx.moveTo(targetProj.sx + 2.5, targetProj.sy);
          ctx.lineTo(targetProj.sx + rOuter + 3, targetProj.sy);
          ctx.moveTo(targetProj.sx, targetProj.sy - rOuter - 3);
          ctx.lineTo(targetProj.sx, targetProj.sy - 2.5);
          ctx.moveTo(targetProj.sx, targetProj.sy + 2.5);
          ctx.lineTo(targetProj.sx, targetProj.sy + rOuter + 3);
          ctx.stroke();

          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(targetProj.sx, targetProj.sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        },
      });
    }
  }

  _collectGhostCorridor3D(painter, cam) {
    const ghost = this.state.ghostCorridor;
    if (!ghost || !Array.isArray(ghost.entryMni) || !Array.isArray(ghost.targetMni)) return;
    const entry = ghost.entryMni;
    const target = ghost.targetMni;
    const rMm = Math.max(1.5, Number(ghost.radiusMm) || 6);
    const frame = buildFallbackCorridorFrame(entry, target);
    if (frame.length < 0.5) return;

    const cyan = '#38bdf8';
    const sides = 12;

    const drawRing = (center) => {
      const pts = [];
      let avgZ = 0;
      for (let s = 0; s <= sides; s++) {
        const theta = ((s % sides) / sides) * Math.PI * 2;
        const p = [
          center[0] + (frame.uAxis[0] * Math.cos(theta) + frame.vAxis[0] * Math.sin(theta)) * rMm,
          center[1] + (frame.uAxis[1] * Math.cos(theta) + frame.vAxis[1] * Math.sin(theta)) * rMm,
          center[2] + (frame.uAxis[2] * Math.cos(theta) + frame.vAxis[2] * Math.sin(theta)) * rMm,
        ];
        const pr = projectPoint(p, cam);
        if (!pr) return;
        pts.push(pr);
        if (s < sides) avgZ += pr.z;
      }
      painter.push({
        depth: avgZ / sides,
        draw(ctx) {
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(pts[0].sx, pts[0].sy);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
          ctx.strokeStyle = hexToRgba(cyan, 0.85);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        },
      });
    };

    drawRing(entry);
    drawRing(target);

    // 4 dashed longitudinal rails + centerline
    const railAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    for (const a of railAngles) {
      const off = [
        (frame.uAxis[0] * Math.cos(a) + frame.vAxis[0] * Math.sin(a)) * rMm,
        (frame.uAxis[1] * Math.cos(a) + frame.vAxis[1] * Math.sin(a)) * rMm,
        (frame.uAxis[2] * Math.cos(a) + frame.vAxis[2] * Math.sin(a)) * rMm,
      ];
      const p0 = projectPoint(v3Add(entry, off), cam);
      const p1 = projectPoint(v3Add(target, off), cam);
      if (!p0 || !p1) continue;
      painter.push({
        depth: (p0.z + p1.z) * 0.5,
        draw(ctx) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.strokeStyle = hexToRgba(cyan, 0.65);
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.restore();
        },
      });
    }

    const pEntry = projectPoint(entry, cam);
    const pTarget = projectPoint(target, cam);
    if (pEntry && pTarget) {
      painter.push({
        depth: (pEntry.z + pTarget.z) * 0.5 - 1,
        draw(ctx) {
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(pEntry.sx, pEntry.sy);
          ctx.lineTo(pTarget.sx, pTarget.sy);
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)';
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `700 9px ${FONT_MONO}`;
          ctx.fillStyle = '#7dd3fc';
          ctx.fillText('OPT', pEntry.sx + 7, pEntry.sy - 6);
          ctx.restore();
        },
      });
    }
  }

  _drawHazardCallouts3D(ctx, cam, selectedId) {
    const warnings = this.state.analysis?.proximityWarnings || [];
    const displayList = [...warnings];

    // Also show tether for an explicitly selected hazard even if > 10 mm
    if (selectedId && !displayList.some((w) => w.id === selectedId)) {
      const found = (this.state.analysis?.sortedHazards || []).find((h) => h.id === selectedId);
      if (found) displayList.push(found);
    }

    if (displayList.length === 0) return;

    const pulse = 0.5 + 0.5 * Math.sin(this._pulsePhase);
    const placedBadges = [];

    for (let i = 0; i < Math.min(displayList.length, 6); i++) {
      const h = displayList[i];
      if (!Array.isArray(h.corridorClosestPoint) || !Array.isArray(h.hazardClosestPoint)) continue;
      if (h.kind === 'structure' && !this._isStructureVisible(h.id)) continue;
      if (h.kind === 'tract' && !this._isTractVisible(h.id)) continue;

      const pCorr = projectPoint(h.corridorClosestPoint, cam);
      const pHaz = projectPoint(h.hazardClosestPoint, cam);
      if (!pCorr || !pHaz) continue;

      const tierColor = RISK_COLORS[h.riskTier] || RISK_COLORS.caution;
      const isCrit = h.riskTier === 'critical';

      // Closest-approach tether line
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pCorr.sx, pCorr.sy);
      ctx.lineTo(pHaz.sx, pHaz.sy);
      ctx.strokeStyle = hexToRgba(tierColor, isCrit ? 0.92 : 0.78);
      ctx.lineWidth = isCrit ? 1.8 : 1.35;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corridor anchor dot
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(pCorr.sx, pCorr.sy, 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing hazard beacon
      const ringR = (isCrit ? 6.5 : 5.2) + pulse * (isCrit ? 6.5 : 4.0);
      ctx.beginPath();
      ctx.arc(pHaz.sx, pHaz.sy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(tierColor, (1 - pulse * 0.72) * 0.85);
      ctx.lineWidth = isCrit ? 1.8 : 1.3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pHaz.sx, pHaz.sy, isCrit ? 4.0 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = tierColor;
      ctx.fill();
      ctx.strokeStyle = '#090d14';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Micro-badge (shortName + clearance in mm) with simple vertical declutter
      const text = `${h.shortName} ${h.corridorClearanceMm.toFixed(1)}mm`;
      ctx.font = `700 10px ${FONT_MONO}`;
      const tw = ctx.measureText(text).width;
      const bw = tw + 12;
      const bh = 18;
      let bx = (pCorr.sx + pHaz.sx) * 0.5 + 8;
      let by = (pCorr.sy + pHaz.sy) * 0.5 - bh * 0.5 - 8;

      for (const box of placedBadges) {
        if (Math.abs(bx - box.x) < (bw + box.w) * 0.5 && Math.abs(by - box.y) < bh + 3) {
          by = box.y - bh - 4;
        }
      }
      placedBadges.push({ x: bx, y: by, w: bw, h: bh });

      drawRoundedRect(ctx, bx, by, bw, bh, 4);
      ctx.fillStyle = 'rgba(9, 13, 20, 0.90)';
      ctx.fill();
      ctx.strokeStyle = hexToRgba(tierColor, 0.92);
      ctx.lineWidth = 1.15;
      ctx.stroke();

      ctx.fillStyle = brightenHex(tierColor, 0.35, 1);
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 6, by + bh * 0.5 + 0.5);
      ctx.restore();
    }
  }

  _draw3DLabels(ctx, labels, w, h) {
    // Sort highest priority & nearest to camera first
    labels.sort((a, b) => (b.priority - a.priority) || (a.z - b.z));

    const placed = [];
    ctx.save();
    ctx.font = `600 10px ${FONT_SANS}`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < labels.length; i++) {
      const lb = labels[i];
      if (lb.sx < 24 || lb.sx > w - 24 || lb.sy < 24 || lb.sy > h - 24) continue;

      const tw = ctx.measureText(lb.text).width;
      const pw = tw + 16;
      const ph = 17;
      let px = clamp(lb.sx - pw * 0.5, 8, w - pw - 8);
      let py = clamp(lb.sy - ph - 4, 8, h - ph - 8);

      let collides = false;
      for (const p of placed) {
        if (px < p.x + p.w + 3 && px + pw + 3 > p.x && py < p.y + p.h + 3 && py + ph + 3 > p.y) {
          if (lb.priority >= 3) {
            py = p.y - ph - 3;
          } else {
            collides = true;
            break;
          }
        }
      }
      if (collides) continue;
      placed.push({ x: px, y: py, w: pw, h: ph });

      // Leader tick
      ctx.beginPath();
      ctx.moveTo(lb.sx, lb.sy);
      ctx.lineTo(px + pw * 0.5, py + ph);
      ctx.strokeStyle = hexToRgba(lb.color, 0.45);
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // Pill badge
      drawRoundedRect(ctx, px, py, pw, ph, 4);
      ctx.fillStyle = 'rgba(11, 17, 28, 0.82)';
      ctx.fill();
      ctx.strokeStyle = hexToRgba(lb.color, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Color dot
      ctx.fillStyle = lb.color;
      ctx.beginPath();
      ctx.arc(px + 6.5, py + ph * 0.5, 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Text
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(lb.text, px + 12, py + ph * 0.5 + 0.5);
    }

    ctx.restore();
  }

  _drawOrientationTriad3D(ctx, cam, w, h) {
    const cx = 46;
    const cy = h - 46;
    const axisLen = 24;

    ctx.save();
    // Translucent circular badge behind triad
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 17, 28, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Positive & negative MNI RAS+ axes colored with standard DTI DEC RGB
    const axes = [
      { dir: [1, 0, 0], label: 'R', color: '#ef4444', pos: true },
      { dir: [-1, 0, 0], label: 'L', color: 'rgba(239,68,68,0.45)', pos: false },
      { dir: [0, 1, 0], label: 'A', color: '#22c55e', pos: true },
      { dir: [0, -1, 0], label: 'P', color: 'rgba(34,197,94,0.45)', pos: false },
      { dir: [0, 0, 1], label: 'S', color: '#3b82f6', pos: true },
      { dir: [0, 0, -1], label: 'I', color: 'rgba(59,130,246,0.45)', pos: false },
    ].map((a) => ({
      ...a,
      x: v3Dot(a.dir, cam.right) * axisLen,
      y: -v3Dot(a.dir, cam.up) * axisLen,
      z: v3Dot(a.dir, cam.fwd),
    }));

    // Sort far -> near (larger dot(dir, fwd) is farther into screen)
    axes.sort((a, b) => b.z - a.z);

    ctx.font = `700 9.5px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const a of axes) {
      const ex = cx + a.x;
      const ey = cy + a.y;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.pos ? 2.0 : 1.1;
      ctx.stroke();

      if (a.pos) {
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.arc(ex, ey, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }

      const lx = cx + a.x * 1.28;
      const ly = cy + a.y * 1.28;
      ctx.fillStyle = a.pos ? '#f1f5f9' : 'rgba(148, 163, 184, 0.65)';
      ctx.fillText(a.label, lx, ly);
    }

    // Center hub
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawScaleBar3D(ctx, cam, w, h) {
    const pxPerMm = cam.focal / cam.dist;
    const barMm = 20;
    const barPx = barMm * pxPerMm;
    if (barPx < 14 || barPx > w * 0.35) return;

    const x2 = w - 16;
    const x1 = x2 - barPx;
    const y = h - 18;

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x1, y - 3);
    ctx.lineTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.lineTo(x2, y - 3);
    ctx.stroke();

    ctx.font = `600 9.5px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${barMm} mm`, (x1 + x2) * 0.5, y - 3);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 2. SYNCHRONIZED ORTHOGONAL TRI-PLANAR MNI SLICE VIEWPORTS
  // -------------------------------------------------------------------------

  _getBrainSliceLoops(plane, sliceCoord) {
    const rounded = Math.round(sliceCoord * 2) / 2;
    const key = `${plane}:${rounded}`;
    const cached = this._sliceContourCache.get(key);
    if (cached) return cached;

    const cfg = SLICE_CONFIGS[plane];
    const loops = sliceWatertightMesh(this._brainSliceMesh, cfg.fixedAxis, sliceCoord);

    // Keep cache bounded
    if (this._sliceContourCache.size > 240) {
      const firstKey = this._sliceContourCache.keys().next().value;
      this._sliceContourCache.delete(firstKey);
    }
    this._sliceContourCache.set(key, loops);
    return loops;
  }

  _renderSlice(plane) {
    const ctx = this.ctxs[plane];
    const { w, h, dpr } = this.sizes[plane];
    if (!ctx || w <= 2 || h <= 2) return;

    const cfg = SLICE_CONFIGS[plane];
    const sliceCoord = this.state.sliceMni[cfg.fixedAxis];

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark radiological background
    ctx.fillStyle = '#080c13';
    ctx.fillRect(0, 0, w, h);

    // Compute uniform isotropic mm -> px transform with clean padding for labels & header
    const padTop = 24;
    const padBottom = 18;
    const padSide = 18;
    const availW = Math.max(20, w - padSide * 2);
    const availH = Math.max(20, h - padTop - padBottom);
    const pxPerMm = Math.min(availW / cfg.hSpanMm, availH / cfg.vSpanMm);
    const cx = w * 0.5;
    const cy = padTop + availH * 0.5;

    const tr = { cx, cy, pxPerMm };
    this._sliceTransforms[plane] = tr;

    const toScreen = (mni) => ({
      x: cx + (mni[cfg.hAxis] - cfg.hCenter) * cfg.hSign * pxPerMm,
      y: cy + (mni[cfg.vAxis] - cfg.vCenter) * cfg.vSign * pxPerMm,
    });
    const toScreenHV = (hVal, vVal) => ({
      x: cx + (hVal - cfg.hCenter) * cfg.hSign * pxPerMm,
      y: cy + (vVal - cfg.vCenter) * cfg.vSign * pxPerMm,
    });

    // 2A. Stereotactic Grid (10 mm minor ticks/lines, 20 mm major grid, AC origin)
    this._drawSliceGrid(ctx, cfg, toScreenHV, w, h, padTop, padBottom, padSide);

    // 2B. Analytical Brain Cross-Section Outline (Exact Marching-Triangles contour)
    if (this.state.showBrainShell) {
      const loops = this._getBrainSliceLoops(plane, sliceCoord);
      for (const loop of loops) {
        if (loop.length < 3) continue;
        ctx.beginPath();
        const p0 = toScreen(loop[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < loop.length; i++) {
          const pi = toScreen(loop[i]);
          ctx.lineTo(pi.x, pi.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(30, 41, 59, 0.36)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 197, 255, 0.42)';
        ctx.lineWidth = 1.35;
        ctx.stroke();
      }
    }

    // 2C. Ventricles & Brainstem Cross-Sections
    if (this.state.showVentricles) {
      this._drawSliceVentriclesAndBrainstem(ctx, cfg, sliceCoord, toScreen, pxPerMm);
    }

    const highlightSet = this._getHighlightSet();
    const selectedId = this.state.selectedHazardId || null;

    // 2D. Visible Eloquent Structure Exact 2D Plane-Ellipsoid Cross-Sections
    this._drawSliceStructures(ctx, cfg, sliceCoord, toScreen, pxPerMm, highlightSet, selectedId);

    // 2E. White-Matter Tract Intersections (±3.5 mm proximity + exact plane pierce dots)
    this._drawSliceTracts(ctx, cfg, sliceCoord, toScreen, highlightSet, selectedId);

    // 2F. Lesion Core + Peritumoral FLAIR Edema Halo + Nearby NIfTI Points
    this._drawSliceLesion(ctx, cfg, sliceCoord, toScreen, pxPerMm);

    // 2G. Projected Surgical Corridor Vector, Envelope & Exact Slice Intersection
    if (this.state.showCorridor && this.state.ghostCorridor) {
      this._drawSliceCorridor(ctx, cfg, sliceCoord, toScreen, pxPerMm, this.state.ghostCorridor, true);
    }
    if (this.state.showCorridor && this.state.corridor) {
      this._drawSliceCorridor(ctx, cfg, sliceCoord, toScreen, pxPerMm, this.state.corridor, false);
    }

    // 2H. Synchronized MNI Slice Crosshair
    const cross = toScreen(this.state.sliceMni);
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padSide, cross.y);
    ctx.lineTo(w - padSide, cross.y);
    ctx.moveTo(cross.x, padTop);
    ctx.lineTo(cross.x, h - padBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cross.x, cross.y, 3.2, 0, Math.PI * 2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // 2I. Radiological Edge Orientation Markers (R/L, A/P, S/I) & Top Readout
    this._drawSliceChrome(ctx, cfg, sliceCoord, w, h);

    ctx.restore();
  }

  _drawSliceGrid(ctx, cfg, toScreenHV, w, h, padTop, padBottom, padSide) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(padSide, padTop, w - padSide * 2, h - padTop - padBottom);
    ctx.clip();

    // 10 mm minor & 20 mm major stereotactic grid lines
    for (let v = -120; v <= 100; v += 10) {
      const isMajor = v % 20 === 0;
      const isZero = v === 0;
      const pH = toScreenHV(v, 0);
      const pV = toScreenHV(0, v);

      ctx.strokeStyle = isZero
        ? 'rgba(56, 189, 248, 0.22)'
        : isMajor
          ? 'rgba(148, 163, 184, 0.11)'
          : 'rgba(148, 163, 184, 0.045)';
      ctx.lineWidth = isZero ? 1.1 : 0.8;

      ctx.beginPath();
      ctx.moveTo(pH.x, padTop);
      ctx.lineTo(pH.x, h - padBottom);
      ctx.moveTo(padSide, pV.y);
      ctx.lineTo(w - padSide, pV.y);
      ctx.stroke();
    }

    // 10 mm border tick marks along bottom & left plot border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1;
    for (let v = -100; v <= 80; v += 10) {
      const tickLen = v % 20 === 0 ? 5 : 2.5;
      const pH = toScreenHV(v, 0);
      const pV = toScreenHV(0, v);
      ctx.beginPath();
      ctx.moveTo(pH.x, h - padBottom);
      ctx.lineTo(pH.x, h - padBottom - tickLen);
      ctx.moveTo(padSide, pV.y);
      ctx.lineTo(padSide + tickLen, pV.y);
      ctx.stroke();
    }

    // AC origin marker (0, 0) in slice plane
    const ac = toScreenHV(0, 0);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ac.x - 4, ac.y);
    ctx.lineTo(ac.x + 4, ac.y);
    ctx.moveTo(ac.x, ac.y - 4);
    ctx.lineTo(ac.x, ac.y + 4);
    ctx.stroke();

    ctx.restore();
  }

  _drawAxisAlignedEllipsoidSlice(ctx, ell, cfg, sliceCoord, toScreen, pxPerMm, style) {
    const fixedR = ell.radii[cfg.fixedAxis];
    if (fixedR <= 0) return null;
    const normDist = (sliceCoord - ell.center[cfg.fixedAxis]) / fixedR;
    if (Math.abs(normDist) >= 1) return null;

    const scaleFactor = Math.sqrt(1 - normDist * normDist);
    const rxPx = ell.radii[cfg.hAxis] * scaleFactor * pxPerMm;
    const ryPx = ell.radii[cfg.vAxis] * scaleFactor * pxPerMm;
    if (rxPx < 0.8 || ryPx < 0.8) return null;

    const p = toScreen(ell.center);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rxPx, ryPx, 0, 0, Math.PI * 2);
    if (style.fill) {
      ctx.fillStyle = style.fill;
      ctx.fill();
    }
    if (style.dashed) ctx.setLineDash(style.dashed);
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.lineWidth || 1.2;
      ctx.stroke();
    }
    ctx.restore();
    return { x: p.x, y: p.y, rxPx, ryPx };
  }

  _drawSliceVentriclesAndBrainstem(ctx, cfg, sliceCoord, toScreen, pxPerMm) {
    const ref = this.atlasData?.brainReference;
    const brainstem = Array.isArray(ref?.brainstemEllipsoids) && ref.brainstemEllipsoids.length
      ? ref.brainstemEllipsoids
      : FALLBACK_BRAINSTEM;
    const ventricles = Array.isArray(ref?.ventricles) && ref.ventricles.length
      ? ref.ventricles
      : FALLBACK_VENTRICLES;

    for (const seg of brainstem) {
      this._drawAxisAlignedEllipsoidSlice(ctx, seg, cfg, sliceCoord, toScreen, pxPerMm, {
        fill: 'rgba(100, 116, 139, 0.24)',
        stroke: 'rgba(148, 163, 184, 0.36)',
        lineWidth: 1,
      });
    }

    for (const v of ventricles) {
      const list = Array.isArray(v.ellipsoids) ? v.ellipsoids : [];
      for (const ell of list) {
        this._drawAxisAlignedEllipsoidSlice(ctx, ell, cfg, sliceCoord, toScreen, pxPerMm, {
          fill: 'rgba(14, 165, 233, 0.22)',
          stroke: 'rgba(56, 189, 248, 0.42)',
          lineWidth: 0.9,
        });
      }
    }
  }

  _drawSliceStructures(ctx, cfg, sliceCoord, toScreen, pxPerMm, highlightSet, selectedId) {
    const structures = this.atlasData?.structures;
    if (!Array.isArray(structures)) return;

    for (const s of structures) {
      if (!this._isStructureVisible(s.id)) continue;
      const isEmph = highlightSet.has(s.id) || selectedId === s.id;
      let labelPos = null;

      for (const ell of s.ellipsoids || []) {
        const res = this._drawAxisAlignedEllipsoidSlice(ctx, ell, cfg, sliceCoord, toScreen, pxPerMm, {
          fill: hexToRgba(s.color, isEmph ? 0.52 : 0.3),
          stroke: hexToRgba(s.color, isEmph ? 0.98 : 0.82),
          lineWidth: isEmph ? 1.9 : 1.2,
        });
        if (res && (!labelPos || res.rxPx * res.ryPx > labelPos.area)) {
          labelPos = { x: res.x, y: res.y, area: res.rxPx * res.ryPx, rx: res.rxPx };
        }
      }

      if (labelPos && (this.state.showLabels || isEmph) && (labelPos.rx >= 4.5 || isEmph)) {
        ctx.save();
        ctx.font = `600 9px ${FONT_SANS}`;
        ctx.fillStyle = brightenHex(s.color, 0.4, 0.95);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.shortName || s.name, labelPos.x, labelPos.y);
        ctx.restore();
      }
    }
  }

  _drawSliceTracts(ctx, cfg, sliceCoord, toScreen, highlightSet, selectedId) {
    const isDec = this.state.tractColorMode === 'dec';
    const slabMm = 3.5;

    for (let tIdx = 0; tIdx < this._tractCache.length; tIdx++) {
      const { tract, preparedLines } = this._tractCache[tIdx];
      if (!this._isTractVisible(tract.id)) continue;
      const isEmph = highlightSet.has(tract.id) || selectedId === tract.id;

      for (let sIdx = 0; sIdx < preparedLines.length; sIdx++) {
        const { pts, decColors } = preparedLines[sIdx];
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i];
          const p1 = pts[i + 1];
          const d0 = p0[cfg.fixedAxis] - sliceCoord;
          const d1 = p1[cfg.fixedAxis] - sliceCoord;
          const color = isDec ? decColors[i] : tract.color;

          // In-slab proximity ribbon segment (tract running near/in plane)
          const minAbs = Math.min(Math.abs(d0), Math.abs(d1));
          if (minAbs <= slabMm) {
            const s0 = toScreen(p0);
            const s1 = toScreen(p1);
            const proxAlpha = (1 - minAbs / slabMm) * (isEmph ? 0.95 : 0.72);
            ctx.beginPath();
            ctx.moveTo(s0.x, s0.y);
            ctx.lineTo(s1.x, s1.y);
            ctx.strokeStyle = hexToRgba(color, proxAlpha);
            ctx.lineWidth = isEmph ? 2.4 : 1.65;
            ctx.stroke();
          }

          // Exact plane crossing pierce dot
          if ((d0 <= 0 && d1 >= 0) || (d0 >= 0 && d1 <= 0)) {
            const denom = d0 - d1;
            const t = Math.abs(denom) > 1e-6 ? d0 / denom : 0.5;
            const crossPt = [
              p0[0] + t * (p1[0] - p0[0]),
              p0[1] + t * (p1[1] - p0[1]),
              p0[2] + t * (p1[2] - p0[2]),
            ];
            const sp = toScreen(crossPt);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, isEmph ? 3.2 : 2.3, 0, Math.PI * 2);
            ctx.fillStyle = brightenHex(color, 0.25, 0.96);
            ctx.fill();
          }
        }
      }
    }
  }

  _drawSliceLesion(ctx, cfg, sliceCoord, toScreen, pxPerMm) {
    const lesion = this.state.lesion;
    if (!lesion) return;
    const coreColor = lesion.color || '#ec4899';
    const edemaColor = lesion.edemaColor || '#fbbf24';

    if (this.state.showEdema && lesion.edemaEllipsoid) {
      this._drawAxisAlignedEllipsoidSlice(ctx, lesion.edemaEllipsoid, cfg, sliceCoord, toScreen, pxPerMm, {
        fill: hexToRgba(edemaColor, 0.16),
        stroke: hexToRgba(edemaColor, 0.6),
        lineWidth: 1.1,
        dashed: [4, 3],
      });
    }

    for (const lobe of [lesion.primaryEllipsoid, lesion.secondaryEllipsoid]) {
      if (!lobe) continue;
      this._drawAxisAlignedEllipsoidSlice(ctx, lobe, cfg, sliceCoord, toScreen, pxPerMm, {
        fill: hexToRgba(coreColor, 0.48),
        stroke: brightenHex(coreColor, 0.25, 0.95),
        lineWidth: 1.75,
      });
    }

    // Nearby NIfTI mask voxel dots within ±3 mm of current slice plane
    if (Array.isArray(lesion.pointCloudMni)) {
      ctx.fillStyle = brightenHex(coreColor, 0.3, 0.72);
      for (let i = 0; i < lesion.pointCloudMni.length; i++) {
        const pt = lesion.pointCloudMni[i];
        if (Math.abs(pt[cfg.fixedAxis] - sliceCoord) <= 3.0) {
          const sp = toScreen(pt);
          ctx.fillRect(sp.x - 1, sp.y - 1, 2, 2);
        }
      }
    }
  }

  _drawSliceCorridor(ctx, cfg, sliceCoord, toScreen, pxPerMm, corridor, isGhost) {
    if (!corridor || !Array.isArray(corridor.entryMni) || !Array.isArray(corridor.targetMni)) return;
    const a = corridor.entryMni;
    const b = corridor.targetMni;
    const radiusMm = Math.max(1.5, Number(corridor.radiusMm) || 6);
    const tier = this.state.analysis?.overallRiskTier || 'safe';
    const color = isGhost ? '#38bdf8' : RISK_COLORS[tier] || RISK_COLORS.safe;

    const pA = toScreen(a);
    const pB = toScreen(b);

    ctx.save();
    // 1. Projected full trajectory guide line
    ctx.setLineDash(isGhost ? [4, 4] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.strokeStyle = hexToRgba(color, isGhost ? 0.55 : 0.65);
    ctx.lineWidth = isGhost ? 1.2 : 1.4;
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Corridor width envelope along the sub-segment intersecting this slice slab (|coord - slice| <= r)
    const dA = a[cfg.fixedAxis] - sliceCoord;
    const dB = b[cfg.fixedAxis] - sliceCoord;
    const diff = dB - dA;

    let tMin = 0;
    let tMax = 1;
    let intersectsSlab = false;

    if (Math.abs(diff) < 1e-6) {
      intersectsSlab = Math.abs(dA) <= radiusMm;
    } else {
      const t1 = (-radiusMm - dA) / diff;
      const t2 = (radiusMm - dA) / diff;
      tMin = clamp(Math.min(t1, t2), 0, 1);
      tMax = clamp(Math.max(t1, t2), 0, 1);
      intersectsSlab = tMax > tMin || (Math.abs(dA) <= radiusMm || Math.abs(dB) <= radiusMm);
    }

    if (intersectsSlab && !isGhost) {
      const s0 = toScreen([
        a[0] + tMin * (b[0] - a[0]),
        a[1] + tMin * (b[1] - a[1]),
        a[2] + tMin * (b[2] - a[2]),
      ]);
      const s1 = toScreen([
        a[0] + tMax * (b[0] - a[0]),
        a[1] + tMax * (b[1] - a[1]),
        a[2] + tMax * (b[2] - a[2]),
      ]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.strokeStyle = hexToRgba(color, 0.24);
      ctx.lineWidth = Math.max(3, radiusMm * 2 * pxPerMm);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.strokeStyle = hexToRgba(color, 0.92);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // 3. Exact centerline plane-pierce ring
    if ((dA <= 0 && dB >= 0) || (dA >= 0 && dB <= 0)) {
      const tCross = Math.abs(diff) > 1e-6 ? -dA / diff : 0.5;
      const crossPt = [
        a[0] + tCross * (b[0] - a[0]),
        a[1] + tCross * (b[1] - a[1]),
        a[2] + tCross * (b[2] - a[2]),
      ];
      const sp = toScreen(crossPt);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(2.5, radiusMm * pxPerMm), 0, Math.PI * 2);
      ctx.strokeStyle = brightenHex(color, 0.25, isGhost ? 0.7 : 0.95);
      ctx.lineWidth = isGhost ? 1.1 : 1.65;
      if (isGhost) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4. Entry & Target markers
    if (!isGhost) {
      // Entry hollow ring
      ctx.beginPath();
      ctx.arc(pA.x, pA.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#090d14';
      ctx.fill();
      ctx.strokeStyle = brightenHex(color, 0.3, 0.95);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Target crosshair bullseye
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(pB.x, pB.y, 4.5, 0, Math.PI * 2);
      ctx.moveTo(pB.x - 7, pB.y);
      ctx.lineTo(pB.x + 7, pB.y);
      ctx.moveTo(pB.x, pB.y - 7);
      ctx.lineTo(pB.x, pB.y + 7);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawSliceChrome(ctx, cfg, sliceCoord, w, h) {
    ctx.save();

    // Header: Plane title at top-left, live signed coordinate at top-right (never overlaps top orientation glyph)
    ctx.font = `700 10px ${FONT_MONO}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = cfg.accent;
    ctx.fillText(cfg.title, 8, 6);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`${cfg.axisLabel} = ${formatSignedMm(sliceCoord, 0)} mm`, w - 8, 6);

    // Radiological orientation edge glyphs (R/L, A/P, S/I)
    ctx.font = `700 10.5px ${FONT_MONO}`;
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(cfg.edgeLeft, 9, h * 0.5 + 3);
    ctx.fillText(cfg.edgeRight, w - 9, h * 0.5 + 3);
    ctx.fillText(cfg.edgeTop, w * 0.5, 11);
    ctx.fillText(cfg.edgeBottom, w * 0.5, h - 9);

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // 3. PROBE'S-EYE VIEW CANVAS (DOWN-THE-BARREL NEURONAVIGATION SCOPE)
  // -------------------------------------------------------------------------

  _renderProbeEye() {
    const ctx = this.ctxs.probe;
    const { w, h, dpr } = this.sizes.probe;
    if (!ctx || w <= 2 || h <= 2) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark surgical instrument housing background
    ctx.fillStyle = '#080c13';
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5 + 4;
    const scopeRadiusPx = Math.max(24, Math.min(w - 44, h - 54) * 0.5);

    // Fetch live ProbeCrossSectionData from geometryEngine analysis
    let data = null;
    if (this.state.analysis && typeof this.state.analysis.probeCrossSection === 'function') {
      try {
        data = this.state.analysis.probeCrossSection(this.state.probeDepthFraction);
      } catch (_) {
        data = null;
      }
    }

    // Scope circular backdrop
    const scopeGrad = ctx.createRadialGradient(cx, cy, scopeRadiusPx * 0.08, cx, cy, scopeRadiusPx);
    scopeGrad.addColorStop(0, '#0f192b');
    scopeGrad.addColorStop(0.75, '#0a111e');
    scopeGrad.addColorStop(1, '#060a12');

    ctx.beginPath();
    ctx.arc(cx, cy, scopeRadiusPx, 0, Math.PI * 2);
    ctx.fillStyle = scopeGrad;
    ctx.fill();

    if (!data || !this.state.corridor) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.font = `600 10.5px ${FONT_MONO}`;
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PROBE VIEW IDLE', cx, cy);
      ctx.restore();
      return;
    }

    const corridorRadiusMm = Math.max(1.5, Number(data.corridorRadiusMm) || 6);
    const viewRadiusMm = Math.max(Number(data.viewRadiusMm) || 28, corridorRadiusMm + 21);
    const pxPerMm = scopeRadiusPx / viewRadiusMm;
    const tier = this.state.analysis?.overallRiskTier || 'safe';
    const tierColor = RISK_COLORS[tier] || RISK_COLORS.safe;
    const isDec = this.state.tractColorMode === 'dec';
    const highlightSet = this._getHighlightSet();
    const selectedId = this.state.selectedHazardId || null;

    // Clipped scope interior
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, scopeRadiusPx, 0, Math.PI * 2);
    ctx.clip();

    // Radial 45-deg spokes & 5 mm axis tick marks
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 180; deg += 45) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(rad) * scopeRadiusPx, cy - Math.sin(rad) * scopeRadiusPx);
      ctx.lineTo(cx + Math.cos(rad) * scopeRadiusPx, cy + Math.sin(rad) * scopeRadiusPx);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    for (let mm = 5; mm < viewRadiusMm; mm += 5) {
      const d = mm * pxPerMm;
      ctx.beginPath();
      ctx.moveTo(cx + d, cy - 2.5);
      ctx.lineTo(cx + d, cy + 2.5);
      ctx.moveTo(cx - d, cy - 2.5);
      ctx.lineTo(cx - d, cy + 2.5);
      ctx.moveTo(cx - 2.5, cy + d);
      ctx.lineTo(cx + 2.5, cy + d);
      ctx.moveTo(cx - 2.5, cy - d);
      ctx.lineTo(cx + 2.5, cy - d);
      ctx.stroke();
    }

    // 3A. Approaching / Intersecting Tumor & Edema Cross-Sections
    const lesion = data.lesion;
    const lesionColor = this.state.lesion?.color || '#ec4899';
    const edemaColor = this.state.lesion?.edemaColor || '#fbbf24';

    const drawProbeEllipse = (e, fill, stroke, lineWidth = 1.4, dashed = null) => {
      if (!e || e.rx2d <= 0 || e.ry2d <= 0) return;
      const sx = cx + e.u * pxPerMm;
      const sy = cy - e.v * pxPerMm;
      ctx.save();
      ctx.beginPath();
      // Canvas Y is inverted relative to +v (up), so ellipse tilt is -angleRad
      ctx.ellipse(sx, sy, e.rx2d * pxPerMm, e.ry2d * pxPerMm, -(e.angleRad || 0), 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (dashed) ctx.setLineDash(dashed);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
      ctx.restore();
    };

    if (lesion) {
      if (this.state.showEdema && lesion.edema) {
        drawProbeEllipse(lesion.edema, hexToRgba(edemaColor, 0.14), hexToRgba(edemaColor, 0.55), 1.1, [4, 3]);
      }
      if (lesion.secondary) {
        drawProbeEllipse(lesion.secondary, hexToRgba(lesionColor, 0.34), brightenHex(lesionColor, 0.2, 0.85), 1.5);
      }
      if (lesion.primary) {
        drawProbeEllipse(lesion.primary, hexToRgba(lesionColor, 0.44), brightenHex(lesionColor, 0.28, 0.96), 1.8);
      }
    }

    // 3B. Surrounding / Intersecting Eloquent Structures
    const probeStructures = Array.isArray(data.structures) ? data.structures : [];
    for (const s of probeStructures) {
      if (!s.intersectsPlane || !this._isStructureVisible(s.id)) continue;
      const isEmph = highlightSet.has(s.id) || selectedId === s.id;
      const strokeColor = s.riskTier === 'critical' ? RISK_COLORS.critical : s.color;
      drawProbeEllipse(
        s,
        hexToRgba(s.color, isEmph ? 0.56 : 0.34),
        hexToRgba(strokeColor, isEmph ? 1.0 : 0.88),
        isEmph ? 2.0 : 1.4,
      );

      const sx = cx + s.u * pxPerMm;
      const sy = cy - s.v * pxPerMm;
      ctx.font = `700 9px ${FONT_SANS}`;
      ctx.fillStyle = brightenHex(s.color, 0.45, 0.96);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.shortName || s.name, sx, sy);
    }

    // 3C. White-Matter Fiber Tracts Cross-Section Bundles
    const probeTracts = Array.isArray(data.tracts) ? data.tracts : [];
    for (const t of probeTracts) {
      if (!this._isTractVisible(t.id) || !Array.isArray(t.points2d) || t.points2d.length === 0) continue;
      const isEmph = highlightSet.has(t.id) || selectedId === t.id;

      let sumX = 0;
      let sumY = 0;
      let count = 0;

      for (const pt of t.points2d) {
        const sx = cx + pt.u * pxPerMm;
        const sy = cy - pt.v * pxPerMm;
        const c = isDec && pt.decColor ? pt.decColor : t.color;

        ctx.beginPath();
        ctx.arc(sx, sy, isEmph ? 5.2 : 4.0, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(c, isEmph ? 0.38 : 0.24);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sx, sy, isEmph ? 2.7 : 2.1, 0, Math.PI * 2);
        ctx.fillStyle = brightenHex(c, 0.22, 0.98);
        ctx.fill();

        sumX += sx;
        sumY += sy;
        count++;
      }

      if (count > 0) {
        const mx = sumX / count;
        const my = sumY / count - 8;
        ctx.font = `700 9px ${FONT_MONO}`;
        ctx.fillStyle = brightenHex(t.color, 0.35, 0.95);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const suffix = Number.isFinite(t.minClearanceMm) && t.minClearanceMm <= 12
          ? ` ${t.minClearanceMm.toFixed(1)}`
          : '';
        ctx.fillText(`${t.shortName || t.name}${suffix}`, mx, my);
      }
    }

    // 3D. Concentric Safety Rings: +20 mm scale, +10 mm caution, +5 mm critical, Corridor Lumen
    const drawSafetyRing = (radiusMm, stroke, lineWidth, dashed, tag, tagColor) => {
      const rPx = radiusMm * pxPerMm;
      if (rPx <= 1 || rPx > scopeRadiusPx + 2) return;
      ctx.save();
      if (dashed) ctx.setLineDash(dashed);
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.setLineDash([]);
      if (tag) {
        ctx.font = `600 8.5px ${FONT_MONO}`;
        ctx.fillStyle = tagColor || stroke;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const angle = -Math.PI * 0.25;
        ctx.fillText(tag, cx + Math.cos(angle) * rPx + 2, cy + Math.sin(angle) * rPx);
      }
      ctx.restore();
    };

    const critMm = RISK_THRESHOLDS?.criticalMm ?? 5.0;
    const cautMm = RISK_THRESHOLDS?.cautionMm ?? 10.0;

    drawSafetyRing(corridorRadiusMm + 20, 'rgba(100, 116, 139, 0.35)', 1, [2, 4], '+20', '#64748b');
    drawSafetyRing(corridorRadiusMm + cautMm, 'rgba(245, 158, 11, 0.65)', 1.2, [5, 4], '+10mm', '#f59e0b');
    drawSafetyRing(corridorRadiusMm + critMm, 'rgba(244, 63, 94, 0.78)', 1.35, [4, 3], '+5mm', '#f43f5e');

    // Corridor Lumen (exact radiusMm)
    const lumenPx = corridorRadiusMm * pxPerMm;
    ctx.beginPath();
    ctx.arc(cx, cy, lumenPx, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(tierColor, 0.16);
    ctx.fill();
    ctx.strokeStyle = brightenHex(tierColor, 0.25, 0.96);
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Precision center barrel crosshair
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();

    ctx.restore(); // end scope clip

    // Scope bezel ring
    ctx.beginPath();
    ctx.arc(cx, cy, scopeRadiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Rotating anatomical compass glyphs (R/L/A/P/S/I) around scope perimeter
    const frame = data.frame;
    if (frame) {
      ctx.font = `700 10px ${FONT_MONO}`;
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pad = 11;
      ctx.fillText(frame.uPositiveLabel || 'R', cx + scopeRadiusPx + pad, cy);
      ctx.fillText(frame.uNegativeLabel || 'L', cx - scopeRadiusPx - pad, cy);
      ctx.fillText(frame.vPositiveLabel || 'S', cx, cy - scopeRadiusPx - pad);
      ctx.fillText(frame.vNegativeLabel || 'I', cx, cy + scopeRadiusPx + pad);
    }

    // Top-left depth HUD readout
    const pct = Math.round(clamp(data.depthFraction ?? this.state.probeDepthFraction, 0, 1) * 100);
    const depthMm = Number.isFinite(data.depthMm) ? data.depthMm.toFixed(1) : '0.0';
    ctx.font = `700 10px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('PROBE', 8, 6);
    const probeTitleW = ctx.measureText('PROBE').width;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(` ${depthMm}mm (${pct}%)`, 8 + probeTitleW, 6);

    // Top-right closest-at-slice pill
    const closest = data.closestAtSlice;
    ctx.textAlign = 'right';
    if (closest && Number.isFinite(closest.clearanceMm)) {
      const cTier = closest.riskTier || getRiskTier(closest.clearanceMm);
      const cColor = RISK_COLORS[cTier] || '#94a3b8';
      ctx.fillStyle = cColor;
      ctx.fillText(`${closest.shortName || closest.name} ${closest.clearanceMm.toFixed(1)}mm`, w - 8, 6);
    } else {
      ctx.fillStyle = RISK_COLORS.safe;
      ctx.fillText(`CLEAR`, w - 8, 6);
    }

    // Bottom MNI plane origin readout
    if (Array.isArray(data.planeOriginMni)) {
      const [mx, my, mz] = data.planeOriginMni;
      ctx.font = `600 9px ${FONT_MONO}`;
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        `MNI [${formatSignedMm(mx, 0)}, ${formatSignedMm(my, 0)}, ${formatSignedMm(mz, 0)}]`,
        8,
        h - 5,
      );
      ctx.textAlign = 'right';
      ctx.fillText(`Ø ${(corridorRadiusMm * 2).toFixed(0)}mm`, w - 8, h - 5);
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 3D Shaded Ellipsoid Drawing Helper
// ---------------------------------------------------------------------------

function drawShadedEllipsoid3D(ctx, proj, colorHex, opts = {}) {
  const {
    fillAlpha = 0.45,
    rimAlpha = 0.78,
    rimWidth = 1.2,
    glow = false,
    glowColor = colorHex,
    isLesion = false,
  } = opts;

  const rx = Math.max(proj.rxPx, 1.8);
  const ry = Math.max(proj.ryPx, 1.8);

  ctx.save();
  ctx.translate(proj.sx, proj.sy);
  ctx.rotate(proj.angle);

  // Subtle outer halo for highlighted, selected, or neoplastic structures
  if (glow) {
    ctx.beginPath();
    ctx.ellipse(0, 0, rx + 3.5, ry + 3.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(glowColor, 0.34);
    ctx.lineWidth = 3.2;
    ctx.stroke();
  }

  // Unit-circle radial gradient transformed to exact projected 2D silhouette ellipse
  ctx.save();
  ctx.scale(rx, ry);

  const grad = ctx.createRadialGradient(-0.32, -0.34, 0.08, 0, 0, 1.04);
  grad.addColorStop(0, brightenHex(colorHex, isLesion ? 0.42 : 0.48, Math.min(0.95, fillAlpha + 0.22)));
  grad.addColorStop(0.58, hexToRgba(colorHex, fillAlpha));
  grad.addColorStop(1, darkenHex(colorHex, 0.45, Math.min(0.9, fillAlpha + 0.14)));

  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Inner lesion core texture ring for clear distinction from eloquent cortex
  if (isLesion) {
    ctx.beginPath();
    ctx.arc(-0.08, -0.06, 0.54, 0, Math.PI * 2);
    ctx.strokeStyle = brightenHex(colorHex, 0.55, 0.35);
    ctx.lineWidth = 1 / Math.max(rx, ry);
    ctx.stroke();
  }

  ctx.restore();

  // Crisp highlight rim stroke
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = brightenHex(colorHex, 0.25, rimAlpha);
  ctx.lineWidth = rimWidth;
  ctx.stroke();

  // Delicate upper-left specular crescent for 3D volumetric depth
  if (rx > 7 && ry > 7) {
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.78, ry * 0.78, 0, -Math.PI * 0.88, -Math.PI * 0.32);
    ctx.strokeStyle = `rgba(255, 255, 255, ${(rimAlpha * 0.32).toFixed(3)})`;
    ctx.lineWidth = 1.05;
    ctx.stroke();
  }

  ctx.restore();
}
