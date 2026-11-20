# NeuroCorridor-3D

**Interactive 3D Stereotactic Neuroanatomy, White-Matter Fiber Tractography & Surgical Corridor Planning Sandbox**

> **IMPORTANT CLINICAL SAFETY DISCLAIMER**
>
> **Educational & Research Sandbox — Not Approved for Clinical Neuronavigation**
>
> NeuroCorridor-3D is an open-science educational and research visualization sandbox based on a stylized analytical MNI-152 stereotactic reference model. It is **not** a medical device, has **not** been cleared or approved by the FDA, EMA, or any regulatory authority, and **must never** be used for clinical diagnosis, patient-specific preoperative planning, intraoperative neuronavigation, or medical decision-making.
>
> **Privacy Guarantee:** **100% Browser-Local — Zero Uploads.** All NIfTI-1 mask parsing, stereotactic clearance computations, trajectory optimization, and educational report exports execute strictly client-side in browser memory with zero external CDN requests, zero analytics, and zero network transmission of user data.

---

## Overview

**NeuroCorridor-3D** is a zero-build, offline-capable static web application built with pure HTML5, CSS3, Vanilla ES Modules, and HTML5 2D Canvas. It delivers an interactive neuronavigation workstation experience directly in any modern browser—combining a depth-sorted 3D stereotactic viewport, synchronized radiological tri-planar (Axial, Coronal, Sagittal) MNI-152 slices, a down-the-barrel **Probe's-Eye** scope, real-time analytical corridor clearance analysis, a deterministic trajectory auto-optimizer, browser-local MNI-152 NIfTI-1 lesion overlay, and a 10-question board-style neuroanatomy quiz.

### Key Engineering Principles

| Principle | Implementation |
|---|---|
| **Zero-Build Static Architecture** | Pure HTML5 + CSS3 + Vanilla ES Modules (`<script type="module">`) + HTML5 2D Canvas. Zero Node.js, zero npm, zero bundlers, zero external CDN dependencies. |
| **100% Browser-Local Privacy** | Native browser `DecompressionStream('gzip')` and `DataView` NIfTI-1 parsing; zero file uploads or telemetry. |
| **Deterministic Stereotactic Math** | Exact analytical Euclidean distances (Ericson segment-to-segment, Eberly 1D root-finding ellipsoid distance, golden-section segment-to-ellipsoid, von Neumann alternating projections) with zero randomness. |
| **Reproducible Verification** | Python 3.12 standard-library-only verification gate (`tests/verify_geometry.py`) enforcing schema integrity, bilateral symmetry, analytical geometry accuracy, and zero-CDN hygiene on every push and pull request. |

---

## Quick Start

Because browsers restrict ES module `fetch()` requests over the `file://` protocol, serve the repository from any local static HTTP server (Python's built-in module requires zero installation):

```bash
git clone https://github.com/neurocorridor-3d/neurocorridor-3d.git
cd neurocorridor-3d
python -m http.server 8000
```

Then open **`http://localhost:8000`** in your browser.

### Run Local Geometry & Hygiene Verification

Verify all atlas/case schemas, bilateral symmetry, clinical proximity invariants, analytical geometry unit tests, and zero-CDN static hygiene using Python 3.12 standard library only:

```bash
python tests/verify_geometry.py
```

### Static GitHub Pages Deployment

The included CI/CD workflow (`.github/workflows/pages.yml`) runs `python tests/verify_geometry.py` on every push and pull request, and automatically deploys the static site to **GitHub Pages** once the verification gate passes on `main`.

---

## MNI-152 Stereotactic Coordinate System (RAS+)

All atlas structures, white-matter fiber streamlines, tumor ellipsoids, surgical trajectories, NIfTI overlays, and tri-planar slices share a unified **MNI-152 RAS+ coordinate space in millimeters (`mm`)**:

| Axis | Anatomical Direction | Negative End (`−`) | Positive End (`+`) | Valid Atlas Range (`mm`) |
|---|---|---|---|---|
| **`X`** | Left → **Right** (`+X`) | Left Hemisphere (`−X`) | Right Hemisphere (`+X`) | `−72` to `+72` |
| **`Y`** | Posterior → **Anterior** (`+Y`) | Occipital Pole (`−Y`) | Frontal Pole (`+Y`) | `−105` to `+72` |
| **`Z`** | Inferior → **Superior** (`+Z`) | Skull Base / Brainstem (`−Z`) | Vertex (`+Z`) | `−55` to `+82` |

- **Stereotactic Origin `(0, 0, 0)`:** Anterior Commissure (**AC**); Posterior Commissure (**PC**) lies at approximately `(0, −24, 0)` mm.
- **Analytical Cortical Envelope (`evaluateBrainShell`):** Centered at `C_brain = [0, −16, 12]` mm with base semi-axes `R_brain = [68, 86, 66]` mm, analytically sculpted with a longitudinal interhemispheric falx groove, orbital-frontal floor contour, posterior cerebellar/occipital tentorial notch, and lateral-inferior temporal prominence. Shared identically by the geometry engine and renderer so optimized cortical entry points lie directly on the rendered cortical surface.
- **Deep Anatomical Landmarks:** Tapered brainstem reference volumes (midbrain, pons, medulla) and ventricular system (bilateral lateral ventricles and midline third ventricle).

### Radiological Tri-Planar Orientation

The three synchronized 2D slice viewports adhere to clinical **radiological convention** with explicit `R / L / A / P / S / I` edge markers, a 20 mm stereotactic grid, and interactive click-to-inspect / click-to-place target or entry controls:

| Viewport | Fixed Plane | Horizontal Axis (Left → Right) | Vertical Axis (Bottom → Top) |
|---|---|---|---|
| **Axial** | `Z = sliceZ` | `+X` (**R**) → `−X` (**L**) | `−Y` (**P**) → `+Y` (**A**) |
| **Coronal** | `Y = sliceY` | `+X` (**R**) → `−X` (**L**) | `−Z` (**I**) → `+Z` (**S**) |
| **Sagittal** | `X = sliceX` | `+Y` (**A**) → `−Y` (**P**) | `−Z` (**I**) → `+Z` (**S**) |

---

## Neuroanatomical Atlas

### 8 Eloquent & Critical Regions (11 Canonical Structures)

The atlas encodes **8 eloquent cortical, deep gray, cranial-nerve, and neurovascular regions**, represented by **11 lateralized canonical structure definitions** in `data/atlas_anatomy.json` (with exact `X`-mirror bilateral symmetry where paired):

| # | Functional Region | Canonical ID(s) | Badge | Category | Key MNI-152 Landmarks & Clinical Significance |
|---|---|---|---|---|---|
| 1 | **Primary Motor Cortex (M1)** | `m1_left`, `m1_right` | `M1-L`, `M1-R` | `eloquent_cortex` | Somatotopic leg (`±10, −26, 66`), hand (`±36, −20, 54`), and face (`±52, −10, 34`) segments along the precentral gyrus. |
| 2 | **Broca's Area** | `broca_left` | `Broca-L` | `eloquent_cortex` | Dominant left inferior frontal gyrus: pars opercularis (`−50, 14, 16`) and pars triangularis (`−48, 28, 10`); expressive speech production. |
| 3 | **Wernicke's Area** | `wernicke_left` | `Wern-L` | `eloquent_cortex` | Dominant left posterior STG (`−56, −42, 14`) and SMG/angular region (`−52, −52, 24`); auditory comprehension and phonological processing. |
| 4 | **Primary Visual Cortex (V1)** | `v1_bilateral` | `V1` | `eloquent_cortex` | Bilateral calcarine banks (`±10, −84, 4`); homonymous visual field representation. |
| 5 | **Supplementary Motor Area (SMA)** | `sma_left`, `sma_right` | `SMA-L`, `SMA-R` | `eloquent_cortex` | Bilateral medial superior frontal gyrus (`±8, −2, 62`); motor initiation and speech fluency (SMA syndrome risk). |
| 6 | **Thalamus** | `thalamus_bilateral` | `Thal` | `deep_gray` | Bilateral deep diencephalic sensory/motor relay nuclei (`±12, −18, 6`). |
| 7 | **Optic Chiasm & Optic Nerves** | `optic_chiasm` | `Chiasm` | `cranial_nerve` | Suprasellar chiasm (`0, 3, −14`) and bilateral intracranial optic nerves (`±6, 12, −16`); elevated safety weight in corridor optimization. |
| 8 | **Critical Neurovascular Structures (ICA & SSS)** | `ica_bilateral`, `sss_midline` | `ICA`, `SSS` | `vascular` | Bilateral cavernous/supraclinoid internal carotid arteries (`±11, −3, −24`; `±10, 1, −15`) and midline superior sagittal sinus (`0, 34, 58` → `0, −64, 54`); elevated safety weight (`1.5×`). |

### 6 White-Matter Fiber Tract Systems (10 Canonical Tracts)

Six major projection, association, and commissural white-matter systems are represented by **10 canonical fiber bundles** in `data/atlas_anatomy.json`, densified smoothly using **centripetal Catmull-Rom splines** ($\alpha = 0.5$) and rendered in either **Anatomical System Color** or neuroradiological **DTI Directionally Encoded Color (DEC RGB: Red = Left–Right, Green = Anterior–Posterior, Blue = Superior–Inferior)**:

| # | White-Matter Tract System | Canonical ID(s) | Badge | System Class | Anatomical Trajectory & Subcortical Mapping Significance |
|---|---|---|---|---|---|
| 1 | **Corticospinal Tract (CST)** | `cst_left`, `cst_right` | `CST-L`, `CST-R` | Projection | M1 leg/hand/face → corona radiata → posterior limb of internal capsule (PLIC) → cerebral peduncle → ventral pons → medullary pyramid. |
| 2 | **Arcuate Fasciculus (AF)** | `af_left` | `AF-L` | Association | Dominant C-shaped perisylvian dorsal phonological stream arching around the insula between Broca's IFG and posterior STG/MTG. |
| 3 | **Superior Longitudinal Fasciculus (SLF)** | `slf_left`, `slf_right` | `SLF-L`, `SLF-R` | Association | Frontoparietal pathway linking DLPFC and inferior parietal/angular cortex (visuospatial attention & articulatory loop). |
| 4 | **Inferior Fronto-Occipital Fasciculus (IFOF)** | `ifof_left`, `ifof_right` | `IFOF-L`, `IFOF-R` | Association | Ventral semantic stream traversing the orbitofrontal/IFG cortex, ventral extreme capsule / temporal stem, sagittal stratum, and occipital lobe. |
| 5 | **Optic Radiation (OR)** | `or_left`, `or_right` | `OR-L`, `OR-R` | Projection | LGN → anterior temporal **Meyer's loop**, central macular bundle, and dorsal **Baum's loop** → calcarine V1. |
| 6 | **Corpus Callosum (CC)** | `cc_commissure` | `CC` | Commissural | Interhemispheric fibers crossing `X = 0` from forceps minor (genu) through body and isthmus to forceps major (splenium). |

---

## 5 Curated Neurosurgical Teaching Cases

Each teaching case in `data/cases.json` includes a calibrated 3D lesion volume (primary lobe, optional secondary extension, and FLAIR/vasogenic edema halo), a realistic starting surgical corridor, clinical vignette, recommended neuromonitoring strategy, and operative pearls:

| Case ID | Clinical Case | Lesion MNI Center & Radii (`mm`) | Default Corridor (`entry → target`, radius, mode) | Primary Anatomical Hazards |
|---|---|---|---|---|
| `case01_right_frontal_gbm` | **Right Frontal Glioblastoma (GBM)** | `[26, 8, 46]`, `r=[15, 16, 14]` (+ edema) | `[40, 26, 56] → [26, 8, 46]`, `r = 7 mm`, `transcortical` | `sma_right`, `cst_right`, `m1_right`, `slf_right` |
| `case02_left_insular_lgg` | **Left Insular Low-Grade Glioma (LGG)** | `[−36, 2, 4]`, `r=[11, 16, 13]` (+ frontal lobe `[−38, 16, −2]`, edema) | `[−62, 6, 10] → [−36, 2, 4]`, `r = 6 mm`, `transcortical` | `ifof_left`, `af_left`, `broca_left`, `cst_left` |
| `case03_left_tpo_met` | **Left Temporo-Parieto-Occipital (TPO) Metastasis** | `[−40, −50, 4]`, `r=[12, 12, 11]` (+ edema) | `[−58, −56, 8] → [−40, −50, 4]`, `r = 6 mm`, `transcortical` | `or_left`, `wernicke_left`, `ifof_left`, `af_left` |
| `case04_left_parasagittal_meningioma` | **Left Parasagittal Meningioma** | `[−14, −18, 62]`, `r=[12, 15, 12]` (+ edema) | `[−26, −10, 74] → [−14, −18, 62]`, `r = 7 mm`, `transcortical` | `sss_midline`, `m1_left`, `sma_left`, `cst_left` |
| `case05_sellar_pituitary` | **Sellar / Suprasellar Pituitary Macroadenoma** | `[0, −2, −23]`, `r=[9, 8, 9]` (+ suprasellar `[0, 0, −15]`, extra-axial) | `[0, 42, −46] → [0, −2, −23]`, `r = 4 mm`, `endonasal` | `ica_bilateral`, `optic_chiasm` |

---

## Core Interactive Capabilities

### 1. Real-Time Corridor Clearance & Deterministic Auto-Optimizer

The pure zero-DOM stereotactic engine (`js/geometryEngine.js`) models the surgical corridor as a 3D capsule of configurable radius $r_{\text{corridor}}$ around the trajectory segment from `entryMni` to `targetMni`:

$$\text{corridorClearanceMm} = \max\left(0,\ d_{\text{centerline}} - r_{\text{corridor}}\right)$$

- **Exact Analytical Distances:** Computes exact centerline-to-tract distances (Ericson 3D closest-points algorithm), exact centerline-to-structure ellipsoid distances (Eberly safeguarded Newton-Raphson + bisection and 40-step golden-section search), and exact solid-lesion-to-hazard margins (von Neumann convex alternating projections).
- **Color-Coded Clinical Risk Tiers:**
  - **Critical (`< 5.0 mm`)** — Red pulsing proximity warning beacons tethered between the corridor wall and closest hazard surface.
  - **Caution (`5.0 – 10.0 mm`)** — Amber proximity alert in the 3D scene, Probe's-Eye view, and sorted Hazard Matrix.
  - **Safe (`> 10.0 mm`)** — Emerald clearance status.
- **Deterministic Trajectory Auto-Optimizer (`optimizeEntryCorridor`):**
  - Uses **zero randomness** (`Math.random()` is never called) for 100% reproducible educational demonstrations.
  - **Transcortical Mode:** Evaluates 144 ipsilateral Golden-Angle Fibonacci hemisphere entry candidates projected directly onto the sculpted cortical shell (`evaluateBrainShell`).
  - **Endonasal Mode:** Evaluates a deterministic 60-point anterior skull-base / sphenoid rostrum entry grid.
  - Applies a weighted multi-objective safety score giving `1.5×` penalty priority to vascular structures, corticospinal tracts, and the optic chiasm while balancing minimum clearance, secondary clearance, and parenchymal depth.
  - Previews the candidate trajectory as a dashed cyan **ghost corridor** in 3D alongside quantitative clearance/length deltas before applying.

### 2. Probe's-Eye ("Down-the-Barrel") View

The circular **Probe's-Eye** viewport slices perpendicular to the active trajectory axis at any user-selected depth from entry (`0%`) to target (`100%`):

- Computes exact analytical 2D plane-ellipsoid intersection ellipses (via normalized-space $2 \times 2$ quadratic eigen-decomposition) and white-matter streamline pierce locations.
- Overlays the exact surgical corridor aperture (`corridorRadiusMm`), concentric `+5 mm` critical (red), `+10 mm` caution (amber), and `+20 mm` reference scale rings, dynamically oriented `R / L / A / P / S / I` compass markers, and nearest-hazard callouts at the active slice depth.

### 3. Local MNI-152 NIfTI-1 Mask Overlay (100% Browser-Local)

Researchers and educators can drag-and-drop or browse for any MNI-152 aligned binary or thresholded lesion mask in **`.nii`** or **`.nii.gz`** format:

- **Zero Server Communication:** Files are read exclusively via browser `File.arrayBuffer()` and decompressed locally via native `DecompressionStream('gzip')`.
- **Full NIfTI-1 Header Support:** Supports little-endian and big-endian NIfTI-1 (`sizeof_hdr = 348`, `n+1\0`), datatypes `UINT8`, `INT8`, `INT16`, `UINT16`, `INT32`, `UINT32`, `FLOAT32`, and `FLOAT64`, with `scl_slope`/`scl_inter` intensity scaling.
- **MNI Affine Resolution:** Applies `sform_code > 0` (`srow_x/y/z`) first, falls back to `qform_code > 0` (quaternion rotation + `qfac` + `qoffset`), and finally diagonal `pixdim` spacing with a transparent user warning.
- **Automatic Scene Integration:** Extracts exact lesion volume ($\text{cm}^3$), MNI centroid, bounding box, tight bounding ellipsoid, and a deterministic surface-prioritized 3D point cloud—automatically re-centering tri-planar slices and recomputing every corridor and lesion hazard distance locally.

### 4. Interactive 10-Question Neuroanatomy Quiz & Report Export

- **10 Board-Style Questions (`q01`–`q10`):** Two targeted questions per teaching case covering functional localization, subcortical Direct Electrical Stimulation (DES) signs, white-matter disconnection syndromes, vascular hazards, and operative corridor selection.
- **Synchronized 3D Guidance:** Opening each question automatically loads the associated teaching case, smoothly flies the 3D camera (`flyToCamera`) to the canonical viewing angle, and highlights the relevant structures or tracts.
- **Educational Session Reports:** Export complete corridor metrics, sorted hazard matrices, optional custom NIfTI summary metadata, and quiz performance as **Markdown (`.md`)** or structured **JSON (`.json`)**, always stamped with the mandatory non-clinical disclaimer.

---

## Repository Structure

```text
neurocorridor-3d/
├── .github/
│   └── workflows/
│       └── pages.yml           # CI geometry/hygiene gate + GitHub Pages static deployment
├── css/
│   └── styles.css              # Dark neuronavigation console theme & responsive layout
├── data/
│   ├── atlas_anatomy.json      # MNI-152 reference, 11 eloquent structures (8 regions), 10 tracts (6 systems)
│   └── cases.json              # 5 neurosurgical teaching cases + 10 interactive quiz questions
├── js/
│   ├── geometryEngine.js       # Pure zero-DOM stereotactic math, optimizer & browser-local NIfTI-1 parser
│   ├── quizEngine.js           # Pure zero-DOM quiz state machine & Markdown/JSON report formatter
│   ├── renderer3d.js           # Pure HTML5 Canvas 3D + Tri-Planar + Probe's-Eye visualization engine
│   └── app.js                  # Application state store, controller & DOM event wiring
├── tests/
│   └── verify_geometry.py      # Python 3.12 stdlib schema, symmetry, geometry & zero-CDN CI suite
├── index.html                  # Zero-CDN HTML5 neuronavigation workstation shell
├── ARCHITECTURE.md             # Canonical system architecture & mathematical specification
├── CONTRIBUTING.md             # Open-science contribution guidelines & verification workflow
├── CITATION.cff                # Machine-readable software citation metadata (CFF 1.2.0)
├── LICENSE                     # MIT License (2026)
├── README.md                   # Project documentation
└── .gitignore                  # Python, neuroimaging PHI/mask safety, and editor ignore rules
```

---

## Contributing

Contributions from neurosurgeons, neuroradiologists, neuroanatomists, neuroscientists, educators, and software engineers are welcome. Please review [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before opening a pull request, and ensure `python tests/verify_geometry.py` passes cleanly with zero errors.

## Citation

If you use **NeuroCorridor-3D** in teaching, neuroanatomy workshops, or academic research, please cite the software using [CITATION.cff](CITATION.cff) (or GitHub's **"Cite this repository"** button):

```bibtex
@software{neurocorridor_3d_2026,
  title   = {NeuroCorridor-3D: Zero-Build Interactive 3D Stereotactic Neuroanatomy, Fiber Tractography and Surgical Corridor Planning Sandbox},
  author  = {{NeuroCorridor-3D Contributors}},
  year    = {2026},
  version = {1.0.0},
  license = {MIT},
  url     = {https://github.com/neurocorridor-3d/neurocorridor-3d}
}
```

## License

Released under the [MIT License](LICENSE) (Copyright © 2026 NeuroCorridor-3D Contributors).
