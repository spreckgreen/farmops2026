# Phase 4.4b — Numeric Semantics Diagnostics and Reconciliation Preview

Status: **analysis, classification and preview only.** No production writes, no
apply path, and the canonical `PremoFarmElectrical.ods` is never written.

Boolean reconciliation is complete and untouched by this phase (Category A 0,
B 0, C 0, D 9 intentionally left alone).

## 1. Inventory before comparison

`src/lib/electrical-numeric-semantics.ts` holds an explicit registry of every
numeric field in the compared electrical entities plus the numeric columns that
live outside them. A numeric database column is **not** evidence of an
engineering value, so each field carries an ownership decision:

| Ownership | Compared? | Examples |
| --- | --- | --- |
| `ODS_ENGINEERING_OWNED` | yes | `volts`, `amps`, `ampacity_amps`, `ocp_rating_amps`, `bus_rating_amps`, `connected_va`, `demand_va`, `conductor_count`, `planned_length_ft`, `spaces`, `circuits`, `count` |
| `FIELD_OBSERVATION` | no | `measured_length_ft`, `electrical_breaker_positions.ocp_amps` |
| `DERIVED` | no | `completion_percent` (recomputed; historically `NOT NULL DEFAULT 0`) |
| `IDENTIFIER_OR_ORDINAL` | no | `breaker_number`, `position`, `poles`, `exit_order`, `raceway_sequence`, `rack_position_u`, waypoint `sequence` |
| `FARMOPS_OPERATIONAL` | no | rack/power-asset/device nameplate values (`input_voltage`, `output_current_amps`, `rack_size_u`) |
| `UNKNOWN_OWNERSHIP` | no | `generator_start_amps`, service/intertie configuration ampacity |

Anything not listed is `UNKNOWN_OWNERSHIP` and therefore never automatically
reconciled. Field-observed breaker amperage is never inferred from label text
and never overwritten from the workbook.

Each registry row also pins the proven schema facts (`db_type`, `nullable`,
`db_default`) and the historical importer behaviour:

> `coerceValue(number)`: blank → `null` (never `0`); commas/whitespace stripped;
> `%` via `parsePercent`; unit-bearing text falls back to its numeric tokens
> (voltage takes the highest).

## 2. Tri-state preservation

`parseNumericCell(raw, unit)` returns one of five states and never collapses
them:

| State | Meaning |
| --- | --- |
| `value` | explicit number |
| `zero` | explicit `0` — a stated engineering value, never "unknown" |
| `absent` | blank / NULL / `n/a` — not stated |
| `non_numeric` | `TBD`, `?`, `verify field`, `40-60`, `~45`, `120/240V`, descriptive text |
| `ambiguous_unit` | a number in a unit that does not match the field (`25 m` for feet, `20 kw` for amps) |

Blank is never equal to `0`. Unresolved engineering notation is preserved
verbatim and is never coerced into a number.

## 3. Unit-aware comparison

Safe, deterministic normalizations only: thousands separators, a declared unit
suffix (`20 A` → `20`, `80 ft` → `80`), `kVA` → `VA`, and decimal equality
within 0.005 (`80` == `80.0`). No unit is ever guessed; anything else becomes
`ambiguous_unit` (Category C) instead of a converted number.

## 4. Diagnostic categories

| Cat | Meaning | Automatic correction |
| --- | --- | --- |
| A | Proven implementation artifact: blank workbook cell where a `NOT NULL DEFAULT` column supplied the stored value (`N1` default `0`, `N2` default non-zero, e.g. `electrical_loads.count DEFAULT 1`) | Only candidate — and blocked when the column is still `NOT NULL`, because "not stated" cannot be stored yet |
| B | Genuine engineering disagreement: both sides explicit and different | Never — requires engineering disposition |
| C | Workbook state not representable as a number (TBD/range/approximate/text/foreign unit) | Never — resolve in the canonical ODS first |
| D | Provenance insufficient: one side silent and the cause unprovable | Never — human review |

## 5. Outputs and stability

`numericDiagnostics(validationReport)` is a pure function. Reports include the
workbook SHA-256, registry/diagnostics versions and reconciliation arithmetic:

```
agreements + (A + B + C + D) = compared numeric cells
A = plan (correctable) + blocked (NOT NULL column)
```

Every finding carries drill-down provenance: entity type, stable ID, FarmOps
row UUID, ODS worksheet, ODS column and ODS row number.

Exports from the Electrical → Validation page ("Numeric semantics
diagnostics" card):

- `phase-4.4b-numeric-registry.csv` — field inventory with ownership and schema facts
- `phase-4.4b-numeric-findings.csv` — one row per finding with provenance and proposed disposition
- `phase-4.4b-numeric-diagnostics.md` — archivable report

## 6. What this phase deliberately does not do

- No database writes, no apply button, no ODS writes.
- No inferred unit conversions and no scaling of ambiguous percentages.
- No changes to completed Boolean reconciliation work.
- No reconciliation of derived, field-observed, ordinal or FarmOps-native
  numbers — they are listed as excluded with a reason instead of silently
  dropped.

## 7. Panel voltage — system-voltage representation (Category E)

`120/240` is not a broken cell. It is canonical notation stating **two** nominal
voltages: 120 V line-to-neutral and 240 V line-to-line (a 3-wire split-phase
system). `parseNumericCell` returns the dedicated state `system_voltage` with a
structured decomposition (`line_neutral`, `line_line`, optional `phases`) and
`value === null`. It is never reduced to the scalar 240, and the canonical ODS is
never edited to satisfy a numeric column.

### Current FarmOps model (gap)

| Column | Type | Can hold 120/240? |
| --- | --- | --- |
| `electrical_panels.voltage` | `numeric` (nullable) | no — one scalar only |
| `electrical_feeders.voltage` | `numeric` (nullable) | no |
| `electrical_branch_circuits.voltage` | `numeric` (nullable) | no |
| `electrical_loads.volts` | `numeric` (nullable) | single utilization voltage — appropriate as-is |

Panel/feeder/branch voltage describes a **system**, so a scalar column is the
wrong shape. Load `volts` describes one utilization voltage and stays scalar.

### Options recorded for decision (none implemented here)

1. Explicit pair: `nominal_line_neutral_volts` + `nominal_line_line_volts`
   (+ optional `phases`, `wires`). Queryable, no parsing, matches the notation.
2. Structured system-voltage reference table (`120/240 1Ø 3W`, `120/208 3Ø 4W`,
   `277/480 3Ø 4W`) with an FK from panels/feeders/branches.
3. Text `system_voltage` column preserving canonical notation verbatim, with the
   scalar retained only for single-voltage systems.

Until one is chosen, these findings are Category **E** —
`requires_data_model_decision` — reported separately from Category C
(unresolved workbook state) and from Category B (engineering disagreement).
Category E is never correctable and this phase still writes nothing.
