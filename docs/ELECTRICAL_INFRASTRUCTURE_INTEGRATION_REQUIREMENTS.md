# FarmOps Electrical Infrastructure Integration Requirements

**Status:** Design baseline / implementation contract  
**Repository:** `spreckgreen/bostead-a29954a1`  
**Application:** FarmOps  
**Engineering system:** `BosteadFarmsBuildDocs` / `VOL-01_Electrical`  
**Date:** 2026-08-28

## 1. Purpose

This document defines the requirements for integrating the farm electrical infrastructure model into FarmOps.

FarmOps shall become the operational, field-friendly system for entering, locating, updating, and inspecting electrical infrastructure. The `BosteadFarmsBuildDocs` electrical workbook and generated documents remain the governed engineering/release artifacts until an intentional cutover is completed and validated.

The design must prevent FarmOps, the ODS workbook, generated Markdown, labels, and released documents from becoming independent drifting sources.

## 2. Existing FarmOps Architecture

Implementation shall fit the existing FarmOps architecture rather than introduce a separate application stack.

Current repository architecture includes:

- TanStack Start / TanStack Router
- React
- TypeScript
- Supabase
- Supabase client/server integration
- generated Supabase TypeScript types
- React Query
- Zod
- React Hook Form
- existing authentication/RLS patterns
- existing administrative export/restore and application data-management patterns
- Vitest and Playwright testing

New electrical functionality shall follow existing repository conventions for routes, components, server functions, Supabase migrations, authorization, validation, and testing.

## 3. Source-of-Truth Model

### 3.1 Principle

There shall be **one authoritative record for each class of electrical object**.

Do not force all infrastructure attributes into `Load_Master`.

The logical model is:

```text
Panel
  |
  +-- CON-### Raceway
          |
          +-- JB-### Junction Box
                  |
                  +-- BR-### Branch Run
                          |
                          +-- FS/PH/BL/HSE-### Load

Load / Circuit requirements
          |
          +-- Circuit Group
          +-- Panel assignment
          +-- Breaker position
```

### 3.2 Authority During Migration

During initial implementation:

- FarmOps is the operational/field-entry system for newly modeled infrastructure.
- The canonical electrical ODS remains the engineering release artifact.
- Synchronization/export into the ODS must be deterministic and validated.
- Generated ODS convenience sheets and generated Markdown are never independently editable authorities.

After round-trip validation, a later controlled phase may designate FarmOps/Supabase as the operational system of record for the supported electrical entities.

### 3.3 ODS Mapping

The target workbook structure is:

- `Load_Master` — authoritative electrical loads/circuit requirements
- `Panels` — authoritative panel inventory
- `Conduit_Runs` — authoritative raceway inventory
- `Junction_Boxes` — authoritative physical junction/pull-box inventory
- `Branch_Runs` — authoritative downstream branch-circuit wiring paths
- `Naming_Standards` — authoritative naming and physical-order rules
- `Interior_Raceways` — generated/convenience view
- `Site_Raceways` — generated/convenience view
- area sheets such as `Farm_Shop`, `Pump_House`, `Boiler`, and `House` — generated/convenience views

## 4. Stable Identifiers

Stable identifiers shall be human-readable and unique.

| Entity | ID convention | Example |
|---|---|---|
| Farm Shop load | `FS-###` | `FS-097` |
| Pump House load | `PH-###` | `PH-028` |
| Boiler load | `BL-###` | `BL-003` |
| House load | preserve existing convention | existing ID |
| Panel | `PNL-*` | `PNL-FS-CRIT` |
| Raceway / conduit | `CON-###` | `CON-030` |
| Junction box | `JB-###` | `JB-014` |
| Branch run | `BR-###` | `BR-057` |

IDs must not encode mutable physical attributes that would force renaming when an installation changes.

FarmOps shall reject duplicate stable IDs.

## 5. Raceway Model

### 5.1 Continuous Raceway Rule

A `CON-###` represents **one continuous physical raceway between actual accessible endpoints**.

The following do **not** create a new Conduit ID:

- sweeps
- bends
- trench direction changes
- geographic waypoints
- changes in compass direction

A new `CON-###` is created at an actual physical boundary such as:

- panel termination
- equipment termination
- real accessible pull box
- real junction box
- handhole
- intentional raceway-type/size transition when operationally useful to model separately

Underground route changes previously modeled as hypothetical pull boxes shall be represented as route waypoints when no box is physically installed.

### 5.2 Interior and Site Raceways

Interior and exterior/site raceways shall use the **same canonical raceway entity/table**.

Do not create separate authoritative databases for indoor and outdoor conduit.

Each raceway shall have an environment/zone attribute supporting at least:

- `INTERIOR`
- `SITE_UNDERGROUND`
- `SITE_EXTERIOR`
- `BUILDING_TRANSITION`

FarmOps may expose filtered views named **Interior Raceways** and **Site Raceways**.

### 5.3 Raceway Fields

The data model shall support at least:

- stable Conduit ID
- description
- environment/zone
- raceway type
- trade size
- material
- source endpoint type
- source endpoint ID
- destination endpoint type
- destination endpoint ID
- source building/location
- destination building/location
- source grid
- destination grid
- route/waypoints
- planned length
- measured/as-built length
- conductor/circuit-group references
- spare/reserve status
- installation status
- completion percentage
- notes
- label status
- created/updated audit metadata

## 6. Panel Raceway Physical Exit Convention

The permanent `CON-###` identifier and physical panel exit position are separate attributes.

When **standing in front of and facing a panel**:

1. Start at the **lower-right corner**.
2. Assign physical raceway exit positions **counterclockwise around the panel perimeter**.
3. Travel from lower-right upward along the right side, across the top, downward along the left side, then across the bottom toward the starting area.
4. The physical exit order may change without changing the stable `CON-###`.

Required fields include:

- source panel ID
- physical exit order
- physical exit side/zone
- physical exit description/notes

Example:

```text
Conduit ID: CON-030
Source Panel: PNL-FS-CRIT
Physical Exit Order: 01
Physical Exit: Lower Right
```

## 7. Farm Shop Installation-Walk Convention

For field ordering and label printing, Farm Shop grid orientation shall use the established physical convention:

- **A6 is the northeast (NE) corner.**
- The exterior/perimeter walk begins at A6.
- Travel clockwise.
- Continue outside-in as a rectangular spiral.
- Each inner/center rectangle begins at its northeast side and follows the same clockwise pattern.

This is a sorting/display/installation attribute. It must not change stable Load IDs.

## 8. Panels and Breaker Positions

Panel records shall support:

- Panel ID
- description
- building/location
- grid
- bus/main rating
- voltage
- phase
- number of spaces
- number of circuits
- feeder/source
- backup/generator classification
- installation status
- notes

Circuit assignment shall support both:

- electrical breaker/circuit number
- field-friendly physical position

For a 48-position panel, FarmOps shall be capable of displaying positions using the agreed field convention such as:

- `Left 1-24`
- `Right 1-24`

The implementation must not assume every panel has 48 positions. Position ranges derive from panel configuration.

## 9. Junction Boxes

A junction-box record represents an **actual installed or planned accessible physical box**.

Do not create Junction Box records merely to describe a bend or route waypoint.

Required fields:

- `JB-###`
- description
- building/location
- grid
- elevation/zone
- box type
- box dimensions where known
- upstream raceway IDs
- downstream raceway/branch run IDs
- installation status
- completion percentage
- label status
- notes
- audit metadata

FarmOps shall make it easy to navigate from a J-box to everything entering and leaving it.

## 10. Branch Runs

A branch run describes the downstream wiring path from a distribution point such as a panel or J-box to a target load/device or another defined endpoint.

Required fields:

- `BR-###`
- source endpoint type/ID
- destination endpoint type/ID
- related Load ID or Circuit Group ID
- wiring method
- cable/conductor type
- conductor size
- conductor count where applicable
- equipment grounding conductor
- voltage
- circuit rating
- planned length
- measured/as-built length
- grid/path notes
- installation status
- device-side connected
- source-side connected
- completion percentage
- label status
- notes

Example:

```text
BR-057
From: JB-014
To Load: FS-097
Wiring Method: FMC / approved final connection method
Length: 28 ft
```

## 11. Loads and Circuit Groups

FarmOps must preserve the distinction between a physical load row and an electrical circuit.

Existing concepts to preserve include:

- Load ID
- Area
- Load Description
- Count
- Dedicated / Shared
- Grid
- Location
- Circuit Group ID
- Circuit Group Description
- Suggested Panel
- Amps
- Circuit Rating Amps
- Demand Basis
- Volts
- Connected VA / kVA
- Critical
- Future
- Backup Priority
- Backup Eligible
- Backup Panel
- Load Shed Group
- Generator Start Class / Amps
- Continuous Load
- Demand VA
- Phase
- installation/progress fields

Shared loads may resolve to one electrical circuit. FarmOps must not treat every `Load_Master` row as a separate breaker.

## 12. Field-Entry UX

The electrical module shall be optimized for desktop **and phone/tablet field use**.

Required primary views:

- Electrical Overview
- Loads / Circuits
- Panels
- Raceways
- Junction Boxes
- Branch Runs
- Installation Progress
- Label Queue
- Naming Standards

Forms should favor selections from existing entities rather than free-text references.

Examples:

- select Panel rather than type a panel name
- select existing J-box as an endpoint
- select Load/Circuit Group for a branch run
- select Grid from known grid values where practical

The UI shall expose the full linked path when available:

```text
Panel -> Raceway -> Junction Box -> Branch Run -> Load
```

## 13. Installation Status

Infrastructure records shall support field progress without destroying design data.

At minimum support:

- Planned
- Material Ready
- Rough-In Started
- Raceway Installed
- Conductors/Cable Installed
- Device Side Connected
- Panel/Source Side Connected
- Tested
- Complete
- As-Built Verified

Where the existing ODS uses explicit completion fields, synchronization shall preserve their semantics.

FarmOps should provide filtered work lists such as:

- incomplete raceways
- unlabeled J-boxes
- branch runs awaiting conductor
- installed but not connected
- connected but not tested
- 0% circuits
- items by grid
- items by panel

## 14. Labeling

FarmOps shall support a label queue rather than treating printing as an uncontrolled one-time export.

Required label classes:

1. load/device/circuit label
2. panel/breaker label
3. raceway/conduit label
4. junction-box label
5. branch-run label

Each label record should support:

- entity ID
- label class
- requested/queued
- printed
- installed
- reprint required
- template/version
- timestamp

Stable IDs must remain readable without QR codes.

QR codes may be added later as a convenience but shall not replace human-readable IDs.

## 15. Naming Standards View

FarmOps shall provide a read-only/reference-friendly Naming Standards view containing the active conventions.

It must include at least:

- entity ID formats
- continuous raceway rule
- waypoint vs endpoint distinction
- interior/site raceway classification
- panel physical exit convention
- Farm Shop A6/clockwise/outside-in walk convention
- breaker-position convention
- label conventions
- examples

Naming standards should be versioned or auditable so a later rule change is intentional.

## 16. Supabase Requirements

Electrical data shall use the existing Supabase architecture and migration process.

Expected logical tables include:

- `electrical_loads`
- `electrical_circuit_groups`
- `electrical_panels`
- `electrical_raceways`
- `electrical_raceway_waypoints`
- `electrical_junction_boxes`
- `electrical_branch_runs`
- `electrical_labels`
- `electrical_naming_standards`

Exact table names may be adjusted to match repository conventions, but entity boundaries and authority rules in this document must be preserved.

Requirements:

- UUID/database primary keys may be used internally.
- Human stable IDs remain unique business keys.
- Foreign keys should enforce valid relationships.
- RLS must follow existing FarmOps authentication/security patterns.
- Schema changes must be delivered through Supabase migrations.
- Generated TypeScript database types must be refreshed after schema changes.

## 17. API / Service Requirements

Electrical data access shall follow existing FarmOps server/data patterns.

The service layer must support:

- list/filter entities
- get entity and linked topology
- create/update field records
- allocate or validate stable IDs
- installation-status updates
- label queue operations
- ODS/import-export snapshot operations

The integration must provide a deterministic machine-readable export suitable for `BosteadFarmsBuildDocs`.

Do not make the ODS parser the primary application API.

## 18. ODS Synchronization Contract

The electrical build repository currently depends on:

`documents/VOL-01_Electrical/source/data/PremoFarmElectrical.ods`

Synchronization must protect the existing document-generation pipeline.

The export/sync process shall:

1. create a candidate rather than immediately overwrite canonical engineering data;
2. preserve required OpenDocument/OpenFormula formulas and namespaces;
3. populate canonical sheets from authoritative FarmOps entities;
4. regenerate convenience sheets/views;
5. run repository validators;
6. compare stable IDs and core fields for semantic drift;
7. require successful validation before promotion/release.

Existing validation concepts that must continue to pass include:

- OpenFormula validation
- circuit-group validation
- schedule generation
- panel/generator distribution analysis
- panel-sorted variant audit
- label generation
- master document build

FarmOps must not directly edit generated Markdown schedules.

## 19. Import / Migration Requirements

Initial population shall be able to import the existing electrical design without forcing manual re-entry.

### Phase A — Read/Normalize

Import:

- Loads
- Circuit Groups
- Panels
- Conduit Runs

Preserve existing stable IDs.

### Phase B — Classify Raceways

Review existing conduit records and:

- retain real continuous raceways;
- merge artificial underground segmentation where the only boundary was a hypothetical pull box;
- retain useful directional information as waypoints;
- preserve actual physical pull/J-box boundaries.

No destructive automatic merge shall occur without an auditable migration report.

### Phase C — Introduce New Infrastructure

Create and populate:

- Junction Boxes
- Branch Runs
- panel physical exit attributes

### Phase D — Round-Trip Verification

Export FarmOps data back into a candidate ODS and prove:

- no missing loads
- no duplicate IDs
- no unexpected circuit changes
- no formula loss
- no semantic drift in unchanged fields

## 20. Validation Rules

At minimum, FarmOps shall prevent or flag:

- duplicate stable IDs
- invalid endpoint references
- branch runs referencing nonexistent loads/circuit groups
- raceways referencing nonexistent panels/J-boxes
- J-box references to nonexistent infrastructure
- invalid panel physical exit order
- conflicting panel breaker positions
- invalid voltage values where controlled
- incomplete required electrical fields
- orphaned infrastructure
- circular topology where not intentionally supported

Warnings may be used for legitimate TBD design values; they must remain visible and reportable.

## 21. Search and Navigation

Global or module search should locate an electrical object by stable ID.

Examples:

- `FS-097`
- `PNL-FS-CRIT`
- `CON-030`
- `JB-014`
- `BR-057`

Entity detail pages should provide clickable navigation through related infrastructure.

A field user looking at `JB-014` should be able to determine:

- where it is
- what feeds it
- what leaves it
- what circuits/loads depend on it
- installation status
- whether its label is installed

## 22. Reporting

Electrical reporting shall eventually support:

- panel circuit count and capacity
- critical/equipment/normal distribution
- known connected load
- incomplete demand data
- installation completion
- planned vs measured cable/raceway footage
- conductor-size takeoff
- dedicated vs shared circuit counts and footage
- incomplete/0% run takeoff
- label completion
- site vs interior raceway inventory

Reports must distinguish design estimates from measured/as-built values.

## 23. Auditability

Changes to electrical infrastructure must be attributable where the existing FarmOps architecture supports user auditing.

Important field changes should retain timestamps and user identity, particularly:

- panel assignment
- breaker position
- raceway endpoint
- branch run endpoint
- measured length
- installation completion
- as-built verification

## 24. Implementation Phases

Implementation should be incremental.

### Phase 1 — Schema and Standards

- Supabase schema
- stable-ID constraints
- Naming Standards
- core tests

### Phase 2 — Infrastructure UI

- Panels
- Raceways
- Junction Boxes
- Branch Runs
- linked topology

### Phase 3 — Existing-Data Import

- import ODS-derived electrical records
- migration reports
- raceway classification

### Phase 4 — Field Workflow

- installation status
- measured lengths
- mobile-friendly forms
- search/filter

### Phase 5 — ODS Export/Synchronization

- deterministic export
- candidate workbook generation
- validation bridge to `BosteadFarmsBuildDocs`

### Phase 6 — Labels

- label queue
- compact panel/raceway/J-box/branch run labels
- existing load-label integration

### Phase 7 — Operational Cutover

Only after successful round-trip validation:

- designate FarmOps as operational source for supported electrical entities;
- preserve released ODS snapshots as engineering artifacts;
- document rollback/recovery procedure.

## 25. Acceptance Criteria

The integration is not complete until all of the following are demonstrated:

- [ ] Existing electrical loads can be imported without changing stable Load IDs.
- [ ] Panels can be represented with circuit/breaker physical positions.
- [ ] A raceway can be traced from actual start to actual end.
- [ ] Underground bends can be stored as waypoints without fake pull boxes.
- [ ] Interior and site raceways are filtered views of one canonical raceway dataset.
- [ ] Panel raceway exit order starts lower-right and proceeds counterclockwise when facing the panel.
- [ ] A real J-box can be created and linked to incoming/outgoing infrastructure.
- [ ] A branch run can link a panel/J-box to a Load or Circuit Group.
- [ ] Farm Shop installation sorting recognizes A6 as NE and follows the clockwise outside-in convention.
- [ ] Duplicate stable IDs are rejected.
- [ ] Orphaned endpoint references are rejected or clearly flagged.
- [ ] Field status can be updated from a phone/tablet-friendly UI.
- [ ] Objects can be found by stable ID.
- [ ] Label queue supports all five required label classes.
- [ ] FarmOps can export a deterministic electrical snapshot.
- [ ] The snapshot can produce a candidate ODS without formula/OpenFormula loss.
- [ ] Existing electrical repository validators pass after synchronization.
- [ ] Existing document and label build workflows continue to work.
- [ ] Round-trip comparison shows no unintended semantic drift.

## 26. Non-Goals for the First Implementation

The first implementation does not require:

- automated NEC engineering approval
- automatic conductor/breaker sizing without electrician/design review
- replacing human-readable labels with QR codes
- full CAD/BIM
- automatic modification of released electrical documents without validation
- uncontrolled two-way editing between FarmOps and the ODS

## 27. Implementation Guidance for AI / Developers

This document is the design contract.

Before implementing a behavior that conflicts with it:

1. identify the conflict;
2. update this requirements document intentionally;
3. record the reason;
4. then modify code/schema.

Do not silently infer a new naming scheme or source-of-truth model.

Particular conventions that must not drift are:

- A6 is the Farm Shop NE reference corner.
- Field walk is clockwise and outside-in.
- Panel raceway physical exit order starts lower-right and proceeds counterclockwise when facing the panel.
- `CON-###` is stable and separate from physical exit position.
- A continuous underground raceway is not split merely because the trench changes direction.
- Hypothetical pull boxes are not physical J-box records.
- Interior and site raceways are views of one canonical raceway dataset.
- Each electrical object class has one authoritative data source.
- Generated convenience views are not independent authorities.

## 28. Recommended Implementation Deliverables

Each implementation phase should produce:

1. migration/schema changes;
2. application code;
3. automated tests;
4. documentation updates;
5. migration or synchronization report where applicable;
6. explicit verification against the acceptance criteria in this document.

The initial implementation plan should be committed separately from this requirements document so requirements and implementation decisions remain distinguishable.
