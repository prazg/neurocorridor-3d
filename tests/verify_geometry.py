#!/usr/bin/env python3
"""
NeuroCorridor-3D — Python 3.12 Stdlib Geometry, Schema & Offline Hygiene Verification Suite.

Constraints:
  - Uses Python 3.12 standard library ONLY (json, math, pathlib, re, struct, gzip, sys).
  - ZERO third-party dependencies, ZERO Node.js calls, ZERO browser process spawning.
  - Exits 0 on full pass, non-zero on any failure.
"""

from __future__ import annotations

import gzip
import json
import math
import re
import struct
import sys
from pathlib import Path
from typing import Any

# =============================================================================
# Constants (Canonical MNI-152 RAS+ Specification)
# =============================================================================

REPO_ROOT = Path(__file__).resolve().parent.parent

MNI_BOUNDS = {
    "x": (-72.0, 72.0),
    "y": (-105.0, 72.0),
    "z": (-55.0, 82.0),
}
BRAIN_CENTER = (0.0, -16.0, 12.0)
BRAIN_RADII = (68.0, 86.0, 66.0)
CRITICAL_MM = 5.0
CAUTION_MM = 10.0

EPS = 1e-12
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))
INV_PHI = (math.sqrt(5.0) - 1.0) / 2.0
INV_PHI2 = (3.0 - math.sqrt(5.0)) / 2.0

EXPECTED_STRUCTURE_IDS = {
    "m1_left",
    "m1_right",
    "broca_left",
    "wernicke_left",
    "v1_bilateral",
    "sma_left",
    "sma_right",
    "thalamus_bilateral",
    "optic_chiasm",
    "ica_bilateral",
    "sss_midline",
}

EXPECTED_TRACT_IDS = {
    "cst_left",
    "cst_right",
    "af_left",
    "slf_left",
    "slf_right",
    "ifof_left",
    "ifof_right",
    "or_left",
    "or_right",
    "cc_commissure",
}

EXPECTED_CASE_IDS = {
    "case01_right_frontal_gbm",
    "case02_left_insular_lgg",
    "case03_left_tpo_met",
    "case04_left_parasagittal_meningioma",
    "case05_sellar_pituitary",
}

EXPECTED_QUIZ_IDS = {f"q{i:02d}" for i in range(1, 11)}

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# =============================================================================
# Independent Python Reference 3D Geometry Engine (Mirror of js/geometryEngine.js)
# =============================================================================

Vec3 = tuple[float, float, float]


def v_sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_scale(v: Vec3, s: float) -> Vec3:
    return (v[0] * s, v[1] * s, v[2] * s)


def v_dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_len(v: Vec3) -> float:
    return math.hypot(v[0], v[1], v[2])


def v_dist(a: Vec3, b: Vec3) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])


def clamp(val: float, lo: float, hi: float) -> float:
    return lo if val < lo else hi if val > hi else val


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def get_risk_tier(clearance_mm: float) -> str:
    if not math.isfinite(clearance_mm):
        return "safe"
    if clearance_mm < CRITICAL_MM:
        return "critical"
    if clearance_mm <= CAUTION_MM:
        return "caution"
    return "safe"


def evaluate_brain_shell(ux: float, uy: float, uz: float) -> Vec3:
    length = math.hypot(ux, uy, uz)
    if length > EPS:
        nx, ny, nz = ux / length, uy / length, uz / length
    else:
        nx, ny, nz = 0.0, 0.0, 1.0

    sx = BRAIN_RADII[0] * nx
    sy = BRAIN_RADII[1] * ny
    sz = BRAIN_RADII[2] * nz

    if nz > -0.15:
        fissure = 6.5 * math.exp(-((nx / 0.13) ** 2)) * max(0.0, (nz + 0.15) / 1.15)
        sup_weight = smoothstep(0.0, 0.18, nz) if nz > 0.0 else 0.0
        sz -= fissure * sup_weight
        sy -= 0.35 * fissure * ny

    orbital_mask = smoothstep(0.15, 0.55, ny) * smoothstep(-0.15, -0.55, nz)
    sz += 14.0 * orbital_mask

    tentorial_mask = smoothstep(-0.25, -0.60, ny) * smoothstep(-0.20, -0.55, nz)
    sx -= 10.0 * tentorial_mask * nx

    abs_nx = abs(nx)
    temp_lat = math.exp(-(((abs_nx - 0.8) / 0.2) ** 2))
    temp_ap = math.exp(-((ny / 0.35) ** 2))
    temp_si = math.exp(-(((nz + 0.3) / 0.22) ** 2))
    temporal_factor = temp_lat * temp_ap * temp_si
    if abs_nx > EPS:
        sx += (1.0 if nx > 0 else -1.0) * 3.5 * temporal_factor
    sz -= 2.5 * temporal_factor

    return (BRAIN_CENTER[0] + sx, BRAIN_CENTER[1] + sy, BRAIN_CENTER[2] + sz)


def is_inside_brain(pt: Vec3) -> bool:
    dx = pt[0] - BRAIN_CENTER[0]
    dy = pt[1] - BRAIN_CENTER[1]
    dz = pt[2] - BRAIN_CENTER[2]
    r = math.hypot(dx, dy, dz)
    if r <= EPS:
        return True
    shell_pt = evaluate_brain_shell(dx, dy, dz)
    shell_r = v_dist(shell_pt, BRAIN_CENTER)
    return r <= shell_r + 1e-6


def lerp_point(p0: Vec3, p1: Vec3, alpha: float) -> Vec3:
    return (
        p0[0] + (p1[0] - p0[0]) * alpha,
        p0[1] + (p1[1] - p0[1]) * alpha,
        p0[2] + (p1[2] - p0[2]) * alpha,
    )


def sample_catmull_rom_polyline(
    points: list[Vec3], samples_per_segment: int = 10
) -> list[Vec3]:
    if not points:
        return []
    steps = max(1, int(samples_per_segment))
    n = len(points)
    if n == 1:
        return [tuple(points[0])]
    if n == 2:
        return [lerp_point(points[0], points[1], s / steps) for s in range(steps + 1)]

    p_start = (
        2.0 * points[0][0] - points[1][0],
        2.0 * points[0][1] - points[1][1],
        2.0 * points[0][2] - points[1][2],
    )
    p_end = (
        2.0 * points[-1][0] - points[-2][0],
        2.0 * points[-1][1] - points[-2][1],
        2.0 * points[-1][2] - points[-2][2],
    )
    ext = [p_start, *points, p_end]
    out: list[Vec3] = []

    for i in range(n - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        t0 = 0.0
        t1 = t0 + math.sqrt(max(v_dist(p0, p1), 1e-6))
        t2 = t1 + math.sqrt(max(v_dist(p1, p2), 1e-6))
        t3 = t2 + math.sqrt(max(v_dist(p2, p3), 1e-6))

        out.append((p1[0], p1[1], p1[2]))
        for s in range(1, steps):
            t = t1 + (s / steps) * (t2 - t1)
            a1 = lerp_point(p0, p1, (t - t0) / (t1 - t0))
            a2 = lerp_point(p1, p2, (t - t1) / (t2 - t1))
            a3 = lerp_point(p2, p3, (t - t2) / (t3 - t2))
            b1 = lerp_point(a1, a2, (t - t0) / (t2 - t0))
            b2 = lerp_point(a2, a3, (t - t1) / (t3 - t1))
            c = lerp_point(b1, b2, (t - t1) / (t2 - t1))
            out.append(c)

    out.append((points[-1][0], points[-1][1], points[-1][2]))
    return out


def point_to_segment_distance(p: Vec3, a: Vec3, b: Vec3) -> float:
    ab = v_sub(b, a)
    ab_len_sq = v_dot(ab, ab)
    if ab_len_sq <= EPS:
        return v_dist(p, a)
    t = clamp(v_dot(v_sub(p, a), ab) / ab_len_sq, 0.0, 1.0)
    closest = v_add(a, v_scale(ab, t))
    return v_dist(p, closest)


def closest_points_segment_to_segment(
    a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3
) -> tuple[float, Vec3, Vec3, float, float]:
    d1 = v_sub(a2, a1)
    d2 = v_sub(b2, b1)
    r = v_sub(a1, b1)
    a = v_dot(d1, d1)
    e = v_dot(d2, d2)
    f = v_dot(d2, r)

    s = 0.0
    t = 0.0
    if a <= EPS and e <= EPS:
        s, t = 0.0, 0.0
    elif a <= EPS:
        s = 0.0
        t = clamp(f / e, 0.0, 1.0)
    else:
        c = v_dot(d1, r)
        if e <= EPS:
            t = 0.0
            s = clamp(-c / a, 0.0, 1.0)
        else:
            b = v_dot(d1, d2)
            denom = a * e - b * b
            if denom > EPS * max(1.0, a * e):
                s = clamp((b * f - c * e) / denom, 0.0, 1.0)
            else:
                s = 0.0
            t = (b * s + f) / e
            if t < 0.0:
                t = 0.0
                s = clamp(-c / a, 0.0, 1.0)
            elif t > 1.0:
                t = 1.0
                s = clamp((b - c) / a, 0.0, 1.0)

    pa = v_add(a1, v_scale(d1, s))
    pb = v_add(b1, v_scale(d2, t))
    return v_dist(pa, pb), pa, pb, s, t


def segment_to_segment_distance(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3) -> float:
    return closest_points_segment_to_segment(a1, a2, b1, b2)[0]


def closest_point_on_ellipsoid(
    p: Vec3, ellipsoid: dict[str, Any]
) -> tuple[float, Vec3, bool]:
    c = ellipsoid["center"]
    r = ellipsoid["radii"]
    rx = max(float(r[0]), 1e-9)
    ry = max(float(r[1]), 1e-9)
    rz = max(float(r[2]), 1e-9)

    dx = p[0] - c[0]
    dy = p[1] - c[1]
    dz = p[2] - c[2]

    sx = -1.0 if dx < 0.0 else 1.0
    sy = -1.0 if dy < 0.0 else 1.0
    sz = -1.0 if dz < 0.0 else 1.0

    q0, q1, q2 = abs(dx), abs(dy), abs(dz)
    k = (q0 / rx) ** 2 + (q1 / ry) ** 2 + (q2 / rz) ** 2
    if k <= 1.0:
        return 0.0, (p[0], p[1], p[2]), True

    r0sq, r1sq, r2sq = rx * rx, ry * ry, rz * rz
    rq0sq = r0sq * q0 * q0
    rq1sq = r1sq * q1 * q1
    rq2sq = r2sq * q2 * q2

    t_lo = 0.0
    t_hi = math.sqrt(rq0sq + rq1sq + rq2sq)
    t = 0.5 * (t_lo + t_hi)

    for _ in range(64):
        d0, d1, d2 = t + r0sq, t + r1sq, t + r2sq
        g = rq0sq / (d0 * d0) + rq1sq / (d1 * d1) + rq2sq / (d2 * d2) - 1.0
        if abs(g) < 1e-12 or (t_hi - t_lo) <= 1e-11 * max(1.0, t):
            break
        if g > 0.0:
            t_lo = t
        else:
            t_hi = t
        dg = -2.0 * (
            rq0sq / (d0 * d0 * d0) + rq1sq / (d1 * d1 * d1) + rq2sq / (d2 * d2 * d2)
        )
        t_next = t - g / dg if dg != 0.0 else 0.5 * (t_lo + t_hi)
        if not (t_lo < t_next < t_hi):
            t_next = 0.5 * (t_lo + t_hi)
        t = t_next

    x0 = (r0sq * q0) / (t + r0sq)
    x1 = (r1sq * q1) / (t + r1sq)
    x2 = (r2sq * q2) / (t + r2sq)

    closest = (c[0] + sx * x0, c[1] + sy * x1, c[2] + sz * x2)
    dist = math.hypot(q0 - x0, q1 - x1, q2 - x2)
    return dist, closest, False


def point_to_ellipsoid_surface_distance(p: Vec3, ellipsoid: dict[str, Any]) -> float:
    return closest_point_on_ellipsoid(p, ellipsoid)[0]


def segment_to_ellipsoid_surface_distance(
    a: Vec3, b: Vec3, ellipsoid: dict[str, Any]
) -> float:
    ab = v_sub(b, a)
    if v_dot(ab, ab) <= EPS:
        return point_to_ellipsoid_surface_distance(a, ellipsoid)

    c = ellipsoid["center"]
    r = ellipsoid["radii"]
    inv_r = (1.0 / max(r[0], 1e-9), 1.0 / max(r[1], 1e-9), 1.0 / max(r[2], 1e-9))

    ah = ((a[0] - c[0]) * inv_r[0], (a[1] - c[1]) * inv_r[1], (a[2] - c[2]) * inv_r[2])
    dh = (ab[0] * inv_r[0], ab[1] * inv_r[1], ab[2] * inv_r[2])
    dhdh = v_dot(dh, dh)
    u_min = clamp(-v_dot(ah, dh) / dhdh, 0.0, 1.0) if dhdh > EPS else 0.0
    vh = v_add(ah, v_scale(dh, u_min))
    if v_dot(vh, vh) <= 1.0 + 1e-12:
        return 0.0

    def eval_at(u: float) -> float:
        return point_to_ellipsoid_surface_distance(v_add(a, v_scale(ab, u)), ellipsoid)

    lo, hi = 0.0, 1.0
    u1 = lo + INV_PHI2 * (hi - lo)
    u2 = lo + INV_PHI * (hi - lo)
    f1, f2 = eval_at(u1), eval_at(u2)
    for _ in range(48):
        if f1 < f2:
            hi, u2, f2 = u2, u1, f1
            u1 = lo + INV_PHI2 * (hi - lo)
            f1 = eval_at(u1)
        else:
            lo, u1, f1 = u1, u2, f2
            u2 = lo + INV_PHI * (hi - lo)
            f2 = eval_at(u2)

    mid = 0.5 * (lo + hi)
    return min(eval_at(mid), eval_at(0.0), eval_at(1.0))


def ellipsoid_to_ellipsoid_distance(
    e1: dict[str, Any], e2: dict[str, Any]
) -> float:
    c1 = tuple(e1["center"])
    c2 = tuple(e2["center"])
    if closest_point_on_ellipsoid(c1, e2)[2]:
        return 0.0
    if closest_point_on_ellipsoid(c2, e1)[2]:
        return 0.0

    p1 = c1
    best_dist = math.inf
    for _ in range(128):
        _, p2, inside2 = closest_point_on_ellipsoid(p1, e2)
        if inside2:
            return 0.0
        d, p1_next, inside1 = closest_point_on_ellipsoid(p2, e1)
        if inside1:
            return 0.0
        p1 = p1_next
        best_dist = d
        if d <= 1e-6:
            return 0.0

        n = v_scale(v_sub(p2, p1), 1.0 / d)
        s1 = math.hypot(e1["radii"][0] * n[0], e1["radii"][1] * n[1], e1["radii"][2] * n[2])
        s2 = math.hypot(e2["radii"][0] * n[0], e2["radii"][1] * n[1], e2["radii"][2] * n[2])
        dual_lb = v_dot(v_sub(c2, c1), n) - s1 - s2
        if d - dual_lb <= 1e-5:
            return d
    return best_dist


def ellipsoid_to_polyline_distance(
    ellipsoid: dict[str, Any], polyline: list[Vec3]
) -> float:
    if not polyline:
        return math.inf
    if len(polyline) == 1:
        return point_to_ellipsoid_surface_distance(polyline[0], ellipsoid)
    max_r = max(ellipsoid["radii"])
    c = tuple(ellipsoid["center"])
    best = math.inf
    for i in range(len(polyline) - 1):
        a, b = polyline[i], polyline[i + 1]
        if point_to_segment_distance(c, a, b) - max_r >= best:
            continue
        d = segment_to_ellipsoid_surface_distance(a, b, ellipsoid)
        if d < best:
            best = d
            if best <= 0.0:
                return 0.0
    return best


def _build_streamline_chunks(
    line: list[Vec3], chunk_size: int = 8
) -> list[tuple[int, int, Vec3, float]]:
    chunks: list[tuple[int, int, Vec3, float]] = []
    seg_count = len(line) - 1
    if seg_count <= 0:
        return chunks
    for start in range(0, seg_count, chunk_size):
        end = min(seg_count, start + chunk_size)
        xs = [line[i][0] for i in range(start, end + 1)]
        ys = [line[i][1] for i in range(start, end + 1)]
        zs = [line[i][2] for i in range(start, end + 1)]
        center = (0.5 * (min(xs) + max(xs)), 0.5 * (min(ys) + max(ys)), 0.5 * (min(zs) + max(zs)))
        radius = max(v_dist(line[i], center) for i in range(start, end + 1))
        chunks.append((start, end, center, radius))
    return chunks


def densify_tracts(atlas_data: dict[str, Any], samples: int = 10) -> list[dict[str, Any]]:
    out = []
    for tract in atlas_data["tracts"]:
        lines = [
            sample_catmull_rom_polyline([tuple(p) for p in pl], samples)
            for pl in tract["controlPolylines"]
        ]
        chunks = [_build_streamline_chunks(line, 8) for line in lines]
        out.append({**tract, "streamlines": lines, "_chunks": chunks})
    return out


def _corridor_to_tract_dist(entry: Vec3, target: Vec3, tract: dict[str, Any]) -> float:
    best = math.inf
    streamlines = tract["streamlines"]
    all_chunks = tract.get("_chunks", [])
    for idx, line in enumerate(streamlines):
        chunks = all_chunks[idx] if idx < len(all_chunks) else None
        if chunks:
            for start, end, center, radius in chunks:
                if point_to_segment_distance(center, entry, target) - radius >= best:
                    continue
                for i in range(start, end):
                    d = segment_to_segment_distance(entry, target, line[i], line[i + 1])
                    if d < best:
                        best = d
                        if best <= 1e-9:
                            return 0.0
        else:
            for i in range(len(line) - 1):
                d = segment_to_segment_distance(entry, target, line[i], line[i + 1])
                if d < best:
                    best = d
                    if best <= 1e-9:
                        return 0.0
    return best


def analyze_corridor_py(
    corridor: dict[str, Any],
    lesion: dict[str, Any],
    atlas_data: dict[str, Any],
    densified_tracts: list[dict[str, Any]],
) -> dict[str, Any]:
    entry = tuple(corridor["entryMni"])
    target = tuple(corridor["targetMni"])
    radius = float(corridor["radiusMm"])
    traj_len = v_dist(entry, target)

    lesion_ells = [
        e
        for e in (lesion.get("primaryEllipsoid"), lesion.get("secondaryEllipsoid"))
        if e is not None
    ]

    hazards = []
    for st in atlas_data["structures"]:
        d_center = min(
            segment_to_ellipsoid_surface_distance(entry, target, e)
            for e in st["ellipsoids"]
        )
        clearance = max(0.0, d_center - radius)
        d_lesion = min(
            ellipsoid_to_ellipsoid_distance(le, se)
            for le in lesion_ells
            for se in st["ellipsoids"]
        )
        hazards.append(
            {
                "id": st["id"],
                "kind": "structure",
                "category": st["category"],
                "centerlineDistanceMm": d_center,
                "corridorClearanceMm": clearance,
                "lesionClearanceMm": d_lesion,
                "riskTier": get_risk_tier(clearance),
            }
        )

    for tr in densified_tracts:
        d_center = _corridor_to_tract_dist(entry, target, tr)
        clearance = max(0.0, d_center - radius)
        d_lesion = min(
            ellipsoid_to_polyline_distance(le, line)
            for le in lesion_ells
            for line in tr["streamlines"]
        )
        hazards.append(
            {
                "id": tr["id"],
                "kind": "tract",
                "category": tr["system"],
                "centerlineDistanceMm": d_center,
                "corridorClearanceMm": clearance,
                "lesionClearanceMm": d_lesion,
                "riskTier": get_risk_tier(clearance),
            }
        )

    hazards.sort(key=lambda h: (h["corridorClearanceMm"], h["centerlineDistanceMm"]))
    return {
        "trajectoryLengthMm": traj_len,
        "sortedHazards": hazards,
        "byId": {h["id"]: h for h in hazards},
    }


def score_hazards_py(hazards: list[dict[str, Any]], traj_len: float) -> float:
    score = 100.0
    clearances = []
    for h in hazards:
        c = h["corridorClearanceMm"]
        clearances.append(c)
        w = (
            1.5
            if (
                h["category"] == "vascular"
                or h["id"].startswith("cst_")
                or h["id"] == "optic_chiasm"
            )
            else 1.0
        )
        if c < CRITICAL_MM:
            score -= w * (60.0 + 40.0 * (CRITICAL_MM - c))
        elif c <= CAUTION_MM:
            score -= w * 6.0 * (CAUTION_MM - c)

    clearances.sort()
    min1 = clearances[0] if clearances else 20.0
    min2 = clearances[1] if len(clearances) > 1 else min1
    score += 12.0 * min(min1, 20.0) + 3.0 * min(min2, 20.0)
    score -= 0.65 * traj_len
    return score


def optimize_corridor_py(
    target_mni: Vec3,
    lesion: dict[str, Any],
    atlas_data: dict[str, Any],
    densified_tracts: list[dict[str, Any]],
    approach_mode: str = "transcortical",
    radius_mm: float = 6.0,
    max_depth_mm: float = 95.0,
    candidate_count: int = 144,
) -> dict[str, Any]:
    entries: list[Vec3] = []
    if approach_mode == "endonasal":
        for x in (-6.0, -3.0, 0.0, 3.0, 6.0):
            for y in (36.0, 42.0, 48.0):
                for z in (-50.0, -46.0, -42.0, -38.0):
                    pt = (x, y, z)
                    if 10.0 <= v_dist(pt, target_mni) <= max_depth_mm:
                        entries.append(pt)
    else:
        hemi_sign = -1.0 if target_mni[0] < 0.0 else 1.0
        near_midline = abs(target_mni[0]) < 2.0
        total_samples = round(candidate_count * (1.15 if near_midline else 2.3))
        for k in range(total_samples):
            frac = (k + 0.5) / total_samples
            uz = -0.25 + frac * (0.985 - (-0.25))
            r_xy = math.sqrt(max(0.0, 1.0 - uz * uz))
            theta = k * GOLDEN_ANGLE
            ux = r_xy * math.cos(theta)
            uy = r_xy * math.sin(theta)
            hemi_pass = abs(ux) >= 0.08 if near_midline else (ux * hemi_sign >= 0.08)
            if not hemi_pass:
                continue
            pt = evaluate_brain_shell(ux, uy, uz)
            if 10.0 <= v_dist(pt, target_mni) <= max_depth_mm:
                entries.append(pt)

    best_score = -math.inf
    best_entry: Vec3 | None = None
    best_min_clearance = 0.0

    for entry in entries:
        traj_len = v_dist(entry, target_mni)
        hazards = []
        for st in atlas_data["structures"]:
            d_c = min(
                segment_to_ellipsoid_surface_distance(entry, target_mni, e)
                for e in st["ellipsoids"]
            )
            hazards.append(
                {
                    "id": st["id"],
                    "category": st["category"],
                    "corridorClearanceMm": max(0.0, d_c - radius_mm),
                }
            )
        for tr in densified_tracts:
            d_c = _corridor_to_tract_dist(entry, target_mni, tr)
            hazards.append(
                {
                    "id": tr["id"],
                    "category": tr["system"],
                    "corridorClearanceMm": max(0.0, d_c - radius_mm),
                }
            )
        sc = score_hazards_py(hazards, traj_len)
        if sc > best_score:
            best_score = sc
            best_entry = entry
            best_min_clearance = min(h["corridorClearanceMm"] for h in hazards)

    return {
        "bestEntry": best_entry,
        "bestScore": best_score,
        "bestMinClearanceMm": best_min_clearance,
        "candidatesEvaluated": len(entries),
    }


# =============================================================================
# Test Runner Infrastructure
# =============================================================================


class VerificationRunner:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.skipped = 0

    def ok(self, label: str, detail: str = "") -> None:
        self.passed += 1
        suffix = f" ({detail})" if detail else ""
        print(f"  [PASS] {label}{suffix}")

    def fail(self, label: str, detail: str = "") -> None:
        self.failed += 1
        suffix = f": {detail}" if detail else ""
        print(f"  [FAIL] {label}{suffix}")

    def skip(self, label: str, reason: str) -> None:
        self.skipped += 1
        print(f"  [SKIP] {label} — {reason}")

    def check(self, cond: bool, label: str, detail: str = "") -> bool:
        if cond:
            self.ok(label, detail)
        else:
            self.fail(label, detail)
        return cond


def in_mni_bounds(pt: list[float] | tuple[float, float, float]) -> bool:
    if len(pt) != 3:
        return False
    x, y, z = pt
    if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
        return False
    return (
        MNI_BOUNDS["x"][0] <= x <= MNI_BOUNDS["x"][1]
        and MNI_BOUNDS["y"][0] <= y <= MNI_BOUNDS["y"][1]
        and MNI_BOUNDS["z"][0] <= z <= MNI_BOUNDS["z"][1]
    )


# =============================================================================
# Suite 1: Pure Analytical 3D Geometry Reference Unit Tests
# =============================================================================


def run_geometry_unit_tests(vr: VerificationRunner) -> None:
    print("\n[Suite 1] Analytical 3D Geometry & Reference Unit Tests")

    # 1. pointToSegmentDistance
    vr.check(
        abs(point_to_segment_distance((5, 3, 0), (0, 0, 0), (10, 0, 0)) - 3.0) < 1e-12,
        "pointToSegmentDistance interior orthogonal projection",
    )
    vr.check(
        abs(point_to_segment_distance((-3, 4, 0), (0, 0, 0), (10, 0, 0)) - 5.0) < 1e-12,
        "pointToSegmentDistance endpoint clamping",
    )
    vr.check(
        abs(point_to_segment_distance((4, 3, 0), (1, -1, 0), (1, -1, 0)) - 5.0) < 1e-12,
        "pointToSegmentDistance degenerate zero-length segment",
    )

    # 2. segmentToSegmentDistance (skew, intersecting, parallel, collinear, degenerate)
    d_skew = segment_to_segment_distance((0, 0, 0), (10, 0, 0), (5, -5, 4), (5, 5, 4))
    vr.check(
        abs(d_skew - 4.0) < 1e-12,
        "segmentToSegmentDistance perpendicular skew segments",
        f"d={d_skew:.6f}",
    )

    d_cross = segment_to_segment_distance((0, 0, 0), (10, 10, 0), (0, 10, 0), (10, 0, 0))
    vr.check(
        abs(d_cross) < 1e-12,
        "segmentToSegmentDistance intersecting X-segments",
        f"d={d_cross:.2e}",
    )

    d_par_same = segment_to_segment_distance((0, 0, 0), (10, 0, 0), (3, 5, 0), (7, 5, 0))
    d_par_opp = segment_to_segment_distance((0, 0, 0), (10, 0, 0), (7, 5, 0), (3, 5, 0))
    d_col_disj = segment_to_segment_distance((0, 0, 0), (10, 0, 0), (20, 0, 0), (30, 0, 0))
    d_col_rev = segment_to_segment_distance((20, 0, 0), (30, 0, 0), (0, 0, 0), (10, 0, 0))
    d_col_ovlp = segment_to_segment_distance((0, 0, 0), (10, 0, 0), (6, 0, 0), (15, 0, 0))
    d_degen = segment_to_segment_distance((2, 3, 4), (2, 3, 4), (2, 3, 4), (2, 3, 4))
    vr.check(
        all(
            math.isfinite(x)
            for x in (d_par_same, d_par_opp, d_col_disj, d_col_rev, d_col_ovlp, d_degen)
        )
        and abs(d_par_same - 5.0) < 1e-12
        and abs(d_par_opp - 5.0) < 1e-12
        and abs(d_col_disj - 10.0) < 1e-12
        and abs(d_col_rev - 10.0) < 1e-12
        and abs(d_col_ovlp) < 1e-12
        and abs(d_degen) < 1e-12,
        "segmentToSegmentDistance parallel, collinear & degenerate segments (zero NaN)",
    )

    # 3. pointToEllipsoidSurfaceDistance + KKT optimality check
    ell = {"center": [10.0, -5.0, 2.0], "radii": [3.0, 5.0, 7.0]}
    vr.check(
        point_to_ellipsoid_surface_distance((10.0, -5.0, 2.0), ell) == 0.0
        and point_to_ellipsoid_surface_distance((11.0, -5.0, 2.0), ell) == 0.0,
        "pointToEllipsoidSurfaceDistance interior points return exact 0",
    )
    vr.check(
        abs(point_to_ellipsoid_surface_distance((13.0, -5.0, 2.0), ell)) < 1e-12,
        "pointToEllipsoidSurfaceDistance boundary surface point returns 0",
    )
    d_axial = point_to_ellipsoid_surface_distance((20.0, -5.0, 2.0), ell)
    vr.check(
        abs(d_axial - 7.0) < 1e-9,
        "pointToEllipsoidSurfaceDistance axial exterior exact distance",
        f"d={d_axial:.9f}",
    )

    sphere = {"center": [0.0, 0.0, 0.0], "radii": [5.0, 5.0, 5.0]}
    d_sph_diag = point_to_ellipsoid_surface_distance((10.0, 10.0, 10.0), sphere)
    expected_sph = 10.0 * math.sqrt(3.0) - 5.0
    vr.check(
        abs(d_sph_diag - expected_sph) < 1e-9,
        "pointToEllipsoidSurfaceDistance diagonal sphere ground truth",
        f"err={abs(d_sph_diag - expected_sph):.2e} mm",
    )

    # General anisotropic ellipsoid KKT optimality: surface membership + normal collinearity
    q_ext = (18.5, 4.2, 13.7)
    d_gen, cp, inside = closest_point_on_ellipsoid(q_ext, ell)
    rel = v_sub(cp, tuple(ell["center"]))
    surf_val = (
        (rel[0] / ell["radii"][0]) ** 2
        + (rel[1] / ell["radii"][1]) ** 2
        + (rel[2] / ell["radii"][2]) ** 2
    )
    normal = (
        rel[0] / (ell["radii"][0] ** 2),
        rel[1] / (ell["radii"][1] ** 2),
        rel[2] / (ell["radii"][2] ** 2),
    )
    diff_vec = v_sub(q_ext, cp)
    cos_angle = v_dot(normal, diff_vec) / (v_len(normal) * v_len(diff_vec))
    vr.check(
        (not inside)
        and abs(surf_val - 1.0) < 1e-9
        and abs(cos_angle - 1.0) < 1e-9
        and abs(d_gen - v_dist(q_ext, cp)) < 1e-12,
        "pointToEllipsoidSurfaceDistance anisotropic KKT surface-normal optimality",
        f"surf={surf_val:.10f}, cos={cos_angle:.10f}",
    )

    # 4. segmentToEllipsoidSurfaceDistance
    vr.check(
        segment_to_ellipsoid_surface_distance((-20, 0, 0), (20, 0, 0), sphere) == 0.0,
        "segmentToEllipsoidSurfaceDistance piercing segment returns 0",
    )
    vr.check(
        segment_to_ellipsoid_surface_distance((-20, 5, 0), (20, 5, 0), sphere) == 0.0,
        "segmentToEllipsoidSurfaceDistance tangent segment returns 0",
    )
    d_seg_sph = segment_to_ellipsoid_surface_distance((-10, 12, 0), (10, 12, 0), sphere)
    vr.check(
        abs(d_seg_sph - 7.0) < 1e-6,
        "segmentToEllipsoidSurfaceDistance exterior segment analytical match",
        f"d={d_seg_sph:.7f}",
    )

    # 5. ellipsoidToEllipsoidDistance
    s1 = {"center": [0.0, 0.0, 0.0], "radii": [4.0, 4.0, 4.0]}
    s2 = {"center": [10.0, 0.0, 0.0], "radii": [3.0, 3.0, 3.0]}
    s3 = {"center": [5.0, 0.0, 0.0], "radii": [3.0, 3.0, 3.0]}
    e_a = {"center": [-12.0, 0.0, 0.0], "radii": [4.0, 9.0, 5.0]}
    e_b = {"center": [12.0, 7.0, -4.0], "radii": [6.0, 3.0, 8.0]}
    d_s1_s2 = ellipsoid_to_ellipsoid_distance(s1, s2)
    d_s1_s3 = ellipsoid_to_ellipsoid_distance(s1, s3)
    d_ea_eb = ellipsoid_to_ellipsoid_distance(e_a, e_b)
    vr.check(
        abs(d_s1_s2 - 3.0) < 1e-5 and d_s1_s3 == 0.0 and d_ea_eb > 10.0 and math.isfinite(d_ea_eb),
        "ellipsoidToEllipsoidDistance overlapping & disjoint convergence",
        f"disjoint_sph={d_s1_s2:.6f}, aniso={d_ea_eb:.4f}",
    )

    # 6. Centripetal Catmull-Rom spline invariants
    ctrl: list[Vec3] = [(0, 0, 0), (10, 5, 2), (22, -4, 10), (35, 2, 18)]
    sampled = sample_catmull_rom_polyline(ctrl, 10)
    expected_len = (len(ctrl) - 1) * 10 + 1
    vr.check(
        len(sampled) == expected_len
        and sampled[0] == ctrl[0]
        and sampled[10] == ctrl[1]
        and sampled[20] == ctrl[2]
        and sampled[-1] == ctrl[-1]
        and all(all(math.isfinite(c) for c in pt) for pt in sampled),
        "Catmull-Rom centripetal spline exact length & control-point interpolation",
        f"n={len(sampled)}",
    )

    # 7. Risk tier boundaries
    vr.check(
        get_risk_tier(0.0) == "critical"
        and get_risk_tier(4.999) == "critical"
        and get_risk_tier(5.0) == "caution"
        and get_risk_tier(7.5) == "caution"
        and get_risk_tier(10.0) == "caution"
        and get_risk_tier(10.001) == "safe",
        "Corridor risk tier classification (<5 critical, 5-10 caution, >10 safe)",
    )

    # 8. Sculpted brain shell symmetry & bounds
    shell_ok = True
    for k in range(300):
        uz = -1.0 + 2.0 * (k + 0.5) / 300.0
        r_xy = math.sqrt(max(0.0, 1.0 - uz * uz))
        theta = k * GOLDEN_ANGLE
        ux, uy = r_xy * math.cos(theta), r_xy * math.sin(theta)
        p_pos = evaluate_brain_shell(ux, uy, uz)
        p_neg = evaluate_brain_shell(-ux, uy, uz)
        if not in_mni_bounds(p_pos):
            shell_ok = False
            break
        if (
            abs(p_pos[0] + p_neg[0]) > 1e-9
            or abs(p_pos[1] - p_neg[1]) > 1e-9
            or abs(p_pos[2] - p_neg[2]) > 1e-9
        ):
            shell_ok = False
            break
    vr.check(
        shell_ok and is_inside_brain(BRAIN_CENTER) and (not is_inside_brain((110.0, 0.0, 0.0))),
        "Sculpted brain shell X-mirror symmetry, MNI bounds & inside/outside test",
    )

    # 9. Synthetic NIfTI-1 (.nii.gz) binary header round-trip verification
    hdr = bytearray(352)
    struct.pack_into("<i", hdr, 0, 348)
    struct.pack_into("<4h", hdr, 40, 3, 4, 4, 4)  # ndim=3, 4x4x4
    struct.pack_into("<2h", hdr, 70, 2, 8)  # datatype=UINT8, bitpix=8
    struct.pack_into("<4f", hdr, 76, 1.0, 2.0, 2.0, 2.0)  # pixdim
    struct.pack_into("<f", hdr, 108, 352.0)  # vox_offset
    struct.pack_into("<2h", hdr, 252, 0, 1)  # sform_code=1
    struct.pack_into("<4f", hdr, 280, 2.0, 0.0, 0.0, -40.0)
    struct.pack_into("<4f", hdr, 296, 0.0, 2.0, 0.0, -20.0)
    struct.pack_into("<4f", hdr, 312, 0.0, 0.0, 2.0, 10.0)
    hdr[344:348] = b"n+1\x00"
    voxels = bytearray(64)
    voxels[0] = 1
    voxels[63] = 1
    gz_blob = gzip.compress(bytes(hdr) + bytes(voxels))
    decompressed = gzip.decompress(gz_blob)
    sizeof_hdr = struct.unpack_from("<i", decompressed, 0)[0]
    magic = decompressed[344:348]
    active_voxels = sum(1 for b in decompressed[352:] if b > 0)
    vr.check(
        sizeof_hdr == 348 and magic == b"n+1\x00" and active_voxels == 2,
        "Synthetic NIfTI-1 .nii.gz stdlib header & payload integrity",
    )


# =============================================================================
# Suite 2: Atlas & Cases Schema, Symmetry, Plausibility & Corridor Verification
# =============================================================================


def run_data_and_clinical_tests(vr: VerificationRunner) -> None:
    print("\n[Suite 2] Atlas Schema, Symmetry & Clinical Case Corridor Verification")

    atlas_path = REPO_ROOT / "data" / "atlas_anatomy.json"
    cases_path = REPO_ROOT / "data" / "cases.json"

    if not atlas_path.exists():
        vr.fail("data/atlas_anatomy.json presence", f"Missing {atlas_path}")
        return
    if not cases_path.exists():
        vr.fail("data/cases.json presence", f"Missing {cases_path}")
        return

    atlas = json.loads(atlas_path.read_text(encoding="utf-8"))
    cases_doc = json.loads(cases_path.read_text(encoding="utf-8"))

    # Top-level atlas metadata
    vr.check(
        atlas.get("coordinateSystem") == "MNI-152-RAS+"
        and atlas.get("units") == "mm"
        and "brainReference" in atlas,
        "atlas_anatomy.json coordinateSystem=MNI-152-RAS+ & units=mm",
    )

    brain_ref = atlas.get("brainReference", {})
    vr.check(
        len(brain_ref.get("brainstemEllipsoids", [])) == 3
        and len(brain_ref.get("ventricles", [])) == 3,
        "atlas_anatomy.json brainstemEllipsoids (3) & ventricles (3)",
    )

    # Structure IDs & schema
    structures = atlas.get("structures", [])
    struct_by_id = {s["id"]: s for s in structures if "id" in s}
    vr.check(
        set(struct_by_id.keys()) == EXPECTED_STRUCTURE_IDS and len(structures) == 11,
        "Exact 11 canonical eloquent/vascular structure IDs",
        f"found={len(structures)}",
    )

    req_struct_fields = {
        "id",
        "name",
        "shortName",
        "hemisphere",
        "category",
        "color",
        "ellipsoids",
        "function",
        "deficitIfInjured",
        "monitoringModality",
        "surgicalPearl",
    }
    struct_schema_errors = []
    for s in structures:
        missing = req_struct_fields - set(s.keys())
        if missing:
            struct_schema_errors.append(f"{s.get('id')}: missing {missing}")
        if not HEX_COLOR_RE.match(str(s.get("color", ""))):
            struct_schema_errors.append(f"{s.get('id')}: bad hex {s.get('color')}")
        if s.get("hemisphere") not in {"left", "right", "bilateral", "midline"}:
            struct_schema_errors.append(f"{s.get('id')}: bad hemisphere")
        if s.get("category") not in {
            "eloquent_cortex",
            "deep_gray",
            "cranial_nerve",
            "vascular",
        }:
            struct_schema_errors.append(f"{s.get('id')}: bad category")
        ells = s.get("ellipsoids", [])
        if not ells:
            struct_schema_errors.append(f"{s.get('id')}: empty ellipsoids")
        for e in ells:
            if not in_mni_bounds(e.get("center", [])):
                struct_schema_errors.append(f"{s.get('id')}: center out of MNI bounds")
            radii = e.get("radii", [])
            if len(radii) != 3 or any(r <= 0 for r in radii):
                struct_schema_errors.append(f"{s.get('id')}: non-positive radii")
    vr.check(
        not struct_schema_errors,
        "All 11 structures pass field, color, radii & MNI bounds validation",
        "; ".join(struct_schema_errors[:3]),
    )

    # Tract IDs & schema
    tracts = atlas.get("tracts", [])
    tract_by_id = {t["id"]: t for t in tracts if "id" in t}
    vr.check(
        set(tract_by_id.keys()) == EXPECTED_TRACT_IDS and len(tracts) == 10,
        "Exact 10 canonical white-matter fiber tract IDs",
        f"found={len(tracts)}",
    )

    req_tract_fields = {
        "id",
        "name",
        "shortName",
        "system",
        "hemisphere",
        "color",
        "controlPolylines",
        "function",
        "deficitIfInjured",
        "desSign",
        "surgicalPearl",
    }
    tract_schema_errors = []
    for t in tracts:
        missing = req_tract_fields - set(t.keys())
        if missing:
            tract_schema_errors.append(f"{t.get('id')}: missing {missing}")
        if not HEX_COLOR_RE.match(str(t.get("color", ""))):
            tract_schema_errors.append(f"{t.get('id')}: bad hex {t.get('color')}")
        if t.get("system") not in {"projection", "association", "commissural"}:
            tract_schema_errors.append(f"{t.get('id')}: bad system")
        pls = t.get("controlPolylines", [])
        if len(pls) < 3:
            tract_schema_errors.append(f"{t.get('id')}: <3 streamlines ({len(pls)})")
        for pl in pls:
            if len(pl) < 4:
                tract_schema_errors.append(f"{t.get('id')}: streamline has <4 points")
            for pt in pl:
                if not in_mni_bounds(pt):
                    tract_schema_errors.append(
                        f"{t.get('id')}: point {pt} outside MNI bounds"
                    )
    vr.check(
        not tract_schema_errors,
        "All 10 tracts pass field, multi-streamline (>=3x4 pts) & MNI bounds validation",
        "; ".join(tract_schema_errors[:3]),
    )

    # Bilateral X-mirror symmetry checks
    sym_errors = []
    for left_id, right_id in (("m1_left", "m1_right"), ("sma_left", "sma_right")):
        el_l = struct_by_id[left_id]["ellipsoids"]
        el_r = struct_by_id[right_id]["ellipsoids"]
        if len(el_l) != len(el_r):
            sym_errors.append(f"{left_id}/{right_id}: ellipsoid count mismatch")
        else:
            for a, b in zip(el_l, el_r):
                if (
                    abs(a["center"][0] + b["center"][0]) > 1e-6
                    or abs(a["center"][1] - b["center"][1]) > 1e-6
                    or abs(a["center"][2] - b["center"][2]) > 1e-6
                    or a["radii"] != b["radii"]
                ):
                    sym_errors.append(f"{left_id}/{right_id}: center/radii asymmetry")

    for prefix in ("cst", "slf", "ifof", "or"):
        pl_l = tract_by_id[f"{prefix}_left"]["controlPolylines"]
        pl_r = tract_by_id[f"{prefix}_right"]["controlPolylines"]
        if len(pl_l) != len(pl_r):
            sym_errors.append(f"{prefix}: streamline count mismatch")
        else:
            for s_l, s_r in zip(pl_l, pl_r):
                if len(s_l) != len(s_r):
                    sym_errors.append(f"{prefix}: point count mismatch")
                    continue
                for p_l, p_r in zip(s_l, s_r):
                    if (
                        abs(p_l[0] + p_r[0]) > 1e-6
                        or abs(p_l[1] - p_r[1]) > 1e-6
                        or abs(p_l[2] - p_r[2]) > 1e-6
                    ):
                        sym_errors.append(f"{prefix}: {p_l} vs {p_r}")
    vr.check(
        not sym_errors,
        "Bilateral homologous structures (M1, SMA) & tracts (CST, SLF, IFOF, OR) exact X-symmetry",
        "; ".join(sym_errors[:3]),
    )

    # Cases & Quiz validation
    all_valid_ids = EXPECTED_STRUCTURE_IDS | EXPECTED_TRACT_IDS
    cases = cases_doc.get("cases", [])
    case_by_id = {c["id"]: c for c in cases if "id" in c}
    vr.check(
        set(case_by_id.keys()) == EXPECTED_CASE_IDS and len(cases) == 5,
        "Exact 5 canonical neurosurgical teaching cases",
    )

    req_case_fields = {
        "id",
        "title",
        "pathology",
        "approachName",
        "defaultCamera",
        "lesion",
        "defaultCorridor",
        "recommendedMapping",
        "clinicalPresentation",
        "surgicalPearls",
        "keyHazards",
    }
    case_errors = []
    for c in cases:
        missing = req_case_fields - set(c.keys())
        if missing:
            case_errors.append(f"{c.get('id')}: missing {missing}")
        for hid in c.get("keyHazards", []):
            if hid not in all_valid_ids:
                case_errors.append(f"{c.get('id')}: unknown hazard {hid}")
        corr = c.get("defaultCorridor", {})
        if corr.get("approachMode") not in {"transcortical", "endonasal"}:
            case_errors.append(f"{c.get('id')}: invalid approachMode")
        if not (isinstance(corr.get("radiusMm"), (int, float)) and corr["radiusMm"] > 0):
            case_errors.append(f"{c.get('id')}: invalid radiusMm")
        if not in_mni_bounds(c["lesion"]["primaryEllipsoid"]["center"]):
            case_errors.append(f"{c.get('id')}: primary lesion center out of bounds")
    vr.check(
        not case_errors,
        "All 5 cases pass schema, corridor & keyHazards referential integrity",
        "; ".join(case_errors[:3]),
    )

    quiz = cases_doc.get("quiz", [])
    quiz_ids = {q.get("id") for q in quiz}
    quiz_errors = []
    for q in quiz:
        qid = q.get("id", "?")
        if q.get("caseId") not in EXPECTED_CASE_IDS:
            quiz_errors.append(f"{qid}: invalid caseId {q.get('caseId')}")
        opts = q.get("options", [])
        if len(opts) != 4 or len(set(opts)) != 4 or any(not str(o).strip() for o in opts):
            quiz_errors.append(f"{qid}: options must be 4 distinct non-empty strings")
        if q.get("correctIndex") not in {0, 1, 2, 3}:
            quiz_errors.append(f"{qid}: correctIndex out of 0..3")
        hids = q.get("highlightStructureIds", [])
        if not (1 <= len(hids) <= 3) or any(h not in all_valid_ids for h in hids):
            quiz_errors.append(f"{qid}: invalid highlightStructureIds {hids}")
        if not str(q.get("explanation", "")).strip() or not str(q.get("pearl", "")).strip():
            quiz_errors.append(f"{qid}: missing explanation or pearl")
    vr.check(
        quiz_ids == EXPECTED_QUIZ_IDS and len(quiz) == 10 and not quiz_errors,
        "All 10 quiz questions pass caseId, correctIndex (0..3) & highlightStructureIds checks",
        "; ".join(quiz_errors[:3]),
    )

    # Densify tracts and run full live anatomical plausibility & corridor analysis
    densified = densify_tracts(atlas, samples=10)
    analyses = {}
    for c in cases:
        analyses[c["id"]] = analyze_corridor_py(
            c["defaultCorridor"], c["lesion"], atlas, densified
        )

    # Verify finite non-NaN clearances & sorted ascending order across all 5 cases
    all_finite = True
    for cid, an in analyses.items():
        hazards = an["sortedHazards"]
        prev_c = -1.0
        for h in hazards:
            c_mm = h["corridorClearanceMm"]
            l_mm = h["lesionClearanceMm"]
            if (
                not math.isfinite(c_mm)
                or c_mm < 0.0
                or not math.isfinite(l_mm)
                or l_mm < 0.0
                or c_mm < prev_c - 1e-12
            ):
                all_finite = False
                break
            prev_c = c_mm
    vr.check(
        all_finite,
        "All 5 default case corridors yield finite, non-negative, sorted clearances",
    )

    # Case 01: Right frontal GBM -> right hemisphere, <20 mm from sma_right & cst_right
    c1 = case_by_id["case01_right_frontal_gbm"]
    a1 = analyses["case01_right_frontal_gbm"]["byId"]
    vr.check(
        c1["lesion"]["primaryEllipsoid"]["center"][0] > 0
        and a1["sma_right"]["lesionClearanceMm"] < 20.0
        and a1["cst_right"]["lesionClearanceMm"] < 20.0,
        "Case 01 (Right Frontal GBM) proximity to SMA-R & CST-R",
        f"SMA-R={a1['sma_right']['lesionClearanceMm']:.1f}mm, CST-R={a1['cst_right']['lesionClearanceMm']:.1f}mm",
    )

    # Case 02: Left insular LGG -> left insula, close to IFOF-L, AF-L, Broca-L, CST-L
    c2 = case_by_id["case02_left_insular_lgg"]
    a2 = analyses["case02_left_insular_lgg"]["byId"]
    vr.check(
        c2["lesion"]["primaryEllipsoid"]["center"][0] < -20
        and a2["ifof_left"]["lesionClearanceMm"] < 10.0
        and a2["af_left"]["lesionClearanceMm"] < 15.0
        and a2["broca_left"]["lesionClearanceMm"] < 12.0
        and a2["cst_left"]["lesionClearanceMm"] < 15.0,
        "Case 02 (Left Insular LGG) surrounded by IFOF-L, AF-L, Broca-L & CST-L",
        f"IFOF={a2['ifof_left']['lesionClearanceMm']:.1f}mm, AF={a2['af_left']['lesionClearanceMm']:.1f}mm",
    )

    # Case 03: Left TPO metastasis -> close to OR-L & Wernicke-L
    c3 = case_by_id["case03_left_tpo_met"]
    a3 = analyses["case03_left_tpo_met"]["byId"]
    vr.check(
        c3["lesion"]["primaryEllipsoid"]["center"][0] < -25
        and c3["lesion"]["primaryEllipsoid"]["center"][1] < -35
        and a3["or_left"]["lesionClearanceMm"] < 10.0
        and a3["wernicke_left"]["lesionClearanceMm"] < 15.0,
        "Case 03 (Left TPO Met) proximity to OR-L & Wernicke-L",
        f"OR-L={a3['or_left']['lesionClearanceMm']:.1f}mm, Wern-L={a3['wernicke_left']['lesionClearanceMm']:.1f}mm",
    )

    # Case 04: Left parasagittal meningioma -> adjacent to SSS (<12 mm) & M1-L (<15 mm)
    a4 = analyses["case04_left_parasagittal_meningioma"]["byId"]
    vr.check(
        a4["sss_midline"]["lesionClearanceMm"] < 12.0
        and a4["m1_left"]["lesionClearanceMm"] < 15.0,
        "Case 04 (Left Parasagittal Meningioma) adjacent to SSS & M1-L",
        f"SSS={a4['sss_midline']['lesionClearanceMm']:.1f}mm, M1-L={a4['m1_left']['lesionClearanceMm']:.1f}mm",
    )

    # Case 05: Sellar pituitary macroadenoma -> compressing Optic Chiasm (<=3 mm), endonasal near ICAs (<8 mm)
    c5 = case_by_id["case05_sellar_pituitary"]
    a5 = analyses["case05_sellar_pituitary"]["byId"]
    vr.check(
        abs(c5["lesion"]["primaryEllipsoid"]["center"][0]) <= 3.0
        and c5["lesion"]["primaryEllipsoid"]["center"][2] < -15.0
        and a5["optic_chiasm"]["lesionClearanceMm"] <= 3.0
        and a5["ica_bilateral"]["corridorClearanceMm"] < 8.0,
        "Case 05 (Pituitary Macroadenoma) chiasmal compression & bilateral ICA corridor proximity",
        f"Chiasm_lesion={a5['optic_chiasm']['lesionClearanceMm']:.1f}mm, ICA_corridor={a5['ica_bilateral']['corridorClearanceMm']:.1f}mm",
    )

    # Deterministic corridor optimization check across all 5 cases
    opt_ok = True
    opt_notes = []
    for c in cases:
        corr = c["defaultCorridor"]
        r1 = optimize_corridor_py(
            tuple(corr["targetMni"]),
            c["lesion"],
            atlas,
            densified,
            approach_mode=corr["approachMode"],
            radius_mm=float(corr["radiusMm"]),
        )
        r2 = optimize_corridor_py(
            tuple(corr["targetMni"]),
            c["lesion"],
            atlas,
            densified,
            approach_mode=corr["approachMode"],
            radius_mm=float(corr["radiusMm"]),
        )
        best_entry = r1["bestEntry"]
        if (
            best_entry is None
            or r1["candidatesEvaluated"] < 20
            or not math.isfinite(r1["bestScore"])
            or not in_mni_bounds(best_entry)
            or r1 != r2
        ):
            opt_ok = False
        opt_notes.append(f"{c['id'][:6]}:{r1['candidatesEvaluated']}c/{r1['bestMinClearanceMm']:.1f}mm")
    vr.check(
        opt_ok,
        "Deterministic corridor optimizer produces valid, bounded, repeatable solutions for all 5 cases",
        ", ".join(opt_notes),
    )


# =============================================================================
# Suite 3: Static ES Module Contracts & Offline/Process Hygiene
# =============================================================================


def strip_js_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def collect_exported_symbols(src: str) -> set[str]:
    symbols: set[str] = set()
    for m in re.finditer(
        r"\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)",
        src,
    ):
        symbols.add(m.group(1))
    for m in re.finditer(r"\bexport\s*\{([^}]+)\}", src):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                symbols.add(part.split(" as ")[-1].strip())
            else:
                symbols.add(part)
    return symbols


def check_js_balanced_delimiters(src: str) -> tuple[bool, str]:
    """Lexical balance verifier for JS braces/brackets/parens, respecting strings,
    template literals (${...} interpolations), regex/comments cleanly."""
    stack: list[str] = []
    pairs = {"(": ")", "[": "]", "{": "}"}
    closing = {")", "]", "}"}
    i = 0
    n = len(src)
    line = 1
    in_template_expr_depth: list[int] = []

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if ch == "\n":
            line += 1
            i += 1
            continue
        # Line comment
        if ch == "/" and nxt == "/":
            i += 2
            while i < n and src[i] != "\n":
                i += 1
            continue
        # Block comment
        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                if src[i] == "\n":
                    line += 1
                i += 1
            if i + 1 >= n:
                return False, f"unterminated block comment near line {line}"
            i += 2
            continue
        # Single or double quoted string
        if ch in ("'", '"'):
            quote = ch
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "\n":
                    return False, f"unterminated string at line {line}"
                i += 1
            if i >= n:
                return False, f"unterminated string at line {line}"
            i += 1
            continue
        # Template literal
        if ch == "`":
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "\n":
                    line += 1
                    i += 1
                    continue
                if src[i] == "`":
                    i += 1
                    break
                if src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                    stack.append("{")
                    in_template_expr_depth.append(len(stack))
                    i += 2
                    break
                i += 1
            continue
        if ch in pairs:
            stack.append(ch)
            i += 1
            continue
        if ch in closing:
            if not stack or pairs[stack[-1]] != ch:
                return False, f"mismatched '{ch}' at line {line}"
            stack.pop()
            if in_template_expr_depth and len(stack) == in_template_expr_depth[-1] - 1:
                in_template_expr_depth.pop()
                # Resume template literal scanning after closing '}'
                i += 1
                while i < n:
                    if src[i] == "\\":
                        i += 2
                        continue
                    if src[i] == "\n":
                        line += 1
                        i += 1
                        continue
                    if src[i] == "`":
                        i += 1
                        break
                    if src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                        stack.append("{")
                        in_template_expr_depth.append(len(stack))
                        i += 2
                        break
                    i += 1
                continue
            i += 1
            continue
        i += 1

    if stack:
        return False, f"unclosed delimiters {stack[-3:]}"
    return True, "ok"


def run_static_hygiene_tests(vr: VerificationRunner, strict_ui: bool = False) -> None:
    print("\n[Suite 3] Static ES Module Export/Import Contracts & Offline Hygiene")

    geom_path = REPO_ROOT / "js" / "geometryEngine.js"
    quiz_path = REPO_ROOT / "js" / "quizEngine.js"

    # 1. geometryEngine.js required exports & zero-DOM check
    if vr.check(geom_path.exists(), "js/geometryEngine.js exists"):
        geom_src = geom_path.read_text(encoding="utf-8")
        geom_exports = collect_exported_symbols(geom_src)
        required_geom = {
            "MNI_BOUNDS",
            "BRAIN_CENTER",
            "BRAIN_RADII",
            "RISK_THRESHOLDS",
            "vecSub",
            "vecAdd",
            "vecScale",
            "vecDot",
            "vecCross",
            "vecLen",
            "getRiskTier",
            "tangentToDecColor",
            "evaluateBrainShell",
            "isInsideBrain",
            "projectToCorticalSurface",
            "sampleCatmullRomPolyline",
            "sampleCatmullRomBundle",
            "densifyAtlasTracts",
            "buildDensifiedTracts",
            "pointToSegmentDistance",
            "segmentToSegmentDistance",
            "closestPointsSegmentToSegment",
            "pointToEllipsoidSurfaceDistance",
            "closestPointOnEllipsoid",
            "segmentToEllipsoidSurfaceDistance",
            "closestPointSegmentToEllipsoid",
            "ellipsoidToEllipsoidDistance",
            "ellipsoidToPolylineDistance",
            "analyzeSurgicalCorridor",
            "optimizeEntryCorridor",
            "parseMniNiftiMask",
        }
        missing_geom = sorted(required_geom - geom_exports)
        vr.check(
            not missing_geom,
            "js/geometryEngine.js declares all required canonical exports",
            f"missing={missing_geom}" if missing_geom else f"{len(required_geom)} verified",
        )
        geom_code = strip_js_comments(geom_src)
        dom_hits = re.findall(r"\b(?:window|document|HTMLCanvasElement)\b", geom_code)
        vr.check(
            not dom_hits,
            "js/geometryEngine.js is strictly zero-DOM",
            f"hits={dom_hits}" if dom_hits else "",
        )
        vr.check(
            "Math.random" not in geom_code,
            "js/geometryEngine.js uses zero Math.random() (100% deterministic)",
        )

    # 2. quizEngine.js required exports & zero-DOM check
    if vr.check(quiz_path.exists(), "js/quizEngine.js exists"):
        quiz_src = quiz_path.read_text(encoding="utf-8")
        quiz_exports = collect_exported_symbols(quiz_src)
        required_quiz = {
            "NeuroQuizEngine",
            "generateEducationalReportMarkdown",
            "generateEducationalReportJson",
        }
        missing_quiz = sorted(required_quiz - quiz_exports)
        vr.check(
            not missing_quiz,
            "js/quizEngine.js declares all required canonical exports",
            f"missing={missing_quiz}" if missing_quiz else f"{len(required_quiz)} verified",
        )
        quiz_code = strip_js_comments(quiz_src)
        dom_hits = re.findall(r"\b(?:window|document|HTMLCanvasElement)\b", quiz_code)
        vr.check(
            not dom_hits,
            "js/quizEngine.js is strictly zero-DOM",
            f"hits={dom_hits}" if dom_hits else "",
        )
        vr.check(
            "Educational & Research Sandbox" in quiz_src
            and "Not Approved for Clinical Neuronavigation" in quiz_src
            and "100% Browser-Local" in quiz_src,
            "js/quizEngine.js embeds mandatory non-clinical & browser-local report notices",
        )

    # 3. Lexical delimiter balance check across all existing js/*.js modules
    js_dir = REPO_ROOT / "js"
    balance_errors = []
    checked_js_count = 0
    for js_file in sorted(js_dir.glob("*.js")):
        checked_js_count += 1
        ok_bal, msg_bal = check_js_balanced_delimiters(js_file.read_text(encoding="utf-8"))
        if not ok_bal:
            balance_errors.append(f"{js_file.name}: {msg_bal}")
    vr.check(
        not balance_errors,
        "All js/*.js ES modules pass lexical delimiter & string/template balance check",
        "; ".join(balance_errors) if balance_errors else f"{checked_js_count} files checked",
    )

    # 4. renderer3d.js (UI phase — skip gracefully if absent unless --strict)
    renderer_path = REPO_ROOT / "js" / "renderer3d.js"
    if renderer_path.exists():
        ren_exports = collect_exported_symbols(renderer_path.read_text(encoding="utf-8"))
        vr.check(
            "NeuroCorridorRenderer" in ren_exports,
            "js/renderer3d.js exports NeuroCorridorRenderer",
        )
    elif strict_ui:
        vr.fail("js/renderer3d.js exists", "missing in strict mode")
    else:
        vr.skip("js/renderer3d.js export check", "not yet present (pre-Phase 2B)")

    # 4. Relative ES module import resolution across all existing js/*.js files
    js_dir = REPO_ROOT / "js"
    broken_imports = []
    import_re = re.compile(
        r"""(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]"""
    )
    for js_file in sorted(js_dir.glob("*.js")):
        code = strip_js_comments(js_file.read_text(encoding="utf-8"))
        for match in import_re.finditer(code):
            rel_spec = match.group(1)
            resolved = (js_file.parent / rel_spec).resolve()
            if not resolved.exists():
                broken_imports.append(f"{js_file.name} -> {rel_spec}")
    vr.check(
        not broken_imports,
        "All relative ES module import paths in js/*.js resolve on disk",
        "; ".join(broken_imports),
    )

    # 5. Offline hygiene & clinical disclaimer in index.html / css/styles.css
    index_path = REPO_ROOT / "index.html"
    if index_path.exists():
        html = index_path.read_text(encoding="utf-8")
        ext_scripts = re.findall(
            r"""<script[^>]+src\s*=\s*['"]https?://[^'"]+['"]""", html, flags=re.IGNORECASE
        )
        ext_links = re.findall(
            r"""<link[^>]+href\s*=\s*['"]https?://[^'"]+['"]""", html, flags=re.IGNORECASE
        )
        vr.check(
            not ext_scripts and not ext_links,
            "index.html contains ZERO external http(s) script/link CDN tags",
            f"scripts={ext_scripts}, links={ext_links}" if (ext_scripts or ext_links) else "",
        )
        has_disclaimer = (
            "Educational & Research Sandbox" in html
            and "Not Approved for Clinical Neuronavigation" in html
        )
        has_local = "100% Browser-Local" in html
        vr.check(
            has_disclaimer and has_local,
            "index.html prominently displays clinical safety disclaimer & 100% Browser-Local badge",
        )
    elif strict_ui:
        vr.fail("index.html exists", "missing in strict mode")
    else:
        vr.skip("index.html offline hygiene & safety chrome", "not yet present (pre-Phase 2B)")

    css_path = REPO_ROOT / "css" / "styles.css"
    if css_path.exists():
        css = css_path.read_text(encoding="utf-8")
        ext_css = re.findall(
            r"""(?:@import\s+(?:url\()?['"]?https?://|url\(\s*['"]?https?://)""",
            css,
            flags=re.IGNORECASE,
        )
        vr.check(
            not ext_css,
            "css/styles.css contains ZERO external http(s) @import or url() CDN references",
            f"hits={ext_css}" if ext_css else "",
        )
    elif strict_ui:
        vr.fail("css/styles.css exists", "missing in strict mode")
    else:
        vr.skip("css/styles.css offline hygiene", "not yet present (pre-Phase 2B)")

    # 6. Zero forbidden browser executable references anywhere in codebase
    forbidden_bins = ("ms" + "edge.exe", "chr" + "ome.exe")
    scan_exts = {".html", ".css", ".js", ".py", ".yml", ".yaml", ".json"}
    bin_hits = []
    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in scan_exts:
            continue
        if ".git" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
        for token in forbidden_bins:
            if token in text:
                bin_hits.append(f"{path.relative_to(REPO_ROOT)} contains {token}")
    vr.check(
        not bin_hits,
        "Zero forbidden browser executable strings across codebase",
        "; ".join(bin_hits),
    )


# =============================================================================
# Entrypoint
# =============================================================================


def main(argv: list[str]) -> int:
    strict_ui = "--strict" in argv
    print("=" * 72)
    print("NeuroCorridor-3D — Verification Suite (Python 3.12 Stdlib Only)")
    print("=" * 72)

    vr = VerificationRunner()
    run_geometry_unit_tests(vr)
    run_data_and_clinical_tests(vr)
    run_static_hygiene_tests(vr, strict_ui=strict_ui)

    print("\n" + "=" * 72)
    print(
        f"SUMMARY: {vr.passed} passed | {vr.failed} failed | {vr.skipped} skipped"
    )
    print("=" * 72)
    return 0 if vr.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
