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

Panel/feeder/branch-run voltage describes a **system**, so a scalar column is the
wrong shape. Load `volts` describes one utilization voltage and stays scalar.

### Implemented representation (`src/lib/electrical-system-voltage.ts`)

Panel/feeder/circuit-group/branch-run/service-configuration `voltage` carries
**system-designation** semantics; `electrical_loads.volts` stays a
**utilization scalar** and power-asset/device voltages stay nameplate scalars
(`VOLTAGE_FIELD_SEMANTICS`). A designation preserves every component:

| Field | Example |
| --- | --- |
| `code` | `SYSV-120/240-1P3W` |
| `designation` | `120/240 V, 1φ, 3-wire` |
| `line_neutral_volts` | 120 |
| `line_line_volts` | 240 |
| `phases` | 1 |
| `wires` | 3 |

`resolveSystemVoltage` accepts a catalog code, canonical notation (`120/240`,
`120/240 V 1ph`) or a structured object, and returns `null` for a bare scalar —
`240` is never promoted to a system designation and `120/240` is never parsed
into a float. The catalog covers 120/240 1φ3W, 120/208 3φ4W and 277/480 3φ4W;
an unlisted L-N/L-L pair still resolves structurally.

This is the shared vocabulary for the existing service **configuration
revision** abstraction (`electrical_service_configurations.voltage` / `.phase`)
rather than a second voltage model. It never attaches a designation to a service
identity: `SVC-HOUSE` / `SVC-FARMSHOP` stay permanent, and voltage remains a
property of a revision.

### Reconciliation behaviour

`numericDiagnostics` reads the FarmOps designation from the proposed
`system_voltage` representation on the same record. Then:

- ODS `120/240` ↔ FarmOps system `120/240` → **agreement**.
- ODS `120/240` ↔ FarmOps system `120/208` → **Category B** (engineering
  disagreement between two fully represented designations).
- ODS `120/240` ↔ FarmOps scalar `240` → **Category E**, unchanged.

Category E therefore disappears only when production data actually carries the
system-voltage representation.

### Migration preview (read-only)

`systemVoltageMigrationPreview` emits one row per affected record with the
current representation, the proposed designation and a status
(`scalar_loses_line_neutral`, `scalar_not_stated`, `scalar_unrelated_value`).
It is surfaced in the "Numeric semantics diagnostics" card and exported as
`phase-4.4b-system-voltage-migration-preview.csv`. The preview itself never
writes and is preserved for audit alongside the apply report.

## 8. Apply gate — `4.4b-system-voltage-apply-gate-1`

`src/lib/electrical-system-voltage-gate.ts` (pure) plus
`src/lib/electrical-system-voltage.functions.ts` (server) apply the reviewed
model to **only** these seven panels: PNL-BLR, PNL-FS-CRIT, PNL-FS-EQ,
PNL-FS-NE, PNL-FS-NW, PNL-H1, PNL-PH.

Schema (additive, non-destructive):

| Column | Type | Purpose |
| --- | --- | --- |
| `electrical_panels.system_voltage` | `jsonb` | full designation: `code`, `designation`, `line_neutral_volts`, `line_line_volts`, `phases`, `wires`, `note`, `model_version` |
| `electrical_panels.system_voltage_applied_at` | `timestamptz` | when the gate wrote it |
| `electrical_panels.voltage` | `numeric` | **unchanged** — the legacy scalar is preserved so every current consumer keeps working |

Per-row protections, evaluated during preview and again immediately before the
write (row re-read by UUID):

1. the panel is one of the seven authorized stable IDs;
2. the live row's stable ID matches;
3. the live scalar voltage is still the reviewed value (240);
4. no different system-voltage designation is already stored;
5. the canonical ODS cell still states `120/240`.

Statuses: `would_change`, `already_correct`, `drifted`, `conflict`,
`not_found`, `not_approved`, `failed`, `applied`. Drifted and conflicting rows
are never written. Apply additionally requires `confirm: true` **and** the row's
explicit approval key `electrical_panels|<PNL-ID>|system_voltage`.

Out of scope and never modified: panel IDs, service identities/revisions,
feeder/branch-run topology, breaker positions, loads, the canonical ODS, Boolean
reconciliation, House field observations and every unrelated numeric field.

### Post-apply validation

A successful apply re-runs the parallel comparison against the same, unchanged
canonical workbook. The stored designation reaches diagnostics through the
snapshot (`electrical_panels.system_voltage`) as a `system_voltage` comparison
record, so ODS `120/240` ↔ FarmOps `120/240` becomes an **agreement**: the seven
former Category-E findings disappear (E = 0) and no new B/C/D finding is
introduced, because no numeric column was written.

### Audit outputs

From the apply-gate card:

- `phase-4.4b-system-voltage-preview-report.csv` / `.md` — pre-migration state
- `phase-4.4b-system-voltage-apply-report.csv` / `.md` —
  `stable_id | old representation | new system_voltage | status | applied_at`
- `phase-4.4b-system-voltage-migration-preview.csv` — the original read-only
  preview, kept for audit


