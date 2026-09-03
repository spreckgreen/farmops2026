# Electrical document generation screen (PDF output)

A new page that pulls everything it prints from the versioned read-only Electrical API and turns it into three PDFs: the Farm Shop electrical sheet, an Avery label sheet, and the grid map.

## What you get

Route: `/electrical/documents`, in Electrical navigation under **Integration → Documents**.

A single screen with:

- **Source panel** — one `GET /api/electrical/v1/documents/bundle` call, showing schema version, generated-at timestamp, per-collection record counts and QA error/warning counts. A "Refresh from API" button re-pulls. If the API returns 401/403, the page says so plainly instead of rendering an empty document.
- **Scope controls** — building/location (defaults to Farm Shop), panel filter, and per-document toggles.
- **Three generate buttons**, each producing a PDF download and an on-screen preview count of what will be included:

  1. **Farm Shop electrical sheet** (multi-page, letter portrait)
     - Cover: building, generated-at, API schema version, record counts, authority note (canonical ODS = design intent, FarmOps = as-built).
     - Panel schedules: one section per panel with bus rating, voltage, phase, spaces, feeder source, then its breaker positions and connected loads.
     - Load schedule: stable ID, description, grid, volts, amps, VA, D/S, critical flag, installation status.
     - Conduit/raceway and junction-box schedules where records exist.
     - QA appendix: findings from `bundle.qa`, verbatim, reported not enforced.
     - Anything absent in the records prints `NOT IN RECORD` — no inferred values, no invented connections.

  2. **Avery label sheet** — the existing label engine, rendered to PDF instead of the browser print dialog. Same formats (including Avery 8593), same walk-order grouping by location → panel → grid → name, same page break per location/panel group, same far-right grid and volt-amp D/S lines, same QR content.

  3. **Grid map** (letter landscape) — the corrected 40′ × 60′ Farm Shop drawing with rows A–F north→south and columns 1–9 west→east, plotted from the same classification helpers the on-screen map uses: red large dedicated, orange dedicated 20 A, blue shared. Unresolved and mobile/non-fixed assets are listed in a side table rather than plotted at invented coordinates. Legend plus a per-dot key table with stable ID, description, grid, precision.

"Generate all three" produces the three files in one action.

## Embedded version stamp on every generated file

Every document and export this screen produces carries the same version block, so a printed sheet on a shop wall can be checked against what the system holds today.

The stamp records:

- document type and document format version (e.g. `farm-shop-sheet v1.0`)
- API version and snapshot schema version
- snapshot `generated_at` timestamp (UTC and local)
- a short content digest of the exact records rendered, so two files with the same digest are provably the same truth
- canonical workbook SHA and Contract v3 binding version where the document depends on canonical values
- record counts, QA error/warning counts, and the "records only, gaps printed as NOT IN RECORD" statement
- who generated it and when

Where it appears:

- Printed footer on every page of every PDF: `type vX.Y · schema · generated_at · digest · page n of m`.
- PDF document metadata (title, subject, keywords) so the version survives even if a page footer is cropped.
- On the Avery sheet, a compact version code on the first sheet only — never inside a cut label, so no label loses printable area.
- Grid map: the block sits in the drawing margin outside the 40′ × 60′ building outline.
- CSV/JSON exports get the same fields as leading comment/metadata rows.
- The screen shows the current stamp before you generate, and a "verify a printed document" box: paste or scan a digest/version code and it reports current, superseded, or unknown.

Digests are computed from the rendered record set, not from PDF bytes, so a reprint of unchanged data verifies as the same version.

## Boundaries kept

- Read-only. The page calls only the GET endpoints; no relationship or field-observation write path is touched.
- No canonical ODS write-back, no schema change, no migration, no bulk edits.
- Stable IDs, existing grid values, classifications and the frozen shop geometry are untouched.
- Gated by the existing electrical entitlement and access checks, same as the other electrical pages.



## Technical notes

- Add `jspdf` for PDF generation (client-side, so nothing runs in the Worker runtime and no server timeouts apply). The grid map is drawn with jsPDF vector primitives plus the existing `farm-shop-grid-plan.png`; labels and schedules are drawn as text/table primitives — no HTML-to-canvas rasterization, so text stays crisp and selectable.
- New `src/lib/electrical-documents.ts`: pure functions that turn a bundle payload plus scope into document models (`sheetModel`, `labelModel`, `gridMapModel`) — unit-testable with no PDF or DOM dependency.
- New `src/lib/electrical-pdf.ts`: jsPDF renderers consuming those models.
- New `src/lib/electrical-doc-version.ts`: builds the version stamp and the content digest (stable-key ordered serialization → SHA-256, truncated to a readable code such as `FS-SHEET-1.0-9F3A21C7`). Pure and unit-tested; the same input always yields the same code.
- Bundle fetch goes through a small authenticated server function that forwards the caller's session to the API handler, so the browser never needs to hold a raw bearer token.
- Reuses without modification: `electrical-labels.ts` (walk groups, label lines, QR URLs), `electrical-grid-map.ts` (`classifyCircuit`, `placeLoad`, `AXIS_ROWS`/`AXIS_COLS`, `SHOP_WIDTH_FT`/`SHOP_DEPTH_FT`), `electrical-grid-operational.ts` (precision and verification classification).
- Tests in `tests/electrical-documents.test.ts`: section/record counts match the bundle counts, `NOT IN RECORD` is emitted rather than a blank or guessed value, label walk order and page-break grouping are preserved, unresolved/mobile assets are excluded from plotted points and present in the unplotted table, classification counts reconcile to the total, the digest is stable across reprints of identical data, and it changes when any rendered value changes.
- Generated PDFs are visually QA'd page by page — including the footer version block on every page — before the work is reported complete.

