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
