/**
 * NeuroCorridor-3D — Pure Stereotactic Computational Geometry Engine
 *
 * Pure, zero-DOM ES Module operating exclusively in MNI-152 RAS+ coordinates (mm):
 *   +X = Right, +Y = Anterior, +Z = Superior, Origin (0,0,0) = Anterior Commissure (AC).
 *
 * Educational & Research Sandbox — Not Approved for Clinical Neuronavigation.
 * 100% Browser-Local — Zero Uploads.
 */

export const MNI_BOUNDS = Object.freeze({
  x: Object.freeze([-72, 72]),
  y: Object.freeze([-105, 72]),
  z: Object.freeze([-55, 82]),
});

export const BRAIN_CENTER = Object.freeze([0, -16, 12]);
export const BRAIN_RADII = Object.freeze([68, 86, 66]);

export const RISK_THRESHOLDS = Object.freeze({
  criticalMm: 5.0,
  cautionMm: 10.0,
});

const EPS = 1e-12;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const INV_PHI = (Math.sqrt(5) - 1) / 2;
const INV_PHI2 = (3 - Math.sqrt(5)) / 2;

// ============================================================================
// 1. Exact 3D Vector Algebra Helpers
// ============================================================================

export function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecScale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vecLen(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function vecDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function vecNormalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= EPS) return [0, 0, 0];
  const inv = 1 / len;
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}

function clamp(val, min, max) {
  return val < min ? min : val > max ? max : val;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ============================================================================
// 2. Risk Classification & DTI DEC Color Mapping
// ============================================================================

/**
 * Classifies surgical clearance (mm) into canonical neurosurgical risk tiers.
 * @param {number} clearanceMm
 * @returns {'critical' | 'caution' | 'safe'}
 */
export function getRiskTier(clearanceMm) {
  if (!Number.isFinite(clearanceMm)) return 'safe';
  if (clearanceMm < RISK_THRESHOLDS.criticalMm) return 'critical';
  if (clearanceMm <= RISK_THRESHOLDS.cautionMm) return 'caution';
  return 'safe';
}

/**
 * Standard neuroradiological DTI Directionally Encoded Color (DEC) RGB:
 *   Red   = |tx| (Left-Right / commissural)
 *   Green = |ty| (Anterior-Posterior / association)
 *   Blue  = |tz| (Superior-Inferior / projection)
 * Clamped to [30..255] per channel for crisp legibility on dark neuronavigation UI.
 * @param {[number, number, number]} tangent
 * @returns {string} Hex color '#RRGGBB'
 */
export function tangentToDecColor(tangent) {
  const unit = vecNormalize(tangent);
  const tx = unit[0] === 0 && unit[1] === 0 && unit[2] === 0 ? 0 : unit[0];
  const ty = unit[0] === 0 && unit[1] === 0 && unit[2] === 0 ? 0 : unit[1];
  const tz = unit[0] === 0 && unit[1] === 0 && unit[2] === 0 ? 1 : unit[2];

  const r = clamp(Math.round(255 * Math.abs(tx)), 30, 255);
  const g = clamp(Math.round(255 * Math.abs(ty)), 30, 255);
  const b = clamp(Math.round(255 * Math.abs(tz)), 30, 255);

  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ============================================================================
// 3. Sculpted Analytical Brain Shell (Shared Between Math & 3D/2D Rendering)
// ============================================================================

/**
 * Evaluates the sculpted MNI-152 cortical shell for any non-zero direction [ux, uy, uz].
 * Combines base ellipsoid (C=[0,-16,12], R=[68,86,66]) with:
 *   - Longitudinal interhemispheric fissure indentation along midline falx
 *   - Orbital frontal floor flattening
 *   - Posterior tentorial / cerebellar lateral taper
 *   - Lateral-inferior temporal lobe prominence
 *
 * @param {number} ux
 * @param {number} uy
 * @param {number} uz
 * @returns {[number, number, number]} MNI-152 mm surface coordinate
 */
export function evaluateBrainShell(ux, uy, uz) {
  const len = Math.hypot(ux, uy, uz);
  const nx = len > EPS ? ux / len : 0;
  const ny = len > EPS ? uy / len : 0;
  const nz = len > EPS ? uz / len : 1;

  let sx = BRAIN_RADII[0] * nx;
  let sy = BRAIN_RADII[1] * ny;
  let sz = BRAIN_RADII[2] * nz;

  // 1. Longitudinal interhemispheric fissure indentation (superior/anterior/posterior falx groove)
  if (nz > -0.15) {
    const fissure =
      6.5 *
      Math.exp(-((nx / 0.13) ** 2)) *
      Math.max(0, (nz + 0.15) / 1.15);
    const superiorWeight = nz > 0 ? smoothstep(0.0, 0.18, nz) : 0;
    sz -= fissure * superiorWeight;
    sy -= 0.35 * fissure * ny;
  }

  // 2. Orbital frontal floor flattening (uy > 0.25 && uz < -0.20, pull Z upward up to 14 mm)
  const orbitalMask =
    smoothstep(0.15, 0.55, ny) * smoothstep(-0.15, -0.55, nz);
  sz += 14.0 * orbitalMask;

  // 3. Posterior tentorial / cerebellar lateral notch (uy < -0.35 && uz < -0.25, pull inward up to 10 mm)
  const tentorialMask =
    smoothstep(-0.25, -0.60, ny) * smoothstep(-0.20, -0.55, nz);
  sx -= 10.0 * tentorialMask * nx;

  // 4. Temporal lobe lateral-inferior contour prominence around |ux| in [0.65,0.95], uy in [-0.35,0.35], uz in [-0.55,-0.05]
  const absNx = Math.abs(nx);
  const tempLat = Math.exp(-(((absNx - 0.8) / 0.2) ** 2));
  const tempAP = Math.exp(-((ny / 0.35) ** 2));
  const tempSI = Math.exp(-(((nz + 0.3) / 0.22) ** 2));
  const temporalFactor = tempLat * tempAP * tempSI;
  if (absNx > EPS) {
    sx += Math.sign(nx) * 3.5 * temporalFactor;
  }
  sz -= 2.5 * temporalFactor;

  return [
    BRAIN_CENTER[0] + sx,
    BRAIN_CENTER[1] + sy,
    BRAIN_CENTER[2] + sz,
  ];
}

/**
 * Projects a 3D MNI point radially from BRAIN_CENTER onto the sculpted cortical shell.
 * @param {[number, number, number]} pointMni
 * @returns {[number, number, number]}
 */
export function projectToCorticalSurface(pointMni) {
  const dx = pointMni[0] - BRAIN_CENTER[0];
  const dy = pointMni[1] - BRAIN_CENTER[1];
  const dz = pointMni[2] - BRAIN_CENTER[2];
  if (Math.hypot(dx, dy, dz) <= EPS) {
    return evaluateBrainShell(0, 0, 1);
  }
  return evaluateBrainShell(dx, dy, dz);
}

/**
 * Tests whether a 3D MNI point lies on or inside the sculpted brain shell.
 * @param {[number, number, number]} pointMni
 * @returns {boolean}
 */
export function isInsideBrain(pointMni) {
  const dx = pointMni[0] - BRAIN_CENTER[0];
  const dy = pointMni[1] - BRAIN_CENTER[1];
  const dz = pointMni[2] - BRAIN_CENTER[2];
  const r = Math.hypot(dx, dy, dz);
  if (r <= EPS) return true;

  // One directional refinement aligns ray angle cleanly near sculpted creases
  const shellPt = evaluateBrainShell(dx, dy, dz);
  const shellRadius = Math.hypot(
    shellPt[0] - BRAIN_CENTER[0],
    shellPt[1] - BRAIN_CENTER[1],
    shellPt[2] - BRAIN_CENTER[2]
  );
  return r <= shellRadius + 1e-6;
}

// ============================================================================
// 4. Centripetal Catmull-Rom Spline Tract Densification
// ============================================================================

function lerpPoint(p0, p1, alpha) {
  return [
    p0[0] + (p1[0] - p0[0]) * alpha,
    p0[1] + (p1[1] - p0[1]) * alpha,
    p0[2] + (p1[2] - p0[2]) * alpha,
  ];
}

/**
 * Densifies a single 3D polyline using a centripetal Catmull-Rom spline (alpha = 0.5)
 * with linear phantom endpoints P_{-1} = 2*P_0 - P_1 and P_n = 2*P_{n-1} - P_{n-2}.
 * Guarantees zero cusps, zero self-intersections, and exact control-point interpolation.
 *
 * @param {Array<[number, number, number]>} points
 * @param {number} [samplesPerSegment=8]
 * @returns {Array<[number, number, number]>}
 */
export function sampleCatmullRomPolyline(points, samplesPerSegment = 8) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const steps = Math.max(1, Math.floor(samplesPerSegment));
  const n = points.length;

  if (n === 1) {
    return [[points[0][0], points[0][1], points[0][2]]];
  }

  if (n === 2) {
    const out = [];
    for (let s = 0; s <= steps; s++) {
      out.push(lerpPoint(points[0], points[1], s / steps));
    }
    return out;
  }

  const pStart = [
    2 * points[0][0] - points[1][0],
    2 * points[0][1] - points[1][1],
    2 * points[0][2] - points[1][2],
  ];
  const pEnd = [
    2 * points[n - 1][0] - points[n - 2][0],
    2 * points[n - 1][1] - points[n - 2][1],
    2 * points[n - 1][2] - points[n - 2][2],
  ];

  const ext = [pStart, ...points, pEnd];
  const out = [];

  for (let i = 0; i < n - 1; i++) {
    const P0 = ext[i];
    const P1 = ext[i + 1];
    const P2 = ext[i + 2];
    const P3 = ext[i + 3];

    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.max(vecDist(P0, P1), 1e-6));
    const t2 = t1 + Math.sqrt(Math.max(vecDist(P1, P2), 1e-6));
    const t3 = t2 + Math.sqrt(Math.max(vecDist(P2, P3), 1e-6));

    // Exact control point P1
    out.push([P1[0], P1[1], P1[2]]);

    for (let s = 1; s < steps; s++) {
      const t = t1 + (s / steps) * (t2 - t1);
      const A1 = lerpPoint(P0, P1, (t - t0) / (t1 - t0));
      const A2 = lerpPoint(P1, P2, (t - t1) / (t2 - t1));
      const A3 = lerpPoint(P2, P3, (t - t2) / (t3 - t2));
      const B1 = lerpPoint(A1, A2, (t - t0) / (t2 - t0));
      const B2 = lerpPoint(A2, A3, (t - t1) / (t3 - t1));
      const C = lerpPoint(B1, B2, (t - t1) / (t2 - t1));
      out.push(C);
    }
  }

  // Exact final control point
  const last = points[n - 1];
  out.push([last[0], last[1], last[2]]);
  return out;
}

/**
 * Densifies an array of white-matter control polylines via centripetal Catmull-Rom splines.
 * @param {Array<Array<[number, number, number]>>} controlPolylines
 * @param {number} [samplesPerSegment=10]
 * @returns {Array<Array<[number, number, number]>>}
 */
export function sampleCatmullRomBundle(controlPolylines, samplesPerSegment = 10) {
  if (!Array.isArray(controlPolylines)) return [];
  return controlPolylines.map((polyline) =>
    sampleCatmullRomPolyline(polyline, samplesPerSegment)
  );
}

function computeStreamlineTangents(streamline) {
  const m = streamline.length;
  if (m === 0) return [];
  if (m === 1) return [[0, 0, 1]];

  const tangents = new Array(m);
  for (let i = 0; i < m; i++) {
    let dir;
    if (i === 0) {
      dir = vecSub(streamline[1], streamline[0]);
    } else if (i === m - 1) {
      dir = vecSub(streamline[m - 1], streamline[m - 2]);
    } else {
      dir = vecSub(streamline[i + 1], streamline[i - 1]);
      if (vecLen(dir) <= EPS) {
        dir = vecSub(streamline[i + 1], streamline[i]);
      }
    }
    const unit = vecNormalize(dir);
    tangents[i] =
      unit[0] === 0 && unit[1] === 0 && unit[2] === 0 ? [0, 0, 1] : unit;
  }
  return tangents;
}

function buildStreamlineChunks(streamline, chunkSize = 8) {
  const chunks = [];
  const segCount = streamline.length - 1;
  if (segCount <= 0) return chunks;

  for (let start = 0; start < segCount; start += chunkSize) {
    const end = Math.min(segCount, start + chunkSize);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i <= end; i++) {
      const p = streamline[i];
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const cz = 0.5 * (minZ + maxZ);
    let radius = 0;
    for (let i = start; i <= end; i++) {
      const p = streamline[i];
      const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
      if (d > radius) radius = d;
    }
    chunks.push({ start, end, center: [cx, cy, cz], radius });
  }
  return chunks;
}

/**
 * Precomputes densified streamlines and unit tangents for all tracts in atlasData.
 * @param {object} atlasData
 * @param {number} [samplesPerSegment=10]
 * @returns {Array<object>}
 */
export function densifyAtlasTracts(atlasData, samplesPerSegment = 10) {
  if (!atlasData || !Array.isArray(atlasData.tracts)) return [];
  return atlasData.tracts.map((tract) => {
    const streamlines = sampleCatmullRomBundle(
      tract.controlPolylines || [],
      samplesPerSegment
    );
    const tangents = streamlines.map(computeStreamlineTangents);
    const _chunkBounds = streamlines.map((line) => buildStreamlineChunks(line, 8));
    return {
      ...tract,
      streamlines,
      tangents,
      _chunkBounds,
    };
  });
}

/** Alias exported for contract compatibility. */
export const buildDensifiedTracts = densifyAtlasTracts;

// ============================================================================
// 5. Exact Analytical 3D Distance Primitives
// ============================================================================

/**
 * Exact Euclidean distance from 3D point p to line segment [a, b].
 * Handles degenerate a == b cleanly without NaN.
 * @param {[number, number, number]} p
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
export function pointToSegmentDistance(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const abLenSq = abx * abx + aby * aby + abz * abz;

  if (abLenSq <= EPS) {
    return Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  }

  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const t = clamp((apx * abx + apy * aby + apz * abz) / abLenSq, 0, 1);

  const cx = a[0] + t * abx;
  const cy = a[1] + t * aby;
  const cz = a[2] + t * abz;
  return Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
}

/**
 * Exact 3D closest points between segments [a1, a2] and [b1, b2]
 * (Ericson, Real-Time Collision Detection §5.1.9).
 * Accurately handles skew, intersecting, parallel, collinear, and degenerate segments.
 *
 * @param {[number, number, number]} a1
 * @param {[number, number, number]} a2
 * @param {[number, number, number]} b1
 * @param {[number, number, number]} b2
 * @returns {{ distance: number, pointOnA: [number,number,number], pointOnB: [number,number,number], tA: number, tB: number }}
 */
export function closestPointsSegmentToSegment(a1, a2, b1, b2) {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d1z = a2[2] - a1[2];

  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  const d2z = b2[2] - b1[2];

  const rx = a1[0] - b1[0];
  const ry = a1[1] - b1[1];
  const rz = a1[2] - b1[2];

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0;
  let t = 0;

  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;

      if (denom > EPS * Math.max(1, a * e)) {
        s = clamp((b * f - c * e) / denom, 0, 1);
      } else {
        // Parallel or nearly parallel segments
        s = 0;
      }

      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const pointOnA = [a1[0] + d1x * s, a1[1] + d1y * s, a1[2] + d1z * s];
  const pointOnB = [b1[0] + d2x * t, b1[1] + d2y * t, b1[2] + d2z * t];
  const distance = Math.hypot(
    pointOnA[0] - pointOnB[0],
    pointOnA[1] - pointOnB[1],
    pointOnA[2] - pointOnB[2]
  );

  return { distance, pointOnA, pointOnB, tA: s, tB: t };
}

/**
 * Exact 3D Euclidean distance between segments [a1, a2] and [b1, b2].
 * @returns {number}
 */
export function segmentToSegmentDistance(a1, a2, b1, b2) {
  return closestPointsSegmentToSegment(a1, a2, b1, b2).distance;
}

/**
 * Exact closest point on an axis-aligned 3D solid ellipsoid using Eberly's 1D root-finding
 * with safeguarded Newton-Raphson + bisection (tolerance < 1e-10).
 * Returns distance === 0 and inside === true when p lies inside or on the ellipsoid.
 *
 * @param {[number, number, number]} p
 * @param {{ center: [number,number,number], radii: [number,number,number] }} ellipsoid
 * @returns {{ distance: number, closestPoint: [number,number,number], inside: boolean }}
 */
export function closestPointOnEllipsoid(p, ellipsoid) {
  const c = ellipsoid.center;
  const r = ellipsoid.radii;
  const rx = Math.max(r[0], 1e-9);
  const ry = Math.max(r[1], 1e-9);
  const rz = Math.max(r[2], 1e-9);

  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const dz = p[2] - c[2];

  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const sz = dz < 0 ? -1 : 1;

  const q0 = Math.abs(dx);
  const q1 = Math.abs(dy);
  const q2 = Math.abs(dz);

  const k = (q0 / rx) ** 2 + (q1 / ry) ** 2 + (q2 / rz) ** 2;
  if (k <= 1.0) {
    return {
      distance: 0,
      closestPoint: [p[0], p[1], p[2]],
      inside: true,
    };
  }

  const r0sq = rx * rx;
  const r1sq = ry * ry;
  const r2sq = rz * rz;
  const rq0sq = r0sq * q0 * q0;
  const rq1sq = r1sq * q1 * q1;
  const rq2sq = r2sq * q2 * q2;

  let tLo = 0;
  let tHi = Math.sqrt(rq0sq + rq1sq + rq2sq);
  let t = 0.5 * (tLo + tHi);

  for (let iter = 0; iter < 64; iter++) {
    const d0 = t + r0sq;
    const d1 = t + r1sq;
    const d2 = t + r2sq;
    const g = rq0sq / (d0 * d0) + rq1sq / (d1 * d1) + rq2sq / (d2 * d2) - 1.0;

    if (Math.abs(g) < 1e-12 || tHi - tLo <= 1e-11 * Math.max(1, t)) {
      break;
    }

    if (g > 0) {
      tLo = t;
    } else {
      tHi = t;
    }

    const dg =
      -2.0 *
      (rq0sq / (d0 * d0 * d0) +
        rq1sq / (d1 * d1 * d1) +
        rq2sq / (d2 * d2 * d2));

    let tNext = dg !== 0 ? t - g / dg : 0.5 * (tLo + tHi);
    if (!(tNext > tLo && tNext < tHi)) {
      tNext = 0.5 * (tLo + tHi);
    }
    t = tNext;
  }

  const x0 = (r0sq * q0) / (t + r0sq);
  const x1 = (r1sq * q1) / (t + r1sq);
  const x2 = (r2sq * q2) / (t + r2sq);

  const closestPoint = [c[0] + sx * x0, c[1] + sy * x1, c[2] + sz * x2];
  const distance = Math.hypot(q0 - x0, q1 - x1, q2 - x2);

  return { distance, closestPoint, inside: false };
}

/**
 * Exact Euclidean distance from 3D point p to the surface of a solid ellipsoid (0 if inside).
 * @returns {number}
 */
export function pointToEllipsoidSurfaceDistance(p, ellipsoid) {
  return closestPointOnEllipsoid(p, ellipsoid).distance;
}

/**
 * Exact closest points between line segment [a, b] and solid axis-aligned ellipsoid.
 * Performs exact unit-sphere intersection check first (returning distance 0 on overlap),
 * followed by 48-step Golden-Section minimization of the strictly unimodal convex distance.
 *
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @param {{ center: [number,number,number], radii: [number,number,number] }} ellipsoid
 * @returns {{ distance: number, pointOnSegment: [number,number,number], pointOnEllipsoid: [number,number,number], t: number }}
 */
export function closestPointSegmentToEllipsoid(a, b, ellipsoid) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const abLenSq = abx * abx + aby * aby + abz * abz;

  if (abLenSq <= EPS) {
    const res = closestPointOnEllipsoid(a, ellipsoid);
    return {
      distance: res.distance,
      pointOnSegment: [a[0], a[1], a[2]],
      pointOnEllipsoid: res.closestPoint,
      t: 0,
    };
  }

  // Exact intersection test in normalized unit-sphere coordinates
  const c = ellipsoid.center;
  const r = ellipsoid.radii;
  const invRx = 1 / Math.max(r[0], 1e-9);
  const invRy = 1 / Math.max(r[1], 1e-9);
  const invRz = 1 / Math.max(r[2], 1e-9);

  const ahx = (a[0] - c[0]) * invRx;
  const ahy = (a[1] - c[1]) * invRy;
  const ahz = (a[2] - c[2]) * invRz;

  const dhx = abx * invRx;
  const dhy = aby * invRy;
  const dhz = abz * invRz;

  const dhdh = dhx * dhx + dhy * dhy + dhz * dhz;
  const uMin =
    dhdh > EPS ? clamp(-(ahx * dhx + ahy * dhy + ahz * dhz) / dhdh, 0, 1) : 0;

  const vhx = ahx + uMin * dhx;
  const vhy = ahy + uMin * dhy;
  const vhz = ahz + uMin * dhz;
  if (vhx * vhx + vhy * vhy + vhz * vhz <= 1.0 + 1e-12) {
    const pt = [a[0] + uMin * abx, a[1] + uMin * aby, a[2] + uMin * abz];
    return {
      distance: 0,
      pointOnSegment: pt,
      pointOnEllipsoid: [pt[0], pt[1], pt[2]],
      t: uMin,
    };
  }

  // Segment is strictly exterior -> convex unimodal Golden-Section search on [0, 1]
  const evalAt = (u) =>
    pointToEllipsoidSurfaceDistance(
      [a[0] + u * abx, a[1] + u * aby, a[2] + u * abz],
      ellipsoid
    );

  let lo = 0;
  let hi = 1;
  let u1 = lo + INV_PHI2 * (hi - lo);
  let u2 = lo + INV_PHI * (hi - lo);
  let f1 = evalAt(u1);
  let f2 = evalAt(u2);

  for (let i = 0; i < 48; i++) {
    if (f1 < f2) {
      hi = u2;
      u2 = u1;
      f2 = f1;
      u1 = lo + INV_PHI2 * (hi - lo);
      f1 = evalAt(u1);
    } else {
      lo = u1;
      u1 = u2;
      f1 = f2;
      u2 = lo + INV_PHI * (hi - lo);
      f2 = evalAt(u2);
    }
  }

  // Compare converged interior point against exact endpoints u=0 and u=1
  let bestU = 0.5 * (lo + hi);
  let bestRes = closestPointOnEllipsoid(
    [a[0] + bestU * abx, a[1] + bestU * aby, a[2] + bestU * abz],
    ellipsoid
  );

  const res0 = closestPointOnEllipsoid(a, ellipsoid);
  if (res0.distance < bestRes.distance) {
    bestU = 0;
    bestRes = res0;
  }

  const res1 = closestPointOnEllipsoid(b, ellipsoid);
  if (res1.distance < bestRes.distance) {
    bestU = 1;
    bestRes = res1;
  }

  return {
    distance: bestRes.distance,
    pointOnSegment: [
      a[0] + bestU * abx,
      a[1] + bestU * aby,
      a[2] + bestU * abz,
    ],
    pointOnEllipsoid: bestRes.closestPoint,
    t: bestU,
  };
}

/**
 * Exact distance from line segment [a, b] to solid ellipsoid surface (0 on intersection).
 * @returns {number}
 */
export function segmentToEllipsoidSurfaceDistance(a, b, ellipsoid) {
  return closestPointSegmentToEllipsoid(a, b, ellipsoid).distance;
}

/**
 * Exact Euclidean surface-to-surface distance between two solid axis-aligned ellipsoids
 * using convex alternating projections verified by exact support-function dual bounds.
 * Returns 0 on overlap or contact.
 *
 * @param {{ center: [number,number,number], radii: [number,number,number] }} e1
 * @param {{ center: [number,number,number], radii: [number,number,number] }} e2
 * @returns {number}
 */
export function ellipsoidToEllipsoidDistance(e1, e2) {
  if (closestPointOnEllipsoid(e1.center, e2).inside) return 0;
  if (closestPointOnEllipsoid(e2.center, e1).inside) return 0;

  let p1 = e1.center;
  let bestDist = Infinity;

  for (let iter = 0; iter < 128; iter++) {
    const r2 = closestPointOnEllipsoid(p1, e2);
    if (r2.inside) return 0;

    const r1 = closestPointOnEllipsoid(r2.closestPoint, e1);
    if (r1.inside) return 0;

    p1 = r1.closestPoint;
    const d = r1.distance;
    bestDist = d;
    if (d <= 1e-6) return 0;

    // Exact separating-hyperplane dual lower bound along unit normal n = (p2 - p1) / d
    const nx = (r2.closestPoint[0] - p1[0]) / d;
    const ny = (r2.closestPoint[1] - p1[1]) / d;
    const nz = (r2.closestPoint[2] - p1[2]) / d;

    const s1 = Math.hypot(
      e1.radii[0] * nx,
      e1.radii[1] * ny,
      e1.radii[2] * nz
    );
    const s2 = Math.hypot(
      e2.radii[0] * nx,
      e2.radii[1] * ny,
      e2.radii[2] * nz
    );
    const centerProj =
      (e2.center[0] - e1.center[0]) * nx +
      (e2.center[1] - e1.center[1]) * ny +
      (e2.center[2] - e1.center[2]) * nz;
    const dualLowerBound = centerProj - s1 - s2;

    if (d - dualLowerBound <= 1e-5) {
      return d;
    }
  }

  return bestDist;
}

/**
 * Exact minimum Euclidean distance from a solid ellipsoid to a 3D polyline (0 on intersection).
 * Accelerated with exact sphere lower-bound pruning per segment.
 *
 * @param {{ center: [number,number,number], radii: [number,number,number] }} ellipsoid
 * @param {Array<[number, number, number]>} polyline
 * @returns {number}
 */
export function ellipsoidToPolylineDistance(ellipsoid, polyline) {
  if (!Array.isArray(polyline) || polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return pointToEllipsoidSurfaceDistance(polyline[0], ellipsoid);
  }

  const maxR = Math.max(
    ellipsoid.radii[0],
    ellipsoid.radii[1],
    ellipsoid.radii[2]
  );
  let bestDist = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const lowerBound = pointToSegmentDistance(ellipsoid.center, a, b) - maxR;
    if (lowerBound >= bestDist) continue;

    const d = segmentToEllipsoidSurfaceDistance(a, b, ellipsoid);
    if (d < bestDist) {
      bestDist = d;
      if (bestDist <= 0) return 0;
    }
  }

  return bestDist;
}

// ============================================================================
// 6. Corridor Reference Frame & Plane-Ellipsoid Cross-Sections (Probe's-Eye)
// ============================================================================

function dominantAxisLabel(v) {
  const ax = Math.abs(v[0]);
  const ay = Math.abs(v[1]);
  const az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] >= 0 ? 'R' : 'L';
  if (ay >= az) return v[1] >= 0 ? 'A' : 'P';
  return v[2] >= 0 ? 'S' : 'I';
}

/**
 * Builds canonical right-handed Probe's-Eye orthonormal basis along [entryMni -> targetMni].
 */
export function buildCorridorFrame(entryMni, targetMni) {
  const diff = vecSub(targetMni, entryMni);
  const len = vecLen(diff);
  const axis = len > EPS ? vecScale(diff, 1 / len) : [0, 0, -1];

  // Use superior [0,0,1] as screen-up unless trajectory is nearly vertical
  const upRef = Math.abs(axis[2]) > 0.92 ? [0, 1, 0] : [0, 0, 1];
  const uAxis = vecNormalize(vecCross(axis, upRef));
  const vAxis = vecNormalize(vecCross(uAxis, axis));

  return {
    origin: [entryMni[0], entryMni[1], entryMni[2]],
    target: [targetMni[0], targetMni[1], targetMni[2]],
    axis,
    uAxis,
    vAxis,
    uPositiveLabel: dominantAxisLabel(uAxis),
    uNegativeLabel: dominantAxisLabel(vecScale(uAxis, -1)),
    vPositiveLabel: dominantAxisLabel(vAxis),
    vNegativeLabel: dominantAxisLabel(vecScale(vAxis, -1)),
  };
}

/**
 * Exact analytical intersection of an axis-aligned 3D ellipsoid with an arbitrary 3D plane
 * P(u, v) = planeOrigin + u * uAxis + v * vAxis.
 * Returns null if the plane does not intersect the ellipsoid; otherwise returns the exact
 * 2D ellipse parameters { u, v, rx2d, ry2d, angleRad } in the plane's (u, v) frame.
 */
export function computePlaneEllipsoidSection(
  ellipsoid,
  planeOrigin,
  uAxis,
  vAxis
) {
  const c = ellipsoid.center;
  const rx = Math.max(ellipsoid.radii[0], 1e-9);
  const ry = Math.max(ellipsoid.radii[1], 1e-9);
  const rz = Math.max(ellipsoid.radii[2], 1e-9);

  // Transform plane origin and basis vectors into normalized unit-sphere ellipsoid space
  const o0 = (planeOrigin[0] - c[0]) / rx;
  const o1 = (planeOrigin[1] - c[1]) / ry;
  const o2 = (planeOrigin[2] - c[2]) / rz;

  const u0 = uAxis[0] / rx;
  const u1 = uAxis[1] / ry;
  const u2 = uAxis[2] / rz;

  const v0 = vAxis[0] / rx;
  const v1 = vAxis[1] / ry;
  const v2 = vAxis[2] / rz;

  // Quadratic form: A*u^2 + 2*B*u*v + C*v^2 + 2*D*u + 2*E*v + (o'.o' - 1) <= 0
  const A = u0 * u0 + u1 * u1 + u2 * u2;
  const B = u0 * v0 + u1 * v1 + u2 * v2;
  const C = v0 * v0 + v1 * v1 + v2 * v2;
  const D = u0 * o0 + u1 * o1 + u2 * o2;
  const E = v0 * o0 + v1 * o1 + v2 * o2;

  const det = A * C - B * B;
  if (det <= EPS) return null;

  const uc = -(C * D - B * E) / det;
  const vc = -(A * E - B * D) / det;

  const qMin = o0 * o0 + o1 * o1 + o2 * o2 + D * uc + E * vc;
  const s = 1.0 - qMin;
  if (s <= 1e-9) return null;

  // Symmetric 2x2 eigen-decomposition of [[A, B], [B, C]]
  const halfTrace = 0.5 * (A + C);
  const halfDiff = 0.5 * (A - C);
  const disc = Math.hypot(halfDiff, B);
  const lambda1 = Math.max(halfTrace + disc, EPS);
  const lambda2 = Math.max(halfTrace - disc, EPS);

  const angleRad = 0.5 * Math.atan2(2 * B, A - C);
  const rx2d = Math.sqrt(s / lambda1);
  const ry2d = Math.sqrt(s / lambda2);

  return { u: uc, v: vc, rx2d, ry2d, angleRad };
}

/**
 * Exact 2D distance from origin (0, 0) to a rotated 2D solid ellipse { u, v, rx2d, ry2d, angleRad }.
 */
function originTo2DEllipseDistance(sec) {
  const cosA = Math.cos(sec.angleRad);
  const sinA = Math.sin(sec.angleRad);
  // Vector from ellipse center (u, v) to origin (0, 0) rotated into ellipse principal axes
  const dx = -sec.u;
  const dy = -sec.v;
  const q0 = Math.abs(dx * cosA + dy * sinA);
  const q1 = Math.abs(-dx * sinA + dy * cosA);

  const r0 = Math.max(sec.rx2d, 1e-9);
  const r1 = Math.max(sec.ry2d, 1e-9);

  if ((q0 / r0) ** 2 + (q1 / r1) ** 2 <= 1.0) return 0;

  const r0sq = r0 * r0;
  const r1sq = r1 * r1;
  const rq0sq = r0sq * q0 * q0;
  const rq1sq = r1sq * q1 * q1;

  let tLo = 0;
  let tHi = Math.hypot(r0 * q0, r1 * q1);
  let t = 0.5 * (tLo + tHi);

  for (let iter = 0; iter < 48; iter++) {
    const d0 = t + r0sq;
    const d1 = t + r1sq;
    const g = rq0sq / (d0 * d0) + rq1sq / (d1 * d1) - 1.0;
    if (Math.abs(g) < 1e-11 || tHi - tLo <= 1e-10 * Math.max(1, t)) break;
    if (g > 0) tLo = t;
    else tHi = t;
    const dg = -2.0 * (rq0sq / (d0 * d0 * d0) + rq1sq / (d1 * d1 * d1));
    let tNext = dg !== 0 ? t - g / dg : 0.5 * (tLo + tHi);
    if (!(tNext > tLo && tNext < tHi)) tNext = 0.5 * (tLo + tHi);
    t = tNext;
  }

  const x0 = (r0sq * q0) / (t + r0sq);
  const x1 = (r1sq * q1) / (t + r1sq);
  return Math.hypot(q0 - x0, q1 - x1);
}

// ============================================================================
// 7. Full Stereotactic Surgical Corridor Analysis
// ============================================================================

function getSolidLesionEllipsoids(lesion) {
  if (!lesion) return [];
  const list = [];
  if (lesion.primaryEllipsoid) list.push(lesion.primaryEllipsoid);
  if (lesion.secondaryEllipsoid) list.push(lesion.secondaryEllipsoid);
  return list;
}

function estimateParenchymaDepthMm(entryMni, targetMni, trajectoryLengthMm) {
  if (trajectoryLengthMm <= EPS) return 0;
  const steps = 64;
  let insideCount = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const pt = [
      entryMni[0] + (targetMni[0] - entryMni[0]) * t,
      entryMni[1] + (targetMni[1] - entryMni[1]) * t,
      entryMni[2] + (targetMni[2] - entryMni[2]) * t,
    ];
    if (isInsideBrain(pt)) insideCount++;
  }
  return (insideCount / steps) * trajectoryLengthMm;
}

function closestCorridorToStructure(entryMni, targetMni, structure) {
  let best = {
    distance: Infinity,
    pointOnSegment: [entryMni[0], entryMni[1], entryMni[2]],
    pointOnEllipsoid: [entryMni[0], entryMni[1], entryMni[2]],
    t: 0,
  };
  for (const ellipsoid of structure.ellipsoids || []) {
    const res = closestPointSegmentToEllipsoid(entryMni, targetMni, ellipsoid);
    if (res.distance < best.distance) {
      best = res;
      if (best.distance <= 0) break;
    }
  }
  return best;
}

function closestCorridorToTract(entryMni, targetMni, tract) {
  let bestDist = Infinity;
  let bestPointA = [entryMni[0], entryMni[1], entryMni[2]];
  let bestPointB = [entryMni[0], entryMni[1], entryMni[2]];
  let bestTA = 0;

  const streamlines = tract.streamlines || tract.controlPolylines || [];
  const allChunks = tract._chunkBounds || null;

  for (let s = 0; s < streamlines.length; s++) {
    const line = streamlines[s];
    if (line.length === 1) {
      const res = closestPointsSegmentToSegment(
        entryMni,
        targetMni,
        line[0],
        line[0]
      );
      if (res.distance < bestDist) {
        bestDist = res.distance;
        bestPointA = res.pointOnA;
        bestPointB = res.pointOnB;
        bestTA = res.tA;
      }
      continue;
    }

    const chunks = allChunks && allChunks[s] ? allChunks[s] : null;
    if (chunks) {
      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const ch = chunks[cIdx];
        const lb =
          pointToSegmentDistance(ch.center, entryMni, targetMni) - ch.radius;
        if (lb >= bestDist) continue;

        for (let i = ch.start; i < ch.end; i++) {
          const res = closestPointsSegmentToSegment(
            entryMni,
            targetMni,
            line[i],
            line[i + 1]
          );
          if (res.distance < bestDist) {
            bestDist = res.distance;
            bestPointA = res.pointOnA;
            bestPointB = res.pointOnB;
            bestTA = res.tA;
            if (bestDist <= 1e-9) {
              return {
                distance: 0,
                pointOnSegment: bestPointA,
                pointOnTract: bestPointB,
                t: bestTA,
              };
            }
          }
        }
      }
    } else {
      for (let i = 0; i < line.length - 1; i++) {
        const res = closestPointsSegmentToSegment(
          entryMni,
          targetMni,
          line[i],
          line[i + 1]
        );
        if (res.distance < bestDist) {
          bestDist = res.distance;
          bestPointA = res.pointOnA;
          bestPointB = res.pointOnB;
          bestTA = res.tA;
          if (bestDist <= 1e-9) {
            return {
              distance: 0,
              pointOnSegment: bestPointA,
              pointOnTract: bestPointB,
              t: bestTA,
            };
          }
        }
      }
    }
  }

  return {
    distance: bestDist,
    pointOnSegment: bestPointA,
    pointOnTract: bestPointB,
    t: bestTA,
  };
}

function computeLesionToStructureDistance(lesionEllipsoids, structure) {
  if (lesionEllipsoids.length === 0) return Infinity;
  let best = Infinity;
  for (const le of lesionEllipsoids) {
    for (const se of structure.ellipsoids || []) {
      const d = ellipsoidToEllipsoidDistance(le, se);
      if (d < best) {
        best = d;
        if (best <= 0) return 0;
      }
    }
  }
  return best;
}

function computeLesionToTractDistance(lesionEllipsoids, tract) {
  if (lesionEllipsoids.length === 0) return Infinity;
  let best = Infinity;
  const streamlines = tract.streamlines || tract.controlPolylines || [];
  for (const le of lesionEllipsoids) {
    for (const line of streamlines) {
      const d = ellipsoidToPolylineDistance(le, line);
      if (d < best) {
        best = d;
        if (best <= 0) return 0;
      }
    }
  }
  return best;
}

/**
 * Performs comprehensive stereotactic hazard analysis for a surgical corridor
 * against every eloquent structure and white-matter fiber tract, plus lesion margins
 * and a Probe's-Eye orthogonal cross-section evaluator.
 *
 * @param {{ entryMni: [number,number,number], targetMni: [number,number,number], radiusMm: number, approachMode?: 'transcortical'|'endonasal' }} corridor
 * @param {{ primaryEllipsoid: object, secondaryEllipsoid?: object|null, edemaEllipsoid?: object|null }} lesion
 * @param {object} atlasData
 * @param {Array<object>} densifiedTracts
 */
export function analyzeSurgicalCorridor(
  corridor,
  lesion,
  atlasData,
  densifiedTracts
) {
  const entryMni = corridor.entryMni;
  const targetMni = corridor.targetMni;
  const corridorRadiusMm = Math.max(0, Number(corridor.radiusMm) || 0);
  const approachMode = corridor.approachMode || 'transcortical';

  const trajectoryLengthMm = vecDist(entryMni, targetMni);
  const corticalEntryDepthMm = estimateParenchymaDepthMm(
    entryMni,
    targetMni,
    trajectoryLengthMm
  );
  const corridorFrame = buildCorridorFrame(entryMni, targetMni);
  const lesionEllipsoids = getSolidLesionEllipsoids(lesion);

  const tractsList =
    Array.isArray(densifiedTracts) && densifiedTracts.length > 0
      ? densifiedTracts
      : densifyAtlasTracts(atlasData, 10);

  const structures = (atlasData?.structures || []).map((structure) => {
    const closest = closestCorridorToStructure(entryMni, targetMni, structure);
    const centerlineDistanceMm = closest.distance;
    const corridorClearanceMm = Math.max(
      0,
      centerlineDistanceMm - corridorRadiusMm
    );
    const lesionClearanceMm = computeLesionToStructureDistance(
      lesionEllipsoids,
      structure
    );

    return {
      id: structure.id,
      name: structure.name,
      shortName: structure.shortName,
      kind: 'structure',
      category: structure.category,
      hemisphere: structure.hemisphere,
      color: structure.color,
      centerlineDistanceMm,
      corridorClearanceMm,
      lesionClearanceMm,
      riskTier: getRiskTier(corridorClearanceMm),
      lesionRiskTier: getRiskTier(lesionClearanceMm),
      corridorClosestPoint: closest.pointOnSegment,
      hazardClosestPoint: closest.pointOnEllipsoid,
      depthFraction: closest.t,
    };
  });

  const tracts = tractsList.map((tract) => {
    const closest = closestCorridorToTract(entryMni, targetMni, tract);
    const centerlineDistanceMm = closest.distance;
    const corridorClearanceMm = Math.max(
      0,
      centerlineDistanceMm - corridorRadiusMm
    );
    const lesionClearanceMm = computeLesionToTractDistance(
      lesionEllipsoids,
      tract
    );

    return {
      id: tract.id,
      name: tract.name,
      shortName: tract.shortName,
      kind: 'tract',
      category: tract.system,
      hemisphere: tract.hemisphere,
      color: tract.color,
      centerlineDistanceMm,
      corridorClearanceMm,
      lesionClearanceMm,
      riskTier: getRiskTier(corridorClearanceMm),
      lesionRiskTier: getRiskTier(lesionClearanceMm),
      corridorClosestPoint: closest.pointOnSegment,
      hazardClosestPoint: closest.pointOnTract,
      depthFraction: closest.t,
    };
  });

  const sortedHazards = [...structures, ...tracts].sort((a, b) => {
    if (a.corridorClearanceMm !== b.corridorClearanceMm) {
      return a.corridorClearanceMm - b.corridorClearanceMm;
    }
    return a.centerlineDistanceMm - b.centerlineDistanceMm;
  });

  const criticalViolations = sortedHazards.filter(
    (h) => h.riskTier === 'critical'
  );
  const cautionStructures = sortedHazards.filter(
    (h) => h.riskTier === 'caution'
  );
  const proximityWarnings = sortedHazards.filter(
    (h) => h.corridorClearanceMm <= RISK_THRESHOLDS.cautionMm
  );

  const overallRiskTier =
    criticalViolations.length > 0
      ? 'critical'
      : cautionStructures.length > 0
      ? 'caution'
      : 'safe';

  const viewRadiusMm = Math.max(28, corridorRadiusMm + 20);
  const diff = vecSub(targetMni, entryMni);

  /**
   * Projects nearby structures, tracts, and lesion onto the orthogonal Probe's-Eye
   * plane at depthFraction in [0, 1] along [entryMni -> targetMni].
   */
  const probeCrossSection = (depthFraction) => {
    const df = clamp(Number(depthFraction) || 0, 0, 1);
    const depthMm = df * trajectoryLengthMm;
    const planeOriginMni = [
      entryMni[0] + diff[0] * df,
      entryMni[1] + diff[1] * df,
      entryMni[2] + diff[2] * df,
    ];

    const sliceStructures = [];
    for (const structure of atlasData?.structures || []) {
      for (const ellipsoid of structure.ellipsoids || []) {
        const sec = computePlaneEllipsoidSection(
          ellipsoid,
          planeOriginMni,
          corridorFrame.uAxis,
          corridorFrame.vAxis
        );
        if (sec) {
          const dist2d = originTo2DEllipseDistance(sec);
          const edgeClearanceMm = Math.max(0, dist2d - corridorRadiusMm);
          if (dist2d <= viewRadiusMm + 16) {
            sliceStructures.push({
              id: structure.id,
              name: structure.name,
              shortName: structure.shortName,
              color: structure.color,
              riskTier: getRiskTier(edgeClearanceMm),
              intersectsPlane: true,
              u: sec.u,
              v: sec.v,
              rx2d: sec.rx2d,
              ry2d: sec.ry2d,
              angleRad: sec.angleRad,
              edgeClearanceMm,
            });
          }
        }
      }
    }

    const sliceTracts = [];
    const nearPlaneSlabMm = 3.0;
    for (const tract of tractsList) {
      const points2d = [];
      const streamlines = tract.streamlines || tract.controlPolylines || [];
      const tangents = tract.tangents || [];

      for (let s = 0; s < streamlines.length; s++) {
        const line = streamlines[s];
        const tLine = tangents[s] || [];
        let addedForStreamline = false;

        for (let i = 0; i < line.length - 1; i++) {
          const p0 = line[i];
          const p1 = line[i + 1];
          const rel0 = vecSub(p0, planeOriginMni);
          const rel1 = vecSub(p1, planeOriginMni);
          const d0 = vecDot(rel0, corridorFrame.axis);
          const d1 = vecDot(rel1, corridorFrame.axis);

          if ((d0 <= 0 && d1 >= 0) || (d0 >= 0 && d1 <= 0)) {
            const denom = d1 - d0;
            const alpha = Math.abs(denom) > EPS ? clamp(-d0 / denom, 0, 1) : 0.5;
            const pt = lerpPoint(p0, p1, alpha);
            const rel = vecSub(pt, planeOriginMni);
            const u = vecDot(rel, corridorFrame.uAxis);
            const v = vecDot(rel, corridorFrame.vAxis);
            const radial = Math.hypot(u, v);

            if (radial <= viewRadiusMm + 6) {
              const clearanceMm = Math.max(0, radial - corridorRadiusMm);
              const tan =
                tLine[i] || vecNormalize(vecSub(p1, p0));
              points2d.push({
                u,
                v,
                decColor: tangentToDecColor(tan),
                clearanceMm,
              });
              addedForStreamline = true;
            }
          }
        }

        // Capture streamlines running nearly parallel within ±nearPlaneSlabMm
        if (!addedForStreamline && line.length > 0) {
          let bestIdx = -1;
          let bestAbsD = nearPlaneSlabMm;
          for (let i = 0; i < line.length; i++) {
            const d = Math.abs(
              vecDot(vecSub(line[i], planeOriginMni), corridorFrame.axis)
            );
            if (d <= bestAbsD) {
              bestAbsD = d;
              bestIdx = i;
            }
          }
          if (bestIdx >= 0) {
            const rel = vecSub(line[bestIdx], planeOriginMni);
            const u = vecDot(rel, corridorFrame.uAxis);
            const v = vecDot(rel, corridorFrame.vAxis);
            const radial = Math.hypot(u, v);
            if (radial <= viewRadiusMm + 6) {
              const clearanceMm = Math.max(
                0,
                Math.hypot(u, v, bestAbsD) - corridorRadiusMm
              );
              const tan = tLine[bestIdx] || [0, 0, 1];
              points2d.push({
                u,
                v,
                decColor: tangentToDecColor(tan),
                clearanceMm,
              });
            }
          }
        }
      }

      if (points2d.length > 0) {
        let minClearanceMm = Infinity;
        for (const pt of points2d) {
          if (pt.clearanceMm < minClearanceMm) minClearanceMm = pt.clearanceMm;
        }
        sliceTracts.push({
          id: tract.id,
          name: tract.name,
          shortName: tract.shortName,
          color: tract.color,
          riskTier: getRiskTier(minClearanceMm),
          minClearanceMm,
          points2d,
        });
      }
    }

    const lesionPrimary = lesion?.primaryEllipsoid
      ? computePlaneEllipsoidSection(
          lesion.primaryEllipsoid,
          planeOriginMni,
          corridorFrame.uAxis,
          corridorFrame.vAxis
        )
      : null;
    const lesionSecondary = lesion?.secondaryEllipsoid
      ? computePlaneEllipsoidSection(
          lesion.secondaryEllipsoid,
          planeOriginMni,
          corridorFrame.uAxis,
          corridorFrame.vAxis
        )
      : null;
    const lesionEdema = lesion?.edemaEllipsoid
      ? computePlaneEllipsoidSection(
          lesion.edemaEllipsoid,
          planeOriginMni,
          corridorFrame.uAxis,
          corridorFrame.vAxis
        )
      : null;

    let closestAtSlice = null;
    for (const s of sliceStructures) {
      if (!closestAtSlice || s.edgeClearanceMm < closestAtSlice.clearanceMm) {
        closestAtSlice = {
          name: s.name,
          shortName: s.shortName,
          clearanceMm: s.edgeClearanceMm,
          riskTier: s.riskTier,
        };
      }
    }
    for (const t of sliceTracts) {
      if (!closestAtSlice || t.minClearanceMm < closestAtSlice.clearanceMm) {
        closestAtSlice = {
          name: t.name,
          shortName: t.shortName,
          clearanceMm: t.minClearanceMm,
          riskTier: t.riskTier,
        };
      }
    }

    return {
      depthFraction: df,
      depthMm,
      planeOriginMni,
      corridorRadiusMm,
      viewRadiusMm,
      frame: corridorFrame,
      structures: sliceStructures,
      tracts: sliceTracts,
      lesion: {
        intersectsPlane: Boolean(lesionPrimary || lesionSecondary || lesionEdema),
        primary: lesionPrimary,
        secondary: lesionSecondary,
        edema: lesionEdema,
      },
      closestAtSlice,
    };
  };

  return {
    trajectoryLengthMm,
    corticalEntryDepthMm,
    corridorRadiusMm,
    approachMode,
    overallRiskTier,
    corridorFrame,
    structures,
    tracts,
    sortedHazards,
    criticalViolations,
    cautionStructures,
    proximityWarnings,
    probeCrossSection,
  };
}

// ============================================================================
// 8. Deterministic Stereotactic Corridor Optimizer (Zero Math.random)
// ============================================================================

function scoreCandidateClearances(hazards, trajectoryLengthMm) {
  let score = 100.0;
  let min1 = Infinity;
  let min2 = Infinity;
  let criticalCount = 0;
  let cautionCount = 0;

  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const c = h.corridorClearanceMm;
    const w =
      h.category === 'vascular' ||
      h.id.startsWith('cst_') ||
      h.id === 'optic_chiasm'
        ? 1.5
        : 1.0;

    if (c < RISK_THRESHOLDS.criticalMm) {
      score -= w * (60 + 40 * (RISK_THRESHOLDS.criticalMm - c));
      criticalCount++;
    } else if (c <= RISK_THRESHOLDS.cautionMm) {
      score -= w * 6 * (RISK_THRESHOLDS.cautionMm - c);
      cautionCount++;
    }

    if (c < min1) {
      min2 = min1;
      min1 = c;
    } else if (c < min2) {
      min2 = c;
    }
  }

  if (!Number.isFinite(min1)) min1 = 20;
  if (!Number.isFinite(min2)) min2 = min1;

  score += 12 * Math.min(min1, 20) + 3 * Math.min(min2, 20);
  score -= 0.65 * trajectoryLengthMm;

  const overallRiskTier =
    criticalCount > 0 ? 'critical' : cautionCount > 0 ? 'caution' : 'safe';

  return { score, minClearanceMm: min1, criticalCount, cautionCount, overallRiskTier };
}

function fastEvaluateCandidate(entryMni, targetMni, radiusMm, atlasData, tractsList) {
  const trajectoryLengthMm = vecDist(entryMni, targetMni);
  const hazards = [];

  for (const structure of atlasData?.structures || []) {
    const closest = closestCorridorToStructure(entryMni, targetMni, structure);
    hazards.push({
      id: structure.id,
      category: structure.category,
      corridorClearanceMm: Math.max(0, closest.distance - radiusMm),
    });
  }

  for (const tract of tractsList) {
    const closest = closestCorridorToTract(entryMni, targetMni, tract);
    hazards.push({
      id: tract.id,
      category: tract.system,
      corridorClearanceMm: Math.max(0, closest.distance - radiusMm),
    });
  }

  const metrics = scoreCandidateClearances(hazards, trajectoryLengthMm);
  return {
    trajectoryLengthMm,
    ...metrics,
  };
}

function generateDeterministicCandidateEntries(
  targetMni,
  approachMode,
  maxDepthMm,
  candidateCount
) {
  const entries = [];

  if (approachMode === 'endonasal') {
    const xs = [-6, -3, 0, 3, 6];
    const ys = [36, 42, 48];
    const zs = [-50, -46, -42, -38];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          const entry = [x, y, z];
          const len = vecDist(entry, targetMni);
          if (len >= 10 && len <= maxDepthMm) {
            entries.push(entry);
          }
        }
      }
    }
    if (entries.length === 0) {
      // Fallback without strict depth filter if target is unusually distant
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) {
            entries.push([x, y, z]);
          }
        }
      }
    }
    return entries;
  }

  // Transcortical Golden-Angle Fibonacci hemisphere on same hemisphere as targetMni
  const targetCount = Math.max(40, Math.floor(candidateCount));
  const hemiSign = targetMni[0] < 0 ? -1 : 1;
  const nearMidline = Math.abs(targetMni[0]) < 2.0;

  // Area of spherical cap z in [-0.25, 0.985] filtered by x*hemiSign >= 0.08 is ~44% of cap
  const totalSamples = Math.round(targetCount * (nearMidline ? 1.15 : 2.3));
  const fallbackEntries = [];

  for (let k = 0; k < totalSamples; k++) {
    const frac = (k + 0.5) / totalSamples;
    const uz = -0.25 + frac * (0.985 - (-0.25));
    const rXY = Math.sqrt(Math.max(0, 1 - uz * uz));
    const theta = k * GOLDEN_ANGLE;
    const ux = rXY * Math.cos(theta);
    const uy = rXY * Math.sin(theta);

    const hemiPass = nearMidline
      ? Math.abs(ux) >= 0.08
      : ux * hemiSign >= 0.08;
    if (!hemiPass) continue;

    const entry = evaluateBrainShell(ux, uy, uz);
    const len = vecDist(entry, targetMni);
    if (len >= 10 && len <= maxDepthMm) {
      entries.push(entry);
    } else if (len >= 5) {
      fallbackEntries.push(entry);
    }
  }

  return entries.length > 0 ? entries : fallbackEntries;
}

/**
 * Deterministically evaluates ~60 (endonasal) or ~90-144 (transcortical) candidate entry points,
 * maximizing minimum clearance to critical tracts/vessels while penalizing excessive depth.
 * Zero Math.random() usage — guaranteed 100% reproducible.
 *
 * @param {[number, number, number]} targetMni
 * @param {object} lesion
 * @param {object} atlasData
 * @param {Array<object>} densifiedTracts
 * @param {object} [options]
 */
export function optimizeEntryCorridor(
  targetMni,
  lesion,
  atlasData,
  densifiedTracts,
  options = {}
) {
  const {
    approachMode = 'transcortical',
    radiusMm = 6,
    currentCorridor = null,
    maxDepthMm = 95,
    candidateCount = 144,
  } = options;

  const tractsList =
    Array.isArray(densifiedTracts) && densifiedTracts.length > 0
      ? densifiedTracts
      : densifyAtlasTracts(atlasData, 10);

  const candidateEntries = generateDeterministicCandidateEntries(
    targetMni,
    approachMode,
    maxDepthMm,
    candidateCount
  );

  const scored = candidateEntries.map((entryMni) => {
    const res = fastEvaluateCandidate(
      entryMni,
      targetMni,
      radiusMm,
      atlasData,
      tractsList
    );
    return {
      corridor: {
        entryMni: [
          Number(entryMni[0].toFixed(2)),
          Number(entryMni[1].toFixed(2)),
          Number(entryMni[2].toFixed(2)),
        ],
        targetMni: [targetMni[0], targetMni[1], targetMni[2]],
        radiusMm,
        approachMode,
      },
      score: res.score,
      minClearanceMm: res.minClearanceMm,
      trajectoryLengthMm: res.trajectoryLengthMm,
      overallRiskTier: res.overallRiskTier,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.minClearanceMm !== a.minClearanceMm) {
      return b.minClearanceMm - a.minClearanceMm;
    }
    return a.trajectoryLengthMm - b.trajectoryLengthMm;
  });

  const best = scored[0];
  const bestCorridor = best
    ? best.corridor
    : {
        entryMni: projectToCorticalSurface(targetMni),
        targetMni: [targetMni[0], targetMni[1], targetMni[2]],
        radiusMm,
        approachMode,
      };

  const bestAnalysis = analyzeSurgicalCorridor(
    bestCorridor,
    lesion,
    atlasData,
    tractsList
  );
  const bestScoreMetrics = scoreCandidateClearances(
    bestAnalysis.sortedHazards,
    bestAnalysis.trajectoryLengthMm
  );
  const bestScore = bestScoreMetrics.score;

  let comparisonDelta = null;
  let improvementSummary = `Evaluated ${scored.length} deterministic ${approachMode} candidates; best trajectory achieves ${bestScoreMetrics.minClearanceMm.toFixed(
    1
  )} mm min clearance (${bestAnalysis.overallRiskTier.toUpperCase()}, ${bestAnalysis.trajectoryLengthMm.toFixed(
    1
  )} mm length).`;

  if (currentCorridor && currentCorridor.entryMni && currentCorridor.targetMni) {
    const curAnalysis = analyzeSurgicalCorridor(
      currentCorridor,
      lesion,
      atlasData,
      tractsList
    );
    const curMetrics = scoreCandidateClearances(
      curAnalysis.sortedHazards,
      curAnalysis.trajectoryLengthMm
    );

    const minClearanceDeltaMm =
      bestScoreMetrics.minClearanceMm - curMetrics.minClearanceMm;
    const trajectoryLengthDeltaMm =
      bestAnalysis.trajectoryLengthMm - curAnalysis.trajectoryLengthMm;
    const criticalCountDelta =
      bestAnalysis.criticalViolations.length -
      curAnalysis.criticalViolations.length;
    const cautionCountDelta =
      bestAnalysis.cautionStructures.length -
      curAnalysis.cautionStructures.length;
    const scoreDelta = bestScore - curMetrics.score;
    const improved = scoreDelta > 0.5;

    const sign = (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    const summary = improved
      ? `Safer ${approachMode} corridor found: min clearance ${sign(
          minClearanceDeltaMm
        )} mm (${curMetrics.minClearanceMm.toFixed(
          1
        )} -> ${bestScoreMetrics.minClearanceMm.toFixed(
          1
        )} mm), critical hazards ${curAnalysis.criticalViolations.length} -> ${
          bestAnalysis.criticalViolations.length
        }, trajectory ${sign(trajectoryLengthDeltaMm)} mm.`
      : `Current corridor is already near-optimal (min clearance ${curMetrics.minClearanceMm.toFixed(
          1
        )} mm, best alternative score delta ${sign(scoreDelta)}).`;

    comparisonDelta = {
      minClearanceDeltaMm,
      trajectoryLengthDeltaMm,
      criticalCountDelta,
      cautionCountDelta,
      scoreDelta,
      improved,
      summary,
    };
    improvementSummary = summary;
  }

  return {
    bestCorridor,
    bestAnalysis,
    analysis: bestAnalysis,
    bestScore,
    candidatesEvaluated: scored.length,
    topCandidates: scored.slice(0, 5),
    comparisonDelta,
    improvementSummary,
  };
}

// ============================================================================
// 9. Pure Browser-Local NIfTI-1 (.nii / .nii.gz) Mask Parser
// ============================================================================

function det3x3(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function readDatatypeInfo(datatype) {
  switch (datatype) {
    case 2:
      return {
        bytes: 1,
        read: (v, o) => v.getUint8(o),
      };
    case 4:
      return {
        bytes: 2,
        read: (v, o, le) => v.getInt16(o, le),
      };
    case 8:
      return {
        bytes: 4,
        read: (v, o, le) => v.getInt32(o, le),
      };
    case 16:
      return {
        bytes: 4,
        read: (v, o, le) => v.getFloat32(o, le),
      };
    case 64:
      return {
        bytes: 8,
        read: (v, o, le) => v.getFloat64(o, le),
      };
    case 256:
      return {
        bytes: 1,
        read: (v, o) => v.getInt8(o),
      };
    case 512:
      return {
        bytes: 2,
        read: (v, o, le) => v.getUint16(o, le),
      };
    case 768:
      return {
        bytes: 4,
        read: (v, o, le) => v.getUint32(o, le),
      };
    default:
      return null;
  }
}

/**
 * Parses a NIfTI-1 (.nii or gzip-compressed .nii.gz) binary mask strictly in browser memory.
 * Uses native DecompressionStream('gzip'), extracts sform/qform MNI affine, computes exact
 * mask volume, MNI centroid, equivalent axis-aligned bounding ellipsoid, and a deterministic
 * surface-prioritized 3D point cloud.
 *
 * @param {ArrayBuffer | ArrayBufferView} arrayBuffer
 * @param {{ fileName?: string|null, threshold?: number, maxPoints?: number }} [options]
 */
export async function parseMniNiftiMask(arrayBuffer, options = {}) {
  const { fileName = null, threshold = 0, maxPoints = 1200 } = options;
  const warnings = [];

  let rawBytes;
  if (arrayBuffer instanceof ArrayBuffer) {
    rawBytes = new Uint8Array(arrayBuffer);
  } else if (ArrayBuffer.isView(arrayBuffer)) {
    rawBytes = new Uint8Array(
      arrayBuffer.buffer,
      arrayBuffer.byteOffset,
      arrayBuffer.byteLength
    );
  } else {
    throw new TypeError('parseMniNiftiMask expects an ArrayBuffer or TypedArray.');
  }

  if (rawBytes.byteLength < 2) {
    throw new Error('Input NIfTI buffer is empty or truncated.');
  }

  // Decompress .nii.gz if gzip magic bytes 0x1f 0x8b are present
  let niftiBuffer;
  if (rawBytes[0] === 0x1f && rawBytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(
        'This runtime lacks DecompressionStream("gzip"); please decompress the .nii.gz file to .nii first.'
      );
    }
    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Blob([rawBytes]).stream().pipeThrough(ds);
    niftiBuffer = await new Response(decompressedStream).arrayBuffer();
  } else {
    niftiBuffer =
      rawBytes.byteOffset === 0 &&
      rawBytes.byteLength === rawBytes.buffer.byteLength
        ? rawBytes.buffer
        : rawBytes.slice().buffer;
  }

  if (niftiBuffer.byteLength < 348) {
    throw new Error(
      `Invalid NIfTI-1 file: expected at least 348 header bytes, got ${niftiBuffer.byteLength}.`
    );
  }

  const view = new DataView(niftiBuffer);

  // Determine endianness from sizeof_hdr === 348
  let littleEndian = true;
  if (view.getInt32(0, true) === 348) {
    littleEndian = true;
  } else if (view.getInt32(0, false) === 348) {
    littleEndian = false;
  } else {
    throw new Error(
      'Invalid NIfTI-1 header: sizeof_hdr does not equal 348 (neither little- nor big-endian).'
    );
  }

  // Validate NIfTI-1 magic bytes at offset 344..347
  const magic = String.fromCharCode(
    view.getUint8(344),
    view.getUint8(345),
    view.getUint8(346)
  );
  if (magic === 'ni1') {
    throw new Error(
      'Dual-file NIfTI (.hdr/.img) is not supported; please provide a single-file .nii or .nii.gz mask.'
    );
  }
  if (magic !== 'n+1') {
    warnings.push(
      `Unexpected NIfTI magic "${magic}" (expected "n+1"); attempting header parse anyway.`
    );
  }

  // Dimensions
  const ndim = view.getInt16(40, littleEndian);
  const nx = view.getInt16(42, littleEndian);
  const ny = view.getInt16(44, littleEndian);
  const nz = view.getInt16(46, littleEndian);
  const nt = ndim >= 4 ? view.getInt16(48, littleEndian) : 1;

  if (nx <= 0 || ny <= 0 || nz <= 0) {
    throw new Error(`Invalid NIfTI volume dimensions: [${nx}, ${ny}, ${nz}].`);
  }
  const totalVoxels = nx * ny * nz;
  if (totalVoxels > 150_000_000) {
    throw new Error(
      `NIfTI volume (${nx}x${ny}x${nz}) exceeds browser-local safety limit.`
    );
  }
  if (nt > 1) {
    warnings.push(`4D NIfTI detected (t=${nt}); reading first volume (t=0) only.`);
  }

  // Datatype & voxel spacing
  const datatype = view.getInt16(70, littleEndian);
  const dtInfo = readDatatypeInfo(datatype);
  if (!dtInfo) {
    throw new Error(`Unsupported NIfTI-1 datatype code: ${datatype}.`);
  }

  const qfacRaw = view.getFloat32(76, littleEndian);
  const qfac = qfacRaw < 0 ? -1 : 1;
  const dx = Math.abs(view.getFloat32(80, littleEndian)) || 1.0;
  const dy = Math.abs(view.getFloat32(84, littleEndian)) || 1.0;
  const dz = Math.abs(view.getFloat32(88, littleEndian)) || 1.0;

  const voxOffsetRaw = view.getFloat32(108, littleEndian);
  const dataOffset = Math.max(
    348,
    Number.isFinite(voxOffsetRaw) ? Math.floor(voxOffsetRaw) : 352
  );

  const sclSlope = view.getFloat32(112, littleEndian);
  const sclInter = view.getFloat32(116, littleEndian);
  const useScaling = Number.isFinite(sclSlope) && sclSlope !== 0;

  const requiredBytes = dataOffset + totalVoxels * dtInfo.bytes;
  if (niftiBuffer.byteLength < requiredBytes) {
    throw new Error(
      `Truncated NIfTI voxel payload: need ${requiredBytes} bytes, found ${niftiBuffer.byteLength}.`
    );
  }

  // Affine matrix resolution: sform > qform > diagonal fallback
  const qformCode = view.getInt16(252, littleEndian);
  const sformCode = view.getInt16(254, littleEndian);

  let affineSource = 'fallback';
  let affineMatrix = null;

  if (sformCode > 0) {
    const srowX = [
      view.getFloat32(280, littleEndian),
      view.getFloat32(284, littleEndian),
      view.getFloat32(288, littleEndian),
      view.getFloat32(292, littleEndian),
    ];
    const srowY = [
      view.getFloat32(296, littleEndian),
      view.getFloat32(300, littleEndian),
      view.getFloat32(304, littleEndian),
      view.getFloat32(308, littleEndian),
    ];
    const srowZ = [
      view.getFloat32(312, littleEndian),
      view.getFloat32(316, littleEndian),
      view.getFloat32(320, littleEndian),
      view.getFloat32(324, littleEndian),
    ];
    const m = [srowX, srowY, srowZ, [0, 0, 0, 1]];
    if (Math.abs(det3x3(m)) > EPS) {
      affineSource = 'sform';
      affineMatrix = m;
    } else {
      warnings.push('sform_code > 0 but sform matrix is singular; falling back.');
    }
  }

  if (!affineMatrix && qformCode > 0) {
    const qb = view.getFloat32(256, littleEndian);
    const qc = view.getFloat32(260, littleEndian);
    const qd = view.getFloat32(264, littleEndian);
    const qx = view.getFloat32(268, littleEndian);
    const qy = view.getFloat32(272, littleEndian);
    const qz = view.getFloat32(276, littleEndian);
    const qa = Math.sqrt(Math.max(0, 1.0 - (qb * qb + qc * qc + qd * qd)));

    const r00 = qa * qa + qb * qb - qc * qc - qd * qd;
    const r01 = 2 * (qb * qc - qa * qd);
    const r02 = 2 * (qb * qd + qa * qc);

    const r10 = 2 * (qb * qc + qa * qd);
    const r11 = qa * qa + qc * qc - qb * qb - qd * qd;
    const r12 = 2 * (qc * qd - qa * qb);

    const r20 = 2 * (qb * qd - qa * qc);
    const r21 = 2 * (qc * qd + qa * qb);
    const r22 = qa * qa + qd * qd - qb * qb - qc * qc;

    affineSource = 'qform';
    affineMatrix = [
      [r00 * dx, r01 * dy, r02 * dz * qfac, qx],
      [r10 * dx, r11 * dy, r12 * dz * qfac, qy],
      [r20 * dx, r21 * dy, r22 * dz * qfac, qz],
      [0, 0, 0, 1],
    ];
  }

  if (!affineMatrix) {
    affineSource = 'fallback';
    warnings.push(
      'No valid sform or qform affine found; using centered diagonal pixdim fallback (verify MNI alignment).'
    );
    affineMatrix = [
      [dx, 0, 0, -0.5 * (nx - 1) * dx],
      [0, dy, 0, -0.5 * (ny - 1) * dy],
      [0, 0, dz, -0.5 * (nz - 1) * dz],
      [0, 0, 0, 1],
    ];
  }

  const m00 = affineMatrix[0][0], m01 = affineMatrix[0][1], m02 = affineMatrix[0][2], m03 = affineMatrix[0][3];
  const m10 = affineMatrix[1][0], m11 = affineMatrix[1][1], m12 = affineMatrix[1][2], m13 = affineMatrix[1][3];
  const m20 = affineMatrix[2][0], m21 = affineMatrix[2][1], m22 = affineMatrix[2][2], m23 = affineMatrix[2][3];

  const colSpacing = [
    Math.hypot(m00, m10, m20) || dx,
    Math.hypot(m01, m11, m21) || dy,
    Math.hypot(m02, m12, m22) || dz,
  ];
  const voxelVolMm3 = Math.abs(det3x3(affineMatrix)) || dx * dy * dz;

  // Pass 1: Extract occupancy mask and exact moments / bounds
  const occupancy = new Uint8Array(totalVoxels);
  const strideJ = nx;
  const strideK = nx * ny;

  let voxelCount = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let bytePos = dataOffset;
  let idx = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let val = dtInfo.read(view, bytePos, littleEndian);
        bytePos += dtInfo.bytes;
        if (useScaling) {
          val = val * sclSlope + sclInter;
        }
        if (Number.isFinite(val) && val > threshold) {
          occupancy[idx] = 1;
          voxelCount++;

          const wx = m00 * i + m01 * j + m02 * k + m03;
          const wy = m10 * i + m11 * j + m12 * k + m13;
          const wz = m20 * i + m21 * j + m22 * k + m23;

          sumX += wx;
          sumY += wy;
          sumZ += wz;
          if (wx < minX) minX = wx;
          if (wy < minY) minY = wy;
          if (wz < minZ) minZ = wz;
          if (wx > maxX) maxX = wx;
          if (wy > maxY) maxY = wy;
          if (wz > maxZ) maxZ = wz;
        }
        idx++;
      }
    }
  }

  if (voxelCount === 0) {
    throw new Error(
      `No mask voxels exceeded threshold (${threshold}) in "${fileName || 'NIfTI volume'}".`
    );
  }

  // Pass 2: Collect 6-neighbor surface voxels for crisp, deterministic 3D point cloud
  const surfaceIndices = [];
  for (let k = 0; k < nz; k++) {
    const kOff = k * strideK;
    for (let j = 0; j < ny; j++) {
      const jkOff = kOff + j * strideJ;
      for (let i = 0; i < nx; i++) {
        const cur = jkOff + i;
        if (occupancy[cur] === 0) continue;

        const isSurface =
          i === 0 ||
          i === nx - 1 ||
          j === 0 ||
          j === ny - 1 ||
          k === 0 ||
          k === nz - 1 ||
          occupancy[cur - 1] === 0 ||
          occupancy[cur + 1] === 0 ||
          occupancy[cur - strideJ] === 0 ||
          occupancy[cur + strideJ] === 0 ||
          occupancy[cur - strideK] === 0 ||
          occupancy[cur + strideK] === 0;

        if (isSurface) {
          surfaceIndices.push(i, j, k);
        }
      }
    }
  }

  const surfaceCount = surfaceIndices.length / 3;
  const targetPts = Math.max(1, Math.floor(maxPoints));
  const pointCloudMni = [];

  if (surfaceCount <= targetPts) {
    for (let p = 0; p < surfaceCount; p++) {
      const i = surfaceIndices[p * 3];
      const j = surfaceIndices[p * 3 + 1];
      const k = surfaceIndices[p * 3 + 2];
      pointCloudMni.push([
        m00 * i + m01 * j + m02 * k + m03,
        m10 * i + m11 * j + m12 * k + m13,
        m20 * i + m21 * j + m22 * k + m23,
      ]);
    }
  } else {
    const step = surfaceCount / targetPts;
    for (let p = 0; p < targetPts; p++) {
      const sIdx = Math.min(surfaceCount - 1, Math.floor(p * step));
      const i = surfaceIndices[sIdx * 3];
      const j = surfaceIndices[sIdx * 3 + 1];
      const k = surfaceIndices[sIdx * 3 + 2];
      pointCloudMni.push([
        m00 * i + m01 * j + m02 * k + m03,
        m10 * i + m11 * j + m12 * k + m13,
        m20 * i + m21 * j + m22 * k + m23,
      ]);
    }
  }

  const centroidMni = [sumX / voxelCount, sumY / voxelCount, sumZ / voxelCount];
  const volumeCm3 = (voxelCount * voxelVolMm3) / 1000.0;

  const primaryEllipsoid = {
    center: [
      0.5 * (minX + maxX),
      0.5 * (minY + maxY),
      0.5 * (minZ + maxZ),
    ],
    radii: [
      Math.max(2.0, 0.5 * (maxX - minX + colSpacing[0])),
      Math.max(2.0, 0.5 * (maxY - minY + colSpacing[1])),
      Math.max(2.0, 0.5 * (maxZ - minZ + colSpacing[2])),
    ],
  };

  if (
    centroidMni[0] < MNI_BOUNDS.x[0] ||
    centroidMni[0] > MNI_BOUNDS.x[1] ||
    centroidMni[1] < MNI_BOUNDS.y[0] ||
    centroidMni[1] > MNI_BOUNDS.y[1] ||
    centroidMni[2] < MNI_BOUNDS.z[0] ||
    centroidMni[2] > MNI_BOUNDS.z[1]
  ) {
    warnings.push(
      `Mask centroid [${centroidMni.map((v) => v.toFixed(1)).join(', ')}] mm lies outside canonical MNI-152 atlas bounds; confirm mask is normalized to MNI-152 RAS+.`
    );
  }

  return {
    fileName,
    dimensions: [nx, ny, nz],
    voxelSpacingMm: colSpacing,
    affineSource,
    affineMatrix,
    voxelCount,
    volumeCm3,
    centroidMni,
    boundingBoxMni: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
    primaryEllipsoid,
    pointCloudMni,
    warnings,
  };
}
