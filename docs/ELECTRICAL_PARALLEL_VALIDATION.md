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
