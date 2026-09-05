# Electrical terminology registry

Registry version: `electrical.terminology.v1`
Code of record: **NEC 2023 (NFPA 70, 2023 edition)**
Jurisdiction: *not yet recorded — confirm the adopted edition with the AHJ*

> FarmOps records observed conditions and documentation terminology only. It does not determine
> code compliance, and nothing in this module is a code ruling. Final interpretations, design
> decisions and installation acceptance remain with the licensed electrician and the authority
> having jurisdiction (AHJ). A different adopted edition or local amendment may change definitions.

Source of truth: `src/lib/electrical-terminology.ts` (registry) and
`src/lib/electrical-terminology-audit.ts` (checker + reconciliation report). This document is
generated prose about those modules; the modules win any disagreement.

## Registry columns

Each entry carries: FarmOps internal identifier, canonical user-facing term, classification
(`NEC_DEFINED`, `NEC_USAGE`, `FARMOPS_OPERATIONAL`), applicable NEC edition, NEC article/section
reference, plain-language explanation, accepted field aliases, deprecated or prohibited usages, and
the affected database, UI, API and export fields.

## NEC-defined terms used in this module

| Term | Reference (NEC 2023) |
| --- | --- |
| Panelboard | Art. 100; Art. 408 |
| Service equipment | Art. 100; Art. 230 |
| Feeder | Art. 100; Art. 215 |
| Branch circuit | Art. 100; Art. 210 |
| Individual branch circuit | Art. 100 (Branch Circuit, Individual); Art. 210 |
| Overcurrent protective device (OCPD) | Art. 100; Art. 240 |
| Circuit breaker | Art. 100; 240.80–240.86 |
| Outlet | Art. 100 |
| Receptacle | Art. 100; Art. 406 |
| Receptacle outlet | Art. 100 |
| Junction box | Art. 314 |
| Device box | Art. 314; Art. 100 (Device) |
| Raceway | Art. 100; Chapter 3 |
| Cable | Art. 100; Arts. 330–340 |
| Conductor | Art. 100; Art. 310 |
| Grounded conductor | Art. 100; Art. 200 |
| Equipment grounding conductor (EGC) | Art. 100; 250.118 |
| Grounding electrode conductor (GEC) | Art. 100; 250.62, 250.66 |
| Disconnecting means | Art. 100; 225.31, 230.70, 422.31 |
| Load | Art. 100; Art. 220 |
| Utilization equipment | Art. 100 |

## FarmOps operational terms (not NEC-defined)

These stay, because they describe how the record is kept — but every screen that shows them
explains the NEC relationship through the term hint.

| FarmOps term | Relationship to NEC concepts |
| --- | --- |
| Circuit group | Logical grouping of loads sharing one OCPD; normally represents one breaker-protected branch circuit. Never an NEC object. |
| Branch run | Physical routing object subordinate to a branch circuit; one branch circuit may have several branch runs. |
| Run segment | One leg of a branch run between waypoints; a bookkeeping unit, not a code concept. |
| Feed-through sequence | Recorded order of devices fed one from the next; replaces user-facing "daisy chain". |
| Material ready | Project stage: material staged on site. Not an installation classification. |
| Complete | Project stage: recorded work finished. Not an inspection result or acceptance. |
| As-built verified | Documentation confidence from an accepted field observation. Not an inspection or approval. |
| Audit batch | Immutable fingerprinted proposal set from one field session. No NEC standing. |
| Pole grid | Structural post/column location reference for the building. |
| Grid reference | Human-readable location label derived from recorded coordinates. |

## Specific corrections applied

- **Circuit group** is labelled a FarmOps logical grouping that normally represents one
  breaker-protected branch circuit. "NEC circuit group" is prohibited.
- **Ambiguous "branch"** is replaced by *branch circuit* (the circuit), *wiring run* or
  *branch-circuit wiring segment* (the physical wiring), or *branch run* (the FarmOps routing
  object). Code identifiers such as `branch_runs` and `kind === "branch"` are untouched.
- **Daisy chain** is replaced in display text by *feed-through sequence* / *downstream device
  sequence*, and retained as a searchable field alias.
- **Receptacle** is the device, **receptacle outlet** is the location, and "plug" survives only as
  an observed field label or search alias.
- **Dedicated circuit** is never auto-translated to *individual branch circuit*; that term displays
  only where the recorded topology shows a single item of utilization equipment.
- **Circuit breaker** and **fuse** stay distinct; **OCPD** is used when either could be meant.
- **Panel** is an optional short display label while the authoritative equipment type remains
  panelboard, switchboard, switchgear or another correct classification.
- **Lifecycle stages** (planned, material ready, complete, verified) are never described as NEC
  installation classifications.

## Switching and control terms

| Term | Status | Reference (NEC 2023) |
| --- | --- | --- |
| Switch (general-use snap switch) | NEC-defined | Art. 100; Art. 404 |
| 3-way switch | NEC usage | Art. 404; 200.7 |
| 4-way switch | NEC usage | Art. 404 |
| Traveler | NEC usage | Art. 404; 300.3(B) |
| Ungrounded conductor | NEC-defined | Art. 100; Art. 200; 210.5(C) |
| Switch bank | FarmOps operational | enclosure is a device box, Art. 314 |
| Control group | FarmOps operational | groups devices controlling one target; never a circuit group |
| Control target | FarmOps operational | the target is normally utilization equipment or an outlet |
| Feed-through sequence | FarmOps operational | replaces user-facing "daisy chain" |

"Hot wire" and "kill switch" survive only as searchable aliases. A wall switch is
described as a disconnecting means only where that classification is verified.

## Automated checks

`bun scripts/terminology-check.ts` (npm script `check:terminology`) and the vitest gate
`tests/electrical-terminology-repo.test.ts` scan:

UI strings and tooltips · database comments and enums in electrical migrations · API/OpenAPI
descriptions · audit manifests and reports · CSV headers and exports · diagram legends · Standards
documentation · AI prompt context. Generated AI answers are scanned at run time and a wording note
is shown to the reader.

Prohibited wording fails the test run with the file, line, matched text and replacement. A line
that legitimately quotes a deprecated word may carry a `terminology-ok` comment; alias declaration
lines are exempt automatically.

## Migration rules

- Display terms change; **stable IDs never do**. PNL-*, FS-*, CON-###, EMT-###, JB-###-##,
  BR-###-##-##, SVC-*/ITIE-* and batch IDs are permanent.
- The reconciliation report at `/electrical/terminology` lists every term, its proposed canonical
  wording, NEC status, source reference, affected screens and migration impact, and is exportable
  as CSV.
- Terminology changes are applied screen by screen after human review by the owner or the licensed
  electrician of record. No automated process rewrites stored records, labels or IDs.
