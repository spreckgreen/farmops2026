// Versioned electrical terminology registry.
//
// One source of truth for every word the Electrical module shows a person:
// which terms are defined by the NEC (NFPA 70), which are FarmOps operational
// terms that only *relate* to NEC concepts, and which usages are deprecated or
// prohibited in user-facing text.
//
// Nothing here renames a stable ID. A display term change never touches
// PNL-*, FS-*, CON-###, EMT-###, JB-###-##, BR-###-##-## or SVC-*/ITIE-*.
//
// FarmOps does not determine code compliance. See NEC_PROFILE.notice.

export const TERMINOLOGY_REGISTRY_VERSION = "electrical.terminology.v1";

/**
 * Applicable code edition and jurisdictional profile. Terminology and
 * requirements change between editions and under local amendments, so the
 * edition is recorded with the registry rather than assumed.
 */
export const NEC_PROFILE = {
  registryVersion: TERMINOLOGY_REGISTRY_VERSION,
  /** Code of record used for the definitions below. */
  necEdition: "NEC 2023 (NFPA 70, 2023 edition)",
  /** Editions whose Article 100 definitions are equivalent for these terms. */
  compatibleEditions: ["NEC 2017", "NEC 2020", "NEC 2023"],
  /** Adopting authority. Confirm locally before relying on the edition. */
  jurisdiction: "Not yet recorded — confirm the adopted edition with the AHJ",
  /** Local amendments that change terminology or requirements, once recorded. */
  localAmendments: [] as string[],
  notice:
    "FarmOps records observed conditions and documentation terminology only. It does not " +
    "determine code compliance, and nothing in this module is a code ruling. Final " +
    "interpretations, design decisions and installation acceptance remain with the licensed " +
    "electrician and the authority having jurisdiction (AHJ). Terminology follows the recorded " +
    "edition above; a different adopted edition or local amendment may change definitions.",
} as const;

export type TermClassification =
  /** Defined in the NEC (normally Article 100) — use the NEC wording. */
  | "NEC_DEFINED"
  /** Not a definition, but a term the NEC uses in requirement text. */
  | "NEC_USAGE"
  /** FarmOps operational/record-keeping term with no NEC definition. */
  | "FARMOPS_OPERATIONAL";

export interface DeprecatedUsage {
  /** The wording that must not appear in user-facing text. */
  usage: string;
  /** What to say instead. */
  instead: string;
  reason: string;
  /** Kept as a searchable field alias even though it is not displayed. */
  aliasOnly?: boolean;
}

export interface TermEntry {
  /** FarmOps internal identifier — stable, never renamed for display reasons. */
  id: string;
  /** Canonical user-facing term. */
  canonical: string;
  classification: TermClassification;
  /** Edition the reference below was read from; null for FarmOps terms. */
  necEdition: string | null;
  /** NEC article/section reference; null for FarmOps terms. */
  necReference: string | null;
  /** Plain-language explanation for tooltips and help text. */
  plain: string;
  /** How a FarmOps operational term relates to NEC concepts. Required for FARMOPS_OPERATIONAL. */
  necRelation?: string;
  /** Accepted field aliases (import headers, observed labels, search synonyms). */
  aliases: string[];
  deprecated: DeprecatedUsage[];
  /** Affected fields, grouped by surface. */
  affects: {
    db?: string[];
    ui?: string[];
    api?: string[];
    export?: string[];
  };
}

const ED = NEC_PROFILE.necEdition;

export const TERMS: readonly TermEntry[] = [
  // ---------------------------------------------------------------- NEC terms
  {
    id: "panelboard",
    canonical: "Panelboard",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Panelboard); Art. 408",
    plain:
      "The enclosed assembly of busbars and overcurrent devices that circuits are fed from. " +
      "'Panel' is an acceptable short display label only while the recorded equipment type " +
      "stays panelboard, switchboard, switchgear or another correct classification.",
    aliases: ["panel", "load center", "loadcentre", "load centre", "breaker box", "distribution panel"],
    deprecated: [
      {
        usage: "panel board",
        instead: "panelboard",
        reason: "NEC Article 100 spells the defined term as one word.",
      },
      {
        usage: "breaker box",
        instead: "panelboard (short display label: panel)",
        reason: "Colloquial; hides the authoritative equipment classification.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_panels", "electrical_service_panels.panel_uuid", "electrical_loads.panel"],
      ui: ["Panels list", "Panel detail", "Panel diagram", "Grid map panel filter"],
      api: ["/api/v1/electrical/panels"],
      export: ["panel", "panel_id"],
    },
  },
  {
    id: "service_equipment",
    canonical: "Service equipment",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Service Equipment); Art. 230",
    plain:
      "The necessary equipment, usually a disconnecting means and overcurrent devices, that " +
      "forms the main control and cutoff of the utility supply to the premises.",
    aliases: ["main service", "service entrance equipment", "main disconnect"],
    deprecated: [
      {
        usage: "main panel",
        instead: "service equipment (or the panelboard's recorded classification)",
        reason: "'Main panel' conflates service equipment with a downstream panelboard.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_services", "electrical_service_configurations"],
      ui: ["Services page", "Topology"],
      api: ["/api/v1/electrical/services"],
      export: ["service_id"],
    },
  },
  {
    id: "feeder",
    canonical: "Feeder",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Feeder); Art. 215",
    plain:
      "The conductors between the service equipment (or another supply source) and the final " +
      "branch-circuit overcurrent device. A feeder never terminates at utilization equipment.",
    aliases: ["subfeed", "sub feed", "panel feed"],
    deprecated: [
      {
        usage: "sub panel feed wire",
        instead: "feeder",
        reason: "Mixes an informal name with the defined term.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_feeders"],
      ui: ["Feeders list", "Topology", "Wiring"],
      api: ["/api/v1/electrical/feeders"],
      export: ["feeder_id"],
    },
  },
  {
    id: "branch_circuit",
    canonical: "Branch circuit",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Branch Circuit); Art. 210",
    plain:
      "The circuit conductors between the final overcurrent protective device and the " +
      "outlet(s) it supplies.",
    aliases: ["circuit", "branch"],
    deprecated: [
      {
        usage: "branch",
        instead: "branch circuit, wiring run, or branch-circuit wiring segment",
        reason:
          "Bare 'branch' is ambiguous: it can mean the circuit, the physical routing, or a " +
          "segment of it. Say which one is meant.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_circuit_groups", "electrical_branch_runs"],
      ui: ["Circuit groups", "Audit sheet", "Panel diagram", "Wiring"],
      api: ["/api/v1/electrical/circuit-groups"],
      export: ["circuit_group_id", "breaker_reference"],
    },
  },
  {
    id: "individual_branch_circuit",
    canonical: "Individual branch circuit",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Branch Circuit, Individual); Art. 210",
    plain:
      "A branch circuit that supplies only one item of utilization equipment. FarmOps displays " +
      "this term only when the recorded topology actually shows a single item of utilization " +
      "equipment on the circuit — never merely because a circuit was called 'dedicated'.",
    aliases: [],
    deprecated: [
      {
        usage: "dedicated circuit",
        instead:
          "individual branch circuit (only when the recorded topology satisfies the definition), " +
          "otherwise 'single recorded load on this circuit'",
        reason:
          "'Dedicated' is an operational/design habit, not the NEC definition, and is often " +
          "recorded before the topology is known.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_circuit_groups.shared", "electrical_loads.dedicated"],
      ui: ["Grid map classification", "Labels", "Circuit group detail"],
      api: ["/api/v1/electrical/circuit-groups"],
      export: ["classification"],
    },
  },
  {
    id: "ocpd",
    canonical: "Overcurrent protective device (OCPD)",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Overcurrent Protective Device); Art. 240",
    plain:
      "Any device that opens the circuit on overcurrent — a circuit breaker or a fuse. Use OCPD " +
      "when either could be meant; name the specific device when it is known.",
    aliases: ["overcurrent device", "protective device", "ocp"],
    deprecated: [
      {
        usage: "breaker or fuse",
        instead: "overcurrent protective device (OCPD)",
        reason: "The generic defined term already covers both.",
      },
    ],
    affects: {
      db: ["electrical_breaker_positions", "electrical_loads.installed_ocp_rating"],
      ui: ["Panel diagram", "Breaker positions", "Audit sheet"],
      api: ["/api/v1/electrical/breaker-positions"],
      export: ["installed_ocp_rating", "mocp"],
    },
  },
  {
    id: "circuit_breaker",
    canonical: "Circuit breaker",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Circuit Breaker); 240.80–240.86",
    plain:
      "A resettable overcurrent protective device. A fuse is a different, non-resettable OCPD; " +
      "the two are never interchangeable in a record.",
    aliases: ["breaker", "cb"],
    deprecated: [
      {
        usage: "fuse breaker",
        instead: "circuit breaker or fuse",
        reason: "Two distinct device types; recording them as one loses the real device.",
      },
    ],
    affects: {
      db: ["electrical_breaker_positions.breaker_number"],
      ui: ["Panel diagram", "Breaker reference (PNL-FS-NW-B39)"],
      api: ["/api/v1/electrical/breaker-positions"],
      export: ["breaker_reference", "breaker_number"],
    },
  },
  {
    id: "outlet",
    canonical: "Outlet",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Outlet)",
    plain:
      "A point on the wiring system where current is taken to supply utilization equipment. A " +
      "lighting outlet and a receptacle outlet are both outlets; an outlet is a location, not a device.",
    aliases: ["outlet point"],
    deprecated: [
      {
        usage: "outlet plug",
        instead: "receptacle (device) or receptacle outlet (location)",
        reason: "Mixes the outlet location with the device installed at it.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_loads", "electrical_devices"],
      ui: ["Loads list", "Audit sheet", "Labels"],
      api: ["/api/v1/electrical/loads"],
      export: ["load_id", "description"],
    },
  },
  {
    id: "receptacle",
    canonical: "Receptacle",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Receptacle); Art. 406",
    plain:
      "The contact device installed at an outlet for the connection of an attachment plug. " +
      "'Plug' is retained only as an observed field label or search alias.",
    aliases: ["plug", "plugs", "double gang plugs", "outlet device", "socket"],
    deprecated: [
      {
        usage: "plug",
        instead: "receptacle",
        reason:
          "The attachment plug is the cord end, not the installed device. 'Plug' stays " +
          "searchable because field labels and the canonical workbook use it.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_devices", "electrical_loads.description"],
      ui: ["Loads list", "Audit sheet row labels", "Grid map markers"],
      api: ["/api/v1/electrical/devices"],
      export: ["description", "label"],
    },
  },
  {
    id: "receptacle_outlet",
    canonical: "Receptacle outlet",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Receptacle Outlet)",
    plain:
      "The outlet location where one or more receptacles are installed. Use this for the place; " +
      "use 'receptacle' for the device.",
    aliases: ["receptacle location", "outlet location"],
    deprecated: [],
    affects: {
      db: ["electrical_loads.grid_reference", "electrical_loads.pole_grid"],
      ui: ["Grid map", "Audit sheet location column"],
      api: ["/api/v1/electrical/loads"],
      export: ["grid_reference", "x_ft", "y_ft"],
    },
  },
  {
    id: "junction_box",
    canonical: "Junction box",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 314 (boxes, conduit bodies and fittings)",
    plain:
      "An enclosure where conductors are spliced or pulled, with no device mounted in it. " +
      "Stable IDs keep the JB-###-## form regardless of display wording.",
    aliases: ["j-box", "jbox", "pull box"],
    deprecated: [
      {
        usage: "device junction box",
        instead: "junction box or device box",
        reason: "A box either houses a device or it does not; the record must say which.",
      },
    ],
    affects: {
      db: ["electrical_junction_boxes"],
      ui: ["Junction boxes list", "Wiring", "Topology"],
      api: ["/api/v1/electrical/junction-boxes"],
      export: ["junction_box_id"],
    },
  },
  {
    id: "device_box",
    canonical: "Device box",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 314; Art. 100 (Device)",
    plain: "A box that houses a device such as a receptacle, switch or dimmer.",
    aliases: ["outlet box", "switch box", "gang box"],
    deprecated: [],
    affects: {
      db: ["electrical_devices", "electrical_junction_boxes.box_kind"],
      ui: ["Devices list", "Audit sheet"],
      api: ["/api/v1/electrical/devices"],
      export: ["box_kind"],
    },
  },
  {
    id: "raceway",
    canonical: "Raceway",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Raceway); Chapter 3",
    plain:
      "An enclosed channel designed expressly to hold conductors or cables — EMT, PVC conduit, " +
      "wireway and similar. A raceway is not a cable.",
    aliases: ["conduit", "emt", "pipe"],
    deprecated: [
      {
        usage: "wire conduit run",
        instead: "raceway (or the specific raceway type, e.g. EMT)",
        reason: "Informal wording that blurs raceway, conductor and routing.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_raceways", "electrical_raceway_waypoints"],
      ui: ["Raceways list", "Wiring", "Topology"],
      api: ["/api/v1/electrical/raceways"],
      export: ["raceway_id"],
    },
  },
  {
    id: "cable",
    canonical: "Cable",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100; Arts. 330–340 (e.g. Type NM, Art. 334)",
    plain:
      "A factory assembly of conductors with an overall covering, such as Type NM or Type MC. " +
      "A cable is an assembly; a raceway is the channel a cable or conductor may run in.",
    aliases: ["romex", "nm-b", "mc cable", "wire"],
    deprecated: [
      {
        usage: "conduit cable",
        instead: "cable in raceway, or the specific cable type",
        reason: "Conflates the cable assembly with the raceway containing it.",
      },
    ],
    affects: {
      db: ["electrical_branch_runs.method", "electrical_raceways.method"],
      ui: ["Wiring", "Branch runs"],
      api: ["/api/v1/electrical/branch-runs"],
      export: ["method"],
    },
  },
  {
    id: "conductor",
    canonical: "Conductor",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100; Art. 310",
    plain:
      "The wire that carries current — bare, covered or insulated. Size and insulation belong to " +
      "the conductor record, not to the raceway.",
    aliases: ["wire", "conductors", "awg"],
    deprecated: [
      {
        usage: "hot wire",
        instead: "ungrounded conductor",
        reason: "NEC wording distinguishes ungrounded, grounded and grounding conductors.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_branch_runs.conductor_size", "electrical_feeders.conductor_size"],
      ui: ["Wiring", "Feeders", "Branch runs"],
      api: ["/api/v1/electrical/branch-runs"],
      export: ["conductor_size"],
    },
  },
  {
    id: "grounded_conductor",
    canonical: "Grounded conductor",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Conductor, Grounded); Art. 200",
    plain:
      "The circuit conductor that is intentionally grounded — in common premises wiring, the " +
      "neutral. It is a current-carrying circuit conductor, unlike a grounding conductor.",
    aliases: ["neutral", "grounded circuit conductor"],
    deprecated: [
      {
        usage: "ground wire",
        instead: "grounded conductor or equipment grounding conductor — say which",
        reason:
          "'Ground wire' is used for both the neutral and the EGC, which are different conductors.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_branch_runs.neutral_size"],
      ui: ["Wiring", "Branch runs"],
      api: ["/api/v1/electrical/branch-runs"],
      export: ["neutral_size"],
    },
  },
  {
    id: "egc",
    canonical: "Equipment grounding conductor (EGC)",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Equipment Grounding Conductor); 250.118",
    plain:
      "The conductive path that connects non-current-carrying metal parts to the system grounded " +
      "conductor and/or the grounding electrode conductor. It does not normally carry current.",
    aliases: ["egc", "ground", "equipment ground"],
    deprecated: [],
    affects: {
      db: ["electrical_branch_runs.egc_size"],
      ui: ["Wiring", "Branch runs"],
      api: ["/api/v1/electrical/branch-runs"],
      export: ["egc_size"],
    },
  },
  {
    id: "gec",
    canonical: "Grounding electrode conductor (GEC)",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Grounding Electrode Conductor); 250.62, 250.66",
    plain:
      "The conductor that connects the grounding electrode to the equipment grounding conductor, " +
      "the grounded conductor, or both, at the service or source. It is not an EGC.",
    aliases: ["gec", "grounding electrode wire"],
    deprecated: [],
    affects: {
      db: ["electrical_service_configurations"],
      ui: ["Services page"],
      api: ["/api/v1/electrical/services"],
      export: ["service_id"],
    },
  },
  {
    id: "disconnecting_means",
    canonical: "Disconnecting means",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Disconnecting Means); 225.31, 230.70, 422.31",
    plain:
      "The device, group of devices or other means by which conductors of a circuit can be " +
      "disconnected from their supply source.",
    aliases: ["disconnect", "safety switch", "shutoff"],
    deprecated: [
      {
        usage: "kill switch",
        instead: "disconnecting means",
        reason: "Colloquial; not the defined term.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_power_assets", "electrical_panel_exits"],
      ui: ["Power assets", "Topology"],
      api: ["/api/v1/electrical/power-assets"],
      export: ["asset_id"],
    },
  },
  {
    id: "load",
    canonical: "Load",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Load); Art. 220 (calculations)",
    plain:
      "The power drawn by equipment, and — in FarmOps records — the recorded item of equipment " +
      "or outlet that draws it. Calculated load values follow Article 220 methods only when the " +
      "record says so explicitly.",
    aliases: ["load", "connected load", "equipment"],
    deprecated: [],
    affects: {
      db: ["electrical_loads"],
      ui: ["Loads list", "Audit sheet", "Grid map", "Critical loads"],
      api: ["/api/v1/electrical/loads"],
      export: ["load_id", "connected_va"],
    },
  },
  {
    id: "utilization_equipment",
    canonical: "Utilization equipment",
    classification: "NEC_DEFINED",
    necEdition: ED,
    necReference: "Art. 100 (Utilization Equipment)",
    plain:
      "Equipment that uses electric energy for its purpose — a heater, motor, light fixture, " +
      "appliance. Use this when the record describes the equipment itself rather than its demand.",
    aliases: ["equipment", "appliance", "fixture"],
    deprecated: [],
    affects: {
      db: ["electrical_loads", "electrical_devices", "electrical_power_assets"],
      ui: ["Loads list", "Nameplate scan", "Item detail"],
      api: ["/api/v1/electrical/loads"],
      export: ["description", "manufacturer", "model"],
    },
  },

  // ------------------------------------------------ FarmOps operational terms
  {
    id: "circuit_group",
    canonical: "Circuit group (FarmOps)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "A FarmOps logical grouping of loads that share one overcurrent protective device. It is a " +
      "record-keeping object, not an NEC term.",
    necRelation:
      "A circuit group normally represents exactly one breaker-protected branch circuit " +
      "(NEC Art. 100, Branch Circuit). It is never itself an NEC-defined object, and its stable " +
      "ID stays fixed when the breaker assignment changes.",
    aliases: ["circuit", "group", "cct group"],
    deprecated: [
      {
        usage: "NEC circuit group",
        instead: "circuit group (FarmOps) representing a branch circuit",
        reason: "The NEC defines no 'circuit group'.",
      },
    ],
    affects: {
      db: ["electrical_circuit_groups", "electrical_breaker_positions.circuit_group_uuid"],
      ui: ["Circuit groups", "Audit sheet", "Panel diagram", "Item detail"],
      api: ["/api/v1/electrical/circuit-groups"],
      export: ["circuit_group_id"],
    },
  },
  {
    id: "branch_run",
    canonical: "Branch run (FarmOps)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "A FarmOps physical-routing object: where branch-circuit wiring physically goes between two " +
      "recorded points.",
    necRelation:
      "Subordinate to a branch circuit (NEC Art. 100/210). One branch circuit may have several " +
      "branch runs; a branch run is routing, never the circuit itself.",
    aliases: ["run", "wiring run", "branch"],
    deprecated: [
      {
        usage: "branch run circuit",
        instead: "branch circuit (the circuit) or branch run (the routing)",
        reason: "Collapses the physical routing object into the NEC circuit.",
      },
    ],
    affects: {
      db: ["electrical_branch_runs"],
      ui: ["Wiring", "Topology", "Branch runs list"],
      api: ["/api/v1/electrical/branch-runs"],
      export: ["branch_run_id"],
    },
  },
  {
    id: "run_segment",
    canonical: "Run segment (FarmOps)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "One recorded leg of a branch run between two waypoints, used for measurement and as-built " +
      "tracing.",
    necRelation:
      "A subdivision of FarmOps routing. In NEC wording the underlying wiring is branch-circuit " +
      "conductors in a raceway or cable; 'run segment' is a FarmOps bookkeeping unit only.",
    aliases: ["segment", "leg", "waypoint span"],
    deprecated: [],
    affects: {
      db: ["electrical_raceway_waypoints", "electrical_branch_runs"],
      ui: ["Wiring", "Raceway detail"],
      api: ["/api/v1/electrical/raceways"],
      export: ["waypoint_seq"],
    },
  },
  {
    id: "feed_through_sequence",
    canonical: "Feed-through sequence",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "The recorded order in which devices are fed one from the next along a branch circuit, " +
      "also shown as 'downstream device sequence'.",
    necRelation:
      "Describes how branch-circuit conductors pass through receptacles or boxes. The NEC does " +
      "not define this ordering; it is an as-built observation.",
    aliases: ["daisy chain", "daisy-chain", "pass-through wiring", "downstream sequence"],
    deprecated: [
      {
        usage: "daisy chain",
        instead: "feed-through sequence or downstream device sequence",
        reason:
          "Slang in user-facing text. Kept as a searchable field alias because field notes use it.",
        aliasOnly: true,
      },
    ],
    affects: {
      db: ["electrical_branch_runs.sequence", "electrical_devices.upstream_device_uuid"],
      ui: ["Wiring", "Audit sheet", "Devices"],
      api: ["/api/v1/electrical/devices"],
      export: ["sequence"],
    },
  },
  {
    id: "material_ready",
    canonical: "Material ready (FarmOps stage)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "A FarmOps install-progress stage meaning the material for the work is staged on site. It " +
      "says nothing about installed condition.",
    necRelation:
      "Project tracking only. It is not an NEC installation classification and carries no code " +
      "meaning or inspection status.",
    aliases: ["material staged", "materials ready"],
    deprecated: [
      {
        usage: "NEC stage",
        instead: "FarmOps install stage",
        reason: "Lifecycle stages are FarmOps project states, not code classifications.",
      },
    ],
    affects: {
      db: ["install_status", "completion_percent"],
      ui: ["Audit sheet", "Install progress", "Panel completeness"],
      api: ["/api/v1/electrical/loads"],
      export: ["install_status", "completion_percent"],
    },
  },
  {
    id: "complete",
    canonical: "Complete (FarmOps stage)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "A FarmOps stage meaning the recorded work for that object is finished per the record. It " +
      "is not an inspection result or acceptance.",
    necRelation:
      "Not an NEC classification. Acceptance of an installation rests with the licensed " +
      "electrician and the AHJ, not with this stage.",
    aliases: ["done", "finished", "installed complete"],
    deprecated: [
      {
        usage: "code complete",
        instead: "FarmOps stage complete",
        reason: "Implies a compliance judgement FarmOps does not make.",
      },
      {
        usage: "NEC compliant",
        instead: "recorded as complete in FarmOps",
        reason: "FarmOps does not determine compliance.",
      },
    ],
    affects: {
      db: ["install_status"],
      ui: ["Audit sheet", "Install progress", "Item detail"],
      api: ["/api/v1/electrical/circuit-groups"],
      export: ["install_status"],
    },
  },
  {
    id: "as_built_verified",
    canonical: "As-built verified (FarmOps stage)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "A FarmOps stage meaning an accepted field observation confirms the installed condition and " +
      "location recorded for the object.",
    necRelation:
      "Documentation confidence only. It is not an inspection, certification or code approval.",
    aliases: ["verified", "field verified", "as built"],
    deprecated: [
      {
        usage: "inspected and approved",
        instead: "as-built verified in FarmOps",
        reason: "Inspection and approval are AHJ actions.",
      },
    ],
    affects: {
      db: ["install_status", "electrical_field_observations"],
      ui: ["Audit sheet", "Audit batches", "Panel completeness"],
      api: ["/api/v1/electrical/field-observations"],
      export: ["install_status"],
    },
  },
  {
    id: "audit_batch",
    canonical: "Audit batch (FarmOps)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "An immutable, fingerprinted set of proposed record changes from one field session, " +
      "reviewed and approved before anything is written.",
    necRelation:
      "A records-management artifact. It has no NEC standing and never substitutes for " +
      "inspection or documentation required by the AHJ.",
    aliases: ["batch", "field audit batch", "manifest"],
    deprecated: [],
    affects: {
      db: ["electrical_audit_batches", "electrical_audit_batch_items"],
      ui: ["Audit batches", "Audit sheet"],
      api: ["/api/v1/electrical/audit-batches"],
      export: ["batch_id", "fingerprint"],
    },
  },
  {
    id: "pole_grid",
    canonical: "Pole grid (FarmOps)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "The building's structural post/column reference used to describe where something is, for " +
      "example the post at column 8, row B.",
    necRelation:
      "A location-description convention for the building, unrelated to any NEC electrical " +
      "definition. Never inferred from a stable-ID prefix or a breaker relationship.",
    aliases: ["post grid", "pole", "post callout"],
    deprecated: [],
    affects: {
      db: ["electrical_loads.pole_grid"],
      ui: ["Grid map", "Audit sheet", "Farm Shop plan"],
      api: ["/api/v1/electrical/loads"],
      export: ["pole_grid"],
    },
  },
  {
    id: "grid_reference",
    canonical: "Grid reference (FarmOps)",
    classification: "FARMOPS_OPERATIONAL",
    necEdition: null,
    necReference: null,
    plain:
      "A human-readable location label derived from recorded physical coordinates, for example " +
      "C-4. Coordinates are authoritative; the grid reference is derived for reading.",
    necRelation:
      "A FarmOps documentation aid for locating outlets and equipment. It is not an NEC concept " +
      "and carries no electrical meaning.",
    aliases: ["grid", "grid location", "grid ref"],
    deprecated: [],
    affects: {
      db: ["electrical_loads.grid_reference", "electrical_loads.x_ft", "electrical_loads.y_ft"],
      ui: ["Grid map", "Grid data quality", "Labels (Avery 8593)"],
      api: ["/api/v1/electrical/loads"],
      export: ["grid_reference", "x_ft", "y_ft"],
    },
  },
];

export const TERMS_BY_ID: Record<string, TermEntry> = Object.fromEntries(
  TERMS.map((t) => [t.id, t]),
);

export function term(id: string): TermEntry | null {
  return TERMS_BY_ID[id] ?? null;
}

/** True when the canonical term is NEC-defined rather than FarmOps operational. */
export function isNecDefined(id: string): boolean {
  return TERMS_BY_ID[id]?.classification === "NEC_DEFINED";
}

/** Every alias that may be typed, imported or searched, mapped to its term id. */
export function aliasIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of TERMS) {
    m.set(t.canonical.toLowerCase(), t.id);
    for (const a of t.aliases) m.set(a.toLowerCase(), t.id);
    for (const d of t.deprecated) m.set(d.usage.toLowerCase(), t.id);
  }
  return m;
}

/** Resolve a typed/imported phrase to a registry term, via canonical or alias. */
export function resolveTerm(phrase: string): TermEntry | null {
  const id = aliasIndex().get(phrase.trim().toLowerCase());
  return id ? (TERMS_BY_ID[id] ?? null) : null;
}

export interface ProhibitedUsage extends DeprecatedUsage {
  termId: string;
  canonical: string;
  /** Word-boundary matcher for user-facing text scans. */
  pattern: RegExp;
}

/**
 * Prohibited user-facing usages, derived from the registry so the checker and
 * the reconciliation report can never drift from the terms themselves.
 */
export function prohibitedUsages(): ProhibitedUsage[] {
  const out: ProhibitedUsage[] = [];
  for (const t of TERMS) {
    for (const d of t.deprecated) {
      out.push({
        ...d,
        termId: t.id,
        canonical: t.canonical,
        pattern: new RegExp(
          `\\b${d.usage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+")}\\b`,
          "i",
        ),
      });
    }
  }
  return out;
}

/** Terms that need contextual help because they can be mistaken for NEC objects. */
export function operationalTerms(): TermEntry[] {
  return TERMS.filter((t) => t.classification === "FARMOPS_OPERATIONAL");
}

/** One-line help text for a tooltip, including the NEC relationship. */
export function termHelp(id: string): string | null {
  const t = TERMS_BY_ID[id];
  if (!t) return null;
  if (t.classification === "FARMOPS_OPERATIONAL") {
    return `${t.plain} ${t.necRelation ?? ""}`.trim();
  }
  return `${t.plain} (${t.necEdition} ${t.necReference})`;
}
