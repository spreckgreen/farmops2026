# Phase 4.4 — Lossless Parallel Validation

Semantic comparison between the canonical engineering workbook
(`PremoFarmElectrical.ods`) and the normalized FarmOps electrical model.

FarmOps is **not** promoted by this phase. `SOR_AUTHORITY` stays
`canonical_ods`; FarmOps remains the candidate engineering SOR and the current
field/as-built authority. Phase 4.5 requires explicit owner authorization.

## Where

- UI: **Electrical → Parallel validation** (`/electrical/validation`)
- Engine: `src/lib/electrical-parallel-validation.ts` (pure, no DB access)
- Server function: `src/lib/electrical-parallel-validation.functions.ts`
  (`runElectricalParallelValidation`, authenticated + `electrical` entitlement)

## Read-only guarantees

Phase 4.4 is a **reconciliation** phase, never a synchronization phase. Neither
system may automatically overwrite the other: the canonical ODS stays
authoritative for engineering design, FarmOps stays authoritative for approved
field/as-built observations, and every difference crossing that authority
boundary requires explicit human disposition.

- The workbook is unzipped in memory; only `content.xml` is read. Nothing is
  written back, and no ODS XML is preserved or compared.
- The comparison reads electrical rows through the existing reconciliation
  snapshot. It performs no `insert`/`update`/`upsert`/`delete`.
- No stable ID is renamed and no record is deleted or recreated to force a
  match.

## Baseline identity

Every report records the workbook `file_name` and its **SHA-256**, the FarmOps
snapshot `generated_at` plus snapshot schema version, the mapping version, the
normalization version and the comparison timestamp — so the exact engineering
baseline that was validated can be proven later.

## Comparison unit

Stable electrical identity, never a database UUID:
`FS-###` / `PH-###` / `BL-###` / `HSE-##`, `PNL-*`, `FDR-###`, `CON-###`,
`JB-###-##`, `BR-###-##-##`.

Raceways use `CON-###` for every raceway type. Material/construction lives in
`raceway_type` (EMT, FLEX, PVC, underground). `EMT-###` is not reintroduced.

## Classifications

| Classification | Meaning |
| --- | --- |
| `MATCH` | Same engineering value, same representation. |
| `EXPECTED_TRANSFORMATION` | Same meaning after a documented normalization (units, Yes/No, relational FK from workbook text, set ordering). |
| `FARMOPS_AS_BUILT_ADDITION` | Legitimate newer field information: installed `CON-###`/`JB-###-##`/`BR-###-##-##`, measured length, install/label status, physical panel exits, breaker positions. |
| `ODS_ONLY` | Meaningful workbook value not yet populated in FarmOps — must be explained. |
| `FARMOPS_ONLY` | FarmOps design-owned value or record with no workbook counterpart — review required. |
| `CONFLICT` | Both systems hold a value for the same design concept and disagree. Neither value is chosen automatically. |
| `LOSS` | Populated workbook column with no FarmOps destination in the Phase 4.3 mapping. **Phase 4.5 blocker.** |
| `INCOMPLETE` | The model can represent the value, but the production record is legitimately unfinished (unresolved relationship, uncaptured field value). |

Design vs as-built is never a conflict: a design length of 45 ft that matches
`planned_length_ft` reports `MATCH`, while a `measured_length_ft` of 48 ft is a
`FARMOPS_AS_BUILT_ADDITION`. Field ownership comes from the Phase 4.3 mapping
(`field_ownership` in the snapshot).

## Normalization rules (version 1.0)

`whitespace_trim`, `case_fold`, `null_equivalence`, `not_applicable_null`,
`boolean_yes_no`, `strip_units`, `thousands_separator`, `percent`,
`dual_voltage` (`120/240V` → 240), `numeric_tolerance` (±0.005),
`relational_fk_from_text`, `set_ordering` (circuit-group membership compared as
sorted stable-ID sets).

Two genuinely different engineering values are never normalized into equality.

## Outputs

Deterministic JSON (schema `1.0`), CSV and a Markdown summary, all downloadable
from the report page and suitable for external validation by
BosteadFarmsBuildDocs. Records are sorted by domain, stable ID, field and
classification, so identical inputs produce byte-identical output.

## Acceptance

Success is **not** 100% match — FarmOps legitimately holds newer field data.
Phase 4.4 passes when `LOSS = 0`, every `CONFLICT` is individually
dispositioned, every `ODS_ONLY` result is explained, as-built additions are
preserved, and no comparison modified production data.

## Deployment note

The Lovable cloud database does not contain the authoritative self-hosted
FarmOps production electrical dataset. The definitive Phase 4.4 comparison is
run on the self-hosted instance against the exact canonical ODS baseline; cloud
counts are not production results.

## Phase 4.4a — reconciliation and validator hardening

Phase 4.4a keeps the same authority boundaries as 4.4 (canonical ODS for
engineering design, FarmOps for approved field/as-built observations) and adds
root-cause analysis and explicit dispositions. Nothing is synchronized: neither
system is written, and no difference is resolved automatically.

### Preserved baseline

The Phase 4.4 run recorded before hardening is kept verbatim in
`src/lib/electrical-reconciliation.ts` (`PRE_4_4A_BASELINE`) so every artifact
can show before/after counts:

| Classification | Baseline |
| --- | --- |
| Match | 1,558 |
| Expected transformation | 488 |
| FarmOps as-built addition | 279 |
| ODS only | 3 |
| FarmOps only | 589 |
| Conflict | 203 |
| Loss | 67 |
| Incomplete / unknown | 111 |

Baseline canonical workbook SHA-256: `89da43c7...77388`. Reconciliation never
edits, regenerates or normalizes the workbook, so its hash is unchanged.

### LOSS destinations added (§2)

| Workbook column | FarmOps destination | Transformation |
| --- | --- | --- |
| Equipment / Model | `electrical_loads.equipment_model` | verbatim text |
| Source / Reference | `electrical_loads.source_reference` | verbatim text |
| Suggested Panel | `electrical_loads.suggested_panel` | verbatim text; the relational panel assignment is never inferred from it |
| Connected kVA | `electrical_loads.connected_va` | kVA x 1000 -> VA, applied once at import |
| D/S | `electrical_loads.dedicated_shared` | tri-state text: Dedicated / Shared / TBD |

A LOSS finding now names the affected workbook rows and values, and carries a
root cause: `missing_mapping_no_farmops_destination` (no destination exists) or
`importer_omission_alias_missing` (the mapping matrix has a destination but the
importer bound no header).

### Tri-state semantics (§5)

`TBD`, blank, `true`, `false` and `0` are five distinct states.

- `TBD`/`?`/`unknown` normalizes to "no value" **with** `tbd: true`, is
  classified `INCOMPLETE`, and gets disposition `TBD_ENGINEERING_STATE`.
- A bare `1` or `0` in a workbook Yes/No column stays ambiguous text; only a
  value already stored as a number becomes a boolean. Backup Eligible,
  Continuous Load, Dedicated, Critical and Future follow this rule.

### Decision metadata on every finding

Each comparison record carries `authority_class`
(`DESIGN_CANONICAL`, `AS_BUILT_OPERATIONAL`, `DERIVED`, `DECISION_REQUIRED`,
`STRUCTURAL`), a `disposition` (`ACCEPTED`, `REVIEW_REQUIRED`,
`ENGINEERING_DECISION_REQUIRED`, `CORRECT_FARMOPS`, `CORRECT_MAPPING`,
`UNRESOLVED_ENGINEERING_REFERENCE`, `TBD_ENGINEERING_STATE`), a machine-readable
`root_cause`, and — for FarmOps-only findings — a §6 category:

| Category | Meaning | Auto-accepted |
| --- | --- | --- |
| A | Legitimate as-built / operational extension | yes |
| B | Valid schema enrichment | yes |
| C | Import / default artifact | no |
| D | Duplicate or identity error | no |
| E | Engineering decision required | no |

### Identity and unresolved references (§7, §8)

- ODS-only records are explained before being reported as missing:
  `identity_present_in_other_collection` (worksheet/entity mapping is wrong) or
  `legacy_stable_id_equivalence` (canonical `CON-###` against a pre-existing
  `EMT-###` record — nothing is renamed).
- A workbook reference that is descriptive text rather than a stable identifier
  (for example `CON-001` -> `Pull Box: Boiler`) is preserved verbatim as
  `INCOMPLETE` with root cause `unresolved_reference_text_not_a_stable_id`. It
  is never guessed at and never reported as a conflict.

### Acceptance gate

The report computes the gate; it is never asserted by hand:

- `LOSS = 0`
- unexplained ODS-only `= 0`
- no finding left with root cause `unclassified`

Open dispositions are counted and shown but do not fail the gate — a genuine
as-built difference or a real TBD must stay visible rather than be forced to
zero.

### Artifacts

The report page's **Phase 4.4a artifacts** button downloads
`phase-4.4a-reconciliation-report.md`, `phase-4.4a-reconciliation.json`,
`phase-4.4a-conflicts.csv` and `phase-4.4a-unresolved.csv`, alongside the normal
Phase 4.4 JSON/CSV/Markdown exports.

Phase 4.5 and SOR cutover remain out of scope: `SOR_AUTHORITY` stays
`canonical_ods`.

## Phase 4.4a addendum — equipment racks and shared power infrastructure

FarmOps models racks, power distribution equipment and powered devices as
reusable, first-class entities. There is no ham-radio-specific table or column:
a rack's purpose (`rack_role`) and a power asset's type (`asset_type`) are data.

| Entity | Table | Stable ID | Examples |
| --- | --- | --- | --- |
| Equipment rack | `electrical_racks` | `RACK-<SITE>-<ROLE>-##` | `RACK-FS-NET-01`, `RACK-FS-HAM-01` |
| Power distribution asset | `electrical_power_assets` | `PSU|UPS|PDU|DCD-<SITE>-<ROLE>-##` | `PSU-FS-HAM-01`, `UPS-FS-NET-01`, `PDU-FS-NET-01` |
| Powered device | `electrical_devices` | site convention | `NET-SW-FS-01` |

Supported power asset types: `AC_DC_POWER_SUPPLY`, `UPS`, `PDU`,
`DC_DISTRIBUTION`. Adding a type never requires a new table.

### Power dependency topology

    Panel -> Circuit / Load -> Power asset -> Powered device(s)

Both levels are preserved on each record: a device stores its *immediate* power
source (`power_asset_uuid`) and, separately, its upstream electrical source
(`circuit_group_uuid` / `load_uuid`). Several devices may share one power asset,
and they are never modelled as independently connected to the upstream branch circuit
circuit, so failure domains stay computable. A power asset can itself be fed by
another power asset (`upstream_power_asset_uuid`), e.g. a PDU on a UPS.

Nothing is inferred: an unknown DC voltage or PSU rating simply stays unset.

### Diagram views

Generated Mermaid views are deliberately separate — electrical power topology,
network topology, rack/equipment topology and power dependency topology are
distinct diagram types rather than one combined drawing.

### SOR position

Racks, power assets and devices are FarmOps-native infrastructure/as-built/
planning extensions. They have no canonical ODS counterpart, are never added to
`PremoFarmElectrical.ods` to force validation equivalence, and are classified in
the Phase 4.4 report as `FARMOPS_AS_BUILT_ADDITION` with FarmOps-only category
**B — valid schema enrichment**. `SOR_AUTHORITY` remains `canonical_ods` and the
project stays in Phase 4.4a.

## Phase 4.4a continuation — closing the semantic-loss gate

The canonical workbook is never modified. `SOR_AUTHORITY = canonical_ods`,
snapshot schema stays `1.2`, and no Phase 4.5 / cutover work is performed.

### LOSS root-cause groups and corrections

| Root cause group | Correction |
| --- | --- |
| `importer_omission_alias_missing` — sheet-specific engineering headers on Feeders, Conduit_Runs, J-Boxes, Branch_Circuits and Circuit_Groups bound to nothing because only Load_Master and Panel_Schedule had per-sheet aliases | Added per-kind header aliases for those five worksheets (`KIND_ALIASES` in `src/lib/electrical-ods.ts`) |
| `duplicate_header_collision_importer_defect` — two workbook headers meaning the same FarmOps column: the second was silently dropped | `mapSheet` reports the collision (`columns[].collidedWith`); the losing column's values are preserved verbatim under a column-numbered key, and once proven present the finding reports `duplicate_header_collision_preserved_verbatim` |
| `missing_mapping_no_farmops_destination` — a populated canonical column with no dedicated FarmOps field | New lossless-capture column `ods_extras` on the seven ODS-backed tables stores the value verbatim, keyed by its exact workbook header |

### Lossless capture (`ods_extras`)

- Present on `electrical_panels`, `electrical_loads`, `electrical_circuit_groups`,
  `electrical_feeders`, `electrical_raceways`, `electrical_junction_boxes`,
  `electrical_branch_runs`.
- Contains a JSON object: `{"<exact workbook header>": "<verbatim cell text>"}`,
  plus a reserved `__source` entry recording the worksheet, exact header and
  1-based worksheet column for every preserved value, e.g.
  `"__source": {"Insulation Class": {"sheet": "Load_Master", "header": "Insulation Class", "column": 4}}`.
  A header text that occurs twice on the same worksheet is keyed
  `"<header>#<column>"` (e.g. `"Source / Reference#3"`) so neither duplicate
  overwrites the other, and a populated cell under an unnamed column is keyed
  `"(unnamed column <N>)"`.
  No coercion, unit conversion or inference. Read-only in FarmOps (importer
  writes it; forms never do) and never written back to the workbook.
- The validator only downgrades such a column from `LOSS` to
  `EXPECTED_TRANSFORMATION` when the value is **provably** present, byte-for-byte,
  on the matching stable-ID record (`root_cause =
  documented_verbatim_preservation_in_ods_extras`). Missing, altered or
  unparseable capture stays `LOSS`, so failures are not hidden by
  reclassification.
- `ods_extras` is excluded from ordinary field-by-field comparison: it is
  evidence about other columns, not a canonical field of its own.

#### Preservation backfill for records imported before the capture column

Records that were imported before `ods_extras` existed hold no preserved copy,
so parallel validation correctly still reports those columns as `LOSS`. The
`/electrical/import` page has a **Preserve canonical columns that have no
FarmOps field** flow for this:

1. Upload the unchanged canonical workbook — this is a dry run
   (`previewOdsPreservation`) and writes nothing.
2. Review the per-record list of columns that would be preserved, plus counts of
   records already preserved and workbook rows with no FarmOps record.
3. Apply (`applyOdsPreservation`) writes **only** `ods_extras` on existing
   records. No engineering field, stable ID, relationship or install state
   changes, no record is created or deleted, and the workbook is never written.

Validator schema/normalization version is `1.3` for the source-identity capture
format. Acceptance for the LOSS gate is determined by rerunning
`/electrical/validation` on the self-hosted production instance against the
unchanged canonical ODS after this backfill — Lovable Cloud data proves nothing
about production acceptance.

### FarmOps-native infrastructure (snapshot 1.2)

Equipment racks, power distribution assets, powered devices / power dependencies
and network links are FarmOps-native (`FARMOPS_NATIVE_KINDS`). They are excluded
from canonical-ODS equivalence checks and reported as documented infrastructure /
as-built / planning extensions. `PNL-FS-NET` remains a first-class electrical
panel and is never converted into a rack or network device.

### Raceway identity

`CON-###` is the canonical raceway stable ID for every raceway type. `EMT`,
`FLEX`, `PVC` and underground are *raceway types*, not ID namespaces. `EMT-###`
remains readable for pre-existing records (never renamed), and
`checkStableId(kind, id, { mode: "create" })` now refuses creation of any new
`EMT-###` raceway ID.

### Versions

Mapping matrix `1.2`; validation schema and normalization `1.2`; snapshot schema
unchanged at `1.2`.

## Infrastructure ↔ FarmOps Asset authority (Phase 4.4a)

Equipment racks, power distribution assets and powered devices do **not** form a
second inventory system. Each carries an optional `asset_uuid` link to the
existing FarmOps Inventory/Asset record, plus a derived read-only `asset_ref`
name for display.

| Owner | Fields |
| --- | --- |
| Inventory/Asset | manufacturer, model, serial number, acquisition, cost, warranty, manuals, maintenance schedules, service history, lifecycle status, replacement/retirement history |
| Infrastructure entity | stable infrastructure ID, role/type, topology, rack membership, network relationships, electrical relationships, upstream + immediate power relationships, ports/interfaces, infrastructure design/as-built attributes |

Rules:

- `asset_uuid` is nullable so planned infrastructure and non-inventoried passive
  structures exist before or without an Asset.
- Replacing the physical unit only changes `asset_uuid`. The stable
  infrastructure ID, role and every relationship are preserved, so dependency
  and failure-domain history survives equipment swaps.
- `manufacturer` / `model` on power assets and devices are superseded: shown
  read-only so pre-4.4a values are never lost, with Inventory/Asset as the
  single authority going forward.
- `asset_uuid` is never populated from a workbook column and is excluded from
  canonical-ODS field comparison (ownership `farmops_as_built`).
- Snapshot schema stays 1.2 — the asset link is an additional FarmOps-native
  field, not a new collection or contract change.

## Remaining semantic-loss diagnostics (Phase 4.4a)

Every finding that still classifies as `LOSS` now carries a `loss_diagnostic`
block so it can be traced to a single workbook cell without guessing:

- `worksheet`, `original_header`, `worksheet_column` (1-based)
- `preservation_key` — the collision-safe `ods_extras` key the value was expected
  under: the exact header, or `Header#<column>` when that header text repeats
- `duplicate_header`, `collided_with`, `farmops_collection`
- `rows[]` — per affected record: `stable_id`, `ods_value`,
  `expected_extras_key`, `actual_extras_value` (`null` when the key is absent),
  `actual_preserved_values` (everything captured for that source column) and
  `capture_present` (whether the record has any capture at all)

The same detail is written into the finding's note, exported as
`phase-4.4a-loss-diagnostics.csv` (one row per affected workbook row) and
tabulated in the reconciliation Markdown report. A value only leaves `LOSS` when
preservation is proven; the diagnostics never reclassify anything. Reads only:
no database write, and the canonical workbook is untouched.

## Phase 4.4a — LOSS diagnostics analysis (119 diagnostic rows)

Reconciliation only. The canonical workbook is never written, and no engineering
field, as-built field, stable ID or relationship is changed by any of this.

### A. 70 Load_Master findings with `capture_present=true`

`capture_present` only meant "this record holds some `ods_extras` JSON". It was
never per-column evidence, and the diagnostic column `actual_ods_extras_value`
was read with a plain top-level `ods_extras[collision_safe_key]` lookup, so a
value preserved under source identity (`__source`) showed `(absent)`.

Classification itself already resolved preservation through `__source`
(`preservedOdsValues`), so no finding was misclassified — the diagnostics were
misleading. Diagnostics now report, per row:

- `capture_has_column` — this worksheet column is present in the capture,
  resolved by `__source` worksheet + header + column, then by exact/ordinal key;
- `capture_has_source_metadata` — the capture carries source identity at all;
- `capture_keys` — the keys the record actually holds, so a mis-key is visible;
- `reason` — `record_not_found`, `capture_absent`,
  `column_absent_from_capture`, `capture_lacks_source_metadata`, or
  `value_differs`.

A finding becomes `EXPECTED_TRANSFORMATION` only when the exact populated value
is proven preserved for that worksheet column (root cause
`documented_verbatim_preservation_in_ods_extras`, or
`duplicate_header_collision_preserved_verbatim` for collided columns). Rows that
remain LOSS now say which layer is at fault instead of implying a bad lookup.

### B. 24 Feeders findings with `capture_present=false`

The preservation backfill only updates `ods_extras` on records that already
exist and match by stable ID; it never creates entities. The Feeders worksheet
rows have no matching FarmOps feeder records, so there was nothing to capture
into. These rows are reported with `reason=record_not_found` and stay LOSS.
Closing them requires real, stable-ID-matched feeder records — not a backfill,
and not fabricated IDs.

### C/D. `Design_Lists` and `Workbook_Info`

These are workbook structure — reference lists and metadata — with no stable
IDs. Fuzzy header scoring previously read `Design_Lists` as panels and
`Workbook_Info` as feeders. `isNonEntitySheet()` now excludes such sheets from
entity classification before scoring, so they can never become panel or feeder
records. Their populated cells are preserved verbatim in the report's
`workbook_metadata` section (worksheet, header, 1-based column, row, value) and
reported as `EXPECTED_TRANSFORMATION` with root cause
`documented_non_entity_workbook_structure`.

### Backfill

No new generic backfill is required. Load_Master captures already exist;
Feeders needs records, not capture; metadata sheets are preserved at report
level. Validator/normalization versions are `1.4`.

## Phase 4.4a — remaining LOSS by failure class (LOSS 22)

Read-only diagnostics only. No workbook writes, no database writes, no Phase 4.5.

### 1. Missing destination record (FDR-001 / FDR-002 / FDR-003)

When every sampled workbook row for a column belongs to a stable ID that has no
FarmOps record, the finding is record-level, not eight field-capture failures:
classification `ODS_ONLY`, root cause `record_not_populated_in_farmops`,
disposition `CORRECT_FARMOPS`, and no `loss_diagnostic`. The canonical
engineering values stay visible in the report (`ods_value`), so no ODS
information is hidden, and the feeder records are deliberately not created.

### 2. Existing record whose capture lacks the key

An existing record that carries `ods_extras` but not this worksheet column is an
import/preservation gap, reported as LOSS with root cause
`ods_extras_capture_incomplete_for_existing_record` (or
`ods_extras_collision_key_missing_for_existing_record` for duplicate headers,
which continue to use collision-safe keys such as
`Circuit Group Description#10`, `Circuit Group ID#32`,
`Circuit Group Description#33`). The finding is not softened: it stays LOSS until
the exact value is captured under its source identity.

### 3. Field-aware equality before loss classification

Preservation proof now compares engineering meaning, not byte shape:
`capturedValueEquivalent()` treats `20`, `20.0`, `20.00` and `"20"` as one value
(rule `numeric_tolerance`) and folds case/whitespace for text. Cases such as
FS-094 and PH-028 Circuit Rating Amps classify as `EXPECTED_TRANSFORMATION`.

### 4. Gate semantics unchanged

Acceptance still requires LOSS = 0. Missing records, unresolved engineering
decisions, TBD states and FarmOps as-built observations keep their own
classifications and dispositions and are never converted to MATCH.

## Phase 4.4a — capture-overwrite defect (final LOSS = 14 population)

Root cause of the remaining semantic loss on existing mapped records
(`BL-003`, `BL-004`, `FS-056`, `FS-062`, `FS-063`): `ods_extras` was written
wholesale. Because several canonical worksheets key on the same record
(`Load_Master`, circuit-group and installation sheets), the last sheet imported
replaced the capture written by the earlier ones, so keys such as
`Calculated Complete %`, the installation/generator columns, `Existing Panel`
and the collision-safe `Circuit Group Description#10` / `#33` /
`Circuit Group ID#32` disappeared from a record that still had capture.

Corrections (importer/preservation only — reconciliation stays read-only and
the canonical ODS is never written):

- `mergeOdsExtras()` unions preserved entries and their `__source` identity.
  Import plan, `applyOdsImport` and the preservation backfill all merge instead
  of replacing. Collision-safe `Header#<column>` keys are never collapsed onto
  the bare header.
- A column that collided with a field already bound (e.g. `Comments` after
  `Notes`) now also gets a collision-safe key.
- A transformed column (kVA -> VA) preserves its verbatim canonical text.
- A cell refused by column validation (invalid `Grid`) is preserved verbatim
  instead of being dropped.

Unchanged: numeric-equivalent captures (`20` vs `20.00`) prove preservation;
absent destination records (`FDR-001..003`) stay record-level `ODS_ONLY` /
`record_not_populated_in_farmops`; a genuinely missing preservation key on an
existing record still reports `LOSS`. Gate still requires LOSS = 0.
