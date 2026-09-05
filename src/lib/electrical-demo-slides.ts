// Slide content for the public FarmOps Electrical feature demo at /demo/electrical.
// Text-only layouts (no application screenshots) so the deck can be shown
// anonymously without exposing any real farm records. Every capability claim
// below describes behaviour that already exists in the Electrical module;
// federation is explicitly labelled as a design direction, not shipped.
import { type PromoSlide } from "@/lib/promo-slides";

export const ELECTRICAL_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps · Electrical module",
    title: "Electrical records you can defend",
    subtitle:
      "A field-first system of record for panelboards, branch circuits, overcurrent protective devices, wiring runs, switching and loads — with evidence, approvals and a full audit trail behind every value.",
    footer: "Feature demo · 30 pages · no live farm data shown",
  },
  {
    kind: "statement",
    kicker: "The problem",
    title: "Spreadsheets forget where the number came from",
    lead:
      "Most property electrical documentation is a workbook nobody trusts: numbers with no provenance, locations that drift, and a panel schedule that stopped matching the building years ago.",
    bullets: [
      "A circuit rating gets copied into a load's current, so capacity math is quietly wrong forever.",
      "Nobody can tell whether a row is designed, roughed in, energized or actually verified in the field.",
      "Renaming or renumbering to \"clean up\" a sheet destroys the only stable reference the crew had.",
      "Corrections arrive as edits with no record of who observed what, when, or on what evidence.",
    ],
    note: "FarmOps treats every electrical value as a claim that must carry its source.",
  },
  {
    kind: "cards",
    kicker: "Principles",
    title: "Four rules the module never breaks",
    cards: [
      {
        label: "01",
        heading: "Stable identity is permanent",
        body: "Panelboards, conduits, junction boxes, branch runs and field stations keep their identifier for life. Moving, re-feeding or reclassifying a record never renames it.",
      },
      {
        label: "02",
        heading: "Nothing is inferred",
        body: "Location, criticality, conductor function and completion are never guessed from a description, a prefix, a wire colour or an amperage.",
      },
      {
        label: "03",
        heading: "Evidence before value",
        body: "Field markings and photos are stored as evidence until the circuit is actually traced or tested. Unproven facts stay explicit holds.",
      },
      {
        label: "04",
        heading: "Approval-gated writes",
        body: "Imports, AI extractions and field audits stage a preview. An owner approves specific fields; only then is anything written, atomically and logged.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Vocabulary",
    title: "NEC terminology, kept honest",
    lead:
      "A versioned terminology registry pins every user-facing term to its status, so operational shorthand is never mistaken for a code-defined object.",
    bullets: [
      "Code-defined terms are used accurately: panelboard, service equipment, feeder, branch circuit, OCPD, receptacle outlet, raceway, grounded conductor, equipment grounding conductor, disconnecting means.",
      "FarmOps-only terms are labelled as such: circuit group, branch run, run segment, material ready, as-built verified, audit batch, grid reference.",
      "Legacy wording survives as searchable aliases, so old sheets and old habits still find the right record.",
      "The applicable code edition and jurisdictional profile are stored with the registry.",
    ],
    note:
      "FarmOps does not determine code compliance. Final interpretation and acceptance rest with the licensed electrician and the authority having jurisdiction.",
  },
  {
    kind: "cards",
    kicker: "Model",
    title: "Distribution, from service to utilization equipment",
    cards: [
      {
        label: "Source",
        heading: "Services and feeders",
        body: "Service identity is permanent and never encodes ampacity, voltage, metering or panel configuration. Configuration lives in dated revisions.",
      },
      {
        label: "Distribution",
        heading: "Panelboards and OCPDs",
        body: "Panelboards carry positions; each position holds a circuit breaker or fuse with its own lifecycle, rating and documentation state.",
      },
      {
        label: "Branch",
        heading: "Circuit groups and runs",
        body: "A circuit group is the logical grouping normally protected by one breaker. Branch runs and run segments carry the physical routing beneath it.",
      },
      {
        label: "End",
        heading: "Loads and equipment",
        body: "Loads, receptacle outlets and utilization equipment attach by relationship, with nameplate data recorded separately from design intent.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Identity",
    title: "Readable identifiers with hierarchy built in",
    lead:
      "Field crews call out identifiers over the phone, so they are short, structured and human-checkable — and they never change meaning.",
    bullets: [
      "Panelboards, conduits, junction boxes, branch runs and field stations each use their own permanent identifier pattern.",
      "Hierarchical identifiers let a quality check confirm a child agrees with its parent instead of trusting the label.",
      "A derived breaker reference reads as panel plus position for display and labels, without ever being fused into the circuit group's identifier.",
      "Relationships are stored by internal reference, so a breaker reassignment changes wiring, not identity.",
    ],
  },
  {
    kind: "cards",
    kicker: "Lifecycle",
    title: "Twelve milestones, tracked independently",
    cards: [
      {
        label: "Design",
        heading: "Planned and material ready",
        body: "Design intent and staged material are recorded without implying that anything is installed.",
      },
      {
        label: "Rough-in",
        heading: "Raceway and conductors",
        body: "Boxes, raceway and cable each advance on their own. Pulling wire never completes a device.",
      },
      {
        label: "Terminate",
        heading: "Device and source ends",
        body: "Load-end and source-end terminations are separate milestones, because in real work they happen weeks apart.",
      },
      {
        label: "Prove",
        heading: "Tested, energized, verified",
        body: "Function test, energization and as-built verification are distinct, and verification requires accepted field evidence.",
      },
    ],
    note:
      "Every completion percentage is derived from the record's stage — a stage cannot be complete while its milestones are not.",
  },
  {
    kind: "statement",
    kicker: "Panel completeness",
    title: "Progress that means something on a Monday",
    lead:
      "Panel reporting is calculated, never typed in. One card answers what is actually done and what is left.",
    bullets: [
      "Infrastructure stage of the panelboard itself, separate from the circuits inside it.",
      "Position classification and capacity utilization, with the denominator spelled out in plain language.",
      "Circuit rollout counts, milestone tallies, open holds and conflicts.",
      "Timestamp of the most recent accepted field evidence, so stale confidence is visible.",
    ],
    note: "A circuit group may read complete only when its breaker is complete and every audited load on it is complete.",
  },
  {
    kind: "statement",
    kicker: "Field audit",
    title: "One observation, one atomic transaction",
    lead:
      "When a technician traces a circuit and confirms an installed connection, that single accepted observation stages every consequence together.",
    bullets: [
      "The approved circuit-group relationship, plus the lifecycle advance the evidence actually supports.",
      "Shared or dedicated classification derived from who else occupies the group.",
      "Building context taken from authoritative relationships — never from an identifier prefix.",
      "Explicit grid and pole observations supplied by the audit, and nothing that was not observed.",
    ],
    note:
      "Every affected field is shown in the preview before approval, then applied atomically. Anything unproven becomes an explicit unresolved hold.",
  },
  {
    kind: "cards",
    kicker: "Audit batches",
    title: "Batches are immutable once applied",
    cards: [
      {
        label: "Preview",
        heading: "Import writes nothing",
        body: "Loading a batch only stages exact before and after values for each item. There is no silent write path.",
      },
      {
        label: "Bind",
        heading: "Fingerprint-checked",
        body: "Each item is bound to the record state it was built against. Drift or newer evidence blocks the apply instead of overwriting it.",
      },
      {
        label: "Approve",
        heading: "Per-item, per-field",
        body: "An owner approves specific items. Rejections and holds are recorded as first-class outcomes.",
      },
      {
        label: "Freeze",
        heading: "Corrections come later",
        body: "An applied batch is never edited. A follow-up batch carries the correction, so the history stays readable.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Data quality",
    title: "Legacy metadata gets corrected, not overwritten",
    lead:
      "Older sheets often recorded a branch-circuit rating in the load's current column. FarmOps repairs that as an auditable batch with visible reasoning.",
    bullets: [
      "Outlet current and derived volt-amperes are cleared when they never had calculation provenance.",
      "Shared classification is set from the real circuit-group relationship instead of an assumption.",
      "A cleared value displays as \"not recorded\" — never as zero, and never as zero capacity.",
      "Records without audit evidence are listed in a read-only candidate report rather than changed.",
    ],
  },
  {
    kind: "statement",
    kicker: "Import contract",
    title: "A workbook column means exactly one thing",
    lead:
      "Canonical workbook imports run through a versioned, read-only contract bound to the authorized file, so the mapping cannot quietly drift.",
    bullets: [
      "Every physical column is bound by position and by its exact observed header.",
      "Each column carries an action: direct, normalized, derived, legacy, as-built, schema gap, ignore or unresolved.",
      "The full row set is simulated before anything is offered for import, with semantic loss reported explicitly.",
      "Genuine schema gaps stay gaps. They are never forced into a column that nearly fits.",
    ],
  },
  {
    kind: "statement",
    kicker: "Mapping repair",
    title: "Deterministic repairs only",
    lead:
      "When a mapping was wrong, the repair gate fixes only what can be proven mechanically — shifted or wrong-destination mappings — and refuses the rest.",
    bullets: [
      "The source file is re-hashed and re-parsed immediately before preview and before apply.",
      "Row drift and newer evidence are re-verified per field at apply time.",
      "Owner approval is required per field, not per screen.",
      "Nothing in the canonical source workbook is ever modified.",
    ],
  },
  {
    kind: "cards",
    kicker: "Location",
    title: "Coordinates first, grid labels second",
    cards: [
      {
        label: "Plan",
        heading: "Coordinate-native drawing",
        body: "The building plan is drawn in real feet, so a four-foot column bay measures four feet at any zoom or print size.",
      },
      {
        label: "Truth",
        heading: "Physical coordinates are authoritative",
        body: "Grid references such as A1 through F9 are derived, human-readable output — not the stored source of truth.",
      },
      {
        label: "Structure",
        heading: "Post and pole references",
        body: "Confirmed post positions and grid cells give crews a physical landmark to walk to, alongside the coordinate.",
      },
      {
        label: "Honesty",
        heading: "Mobile stays mobile",
        body: "Equipment with no fixed position is permanently marked non-fixed rather than assigned a comfortable-looking cell.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Grid map",
    title: "The whole building, colour-coded",
    lead:
      "One map answers where the power is: markers sit at exact coordinates with an anchored cluster badge, and expand only when selected.",
    bullets: [
      "Classification colour separates large dedicated equipment, dedicated 20 A circuits and shared circuits.",
      "Panelboard buttons filter the view down to one panel's territory.",
      "Planned, remaining and current overlays show install progress on the plan itself.",
      "Records that cannot be placed are counted and listed, never hidden.",
    ],
  },
  {
    kind: "statement",
    kicker: "Switching",
    title: "Control topology is its own model",
    lead:
      "Switches are not loads and control groups are not circuit groups. Multi-location control is modelled the way it is actually wired.",
    bullets: [
      "Switch banks are the physical enclosures; switch devices are individual single-pole, 3-way, 4-way, dimmer or selector devices.",
      "A control group is the set of devices controlling the same target or targets, with its own verification state.",
      "The cable between two 3-way switches is a wiring segment inside the supplying branch circuit — not a second circuit.",
      "Conductor function is recorded only when traced or tested; a black band or tape stays evidence, not a conclusion.",
    ],
    note: "A wall switch is only classified as a disconnecting means after explicit verification.",
  },
  {
    kind: "statement",
    kicker: "Critical loads",
    title: "Backup sizing from recorded criticality",
    lead:
      "Generator and backup planning uses only loads that are recorded as critical in the canonical source, with the operator's own priority rules.",
    bullets: [
      "Criticality is never inferred from a panel, a description, an amperage or a volt-ampere figure.",
      "Logical circuit and backup priority rules are applied as supplied, not invented.",
      "Missing relationships surface as gaps in the sizing report instead of silent zeroes.",
      "Planned and current modes let you size for today's build and for the finished design.",
    ],
  },
  {
    kind: "cards",
    kicker: "Diagrams",
    title: "Views generated from records, not drawn by hand",
    cards: [
      {
        label: "Topology",
        heading: "Service to load",
        body: "A generated diagram walks service, feeder, panelboard, breaker, circuit group and load, with explicit gaps where a link is missing.",
      },
      {
        label: "Panel",
        heading: "Panel schedule view",
        body: "Position-by-position layout with breaker reference, load occupancy and documentation state.",
      },
      {
        label: "Wiring",
        heading: "Runs and segments",
        body: "Conduits, junction boxes, branch runs and segments, showing what is installed versus designed.",
      },
      {
        label: "Control",
        heading: "Switching arrangements",
        body: "Control groups, travellers and switched conductors kept visually distinct from power distribution.",
      },
    ],
    note: "Because the diagram is generated, it cannot disagree with the records it came from.",
  },
  {
    kind: "statement",
    kicker: "Documents",
    title: "Printable output for the truck and the binder",
    lead:
      "Field documents are produced from live records at the moment you press print, using the current building drawing.",
    bullets: [
      "Grid document with the current plan drawing, A1–F9 references and a full post schedule.",
      "A clean posts-only plan for markup, with load markers removed.",
      "Cross-reference tables linking loads to grid cell and nearest post.",
      "Tablet-friendly audit sheets for walking a panel with a phone in one hand.",
    ],
  },
  {
    kind: "statement",
    kicker: "Labels",
    title: "Labels that match the field vocabulary",
    lead:
      "QR labels print in walk order so a labelling pass follows the building instead of a database sort.",
    bullets: [
      "Ordered by location, then panelboard, then grid, then load name, with page breaks at location and panel changes.",
      "Grid location and shared or dedicated classification print on the label face.",
      "Scanning a label opens that exact record, signing in first when needed.",
      "Identifiers on printed labels stay valid because identity never changes.",
    ],
  },
  {
    kind: "statement",
    kicker: "Nameplate capture",
    title: "Photograph the plate, approve the data",
    lead:
      "Assisted extraction reads manufacturer, model, serial, voltage, current, minimum ampacity and maximum protection from a nameplate photo.",
    bullets: [
      "Large equipment is scanned for missing nameplate coverage and badged where data exists.",
      "Extraction produces a draft with the photo retained as evidence.",
      "An administrator approves specific fields before any equipment row changes.",
      "Nothing extracted is treated as engineering truth without that approval.",
    ],
  },
  {
    kind: "statement",
    kicker: "Assistant",
    title: "Answers that cite records or say they cannot",
    lead:
      "The electrical assistant answers from the recorded model — tracing circuit to breaker to panelboard to feeder — and reports absences plainly.",
    bullets: [
      "Deterministic tracing and ranking supply the context, so the answer follows the relationships.",
      "Where a relationship is missing, the reply says it is not in the record instead of filling the gap.",
      "Cost-aware routing keeps routine questions local and escalates only with a visible estimate.",
      "Approved terminology notes travel with every answer.",
    ],
  },
  {
    kind: "statement",
    kicker: "Quality checks",
    title: "Continuous checks instead of an annual cleanup",
    lead:
      "Quality tooling is grouped in one place and runs against the live model, so problems surface while the crew is still on site.",
    bullets: [
      "Reference integrity, parent agreement and orphan detection across every relationship.",
      "Semantic checks that catch a rating recorded as a load, or a volt-ampere figure with no provenance.",
      "Terminology scanning across screens, exports, schemas, diagrams and documentation.",
      "Reconciliation reports that require an explicit decision instead of overwriting one side.",
    ],
  },
  {
    kind: "cards",
    kicker: "Access",
    title: "Who can see and change what",
    cards: [
      {
        label: "Roles",
        heading: "Separate role storage",
        body: "Roles live in their own table and are checked server-side, so nothing about permission depends on the browser.",
      },
      {
        label: "Rows",
        heading: "Owner-scoped records",
        body: "Every electrical table is scoped to its owner at the database level, including child records without an owner column.",
      },
      {
        label: "Writes",
        heading: "Approval gates",
        body: "Field writes, batch applies and nameplate merges each require explicit approval by an authorised role.",
      },
      {
        label: "Trail",
        heading: "Activity logging",
        body: "Applied changes carry who, when, on what evidence and under which batch.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Integration",
    title: "A versioned read-only API, plus scoped write previews",
    lead:
      "Other systems read the electrical model through a documented, versioned interface with its own specification.",
    bullets: [
      "Bearer-authenticated service principals with narrow scopes and structured error envelopes.",
      "Reads are owner-scoped in the database; a scope mismatch fails closed.",
      "Relationship and field-observation endpoints stage previews separately from applies.",
      "Administrative functions are deliberately excluded from the API surface.",
    ],
  },
  {
    kind: "statement",
    kicker: "Instance sync",
    title: "Pull from a peer, approve locally",
    lead:
      "Two FarmOps instances can stay aligned without either one writing into the other.",
    bullets: [
      "A manifest export endpoint publishes an audit batch with its checksum intact.",
      "The receiving instance stages the manifest as a preview only — it carries no approvals.",
      "Local approval is still required before a single field changes.",
      "Scheduled pulls keep staging current; the write decision stays with the owner.",
    ],
  },
  {
    kind: "cards",
    kicker: "Deployment",
    title: "Run it standalone, on your terms",
    cards: [
      {
        label: "Hosted",
        heading: "Cloud instance",
        body: "One instance per property, managed hosting, nothing to install. Sign in and start recording panels the same day.",
      },
      {
        label: "Self-hosted",
        heading: "Your own hardware",
        body: "Container deployment with scripted bootstrap, environment preflight, backups and disaster-recovery documentation.",
      },
      {
        label: "Offline-tolerant",
        heading: "Barn-grade reality",
        body: "Field work assumes weak connectivity: identifiers are readable, documents print, and audits stage for later approval.",
      },
      {
        label: "Exit",
        heading: "Your data leaves with you",
        body: "Full record export, document generation and snapshot restore are part of the product, not a support ticket.",
      },
    ],
    note: "The Electrical module runs as a standalone deployment today — no other FarmOps module is required to use it.",
  },
  {
    kind: "statement",
    kicker: "Standalone",
    title: "The Electrical module on its own",
    lead:
      "For an electrician or a single property owner who only cares about power, the module stands alone as a complete system of record.",
    bullets: [
      "Panelboards, circuits, OCPDs, runs, switching, loads and nameplate data in one model.",
      "Field audits, labels, printable grid documents and panel completeness reporting included.",
      "The versioned read-only API and quality tooling come with it.",
      "A free-forever knowledge base carries your procedures and reference material alongside the records.",
    ],
  },
  {
    kind: "statement",
    kicker: "Federated · design direction",
    title: "One practice, many client sites",
    lead:
      "For a contractor serving many properties, the intended shape is a federation of client instances with a practice-level workspace on top. This is a designed direction, not a shipped feature.",
    bullets: [
      "Each client keeps its own instance and remains the owner of its records and its approvals.",
      "The contractor workspace reads across client sites through scoped service principals, never by pooling data into one table.",
      "Cross-site work lands as preview manifests that the client instance approves locally, preserving the same audit trail.",
      "Practice-level views roll up open holds, install progress and upcoming work per site.",
      "Site scoping and cross-instance identity are the prerequisites, and they are tracked as product architecture work.",
    ],
    note:
      "Nothing in the federated model weakens the local rules: owner-scoped rows, explicit approvals, immutable applied batches, preview-only sync.",
  },
  {
    kind: "cta",
    kicker: "Next step",
    title: "See it against your own panel",
    lead:
      "The fastest evaluation is one real panelboard: record it, walk it, audit it, and print the label run and grid document.",
    actions: [
      "Start with a single panelboard and its branch circuits.",
      "Run one field audit and watch the preview show every consequence before approval.",
      "Print the labels and the clean posts-only plan, then walk the building.",
      "Ask about standalone hosting, self-hosting, or the federated contractor direction.",
    ],
    footer: "farmops.bostead.life/demo/electrical",
  },
];
