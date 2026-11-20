# Contributing to NeuroCorridor-3D

Thank you for your interest in contributing to **NeuroCorridor-3D**, an open-science educational and research sandbox for 3D stereotactic neuroanatomy, white-matter fiber tractography, and surgical corridor exploration.

Before submitting an issue or pull request, please read this guide together with [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Clinical Safety, Privacy & Architecture Non-Negotiables

All contributions must strictly preserve the following project invariants:

1. **Non-Clinical Educational Mandate:** Every user-facing interface and exported report must preserve the prominent disclaimer:
   > `"Educational & Research Sandbox — Not Approved for Clinical Neuronavigation"`
   > `"100% Browser-Local — Zero Uploads"`
2. **Zero Patient Data (PHI):** Never commit patient-derived neuroimaging volumes (`.nii`, `.nii.gz`, `.dcm`), clinical screenshots containing identifiers, or non-anonymized case histories. All repository cases and atlas coordinates must use synthetic or population-level MNI-152 reference geometry.
3. **Zero-Build & Zero-CDN Policy:** The application must remain pure HTML5, CSS3, Vanilla ES Modules, and HTML5 2D Canvas. Do **not** introduce Node.js, npm packages, bundlers, external CDN `<script>` / `<link>` tags, external web fonts, or network telemetry.
4. **Python 3.12 Stdlib-Only Testing:** Verification scripts in `tests/` must run using only the Python 3.12 standard library. Never spawn local or headless browser binaries in scripts, tests, or CI workflows.
5. **Deterministic Computation:** Stereotactic geometry calculations and corridor optimization routines must remain 100% deterministic (never use `Math.random()`).

---

## Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/neurocorridor-3d.git
   cd neurocorridor-3d
   ```
2. Launch a local static HTTP server (required for ES modules and local `fetch()`):
   ```bash
   python -m http.server 8000
   ```
   Open `http://localhost:8000` in your browser.
3. Run the verification suite before and after making changes:
   ```bash
   python tests/verify_geometry.py
   ```

---

## Contribution Areas

### 1. Neuroanatomical Atlas (`data/atlas_anatomy.json`)

When refining or proposing anatomical structures or white-matter tracts:

- Express all coordinates in **MNI-152 RAS+ millimeters (`mm`)** within the canonical bounds:
  - `X ∈ [-72, +72]` (Left → Right)
  - `Y ∈ [-105, +72]` (Posterior → Anterior)
  - `Z ∈ [-55, +82]` (Inferior → Superior)
- Maintain exact `X`-mirror symmetry (`|x_L + x_R| < 1e-6`, matching `y` and `z`) for paired bilateral homologous structures and tracts.
- Provide complete clinical metadata for every entry (`function`, `deficitIfInjured`, `monitoringModality` or `desSign`, and `surgicalPearl`), grounded in peer-reviewed neuroanatomy and subcortical mapping literature.
- Use high-contrast `#RRGGBB` hex colors legible against the dark `#090d14` canvas background.

### 2. Teaching Cases & Quiz Bank (`data/cases.json`)

When adding or improving teaching cases or board-style quiz questions:

- Verify that all `keyHazards`, `caseId`, and `highlightStructureIds` reference valid canonical IDs in `data/atlas_anatomy.json` and `data/cases.json`.
- Ensure lesion ellipsoids and default corridors represent anatomically plausible clinical geometry and clear educational learning objectives.
- Each quiz item must provide exactly 4 distinct options (`options.length === 4`), a valid `correctIndex` (`0`–`3`), a camera focus angle (`focusCamera`), a thorough anatomical `explanation`, and a concise `pearl`.

### 3. Stereotactic Geometry, Quiz & Visualization Engines (`js/`)

- Keep `js/geometryEngine.js` and `js/quizEngine.js` **100% zero-DOM** (no `window`, `document`, or Canvas references) so mathematical and state-machine logic remains cleanly testable and decoupled from presentation.
- Preserve exact exported API signatures documented in [ARCHITECTURE.md](ARCHITECTURE.md).
- Keep the HTML5 Canvas renderer (`js/renderer3d.js`) responsive via `ResizeObserver` with DPR clamping (`1..2`) and faithful radiological orientation (`R/L/A/P/S/I`).
- When modifying geometric algorithms in `js/geometryEngine.js`, update the corresponding analytical reference tests in `tests/verify_geometry.py` in the same pull request.

### 4. Documentation & DevOps

- Keep `README.md`, `ARCHITECTURE.md`, `CITATION.cff`, and `.github/workflows/pages.yml` synchronized whenever schemas, atlas inventories, or workflows evolve.

---

## Pull Request Checklist

Before opening a pull request against `main`, confirm that:

- [ ] `python tests/verify_geometry.py` exits with status `0` locally.
- [ ] All modified JSON files are valid, cleanly formatted, and adhere to the schemas in `ARCHITECTURE.md`.
- [ ] No external CDN links, external fonts, Node/npm artifacts, or NIfTI/DICOM data files are included in the diff.
- [ ] The clinical safety disclaimer and 100% browser-local privacy guarantees remain intact.
- [ ] Your PR description clearly summarizes the motivation, anatomical/mathematical rationale, and verification results.

---

## Reporting Issues

Please open a GitHub Issue with:

- A concise title and category (**Anatomical Accuracy**, **Geometry Bug**, **NIfTI Compatibility**, **UI/Accessibility**, or **Documentation**).
- Exact MNI-152 coordinates, case ID, or browser version needed to reproduce the issue.
- Relevant peer-reviewed anatomical or mathematical references when proposing coordinate or clinical-content corrections.

---

## Licensing of Contributions

By submitting a contribution to NeuroCorridor-3D, you agree that your work will be licensed under the project's [MIT License](LICENSE).
