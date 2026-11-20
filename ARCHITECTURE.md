# NeuroCorridor-3D — System Architecture & Engineering Specification

**Version:** 1.0.0  
**Scope:** Zero-build, 100% browser-local, offline-capable static web application (GitHub Pages ready) for interactive 3D stereotactic neuroanatomy, white-matter fiber tractography, brain tumor cases, and neurosurgical corridor planning.

> **Clinical Safety Mandate:** Every user-facing view and exported report MUST prominently display:  
> `"Educational & Research Sandbox — Not Approved for Clinical Neuronavigation"`  
> and `"100% Browser-Local — Zero Uploads"`.

---

## 1. Environment Constraints & Engineering Non-Negotiables

| Constraint | Requirement |
|---|---|
| **Runtime Stack** | Pure HTML5 + CSS3 + Vanilla ES Modules (`<script type="module">`) + HTML5 2D Canvas (custom 3D depth-sorted projection + orthogonal slices + Probe's-Eye view). |
| **Build & Dependencies** | **ZERO** Node.js, npm, Vite/Webpack/esbuild bundlers, or external CDN `<script>` / `<link>` dependencies. Must operate identically 100% offline and online on GitHub Pages. |
| **Data Privacy** | All NIfTI (`.nii` / `.nii.gz`) parsing, trajectory optimization, and report generation run strictly client-side in browser memory. Zero network telemetry or file uploads. |
| **Verification Stack** | Python 3.12 **stdlib only** (`tests/verify_geometry.py`) executed locally and in GitHub Actions CI (`.github/workflows/ci.yml`). |
| **Process Safety** | **NEVER** spawn `msedge.exe`, `chrome.exe`, or any headless browser binary in scripts, tests, or CI. |

---

## 2. Parallel Engineer Ownership Map (Zero File Overlap)

Four engineers build completely disjoint file lanes against the contracts in Sections 3–8:

| Lane | Role | Owned Files (Exclusive Write) |
|---|---|---|
| **Engineer 1** | Neuroanatomical Atlas & Clinical Case Author | `data/atlas_anatomy.json`, `data/cases.json` |
| **Engineer 2** | Stereotactic Geometry, Quiz & Verification Engine | `js/geometryEngine.js`, `js/quizEngine.js`, `tests/verify_geometry.py`, `.github/workflows/ci.yml` |
| **Engineer 3** | 3D Canvas, Tri-Planar & Probe's-Eye Visualization | `js/renderer3d.js` |
| **Engineer 4** | Neuronavigation Console UI, Controller & Docs | `index.html`, `css/styles.css`, `js/app.js`, `README.md` |

### Repository Layout

```text
neurocorridor-3d/
├── ARCHITECTURE.md            # This specification (canonical contract)
├── README.md                  # User guide, GitHub Pages usage, local serving
├── index.html                 # Zero-CDN HTML5 neuronavigation console shell
├── css/
│   └── styles.css             # Dark neuronavigation theme & responsive grid
├── data/
│   ├── atlas_anatomy.json     # MNI-152 brain ref, 11 eloquent structures, 10 fiber tracts
│   └── cases.json             # 5 teaching cases + 10 interactive neuroanatomy quiz items
├── js/
│   ├── geometryEngine.js      # Pure zero-DOM stereotactic math, optimizer & NIfTI parser
│   ├── quizEngine.js          # Pure zero-DOM quiz state machine & report formatter
│   ├── renderer3d.js          # Pure HTML5 Canvas 3D + Tri-Planar + Probe's-Eye renderer
│   └── app.js                 # Application controller, state store & DOM event wiring
├── tests/
│   └── verify_geometry.py     # Python 3.12 stdlib schema, geometry & static hygiene CI suite
└── .github/
    └── workflows/
        └── ci.yml             # GitHub Actions CI running tests/verify_geometry.py
```

---

## 3. Standardized Stereotactic Coordinate System (MNI-152 RAS+ in mm)

All 3D coordinates across JSON data, geometry math, NIfTI masks, 3D rendering, and tri-planar slices use **MNI-152 RAS+ millimeters (`mm`)**:

| Axis | Anatomical Direction | Negative End | Positive End | Valid Atlas Range (`mm`) |
|---|---|---|---|---|
| **`X`** | Left → **Right** (`+X`) | Left Hemisphere (`-X`) | Right Hemisphere (`+X`) | `-72 .. +72` |
| **`Y`** | Posterior → **Anterior** (`+Y`) | Occipital Pole (`-Y`) | Frontal Pole (`+Y`) | `-105 .. +72` |
| **`Z`** | Inferior → **Superior** (`+Z`) | Skull Base / Brainstem (`-Z`) | Vertex (`+Z`) | `-55 .. +82` |

- **Origin `(0, 0, 0)`:** Anterior Commissure (**AC**). Posterior Commissure (**PC**) sits at approximately `(0, -24, 0)`.
- **Reference Brain Ellipsoid:**
  - Center: `C_brain = [0, -16, 12]` mm
  - Base semi-axes: `R_brain = [68, 86, 66]` mm (spanning `X: [-68, +68]`, `Y: [-102, +70]`, `Z: [-54, +78]`)

### Analytical Brain Envelope, Contour Sculpting & Sub-Structures

Both `js/geometryEngine.js` (for cortical entry projection & depth calculation) and `js/renderer3d.js` (for 3D wireframe + 2D slice silhouettes) MUST share the exact analytical shell function exported by `geometryEngine.js`:

1. **Sculpted Cortical Shell `evaluateBrainShell(ux, uy, uz)`** for any unit direction `u = [ux, uy, uz]`:
   - Start with base ellipsoid point relative to `C_brain = [0, -16, 12]`:
     - `bx = 68 * ux`, `by = 86 * uy`, `bz = 66 * uz`
   - **Longitudinal Interhemispheric Fissure Indentation** (superior/anterior/posterior midline falx groove):
     - For `uz > -0.15`: `fissure = 6.5 * Math.exp(-(ux / 0.13) ** 2) * Math.max(0, (uz + 0.15) / 1.15)`
     - Pull point inward radially along `u` (primarily reducing superior `Z` and anterior/posterior `Y` at `x ≈ 0`): subtract `fissure` along `Z` (when `uz > 0`) and `0.35 * fissure` along `Y`.
   - **Temporal Lobe Lateral-Inferior Contour**:
     - Inferior temporal taper for `uz < -0.15`: gently flatten the orbital frontal floor (`uy > 0.25 && uz < -0.20`, pull `Z` upward by up to `14 mm`) and posterior cerebellar/occipital tentorial notch (`uy < -0.35 && uz < -0.25`, pull inward laterally by up to `10 mm`), while preserving temporal lobe prominence around `|ux| ∈ [0.65, 0.95], uy ∈ [-0.35, 0.35], uz ∈ [-0.55, -0.05]`.
   - **Result:** Returns world MNI point `[x, y, z] = [C_brain[0] + sx, C_brain[1] + sy, C_brain[2] + sz]` so every cortical entry point generated by `optimizeEntryCorridor` sits *directly* on the visible cortical surface rendered in 3D and 2D slices!
2. **Brainstem Reference Volume** (visual landmark + anatomical envelope):
   - Midbrain / Pons / Medulla tapered segments defined in `atlas_anatomy.json` under `brainReference.brainstemEllipsoids`:
     - Midbrain: `center: [0, -24, -8]`, `radii: [11, 9, 9]`
     - Pons: `center: [0, -26, -24]`, `radii: [14, 12, 11]`
     - Medulla: `center: [0, -30, -44]`, `radii: [8, 8, 12]`
3. **Ventricular System Reference** (visual landmark in `atlas_anatomy.json` under `brainReference.ventricles`):
   - Left & Right Lateral Ventricle polylines/ellipsoid chains (frontal horn → body → atrium/trigone → occipital horn → temporal horn) + midline 3rd ventricle ellipsoid `center: [0, -14, 2]`, `radii: [2.5, 11, 6]`.

### Radiological Display Orientation (Tri-Planar Slices)

All three orthogonal slice viewports MUST adhere to standard clinical radiological orientation and print edge orientation glyphs (`R`, `L`, `A`, `P`, `S`, `I`):

| Viewport | Fixed Coord | Horizontal Axis (Left → Right on screen) | Vertical Axis (Bottom → Top on screen) |
|---|---|---|---|
| **Axial** | `Z = sliceZ` | `+X` (**R**) on Left → `-X` (**L**) on Right | `-Y` (**P**) at Bottom → `+Y` (**A**) at Top |
| **Coronal** | `Y = sliceY` | `+X` (**R**) on Left → `-X` (**L**) on Right | `-Z` (**I**) at Bottom → `+Z` (**S**) at Top |
| **Sagittal** | `X = sliceX` | `+Y` (**A**) on Left → `-Y` (**P**) on Right | `-Z` (**I**) at Bottom → `+Z` (**S**) at Top |

---

## 4. Anatomical Atlas & Case Data Schemas

### 4.1 `data/atlas_anatomy.json`

Top-level JSON structure:

```json
{
  "schemaVersion": "1.0.0",
  "coordinateSystem": "MNI-152-RAS+",
  "units": "mm",
  "bounds": {
    "x": [-72, 72],
    "y": [-105, 72],
    "z": [-55, 82]
  },
  "brainReference": {
    "originMni": [0, 0, 0],
    "centerMni": [0, -16, 12],
    "radiiMm": [68, 86, 66],
    "brainstemEllipsoids": [
      { "label": "Midbrain", "center": [0, -24, -8], "radii": [11, 9, 9] },
      { "label": "Pons", "center": [0, -26, -24], "radii": [14, 12, 11] },
      { "label": "Medulla", "center": [0, -30, -44], "radii": [8, 8, 12] }
    ],
    "ventricles": [
      { "id": "lat_vent_left", "hemisphere": "left", "ellipsoids": [...] },
      { "id": "lat_vent_right", "hemisphere": "right", "ellipsoids": [...] },
      { "id": "third_vent", "hemisphere": "midline", "ellipsoids": [{ "center": [0, -14, 2], "radii": [2.5, 11, 6] }] }
    ]
  },
  "structures": [ /* 11 Eloquent / Subcortical / Skull-Base Structure objects */ ],
  "tracts": [ /* 10 White-Matter Fiber Tract objects */ ]
}
```

#### Eloquent Structure Object Schema (`atlasData.structures[]`)

Every entry in `structures` MUST contain all required fields:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique snake_case ID (exact canonical IDs listed below). |
| `name` | `string` | Full anatomical name (e.g., `"Primary Motor Cortex (Left)"`). |
| `shortName` | `string` | Compact badge label (`<= 12` chars, e.g., `"M1-L"`). |
| `hemisphere` | `"left" \| "right" \| "bilateral" \| "midline"` | Laterality tag. |
| `category` | `"eloquent_cortex" \| "deep_gray" \| "cranial_nerve" \| "vascular"` | Functional/surgical class (vascular & cranial nerves receive higher safety weighting in optimization). |
| `color` | `string` | Hex color string (`#RRGGBB`) with high legibility on `#090d14`. |
| `ellipsoids` | `Array<{ center: [number,number,number], radii: [number,number,number], label?: string }>` | One or more MNI-152 mm axis-aligned ellipsoids defining the structure's 3D extent. |
| `function` | `string` | Concise neuroanatomical function summary. |
| `deficitIfInjured` | `string` | Classic neurological deficit if transected or thermally/ischemic injured. |
| `monitoringModality` | `string` | Gold-standard intraoperative neuromonitoring / mapping modality. |
| `surgicalPearl` | `string` | High-yield neurosurgical operative pearl. |

#### Canonical 11 Eloquent / Subcortical / Skull-Base Structure IDs & MNI Anchor Coordinates

Engineer 1 MUST populate these exact 11 IDs (representing the 8 functional systems, split laterally where surgically essential) within these anatomically verified MNI-152 bounds:

| Exact `id` | `shortName` | `category` | `color` | MNI-152 Anchor Ellipsoids (`center`, `radii` in mm) |
|---|---|---|---|---|
| `m1_left` | `M1-L` | `eloquent_cortex` | `#ef4444` | Leg `[-10,-26,66] r[8,9,10]`, Hand `[-36,-20,54] r[11,9,12]`, Face `[-52,-10,34] r[9,8,11]` |
| `m1_right` | `M1-R` | `eloquent_cortex` | `#f87171` | Exact `+X` mirror of `m1_left` |
| `broca_left` | `Broca-L` | `eloquent_cortex` | `#f97316` | Pars opercularis `[-50,14,16] r[9,10,10]`, Pars triangularis `[-48,28,10] r[9,10,9]` |
| `wernicke_left` | `Wern-L` | `eloquent_cortex` | `#eab308` | Posterior STG `[-56,-42,14] r[9,13,10]`, SMG/Angular `[-52,-52,24] r[9,10,9]` |
| `v1_bilateral` | `V1` | `eloquent_cortex` | `#22c55e` | Left calcarine `[-10,-84,4] r[8,14,10]`, Right calcarine `[10,-84,4] r[8,14,10]` |
| `sma_left` | `SMA-L` | `eloquent_cortex` | `#fb923c` | Medial SFG `[-8,-2,62] r[7,15,9]` |
| `sma_right` | `SMA-R` | `eloquent_cortex` | `#fdba74` | Exact `+X` mirror `[8,-2,62] r[7,15,9]` |
| `thalamus_bilateral` | `Thal` | `deep_gray` | `#a855f7` | Left `[-12,-18,6] r[9,14,10]`, Right `[12,-18,6] r[9,14,10]` |
| `optic_chiasm` | `Chiasm` | `cranial_nerve` | `#fde047` | Chiasm `[0,3,-14] r[7,4,3]`, L-ON `[-6,12,-16] r[2.5,8,2.5]`, R-ON `[6,12,-16] r[2.5,8,2.5]` |
| `ica_bilateral` | `ICA` | `vascular` | `#e11d48` | L-Cav `[-11,-3,-24] r[3,7.5,5.5]`, L-Sup `[-10,1,-15] r[2.8,4.5,4.5]`, R-Cav `[11,-3,-24] r[3,7.5,5.5]`, R-Sup `[10,1,-15] r[2.8,4.5,4.5]` |
| `sss_midline` | `SSS` | `vascular` | `#3b82f6` | Ant `[0,34,58] r[4.5,22,5.5]`, Mid `[0,-14,73] r[5.5,28,6]`, Post `[0,-64,54] r[6,26,7]` |

#### White-Matter Fiber Tract Object Schema (`atlasData.tracts[]`)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique snake_case ID (exact canonical IDs below). |
| `name` | `string` | Full tract name (e.g., `"Left Corticospinal Tract"`). |
| `shortName` | `string` | Compact badge label (`<= 10` chars, e.g., `"CST-L"`). |
| `system` | `"projection" \| "association" \| "commissural"` | White-matter classification. |
| `hemisphere` | `"left" \| "right" \| "bilateral"` | Laterality. |
| `color` | `string` | Anatomical mode hex color (`#RRGGBB`). |
| `controlPolylines` | `Array<Array<[number,number,number]>>` | 3–6 anatomically accurate 3D control-point streamlines in MNI mm (each polyline `>= 4` points), densified via Catmull-Rom in `geometryEngine.js`. |
| `function` | `string` | Functional pathway description. |
| `deficitIfInjured` | `string` | Postoperative tract disconnection deficit. |
| `desSign` | `string` | Classic subcortical Direct Electrical Stimulation (DES) response (e.g., phonemic paraphasias, semantic paraphasias, contralateral MEP/contraction, phosphenes). |
| `surgicalPearl` | `string` | Subcortical mapping & preservation surgical pearl. |

#### Canonical 10 White-Matter Fiber Tract IDs (6 Major Systems)

| Exact `id` | `shortName` | `system` | `color` | Key Anatomical Trajectory Landmarks (MNI-152 mm) |
|---|---|---|---|---|
| `cst_left` | `CST-L` | `projection` | `#38bdf8` | 4 streamlines: M1 leg/hand/face (`[-12..-44, -14..-24, 42..64]`) → corona radiata → PLIC `[-22,-16,6]` → cerebral peduncle `[-14,-22,-14]` → ventral pons `[-8,-26,-32]` → pyramid `[-4,-30,-48]` |
| `cst_right` | `CST-R` | `projection` | `#0ea5e9` | Exact `+X` mirror of `cst_left` |
| `af_left` | `AF-L` | `association` | `#f59e0b` | 4 streamlines forming C-shaped perisylvian arc: Broca IFG `[-46,18,14]` → frontoparietal arc `[-40,-6,28]` → `[-42,-32,26]` → curving behind insula `[-46,-44,14]` → posterior STG/MTG `[-52,-38,2]` |
| `slf_left` | `SLF-L` | `association` | `#fbbf24` | 3 streamlines: DLPFC `[-38,28,26]` → `[-38,4,34]` → `[-38,-22,34]` → inferior parietal/angular `[-42,-50,32]` |
| `slf_right` | `SLF-R` | `association` | `#facc15` | Exact `+X` mirror of `slf_left` |
| `ifof_left` | `IFOF-L` | `association` | `#c084fc` | 4 streamlines: orbitofrontal/IFG `[-34,42,4]` → **ventral extreme capsule / temporal stem** `[-32,4,-6]` → `[-34,-22,-4]` → sagittal stratum `[-32,-56,0]` → occipital `[-24,-84,4]` |
| `ifof_right` | `IFOF-R` | `association` | `#a855f7` | Exact `+X` mirror of `ifof_left` |
| `or_left` | `OR-L` | `projection` | `#34d399` | 3–4 streamlines: LGN `[-22,-24,-4]` → **Meyer's Loop** anterior temporal sweep `[-36,-12,-14] → [-44,-22,-14] → [-38,-48,-6] → [-14,-84,-2]`, central macular bundle `[-36,-28,-4] → [-34,-54,0] → [-14,-86,4]`, dorsal Baum's loop `[-34,-34,6] → [-30,-58,8] → [-12,-82,10]` |
| `or_right` | `OR-R` | `projection` | `#10b981` | Exact `+X` mirror of `or_left` |
| `cc_commissure` | `CC` | `commissural` | `#f472b6` | 5 interhemispheric streamlines arching across `X = 0`: forceps minor (genu `[0,24,12]`), anterior body `[0,8,24]`, midbody `[0,-12,26]`, isthmus `[0,-32,22]`, forceps major (splenium `[0,-42,16]`) |

---

### 4.2 `data/cases.json`

Top-level JSON structure:

```json
{
  "schemaVersion": "1.0.0",
  "cases": [ /* 5 Curated Neurosurgical Teaching Cases */ ],
  "quiz": [ /* 10 Interactive Neuroanatomy & Surgical Approach Quiz Questions */ ]
}
```

#### Teaching Case Object Schema (`casesData.cases[]`)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Exact canonical case ID (below). |
| `title` | `string` | Concise clinical case title. |
| `pathology` | `string` | WHO / histopathological classification & grade. |
| `approachName` | `string` | Named neurosurgical corridor / craniotomy. |
| `defaultCamera` | `{ yaw: number, pitch: number, zoom: number }` | Recommended 3D viewpoint when loading case. |
| `lesion` | `{ primaryEllipsoid: Ellipsoid, secondaryEllipsoid: Ellipsoid \| null, edemaEllipsoid: Ellipsoid \| null, color: string, edemaColor: string }` | 3D tumor geometry in MNI-152 mm (`Ellipsoid = { center: [x,y,z], radii: [rx,ry,rz] }`). |
| `defaultCorridor` | `{ entryMni: [number,number,number], targetMni: [number,number,number], radiusMm: number, approachMode: "transcortical" \| "endonasal" }` | Default starting surgical corridor (calibrated to showcase realistic clinical hazard geometry and optimization headroom). |
| `recommendedMapping` | `string` | Recommended anesthesia & neuromonitoring protocol (e.g., Awake craniotomy + DO80 naming + bipolar DES vs Asleep continuous MEP/SSEP). |
| `clinicalPresentation` | `string` | Realistic 2–3 sentence neurosurgical vignette. |
| `surgicalPearls` | `string[]` | 3–5 actionable operative pearls. |
| `keyHazards` | `string[]` | Array of canonical structure/tract IDs from `atlas_anatomy.json` representing the primary hazards for this case. |

#### Canonical 5 Curated Teaching Cases & Calibrated MNI Geometry

| Exact `id` | Lesion Primary (`center`, `radii`) | Edema Halo | Default Corridor (`entryMni` → `targetMni`, `radiusMm`, `mode`) | Key Hazard IDs |
|---|---|---|---|---|
| `case01_right_frontal_gbm` | `[26, 8, 46]`, `r[15, 16, 14]` | `[26, 8, 46] r[22, 23, 20]` | `[40, 26, 56]` → `[26, 8, 46]`, `r=7`, `transcortical` | `sma_right`, `cst_right`, `m1_right`, `slf_right` |
| `case02_left_insular_lgg` | `[-36, 2, 4]`, `r[11, 16, 13]` (+ sec `[-38, 16, -2] r[8, 10, 9]`) | `[-36, 4, 3] r[15, 22, 17]` | `[-62, 6, 10]` → `[-36, 2, 4]`, `r=6`, `transcortical` | `ifof_left`, `af_left`, `broca_left`, `cst_left` |
| `case03_left_tpo_met` | `[-40, -50, 4]`, `r[12, 12, 11]` | `[-40, -50, 4] r[20, 20, 18]` | `[-58, -56, 8]` → `[-40, -50, 4]`, `r=6`, `transcortical` | `or_left`, `wernicke_left`, `ifof_left`, `af_left` |
| `case04_left_parasagittal_meningioma` | `[-14, -18, 62]`, `r[12, 15, 12]` | `[-16, -18, 58] r[16, 19, 15]` | `[-26, -10, 74]` → `[-14, -18, 62]`, `r=7`, `transcortical` | `sss_midline`, `m1_left`, `sma_left`, `cst_left` |
| `case05_sellar_pituitary` | `[0, -2, -23]`, `r[9, 8, 9]` (+ sec `[0, 0, -15] r[6, 5, 4]`) | `null` (extra-axial) | `[0, 42, -46]` → `[0, -2, -23]`, `r=4`, `endonasal` | `ica_bilateral`, `optic_chiasm` |

#### Quiz Question Object Schema (`casesData.quiz[]` — Exactly 10 Questions)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | `"q01"` through `"q10"`. |
| `caseId` | `string` | Valid case ID from `casesData.cases` (2 questions mapped per case for balanced curriculum). |
| `focusCamera` | `{ yaw: number, pitch: number, zoom: number }` | 3D camera viewpoint in radians/scale matching Section 6 camera conventions. |
| `highlightStructureIds` | `string[]` | 1–3 valid structure and/or tract IDs from `atlas_anatomy.json` highlighted while answering. |
| `question` | `string` | Board-style clinical/anatomical stem. |
| `options` | `[string, string, string, string]` | Exactly 4 distinct multiple-choice answers. |
| `correctIndex` | `0 \| 1 \| 2 \| 3` | Zero-based index of the correct option. |
| `explanation` | `string` | Clear anatomical/physiological rationale shown after submission. |
| `pearl` | `string` | High-yield clinical takeaway. |

---

## 5. Pure Stereotactic Geometry & Quiz Engine Contracts

### 5.1 `js/geometryEngine.js` (Zero-DOM Pure ES Module)

Must have **zero** references to `window`, `document`, `HTMLCanvasElement`, or DOM globals (except standard `DecompressionStream` / `Blob` / `Response` inside `parseMniNiftiMask` which are standard Web APIs).

#### Required Exported Constants & Utility Functions

```js
export const MNI_BOUNDS = { x: [-72, 72], y: [-105, 72], z: [-55, 82] };
export const BRAIN_CENTER = [0, -16, 12];
export const BRAIN_RADII = [68, 86, 66];
export const RISK_THRESHOLDS = { criticalMm: 5.0, cautionMm: 10.0 };

export function getRiskTier(clearanceMm)
// Returns 'critical' if clearanceMm < 5.0
//         'caution'  if 5.0 <= clearanceMm <= 10.0
//         'safe'     if clearanceMm > 10.0

export function tangentToDecColor(tangent)
// Standard neuroradiological DTI DEC RGB from unit tangent [tx, ty, tz]:
// Red = |tx| (Left-Right), Green = |ty| (Ant-Post), Blue = |tz| (Sup-Inf)
// Returns hex string '#RRGGBB' (scaled cleanly with subtle dark-UI floor clamp [30..255]).

export function evaluateBrainShell(ux, uy, uz)
// Given any non-zero direction [ux, uy, uz], normalizes it and returns [x, y, z] MNI mm
// on the sculpted brain shell (base ellipsoid + longitudinal fissure + temporal/frontal contour).

export function isInsideBrain(pointMni)
// Returns boolean: true if pointMni lies on or inside the sculpted brain shell.

export function projectToCorticalSurface(pointMni)
// Projects a point radially from BRAIN_CENTER onto evaluateBrainShell, returning [x, y, z].
```

#### Core Spline & Analytical 3D Distance API (Exact Signatures & Algorithms)

1. **`sampleCatmullRomBundle(controlPolylines, samplesPerSegment = 10)`**
   - **Algorithm:** Centripetal Catmull-Rom spline ($\alpha = 0.5$, knot spacing $\Delta t_i = \|P_{i+1} - P_i\|^{0.5}$) with linear phantom endpoints $P_{-1} = 2P_0 - P_1$ and $P_n = 2P_{n-1} - P_{n-2}$. Guarantees zero cusps or self-intersections and exact interpolation of control endpoints.
   - **Returns:** `Array<Array<[number, number, number]>>` where each streamline has `(k - 1) * samplesPerSegment + 1` points (for $k$ control points).
   - **Convenience Companion:** `densifyAtlasTracts(atlasData, samplesPerSegment = 10)` -> returns `Array<{ ...tract, streamlines: Array<Array<[x,y,z]>>, tangents: Array<Array<[tx,ty,tz]>> }>` with unit tangents precomputed via central differences.

2. **`pointToSegmentDistance(p, a, b)`**
   - **Algorithm:** Exact analytical projection $t = \operatorname{clamp}(\frac{(p-a)\cdot(b-a)}{\|b-a\|^2}, 0, 1)$, returns Euclidean distance $\|p - (a + t(b-a))\|_2 \ge 0$ (`number`, mm). Handles degenerate $a = b$.

3. **`segmentToSegmentDistance(a1, a2, b1, b2)`**
   - **Algorithm:** Exact analytical 3D closest-points algorithm (Ericson, *Real-Time Collision Detection* §5.1.9) handling skew, parallel, collinear, and degenerate segments with `EPS = 1e-12`.
   - **Returns:** `number` (`>= 0`, mm).
   - **Companion:** `closestPointsSegmentToSegment(a1, a2, b1, b2)` -> `{ distance, pointOnA: [x,y,z], pointOnB: [x,y,z], tA, tB }`.

4. **`pointToEllipsoidSurfaceDistance(p, ellipsoid)` & `closestPointOnEllipsoid(p, ellipsoid)`**
   - **Algorithm (Exact Eberly 1D Root-Finding):**
     - Translate $q_i = |p_i - c_i|$, compute $k = \sum (q_i / r_i)^2$.
     - If $k \le 1$: point is inside/on ellipsoid $\Rightarrow$ `distance = 0`, `closestPoint = p`, `inside = true`.
     - If $k > 1$: solve strictly-decreasing convex $g(t) = \sum_{i=1}^3 \left(\frac{r_i q_i}{t + r_i^2}\right)^2 - 1 = 0$ on $[0, t_{\text{hi}}]$ where $t_{\text{hi}} = \sqrt{\sum (r_i q_i)^2}$ (guaranteed $g(0) > 0 > g(t_{\text{hi}})$) via safeguarded Newton-Raphson + bisection to tolerance `1e-10`.
     - Closest surface point in local octant: $x_i = \frac{r_i^2 q_i}{t^* + r_i^2}$; restore signs and add `ellipsoid.center`.
   - **Returns:** `pointToEllipsoidSurfaceDistance` -> `number` (`>= 0`, mm); `closestPointOnEllipsoid` -> `{ distance, closestPoint: [x,y,z], inside: boolean }`.

5. **`segmentToEllipsoidSurfaceDistance(a, b, ellipsoid)`**
   - **Algorithm:**
     1. Exact intersection test in unit-sphere space $\hat{a} = (a - c) / r, \hat{b} = (b - c) / r$: solve quadratic $\|\hat{a} + u(\hat{b}-\hat{a})\|^2 \le 1$ on $u \in [0, 1]$. If intersecting, return `0`.
     2. Otherwise, because both the segment and solid ellipsoid are convex sets, $f(u) = \text{pointToEllipsoidSurfaceDistance}(a + u(b-a), E)$ is strictly convex/unimodal on $[0, 1]$. Minimize via 40-step Golden-Section Search (error `< 1e-6 mm`).
   - **Returns:** `number` (`>= 0`, mm — trajectory **centerline** to ellipsoid surface).
   - **Corridor-Wall Clearance Rule:** Surgical corridor collision volume is a **capsule** of radius `corridorRadiusMm` around segment `[entryMni, targetMni]`:
     $$\text{corridorClearanceMm} = \max\left(0,\ d_{\text{centerline}} - \text{corridorRadiusMm}\right)$$
   - **Companion:** `closestPointSegmentToEllipsoid(a, b, ellipsoid)` -> `{ distance, pointOnSegment: [x,y,z], pointOnEllipsoid: [x,y,z], t }`.

6. **`ellipsoidToEllipsoidDistance(e1, e2)`**
   - **Algorithm (Exact Convex Alternating Projections):**
     - Fast sphere-bound & center-inside check first.
     - Iterate up to 64 steps starting from `p1 = e1.center`:
       - `r2 = closestPointOnEllipsoid(p1, e2)` -> if `r2.inside`, return `0`.
       - `r1 = closestPointOnEllipsoid(r2.closestPoint, e1)` -> if `r1.inside`, return `0`.
       - Stop early when `|d_prev - r1.distance| < 1e-5` mm.
     - By von Neumann's theorem for strictly convex compact sets, converges monotonically to exact Euclidean distance `>= 0` (tolerance `< 0.005 mm`).
   - **Returns:** `number` (`>= 0`, mm).

7. **`ellipsoidToPolylineDistance(ellipsoid, polyline)`**
   - **Algorithm:** Minimum of `segmentToEllipsoidSurfaceDistance(polyline[i], polyline[i+1], ellipsoid)` over all segments $i = 0 \dots n-2$, accelerated with exact lower-bound pruning `pointToSegmentDistance(e.center, P_i, P_{i+1}) - max(e.radii) >= bestDist`.
   - **Returns:** `number` (`>= 0`, mm).

#### Corridor Analysis API

8. **`analyzeSurgicalCorridor(corridor, lesion, atlasData, densifiedTracts)`**
   - **Inputs:**
     - `corridor`: `{ entryMni: [x,y,z], targetMni: [x,y,z], radiusMm: number, approachMode?: 'transcortical' | 'endonasal' }`
     - `lesion`: `{ primaryEllipsoid, secondaryEllipsoid?: Ellipsoid|null, edemaEllipsoid?: Ellipsoid|null, pointCloudMni?: Array<[x,y,z]>|null }`
     - `atlasData`: parsed `atlas_anatomy.json`
     - `densifiedTracts`: output of `densifyAtlasTracts(atlasData)`
   - **Lesion Ellipsoids Considered for `lesionClearanceMm`:** Minimum distance across `[lesion.primaryEllipsoid, lesion.secondaryEllipsoid].filter(Boolean)` (solid tumor margin, excluding vasogenic edema halo).
   - **Returns:**
     ```js
     {
       trajectoryLengthMm: number,          // ||targetMni - entryMni||
       corticalEntryDepthMm: number,        // parenchyma traversal depth along trajectory
       corridorRadiusMm: number,
       approachMode: 'transcortical' | 'endonasal',
       overallRiskTier: 'critical' | 'caution' | 'safe',
       corridorFrame: {
         origin: [x, y, z],                 // entryMni
         target: [x, y, z],                 // targetMni
         axis: [ax, ay, az],                // unit entry -> target
         uAxis: [ux, uy, uz],               // canonical right axis in Probe's-Eye
         vAxis: [vx, vy, vz],               // canonical up axis in Probe's-Eye
         uPositiveLabel: 'R'|'L'|'A'|'P'|'S'|'I',
         uNegativeLabel: 'R'|'L'|'A'|'P'|'S'|'I',
         vPositiveLabel: 'R'|'L'|'A'|'P'|'S'|'I',
         vNegativeLabel: 'R'|'L'|'A'|'P'|'S'|'I'
       },
       structures: Array<HazardReport>,     // one per atlasData.structures
       tracts: Array<HazardReport>,         // one per densifiedTracts
       sortedHazards: Array<HazardReport>,  // combined, sorted asc by corridorClearanceMm
       criticalViolations: Array<HazardReport>, // riskTier === 'critical' (< 5 mm)
       cautionStructures: Array<HazardReport>,  // riskTier === 'caution' (5..10 mm)
       proximityWarnings: Array<HazardReport>,  // corridorClearanceMm <= 10 mm
       probeCrossSection: (depthFraction: number) => ProbeCrossSectionData
     }
     ```
   - **`HazardReport` Shape:**
     ```js
     {
       id: string,
       name: string,
       shortName: string,
       kind: 'structure' | 'tract',
       category: string,                    // structure.category or tract.system
       hemisphere: string,
       color: string,
       centerlineDistanceMm: number,        // exact distance from corridor centerline
       corridorClearanceMm: number,         // max(0, centerlineDistanceMm - corridorRadiusMm)
       lesionClearanceMm: number,           // exact lesion surface to structure/tract distance
       riskTier: 'critical' | 'caution' | 'safe',
       lesionRiskTier: 'critical' | 'caution' | 'safe',
       corridorClosestPoint: [x, y, z],
       hazardClosestPoint: [x, y, z],
       depthFraction: number                // 0..1 along [entryMni, targetMni]
     }
     ```
   - **`ProbeCrossSectionData` Shape** (returned by `analysis.probeCrossSection(depthFraction)`):
     ```js
     {
       depthFraction: number,               // clamped [0, 1]
       depthMm: number,                     // depthFraction * trajectoryLengthMm
       planeOriginMni: [x, y, z],
       corridorRadiusMm: number,
       viewRadiusMm: number,                // default 28 mm display radius
       frame: corridorFrame,
       structures: Array<{
         id, name, shortName, color, riskTier,
         intersectsPlane: boolean,
         u: number, v: number,              // 2D offset from corridor centerline (mm)
         rx2d: number, ry2d: number,        // cross-section ellipse radii (mm)
         angleRad: number,
         edgeClearanceMm: number
       }>,
       tracts: Array<{
         id, name, shortName, color, riskTier,
         minClearanceMm: number,
         points2d: Array<{ u: number, v: number, decColor: string, clearanceMm: number }>
       }>,
       lesion: {
         intersectsPlane: boolean,
         primary: { u, v, rx2d, ry2d, angleRad } | null,
         secondary: { u, v, rx2d, ry2d, angleRad } | null,
         edema: { u, v, rx2d, ry2d, angleRad } | null
       },
       closestAtSlice: { name: string, shortName: string, clearanceMm: number, riskTier: string } | null
     }
     ```
   - **Plane-Ellipsoid Cross-Section Math (for `probeCrossSection`):**
     For an ellipsoid $(c, r)$ and plane $P(u, v) = O + u\hat{U} + v\hat{V}$ with normal $\hat{N} = \text{axis}$:
     Transform into normalized ellipsoid space ($D^{-1} = \operatorname{diag}(1/r_x, 1/r_y, 1/r_z)$):
     - Let $o' = D^{-1}(O - c)$, $u' = D^{-1}\hat{U}$, $v' = D^{-1}\hat{V}$, $n' = \operatorname{normalize}(u' \times v')$.
     - Signed distance from unit sphere center to plane is $d = o' \cdot n'$.
     - If $|d| < 1$: the slice intersects the ellipsoid in a true 2D ellipse! Solve the $2 \times 2$ quadratic form $(u' u + v' v + o')^2 = 1$ (symmetric $2 \times 2$ eigen-decomposition gives exact center `(u0, v0)`, semi-axes `(rx2d, ry2d)`, and rotation `angleRad`!).

#### Deterministic Corridor Optimizer API

9. **`optimizeEntryCorridor(targetMni, lesion, atlasData, densifiedTracts, options = {})`**
   - **Options:** `{ approachMode = 'transcortical', radiusMm = 6, currentCorridor = null, maxDepthMm = 95, candidateCount = 144 }`
   - **100% Deterministic Sampling (Zero `Math.random()`):**
     - `approachMode === 'transcortical'`: Golden-Angle Fibonacci hemisphere (`goldenAngle = Math.PI * (3 - Math.sqrt(5))`) on the **same hemisphere** as `targetMni` (`x * hemiSign >= 0.08`, `z >= -0.25`), projected onto `evaluateBrainShell(ux, uy, uz)`. Rejects lengths `< 10 mm` or `> maxDepthMm`.
     - `approachMode === 'endonasal'`: Deterministic 60-point anterior skull-base / sphenoid rostrum grid `x ∈ [-6, -3, 0, 3, 6]`, `y ∈ [36, 42, 48]`, `z ∈ [-50, -46, -42, -38]`.
   - **Objective Score (higher = safer & more practical):**
     - For each hazard `h`: weight `w = (h.category === 'vascular' || h.id.startsWith('cst_') || h.id === 'optic_chiasm') ? 1.5 : 1.0`.
     - If `h.corridorClearanceMm < 5`: add `-w * (60 + 40 * (5 - h.corridorClearanceMm))`.
     - Else if `h.corridorClearanceMm <= 10`: add `-w * 6 * (10 - h.corridorClearanceMm)`.
     - Reward minimum clearance: `+12 * Math.min(minClearance, 20) + 3 * Math.min(secondMinClearance, 20)`.
     - Depth penalty: `-0.65 * trajectoryLengthMm`.
     - Baseline offset: `+100`.
   - **Returns:**
     ```js
     {
       bestCorridor: { entryMni, targetMni, radiusMm, approachMode },
       bestAnalysis: AnalysisResult,
       bestScore: number,
       candidatesEvaluated: number,
       topCandidates: Array<{ corridor, score, minClearanceMm, trajectoryLengthMm, overallRiskTier }>, // top 5
       comparisonDelta: {
         minClearanceDeltaMm: number,
         trajectoryLengthDeltaMm: number,
         criticalCountDelta: number,
         cautionCountDelta: number,
         scoreDelta: number,
         improved: boolean,
         summary: string
       } | null
     }
     ```

#### Browser-Local NIfTI-1 Parser API

10. **`async parseMniNiftiMask(arrayBuffer, options = {})`**
    - **Options:** `{ fileName = null, threshold = 0, maxPoints = 1200 }`
    - **Gzip Support:** Detects `0x1f 0x8b` header and decompresses via native `DecompressionStream('gzip')` (zero external libraries).
    - **Header Parsing:** Supports little-endian and big-endian NIfTI-1 (`sizeof_hdr === 348`), single-file `n+1\0`, datatypes `UINT8 (2)`, `INT16 (4)`, `INT32 (8)`, `FLOAT32 (16)`, `FLOAT64 (64)`, `INT8 (256)`, `UINT16 (512)`, `UINT32 (768)`, applying `scl_slope` / `scl_inter` when `scl_slope !== 0`.
    - **MNI Affine Priority:** `sform_code > 0` (`srow_x/y/z`) → `qform_code > 0` (quaternion rotation + `qfac` + `qoffset`) → diagonal `pixdim` fallback (with warning).
    - **Mask Extraction:** Collects non-zero voxels (`value > threshold`), computes exact volume (`cm³`), MNI centroid, tight axis-aligned bounding ellipsoid (`radii >= 2 mm`), and deterministic strided surface-prioritized point cloud (`<= maxPoints` points).
    - **Returns:**
      ```js
      {
        fileName: string | null,
        dimensions: [nx, ny, nz],
        voxelSpacingMm: [dx, dy, dz],
        affineSource: 'sform' | 'qform' | 'fallback',
        affineMatrix: number[][],
        voxelCount: number,
        volumeCm3: number,
        centroidMni: [x, y, z],
        boundingBoxMni: { min: [x,y,z], max: [x,y,z] },
        primaryEllipsoid: { center: [x,y,z], radii: [rx,ry,rz] },
        pointCloudMni: Array<[x, y, z]>,
        warnings: string[]
      }
      ```

---

### 5.2 `js/quizEngine.js` (Zero-DOM Pure ES Module)

```js
export class NeuroQuizEngine {
  constructor(questions = []);
  reset();
  getQuestionCount();              // number
  getCurrentIndex();               // 0..n-1
  getCurrentQuestion();            // QuizQuestion | null
  selectQuestion(index);           // QuizQuestion | null
  nextQuestion();                  // QuizQuestion | null
  prevQuestion();                  // QuizQuestion | null
  submitAnswer(optionIndex);       // { questionId, isCorrect, correctIndex, selectedIndex, alreadyAnswered, explanation, pearl, score, answeredCount, totalCount }
  getAnswerRecord(questionId);     // { selectedIndex, isCorrect } | null
  getProgress();                   // { currentIndex, answeredCount, correctCount, totalCount, percentComplete, accuracyPercent, isComplete, answersById }
  getSummary();                    // { score, totalCount, accuracyPercent, tierLabel, missedQuestions }
}

export function generateEducationalReportMarkdown({
  caseData,
  corridor,
  analysis,
  customNiftiInfo = null,
  quizSummary = null,
  timestampIso = new Date().toISOString()
}); // returns formatted Markdown string containing prominent non-clinical disclaimer

export function generateEducationalReportJson({
  caseData,
  corridor,
  analysis,
  customNiftiInfo = null,
  quizSummary = null,
  timestampIso = new Date().toISOString()
}); // returns JSON-serializable structured report object
```

---

## 6. Pure HTML5 Canvas Visualization Engine Contract (`js/renderer3d.js`)

### Camera Convention (Shared with `data/cases.json`)

The 3D orbit camera targets `lookAt = [0, -14, 10]` (center of reference brain) at base distance `baseDist = 310 / zoom` mm (`zoom ∈ [0.55, 2.6]`, `pitch ∈ [-1.48, +1.48]` rad):

```js
eye = [
  lookAt[0] + dist * Math.cos(pitch) * Math.sin(yaw),
  lookAt[1] + dist * Math.cos(pitch) * Math.cos(yaw),
  lookAt[2] + dist * Math.sin(pitch)
]
```

| Preset Name | `yaw` (rad) | `pitch` (rad) | `zoom` | Clinical View |
|---|---|---|---|---|
| `'oblique'` (default) | `-0.68` | `0.34` | `1.0` | Left-anterior-superior 3/4 view |
| `'anterior'` | `0.0` | `0.06` | `1.0` | Frontal coronal view |
| `'posterior'` | `3.1416` | `0.08` | `1.0` | Occipital posterior view |
| `'left'` | `-1.5708` | `0.08` | `1.05` | Left lateral (language/insular) |
| `'right'` | `1.5708` | `0.08` | `1.05` | Right lateral (right frontal) |
| `'superior'` | `0.0` | `1.42` | `1.05` | Superior vertex (parasagittal) |
| `'endonasal'` | `0.18` | `-0.38` | `1.35` | Inferior-anterior skull base (sellar) |

### `class NeuroCorridorRenderer` API

```js
export class NeuroCorridorRenderer {
  constructor({
    canvas3d,
    canvasAxial,
    canvasCoronal,
    canvasSagittal,
    canvasProbe,
    onSliceClick = null,       // ({ plane: 'axial'|'coronal'|'sagittal', mniPoint: [x,y,z], shiftKey: boolean }) => void
    onStructureHover = null,   // ({ id, name, kind, screenX, screenY } | null) => void
    onCameraChange = null      // ({ yaw, pitch, zoom }) => void
  });

  setAtlasData(atlasData, densifiedTracts);
  setState(partialState);      // Merges into render state & schedules redraw
  setCamera(yaw, pitch, zoom);
  flyToCamera(yaw, pitch, zoom, durationMs = 420);
  setCameraPreset(presetName);
  getCamera();                 // { yaw, pitch, zoom }
  resize();                    // Re-syncs all 5 canvases using DPR (clamped 1..2)
  renderAll();                 // Immediate full draw pass across all 5 viewports
  destroy();                   // Disconnects ResizeObserver, RAF, and input listeners
}
```

### Canonical `renderState` Shape Accepted by `setState(partialState)`

```js
{
  lesion: { primaryEllipsoid, secondaryEllipsoid, edemaEllipsoid, color, edemaColor, pointCloudMni } | null,
  corridor: { entryMni, targetMni, radiusMm, approachMode } | null,
  ghostCorridor: { entryMni, targetMni, radiusMm, approachMode } | null, // optimizer preview
  analysis: AnalysisResult | null,
  sliceMni: [number, number, number],          // [sliceX, sliceY, sliceZ]
  probeDepthFraction: number,                  // 0.0 (entry) .. 1.0 (target)
  tractColorMode: 'anatomical' | 'dec',
  visibleStructures: Record<string, boolean>,  // { [structureId]: true/false }
  visibleTracts: Record<string, boolean>,      // { [tractId]: true/false }
  highlightIds: string[],                      // highlighted structure/tract IDs
  selectedHazardId: string | null,
  showBrainShell: boolean,
  showVentricles: boolean,
  showEdema: boolean,
  showLabels: boolean,
  showCorridor: boolean,
  brainOpacity: number                         // 0.05 .. 0.60
}
```

### Required Rendering Capabilities Across the 5 Canvases

1. **Interactive 3D Stereotactic Viewport (`canvas3d`)**:
   - **Depth-Sorted 3D Painter Pipeline** (`60fps`, `requestAnimationFrame` with dirty-tracking + pulsing glow animation when critical warnings exist):
     - Translucent anatomical brain wireframe latitude/longitude contours derived from `evaluateBrainShell`, translucent brainstem & lateral ventricles.
     - Shaded translucent eloquent structure ellipsoids with rim highlight and optional floating 3D callout pills.
     - Glowing multi-streamline white-matter fiber tracts supporting both **Anatomical Color** and **DTI DEC RGB** coloring (with luminous outer aura + crisp inner filament).
     - 3D tumor core (primary + optional secondary lobe) + translucent FLAIR/edema halo + optional local NIfTI point cloud.
     - **3D Surgical Corridor Cylinder**: translucent 16-sided tube of exact radius `corridorRadiusMm`, cortical **Entry Ring**, **10 mm Depth Tick Rings**, **Target Crosshair**, risk-tier color (`#10b981` safe / `#f59e0b` caution / `#f43f5e` critical), and optional dashed cyan `ghostCorridor` preview.
     - **Proximity Warning Beacons**: glowing red (`<5 mm`) / amber (`5–10 mm`) markers at `hazardClosestPoint` tethered to `corridorClosestPoint` with `shortName + mm` micro-badges.
     - Interactive 3D anatomical orientation triad (`R/L`, `A/P`, `S/I`) in the lower-left HUD corner.
   - **Input Controls:** Pointer drag to orbit (mouse + single-touch), wheel / pinch to zoom, double-click to reset oblique view.
2. **Synchronized Axial / Coronal / Sagittal MNI Slice Viewports (`canvasAxial`, `canvasCoronal`, `canvasSagittal`)**:
   - Crisp 20 mm MNI stereotactic grid, AC origin crosshair, radiological edge labels (`R/L/A/P/S/I`), live coordinate readout (`AXIAL Z = +12 mm`).
   - Analytical brain silhouette contour on the active slice plane, exact 2D plane-ellipsoid cross-sections of visible eloquent structures, tract pierce markers within `±3.5 mm` of the plane (colored in Anatomical or DEC RGB), lesion core + FLAIR cross-section, projected surgical trajectory vector & corridor width envelope, and interactive click-to-place target/entry/crosshair conversion (`onSliceClick`).
3. **Probe's-Eye View Canvas (`canvasProbe`)**:
   - Live circular down-the-barrel scope driven by `analysis.probeCrossSection(probeDepthFraction)`.
   - Displays exact corridor circle (`corridorRadiusMm`), red `+5 mm` critical ring, amber `+10 mm` caution ring, outer `+20 mm` scale ring, rotating `R/L/A/P/S/I` compass edge markers, intersecting structures, tract bundle cross-section dots, and approaching lesion cross-section.
4. **Sharpness & Layout Resilience:** All 5 canvases attach to a single `ResizeObserver` and scale backing store by `Math.min(window.devicePixelRatio || 1, 2)`.

---

## 7. Neuronavigation Console UI & Controller Contracts (`index.html`, `css/styles.css`, `js/app.js`)

### Design System Tokens (`css/styles.css`)

```css
:root {
  --bg-void: #090d14;
  --bg-panel: #0f1623;
  --bg-elevated: #162033;
  --bg-input: #0b111c;
  --border-subtle: rgba(148, 163, 184, 0.16);
  --border-active: rgba(56, 189, 248, 0.50);
  --accent-cyan: #38bdf8;
  --accent-cobalt: #0ea5e9;
  --status-safe: #10b981;
  --status-caution: #f59e0b;
  --status-critical: #f43f5e;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Cascadia Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
}
```

### Mandatory Persistent Safety & Privacy Chrome

- Top workstation bar MUST always display:
  1. App title **NeuroCorridor-3D**
  2. High-visibility warning pill: **`Educational & Research Sandbox — Not Approved for Clinical Neuronavigation`**
  3. High-visibility privacy pill: **`100% Browser-Local — Zero Uploads`**

### Canonical DOM Element IDs (Contract between `index.html` and `js/app.js`)

| Group | Element IDs |
|---|---|
| **Viewports** | `viewport-3d`, `slice-axial`, `slice-coronal`, `slice-sagittal`, `viewport-probe` |
| **3D HUD & Camera** | `hud-risk-badge`, `hud-case-title`, `hud-trajectory-stats`, `camera-presets` (buttons with `data-preset="oblique\|anterior\|posterior\|left\|right\|superior\|endonasal"`), `hover-tooltip` |
| **Slice & Probe Sliders** | `slider-slice-z`, `val-slice-z`, `slider-slice-y`, `val-slice-y`, `slider-slice-x`, `val-slice-x`, `slider-probe-depth`, `val-probe-depth` |
| **Left Rail (Cases & NIfTI)** | `case-selector-list`, `nifti-dropzone`, `nifti-file-input`, `nifti-status-card`, `btn-reset-lesion` |
| **Left Rail (Layers & Atlas)** | `btn-color-anatomical`, `btn-color-dec`, `dec-legend`, `toggle-brain-shell`, `slider-brain-opacity`, `toggle-ventricles`, `toggle-edema`, `toggle-labels`, `toggle-corridor`, `structure-toggle-list`, `tract-toggle-list`, `btn-show-all-atlas`, `btn-hazards-only` |
| **Right Rail Tabs** | `tab-btn-planner`, `tab-btn-pearls`, `tab-btn-quiz`, `tab-panel-planner`, `tab-panel-pearls`, `tab-panel-quiz` |
| **Corridor Controls** | `click-mode-group` (`data-mode="inspect\|target\|entry"`), `approach-mode-group` (`data-approach="transcortical\|endonasal"`), `input-entry-x/y/z`, `input-target-x/y/z`, `slider-corridor-radius`, `val-corridor-radius`, `btn-optimize-corridor`, `btn-apply-optimized`, `btn-reset-corridor`, `optimizer-result-banner` |
| **Hazard Matrix & Inspector** | `hazard-matrix-body`, `anatomy-inspector-card`, `pearls-content` |
| **Quiz & Export** | `quiz-progress-bar`, `quiz-score-badge`, `quiz-question-card`, `btn-quiz-prev`, `btn-quiz-next`, `btn-quiz-restart`, `btn-export-md`, `btn-export-json` |

### Application State Flow (`js/app.js`)

1. **Bootstrap:** Loads `./data/atlas_anatomy.json` and `./data/cases.json` via `fetch()` in parallel. On `file://` CORS failure, renders a clean inline banner instructing the user to run `python -m http.server 8000` (never fails silently).
2. **Precomputation:** Calls `densifyAtlasTracts(atlasData, 10)` once on startup.
3. **Reactive Recompute Loop:** Any change to `corridor`, `lesion`, or active case immediately invokes `analyzeSurgicalCorridor(...)`, updates the HUD risk pill, re-renders the sorted Hazard Matrix, and calls `renderer.setState(...)`.
4. **Optimizer Workflow:** Clicking **Optimize Safer Corridor** runs `optimizeEntryCorridor(...)`, sets `ghostCorridor = result.bestCorridor` so the user visually compares current vs optimized trajectory in 3D, and displays `comparisonDelta.summary` with an **Apply Optimized Trajectory** button.
5. **NIfTI Drop Workflow:** Dropping or picking a `.nii` / `.nii.gz` file reads `file.arrayBuffer()`, calls `await parseMniNiftiMask(...)`, sets the custom lesion (`primaryEllipsoid` + `pointCloudMni`), re-centers `targetMni` and tri-planar slices on `centroidMni`, and auto-recalculates all stereotactic clearances locally!
6. **Quiz Workflow:** Opening a quiz question loads its associated `caseId`, flies the 3D camera smoothly via `renderer.flyToCamera(...)` to `question.focusCamera`, highlights `question.highlightStructureIds`, and locks/scores answers via `NeuroQuizEngine`.

---

## 8. Python 3.12 Stdlib Verification & CI Contract (`tests/verify_geometry.py`, `.github/workflows/ci.yml`)

`tests/verify_geometry.py` MUST run with **Python 3.12 standard library only** (`json`, `math`, `pathlib`, `re`, `struct`, `gzip`, `sys`) and exit `0` on full pass / non-zero on any failure:

1. **Data Schema & Referential Integrity Checks:**
   - Verifies exact 11 structure IDs and exact 10 tract IDs in `data/atlas_anatomy.json`, all required fields present, valid hex colors, positive ellipsoid radii, and all MNI coordinates inside `[-72..72, -105..72, -55..82]`.
   - Verifies exact 5 case IDs and 10 quiz questions in `data/cases.json`; confirms all `keyHazards`, `caseId`, and `highlightStructureIds` resolve to valid IDs; confirms `len(options) == 4` and `correctIndex in {0, 1, 2, 3}`.
2. **Anatomical Symmetry & Clinical Plausibility Checks:**
   - Bilateral homologous structures (`m1_left`/`m1_right`, `sma_left`/`sma_right`) and tracts (`cst`, `slf`, `ifof`, `or`) are exact `X`-mirror symmetric (`|x_L + x_R| < 1e-6`, equal `y, z`).
   - Case 01 (`case01_right_frontal_gbm`): right hemisphere (`x > 0`), within `< 20 mm` of `sma_right` and `cst_right`.
   - Case 02 (`case02_left_insular_lgg`): left insula (`x < -20`), surrounded by `ifof_left`, `af_left`, `broca_left`, `cst_left`.
   - Case 03 (`case03_left_tpo_met`): left posterior temporal/TPO (`x < -25, y < -35`), close to `or_left` and `wernicke_left`.
   - Case 04 (`case04_left_parasagittal_meningioma`): adjacent to `sss_midline` (`< 12 mm`) and `m1_left` (`< 15 mm`).
   - Case 05 (`case05_sellar_pituitary`): midline sellar mass (`|x| <= 3, z < -15`), abutting/compressing `optic_chiasm` (`<= 3 mm`), endonasal corridor passing between bilateral `ica_bilateral` with `corridorClearanceMm < 8 mm`.
3. **Analytical Geometry Unit Tests (Python Mirror of `geometryEngine.js`):**
   - Exact tests for `point_to_segment_distance`, `segment_to_segment_distance` (skew, intersecting, parallel, degenerate), `point_to_ellipsoid_surface_distance` (interior, surface, axial/diagonal exterior against analytical sphere/ellipsoid truths to `< 1e-5 mm`), `segment_to_ellipsoid_surface_distance`, `ellipsoid_to_ellipsoid_distance`, and centripetal Catmull-Rom spline endpoint & smoothness invariants.
   - Evaluates all 5 default case corridors and verifies non-NaN finite clearances, risk-tier classification (`<5` critical, `5–10` caution, `>10` safe), and confirms deterministic corridor optimization never returns NaN or out-of-bounds entries.
4. **Static Hygiene & Zero-CDN Gating:**
   - Scans `index.html`, `css/styles.css`, and `js/*.js` to guarantee **zero** external `http://` or `https://` `<script>` or `<link rel="stylesheet">` tags.
   - Verifies clinical safety disclaimer text and `"100% Browser-Local"` badge exist in `index.html`.
   - Verifies **zero** occurrences of `msedge.exe` or `chrome.exe` anywhere in the codebase.
   - Verifies all relative ES module `import` paths in `js/*.js` exist on disk and all required exported symbols from `geometryEngine.js`, `quizEngine.js`, and `renderer3d.js` are declared.

### GitHub Actions CI (`.github/workflows/ci.yml`)

Triggers on `push` and `pull_request`, uses `actions/checkout@v4` + `actions/setup-python@v5` (`python-version: '3.12'`), and runs `python tests/verify_geometry.py`. Zero npm or browser installs.
