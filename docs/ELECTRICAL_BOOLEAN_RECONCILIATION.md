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

## Category-A production correction gate

Eligibility is exactly two proven historical implementation artifacts — nothing else:

| Artifact | Canonical ODS | FarmOps | Proof | Correction |
| --- | --- | --- | --- | --- |
| `A1_N_COERCED_TRUE` | explicit `N` | `true` | old `Boolean("N") === true` coercion | `true` → `false` |
| `A2_BLANK_DEFAULTED_FALSE` | blank / not stated | `false` | column was `NOT NULL DEFAULT false` before 4.4b (documented list only) | `false` → `NULL` |

A2 is never generalised to arbitrary Boolean columns.

`previewBooleanCorrection` (`src/lib/electrical-boolean-correction.functions.ts`)

- Re-reads each live row by UUID and the exact Boolean column before proposing anything.
- Statuses: `would_change`, `already_correct`, `drifted`, `not_found`, `failed`
  (plus `not_approved` / `applied` during Apply). `drifted` means the live value no
  longer equals the FarmOps value the finding was based on and is never written.
- Preview (`confirm: false`) writes nothing and the UI states
  “Preview only — no production values changed”.
- Apply requires `confirm: true` **and** an explicit `approved` key list built from
  previewed `would_change` rows. Immediately before each write it re-reads the row by
  UUID, verifies the field and current value, re-verifies the A1/A2 rule, then updates
  exactly one Boolean column. Never a whole-row replacement.

Summary arithmetic that must hold:
`would_change + already_correct + drifted + not_found + failed (+ not_approved + applied) = Category A findings`.
Category D is displayed alongside as *not eligible for automatic correction* and stays untouched,
as do Categories B/C, non-Boolean fields, IDs, relationships, `ods_extras`, service topology,
breaker positions, House field observations and the canonical ODS.

## Exports

- `phase-4.4b-boolean-groups.csv` / `phase-4.4b-boolean-records.csv` — diagnostics.
- `phase-4.4b-category-a-plan.csv` — one row per Category-A finding:
  entity, stable_id, row_uuid, field, canonical ODS, reconciliation FarmOps, live
  FarmOps, artifact type, proposed value, status, provenance.
- `phase-4.4b-category-a-gate.md` — archivable report: summary, artifact definitions,
  full correction plan, Category-D exclusion, post-Apply gate.

## Post-Apply gate

Phase 4.4b Boolean reconciliation is not complete on “N writes completed”. After an
explicitly approved Apply, re-run reconciliation against the unchanged canonical ODS and
review that the corrected Category-A artifacts are gone, no new Boolean disagreements were
introduced, Category D is untouched, and unrelated reconciliation domains are unchanged.

