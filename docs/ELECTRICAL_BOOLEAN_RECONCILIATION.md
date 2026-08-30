# Phase 4.4b Task 1B — Boolean reconciliation & correction plan

Phase 4.4a stays frozen (LOSS = 0, unexplained ODS-only = 0, unexplained findings = 0).
`SOR_AUTHORITY = canonical_ods`. Nothing here writes the canonical ODS, and no
correction is applied without an explicit human Apply.

## Semantics (four distinct concepts)

| Workbook cell | Meaning | Stored |
| --- | --- | --- |
| `Y` / `Yes` / `X` / `1` | Yes | `true` |
| `N` / `No` / `0` | No | `false` |
| blank / `N/A` / `-` | Not stated | `null` |
| `TBD` / `?` | Unresolved engineering state | `null`, flagged `tbd` |

JavaScript truthiness is never used for workbook text. `"N"` can never become
`true`; blank never becomes `false`; `TBD` never becomes either boolean.

## Classification (`src/lib/electrical-boolean-diagnostics.ts`)

| Cat | Rule | Correctable |
| --- | --- | --- |
| A | ODS explicit `N` but FarmOps `true` (`Boolean("N") === true` importer coercion), or blank ODS with FarmOps `false` on a column that was `NOT NULL DEFAULT false` before 4.4b | Yes, preview-first |
| B | Both ODS and FarmOps hold explicit Yes/No values that disagree | No |
| C | ODS state is blank / `TBD` / `N/A` / otherwise not a boolean | No |
| D | Values disagree but provenance cannot be proven (unrecognised text, null FarmOps value) | No |

Category A proposals: importer coercion → `false`; NOT NULL default → `null`.

## Diagnostic outputs (Parallel validation report page)

- Grouped table: category, entity type, field, ODS value/meaning, FarmOps value,
  persisted value, provenance, old default/coercion behaviour, affected count,
  proposed action.
- `phase-4.4b-boolean-groups.csv` — the grouped view above.
- `phase-4.4b-boolean-records.csv` — drill-down, one row per stable ID, all categories.
- `phase-4.4b-category-a-plan.csv` — proposed Category-A correction set only.

## Correction tool

`previewBooleanCorrection` (`src/lib/electrical-boolean-correction.functions.ts`)

- Accepts only Yes/No columns declared on an electrical entity (`kind: "bool"`, not read-only).
- Re-reads live rows: reports `would_change`, `already_correct`, `drifted`, `not_found`, `failed`.
- `drifted` (stored value no longer matches the report) is never written.
- `confirm: false` is a dry run; `confirm: true` writes exactly one boolean column per row
  via the row UUID. Stable IDs, relationships, `ods_extras`, installation state, topology,
  other engineering fields and the ODS are untouched.

Whether a production backfill is justified is decided per run: if the report
shows zero Category-A records, no backfill is warranted and the UI says so.
Regression gate after any correction: rerun parallel validation and confirm
LOSS = 0, unexplained ODS-only = 0, unexplained findings = 0.
