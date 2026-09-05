// Field descriptors for the electrical entities. Both the UI (generic list /
// edit forms) and the server functions (column whitelists) read from here, so
// there is exactly one definition of each entity's shape.
import {
  CURRENT_TYPES,
  DEVICE_ROLES,
  ENDPOINT_TYPES,
  FARMOPS_NATIVE_KINDS,
  INSTALL_STATUSES,
  LABEL_STATUSES,
  ODS_EXTRAS_FIELD,
  PANEL_EXIT_SIDES,
  parsePercent,
  POWER_ASSET_TYPES,
  RACEWAY_ENVIRONMENTS,
  RACK_ROLES,
  type ElectricalEntityKind,
} from "@/lib/electrical";
import { parseBooleanCell } from "@/lib/electrical-boolean";
import { AMPS_SEMANTICS } from "@/lib/electrical-current-model";


import { classifyGrid } from "@/lib/electrical-grid";


export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "bool"
  | "select"
  | "entity"
  /**
   * Link to the authoritative FarmOps Inventory/Asset record for this physical
   * equipment. Infrastructure entities describe role and topology only — the
   * Asset system owns manufacturer, model, serial, cost, warranty, manuals,
   * maintenance schedules and lifecycle. Always optional: planned infrastructure
   * and non-inventoried passive structures exist without an Asset.
   */
  | "asset";

export interface EntityField {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  /** Shown in the compact list view. */
  list?: boolean;
  /**
   * For `kind: "entity"` — which electrical record this FK column points at.
   * The stored value is the target row's UUID; the UI always displays the
   * target's human-readable stable ID.
   */
  entityKind?: ElectricalEntityKind;
  /**
   * Legacy free-text reference retained for import/export compatibility. It is
   * displayed but not editable: the FK relationship is authoritative and the
   * database keeps this column in sync with it.
   */
  readOnly?: boolean;
  /**
   * Engineering value governed by the canonical electrical ODS. FarmOps shows a
   * caution before these are edited so Phase 4.1 never silently supersedes the
   * engineering release authority.
   */
  engineering?: boolean;
  /** Field-work fields are surfaced first on phone/tablet. */
  field?: boolean;
  hint?: string;
}

export interface EntityDef {
  kind: ElectricalEntityKind;
  table: string;
  stableIdField: string;
  stableIdLabel: string;
  title: string;
  singular: string;
  fields: EntityField[];
}

const statusFields: EntityField[] = [
  { key: "install_status", label: "Install status", kind: "select", options: INSTALL_STATUSES, list: true, field: true },
  { key: "completion_percent", label: "Complete %", kind: "number", list: true },
  { key: "label_status", label: "Label", kind: "select", options: LABEL_STATUSES, field: true },
  { key: "notes", label: "Notes", kind: "textarea", field: true },
];

/**
 * Phase 4.4a — infrastructure asset integration. The optional link to the
 * existing FarmOps Inventory/Asset record. Replacing the physical unit only
 * changes this link: the stable infrastructure ID, role and every relationship
 * stay exactly as they are.
 */
function assetLinkFields(what: string): EntityField[] {
  return [
    {
      key: "asset_uuid",
      label: "Inventory asset",
      kind: "asset",
      field: true,
      hint: `Optional. Link the Asset record for the installed ${what} — manufacturer, model, serial, cost, warranty, manuals, maintenance schedules and lifecycle all live there, not here. Swapping in a replacement Asset never changes this infrastructure ID or its topology.`,
    },
    {
      key: "asset_ref",
      label: "Asset name (derived)",
      kind: "text",
      list: true,
      readOnly: true,
      hint: "Derived from the linked inventory asset.",
    },
  ];
}

/**
 * Superseded by the Asset link above. Kept visible but read-only so historical
 * values entered before Phase 4.4a are never lost, while Inventory/Asset stays
 * the single authority for equipment identity.
 */
const supersededEquipmentFields: EntityField[] = [
  {
    key: "manufacturer",
    label: "Manufacturer (superseded)",
    kind: "text",
    readOnly: true,
    hint: "Inventory/Asset owns manufacturer — link an asset instead. Shown for records entered before the asset link existed.",
  },
  {
    key: "model",
    label: "Model (superseded)",
    kind: "text",
    readOnly: true,
    hint: "Inventory/Asset owns model — link an asset instead. Shown for records entered before the asset link existed.",
  },
];


export const ENTITIES: Record<ElectricalEntityKind, EntityDef> = {
  panel: {
    kind: "panel",
    table: "electrical_panels",
    stableIdField: "panel_id",
    stableIdLabel: "Panel ID",
    title: "Panels",
    singular: "panel",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      {
        key: "panel_kind",
        label: "Panel kind",
        kind: "select",
        options: ["physical", "logical"],
        list: true,
        hint: "Physical = panelboard equipment (enclosure, bus, breaker spaces). Logical = a critical-load / load-shedding grouping hosted on a physical panel; it has no bus, feeder or breaker spaces of its own.",
      },
      {
        key: "physical_panel_uuid",
        label: "Hosted on physical panel",
        kind: "entity",
        entityKind: "panel",
        hint: "Only for a logical panel: the real panelboard whose breakers supply its member circuits.",
      },
      {
        key: "logical_panel_note",
        label: "Logical grouping note",
        kind: "textarea",
      },
      { key: "building", label: "Building / location", kind: "text", list: true },
      { key: "grid", label: "Grid", kind: "text", list: true, readOnly: true, engineering: true, hint: "Grid is owned by the canonical electrical ODS." },
      { key: "bus_rating_amps", label: "Bus / main rating (A)", kind: "number" },
      { key: "voltage", label: "Voltage", kind: "number" },
      { key: "phase", label: "Phase", kind: "text" },
      { key: "spaces", label: "Spaces", kind: "number", list: true },
      { key: "circuits", label: "Circuits", kind: "number" },
      { key: "feeder_source", label: "Feeder / source", kind: "text" },
      { key: "backup_class", label: "Backup / generator class", kind: "text" },
      ...statusFields,
    ],
  },
  feeder: {
    kind: "feeder",
    table: "electrical_feeders",
    stableIdField: "feeder_id",
    stableIdLabel: "Feeder ID",
    title: "Feeders",
    singular: "feeder",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "source_panel_uuid", label: "Source panel (upstream)", kind: "entity", entityKind: "panel", field: true },
      {
        key: "source_endpoint_type",
        label: "Source endpoint type",
        kind: "select",
        options: ENDPOINT_TYPES,
      },
      {
        key: "source_endpoint_ref",
        label: "Source endpoint ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked record.",
      },
      { key: "dest_panel_uuid", label: "Fed panel (downstream)", kind: "entity", entityKind: "panel", field: true },
      {
        key: "dest_endpoint_type",
        label: "Destination endpoint type",
        kind: "select",
        options: ENDPOINT_TYPES,
      },
      {
        key: "dest_endpoint_ref",
        label: "Destination endpoint ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked record.",
      },
      { key: "raceway_uuid", label: "Raceway", kind: "entity", entityKind: "raceway", field: true },
      {
        key: "raceway_ref",
        label: "Raceway ID (legacy)",
        kind: "text",
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked raceway.",
      },
      { key: "service_type", label: "Service type", kind: "text", list: true },
      { key: "conductor_material", label: "Conductor material", kind: "text" },
      { key: "conductor_size", label: "Conductor size", kind: "text", list: true, engineering: true },
      { key: "conductor_count", label: "Conductor count", kind: "number", engineering: true },
      { key: "neutral_conductor", label: "Neutral conductor", kind: "text", engineering: true },
      { key: "ground_conductor", label: "Equipment grounding conductor", kind: "text", engineering: true },
      { key: "voltage", label: "Voltage", kind: "number", list: true, engineering: true },
      { key: "phase", label: "Phase", kind: "text", engineering: true },
      { key: "ampacity_amps", label: "Conductor ampacity (A)", kind: "number", engineering: true },
      { key: "ocp_rating_amps", label: "Overcurrent rating (A)", kind: "number", list: true, engineering: true },
      { key: "ocp_type", label: "Overcurrent device type", kind: "text", engineering: true },
      { key: "demand_basis", label: "Demand basis", kind: "text", engineering: true },
      { key: "demand_va", label: "Demand VA", kind: "number", engineering: true },
      { key: "planned_length_ft", label: "Planned length (ft)", kind: "number" },
      { key: "measured_length_ft", label: "Measured length (ft)", kind: "number", list: true, field: true },
      { key: "backup_class", label: "Backup / generator class", kind: "text" },
      { key: "critical", label: "Critical", kind: "bool" },
      { key: "future", label: "Future", kind: "bool" },
      ...statusFields,
    ],
  },
  raceway: {
    kind: "raceway",
    table: "electrical_raceways",
    stableIdField: "conduit_id",
    stableIdLabel: "Conduit ID",
    title: "Raceways",
    singular: "raceway",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "route_group", label: "Route group", kind: "text", list: true },
      { key: "from_label", label: "From", kind: "text", list: true },
      { key: "to_label", label: "To", kind: "text", list: true },
      { key: "purpose", label: "Purpose", kind: "text", list: true },
      { key: "service_type", label: "Service type", kind: "text", list: true },
      { key: "environment", label: "Environment", kind: "select", options: RACEWAY_ENVIRONMENTS, list: true },
      { key: "raceway_type", label: "Raceway type", kind: "text", list: true },
      { key: "trade_size", label: "Trade size", kind: "text", list: true },
      { key: "material", label: "Material", kind: "text", list: true },

      { key: "source_panel_uuid", label: "Source panel", kind: "entity", entityKind: "panel", field: true },
      { key: "source_jbox_uuid", label: "Source junction box", kind: "entity", entityKind: "jbox", field: true },
      { key: "source_endpoint_type", label: "Source endpoint type", kind: "select", options: ENDPOINT_TYPES },
      {
        key: "source_endpoint_ref",
        label: "Source endpoint ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked record.",
      },
      { key: "dest_panel_uuid", label: "Destination panel", kind: "entity", entityKind: "panel", field: true },
      { key: "dest_jbox_uuid", label: "Destination junction box", kind: "entity", entityKind: "jbox", field: true },
      { key: "dest_endpoint_type", label: "Destination endpoint type", kind: "select", options: ENDPOINT_TYPES },
      {
        key: "dest_endpoint_ref",
        label: "Destination endpoint ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked record.",
      },
      { key: "source_building", label: "Source building", kind: "text" },
      { key: "dest_building", label: "Destination building", kind: "text" },
      { key: "source_grid", label: "Source grid", kind: "text" },
      { key: "dest_grid", label: "Destination grid", kind: "text" },
      {
        key: "exit_order",
        label: "Physical exit order",
        kind: "number",
        field: true,
        hint: "Facing the panel: 1 is the lower-right corner, then counterclockwise. Independent of the Conduit ID.",
      },
      {
        key: "exit_side",
        label: "Physical exit position",
        kind: "select",
        options: PANEL_EXIT_SIDES,
        field: true,
      },
      { key: "exit_notes", label: "Panel exit notes", kind: "text" },
      { key: "planned_length_ft", label: "Planned length (ft)", kind: "number", list: true },
      { key: "measured_length_ft", label: "Measured length (ft)", kind: "number", list: true, field: true },
      { key: "circuit_refs", label: "Conductor / circuit refs", kind: "text", list: true },

      { key: "spare", label: "Spare / reserve", kind: "bool" },

      ...statusFields,
    ],
  },
  jbox: {
    kind: "jbox",
    table: "electrical_junction_boxes",
    stableIdField: "jbox_id",
    stableIdLabel: "J-box ID",
    title: "Junction boxes",
    singular: "junction box",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "building", label: "Building / location", kind: "text", list: true },
      { key: "grid", label: "Grid", kind: "text", list: true, readOnly: true, engineering: true, hint: "Grid is owned by the canonical electrical ODS." },
      { key: "elevation_zone", label: "Elevation / zone", kind: "text" },
      { key: "box_type", label: "Box type", kind: "text", list: true },
      { key: "dimensions", label: "Dimensions", kind: "text" },
      // Phase 4.4b — continuous raceway topology. One physical raceway passes
      // through several boxes in physical order; the link plus the position is
      // authoritative, the encoded ID only cross-checks it.
      {
        key: "raceway_uuid",
        label: "Parent raceway / path",
        kind: "entity",
        entityKind: "raceway",
        field: true,
        hint: "The continuous raceway this box sits on, e.g. CON-104 — NW EMT, 3/4\" EMT. Junction boxes along one physical run all share the same raceway.",
      },
      {
        key: "raceway_sequence",
        label: "Position on raceway",
        kind: "number",
        list: true,
        field: true,
        hint: "Physical order of this junction box along the continuous parent raceway. Example: JB-104-02 on CON-104 uses position 2.",
      },
      {
        key: "raceway_ref",
        label: "Parent raceway ID (derived)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Derived from the linked raceway. The link is authoritative.",
      },
      ...statusFields,
    ],
  },
  branch: {
    kind: "branch",
    table: "electrical_branch_runs",
    stableIdField: "branch_id",
    stableIdLabel: "Branch ID",
    title: "Branch runs",
    singular: "branch run",
    fields: [
      { key: "source_panel_uuid", label: "Source panel", kind: "entity", entityKind: "panel", field: true },
      { key: "source_jbox_uuid", label: "Source junction box", kind: "entity", entityKind: "jbox", field: true },
      { key: "source_endpoint_type", label: "Source endpoint type", kind: "select", options: ENDPOINT_TYPES },
      {
        key: "source_endpoint_ref",
        label: "Source endpoint ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked record.",
      },
      { key: "load_uuid", label: "Destination load", kind: "entity", entityKind: "load", field: true },
      {
        key: "circuit_group_uuid",
        label: "Circuit group",
        kind: "entity",
        entityKind: "circuit_group",
        engineering: true,
      },
      { key: "dest_endpoint_type", label: "Destination endpoint type", kind: "select", options: ENDPOINT_TYPES },
      {
        key: "dest_endpoint_ref",
        label: "Destination endpoint ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked record.",
      },
      { key: "wiring_method", label: "Wiring method", kind: "text", list: true },
      { key: "cable_type", label: "Cable / conductor type", kind: "text" },
      { key: "conductor_size", label: "Conductor size", kind: "text", list: true },
      { key: "conductor_count", label: "Conductor count", kind: "number" },
      { key: "ground_conductor", label: "Equipment grounding conductor", kind: "text" },
      { key: "voltage", label: "Voltage", kind: "number", engineering: true },
      { key: "circuit_rating_amps", label: "Circuit rating (A)", kind: "number", engineering: true },
      { key: "planned_length_ft", label: "Planned length (ft)", kind: "number" },
      { key: "measured_length_ft", label: "Measured length (ft)", kind: "number", list: true, field: true },
      { key: "path_notes", label: "Grid / path notes", kind: "text", field: true },
      { key: "device_side_connected", label: "Device side connected", kind: "bool", field: true },
      { key: "source_side_connected", label: "Source side connected", kind: "bool", field: true },

      ...statusFields,
    ],
  },
  load: {
    kind: "load",
    table: "electrical_loads",
    stableIdField: "load_id",
    stableIdLabel: "Load ID",
    title: "Loads",
    singular: "load",
    fields: [
      { key: "area", label: "Area", kind: "text", list: true },
      { key: "description", label: "Load description", kind: "text", list: true },
      { key: "count", label: "Count", kind: "number" },
      { key: "dedicated", label: "Dedicated circuit", kind: "bool", list: true },
      { key: "grid", label: "Grid", kind: "text", list: true, readOnly: true, engineering: true, hint: "Grid is owned by the canonical electrical ODS." },
      { key: "location", label: "Location", kind: "text" },
      {
        key: "logical_panel_uuid",
        label: "Logical panel (critical / load-shed grouping)",
        kind: "entity",
        entityKind: "panel",
        hint: "Grouping policy only. It never replaces the physical supply path: breaker position, circuit group and physical panel stay exactly as recorded.",
      },
      {
        key: "logical_panel_ref",
        label: "Logical panel ID",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Derived from the linked logical panel.",
      },
      {
        key: "circuit_group_uuid",
        label: "Circuit group",
        kind: "entity",
        entityKind: "circuit_group",
        engineering: true,
      },
      {
        key: "circuit_group_ref",
        label: "Circuit group ID (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked circuit group.",
      },
      {
        key: "source_circuit",
        label: "Source circuit (Load_Master)",
        kind: "text",
        list: true,
        hint: "Circuit reference as released in the canonical workbook.",
      },
      {
        key: "equipment_model",
        label: "Equipment / model",
        kind: "text",
        list: true,
        engineering: true,
        hint: "Equipment / Model as released in the canonical workbook.",
      },
      {
        key: "source_reference",
        label: "Source / reference",
        kind: "text",
        engineering: true,
        hint: "Source / Reference citation as released in the canonical workbook.",
      },
      {
        key: "suggested_panel",
        label: "Suggested panel",
        kind: "text",
        engineering: true,
        hint: "Panel suggested by the canonical workbook for this load.",
      },
      {
        key: "dedicated_shared",
        label: "Dedicated / shared (D/S)",
        kind: "text",
        engineering: true,
        hint: 'Canonical D/S column. Tri-state text: "Dedicated", "Shared" or "TBD" — never coerced to yes/no.',
      },

      {
        key: "amps",
        label: "Amps (legacy)",
        kind: "number",
        engineering: true,
        hint: "Legacy overloaded scalar. Semantically unresolved unless amps_semantic + provenance are set. Never rewritten or backfilled.",
      },
      // Phase 4.4b — additive current semantic model. All nullable; nothing is
      // backfilled from the legacy amps column.
      {
        key: "amps_semantic",
        label: "Legacy amps meaning",
        kind: "select",
        options: AMPS_SEMANTICS,
        engineering: true,
        hint: "Only set when provenance independently establishes what the legacy amps value means. Numeric equality is not provenance.",
      },
      {
        key: "amps_semantic_provenance",
        label: "Legacy amps provenance",
        kind: "textarea",
        engineering: true,
      },
      { key: "connected_load_current", label: "Connected load current (A)", kind: "number", engineering: true },
      { key: "equipment_fla", label: "Equipment FLA (A)", kind: "number", engineering: true },
      { key: "rated_current_amps", label: "Rated current / RCA (A)", kind: "number", engineering: true },
      { key: "rated_load_amps", label: "Rated load amps / RLA (A)", kind: "number", engineering: true },
      {
        key: "minimum_circuit_ampacity",
        label: "Minimum circuit ampacity (A)",
        kind: "number",
        engineering: true,
        hint: "Nameplate MCA only — never derived.",
      },
      {
        key: "maximum_overcurrent_protection",
        label: "Maximum overcurrent protection (A)",
        kind: "number",
        engineering: true,
        hint: "Nameplate MOCP only — never inferred from the installed breaker.",
      },
      { key: "installed_ocp_rating", label: "Installed OCP rating (A)", kind: "number", engineering: true },
      { key: "design_circuit_ampacity", label: "Design circuit ampacity (A)", kind: "number", engineering: true },

      { key: "volts", label: "Volts", kind: "number", engineering: true },
      { key: "connected_va", label: "Connected VA", kind: "number", engineering: true },
      { key: "demand_basis", label: "Demand basis", kind: "text", engineering: true },
      { key: "demand_va", label: "Demand VA", kind: "number", engineering: true },
      { key: "phase", label: "Phase", kind: "text", engineering: true },

      { key: "critical", label: "Critical", kind: "bool" },
      { key: "future", label: "Future", kind: "bool" },
      { key: "continuous_load", label: "Continuous load", kind: "bool" },
      { key: "backup_eligible", label: "Backup eligible", kind: "bool" },
      { key: "backup_priority", label: "Backup priority", kind: "text" },
      { key: "backup_panel", label: "Backup panel", kind: "text" },
      { key: "load_shed_group", label: "Load shed group", kind: "text" },
      ...statusFields,
    ],
  },
  circuit_group: {
    kind: "circuit_group",
    table: "electrical_circuit_groups",
    stableIdField: "circuit_group_id",
    stableIdLabel: "Circuit group ID",
    title: "Circuit groups",
    singular: "circuit group",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      {
        key: "panel_uuid",
        label: "Assigned panel",
        kind: "entity",
        entityKind: "panel",
        engineering: true,
      },
      {
        key: "suggested_panel",
        label: "Suggested panel (legacy)",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Kept for ODS compatibility. Derived from the linked panel.",
      },
      {
        key: "logical_panel_uuid",
        label: "Logical panel (critical / load-shed grouping)",
        kind: "entity",
        entityKind: "panel",
        hint: "Grouping policy only. It never replaces the physical supply path: breaker position, circuit group and physical panel stay exactly as recorded.",
      },
      {
        key: "logical_panel_ref",
        label: "Logical panel ID",
        kind: "text",
        list: true,
        readOnly: true,
        hint: "Derived from the linked logical panel.",
      },
      { key: "breaker_number", label: "Breaker number", kind: "number", list: true, engineering: true },
      { key: "breaker_position", label: "Physical position", kind: "text", list: true },
      { key: "circuit_rating_amps", label: "Circuit rating (A)", kind: "number", engineering: true },
      { key: "voltage", label: "Voltage", kind: "number", engineering: true },
      { key: "phase", label: "Phase", kind: "text", engineering: true },
      { key: "demand_basis", label: "Demand basis", kind: "text", engineering: true },
      { key: "demand_va", label: "Demand VA", kind: "number", engineering: true },

      { key: "continuous_load", label: "Continuous load", kind: "bool" },
      { key: "critical", label: "Critical", kind: "bool" },
      { key: "backup_eligible", label: "Backup eligible", kind: "bool" },
      { key: "backup_priority", label: "Backup priority", kind: "text" },
      { key: "backup_panel", label: "Backup panel", kind: "text" },
      { key: "load_shed_group", label: "Load shed group", kind: "text" },
      { key: "generator_start_class", label: "Generator start class", kind: "text" },
      { key: "generator_start_amps", label: "Generator start amps", kind: "number" },
      ...statusFields,
    ],
  },

  // ---------------------------------------------------------------------------
  // FarmOps-native infrastructure. Reusable by design: a rack's purpose and a
  // power asset's type are data, so network, ham radio or any future rack needs
  // no schema exception. These entities have no canonical ODS counterpart.
  // ---------------------------------------------------------------------------
  rack: {
    kind: "rack",
    table: "electrical_racks",
    stableIdField: "rack_id",
    stableIdLabel: "Rack ID",
    title: "Equipment racks",
    singular: "equipment rack",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "rack_role", label: "Rack role", kind: "select", options: RACK_ROLES, list: true, hint: "Controlled infrastructure class; the same token used in RACK-<SITE>-<ROLE>-##." },
      { key: "site_area", label: "Site / area", kind: "text", list: true, hint: "Controlled location code used in the rack ID: FS, PH, BLR, HSE, SITE." },
      { key: "building", label: "Building", kind: "text", list: true },
      { key: "grid", label: "Grid", kind: "text" },
      { key: "location_note", label: "Physical location", kind: "text", field: true },
      { key: "rack_size_u", label: "Rack size (U)", kind: "number" },
      { key: "mounting", label: "Mounting", kind: "text", hint: "Floor, wall, open frame, …" },
      ...assetLinkFields("rack, when the rack itself is inventory-managed"),
      ...statusFields,
    ],
  },
  power_asset: {
    kind: "power_asset",
    table: "electrical_power_assets",
    stableIdField: "power_asset_id",
    stableIdLabel: "Power asset ID",
    title: "Power assets",
    singular: "power distribution asset",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "asset_type", label: "Asset type", kind: "select", options: POWER_ASSET_TYPES, list: true },
      ...assetLinkFields("power equipment"),
      ...supersededEquipmentFields,
      { key: "rack_uuid", label: "Installed in rack", kind: "entity", entityKind: "rack", field: true },
      { key: "rack_ref", label: "Rack ID (derived)", kind: "text", readOnly: true, hint: "Derived from the linked rack." },
      { key: "input_type", label: "Input type", kind: "select", options: CURRENT_TYPES },
      { key: "input_voltage", label: "Input voltage", kind: "number" },
      { key: "input_current_amps", label: "Input current / rating (A)", kind: "number" },
      { key: "output_type", label: "Output type", kind: "select", options: CURRENT_TYPES },
      { key: "output_voltage", label: "Output voltage", kind: "number", list: true },
      { key: "output_current_amps", label: "Output current / rating (A)", kind: "number", list: true },
      { key: "capacity_note", label: "Capacity note", kind: "text" },
      // Upstream electrical source: whichever level is actually known. Nothing
      // is inferred, so an unknown upstream simply stays unset.
      { key: "source_panel_uuid", label: "Upstream panel", kind: "entity", entityKind: "panel", field: true },
      { key: "source_panel_ref", label: "Panel ID (derived)", kind: "text", readOnly: true },
      { key: "source_circuit_group_uuid", label: "Upstream circuit", kind: "entity", entityKind: "circuit_group", field: true },
      { key: "source_circuit_group_ref", label: "Circuit ID (derived)", kind: "text", readOnly: true },
      { key: "source_load_uuid", label: "Upstream load / outlet", kind: "entity", entityKind: "load", field: true },
      { key: "source_load_ref", label: "Load ID (derived)", kind: "text", readOnly: true },
      { key: "source_branch_uuid", label: "Upstream branch run", kind: "entity", entityKind: "branch", field: true },
      { key: "source_branch_ref", label: "Branch ID (derived)", kind: "text", readOnly: true },
      { key: "upstream_power_asset_uuid", label: "Fed from power asset", kind: "entity", entityKind: "power_asset", hint: "e.g. a PDU fed from a UPS." },
      { key: "upstream_power_asset_ref", label: "Upstream asset ID (derived)", kind: "text", readOnly: true },
      { key: "building", label: "Building", kind: "text", list: true },
      { key: "grid", label: "Grid", kind: "text" },
      { key: "location_note", label: "Physical location", kind: "text" },
      ...statusFields,
    ],
  },
  device: {
    kind: "device",
    table: "electrical_devices",
    stableIdField: "device_id",
    stableIdLabel: "Device ID",
    title: "Powered devices",
    singular: "device",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "device_role", label: "Device role", kind: "select", options: DEVICE_ROLES, list: true },
      { key: "device_type", label: "Device type", kind: "text", hint: "Switch, transceiver, router, … Network roles use the ID tokens SW, RTR, AP, FW, BR, ONT." },
      ...assetLinkFields("device"),
      ...supersededEquipmentFields,
      { key: "rack_uuid", label: "Installed in rack", kind: "entity", entityKind: "rack", field: true },
      { key: "rack_ref", label: "Rack ID (derived)", kind: "text", readOnly: true },
      { key: "rack_position_u", label: "Rack position (U)", kind: "number" },
      // Immediate power source and upstream electrical source are preserved
      // separately so failure domains stay computable.
      { key: "power_asset_uuid", label: "Immediate power source", kind: "entity", entityKind: "power_asset", list: true, field: true },
      { key: "power_asset_ref", label: "Power asset ID (derived)", kind: "text", readOnly: true },
      { key: "circuit_group_uuid", label: "Upstream circuit", kind: "entity", entityKind: "circuit_group", field: true },
      { key: "circuit_group_ref", label: "Circuit ID (derived)", kind: "text", readOnly: true },
      { key: "load_uuid", label: "Upstream load / outlet", kind: "entity", entityKind: "load" },
      { key: "load_ref", label: "Load ID (derived)", kind: "text", readOnly: true },
      { key: "uplink_device_uuid", label: "Network uplink device", kind: "entity", entityKind: "device" },
      { key: "uplink_device_ref", label: "Uplink device ID (derived)", kind: "text", readOnly: true },
      { key: "input_voltage", label: "Input voltage", kind: "number" },
      { key: "input_current_amps", label: "Input current (A)", kind: "number" },
      { key: "hostname", label: "Hostname", kind: "text" },
      { key: "address", label: "Address", kind: "text", hint: "IP, callsign or other addressing." },
      { key: "building", label: "Building", kind: "text", list: true },
      { key: "grid", label: "Grid", kind: "text" },
      { key: "location_note", label: "Physical location", kind: "text" },
      ...statusFields,
    ],
  },
};

/**
 * Phase 4.4a — lossless capture. Every ODS-backed entity gets the verbatim
 * preservation column so a canonical workbook column with no dedicated FarmOps
 * field is still stored (keyed by its exact workbook header) rather than
 * dropped. It is read-only: the importer writes it, the forms never do.
 * FarmOps-native kinds (racks, power assets, devices) are never imported from
 * the workbook, so they do not carry it.
 */
for (const kind of Object.keys(ENTITIES) as ElectricalEntityKind[]) {
  if (FARMOPS_NATIVE_KINDS.has(kind)) continue;
  ENTITIES[kind].fields.push({
    key: ODS_EXTRAS_FIELD,
    label: "Preserved workbook columns",
    kind: "textarea",
    readOnly: true,
    engineering: true,
    hint: "Canonical ODS columns with no dedicated FarmOps field, preserved verbatim as JSON by the workbook import.",
  });
}

export const ENTITY_KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];


/**
 * Columns the server accepts for a kind — anything else is dropped. Legacy
 * read-only reference columns are excluded: the database derives them from the
 * authoritative FK relationships.
 */
export function writableColumns(kind: ElectricalEntityKind): string[] {
  const def = ENTITIES[kind];
  return [def.stableIdField, ...def.fields.filter((f) => !f.readOnly).map((f) => f.key)];
}

/**
 * Columns accepted from a canonical ODS import. The spreadsheet remains the
 * engineering authority, so it may still set the legacy stable-ID reference
 * columns that the in-app forms treat as derived.
 */
export function importColumns(kind: ElectricalEntityKind): string[] {
  const def = ENTITIES[kind];
  return [
    def.stableIdField,
    // Relationship and Inventory/Asset links are established in FarmOps, never
    // set by a workbook column.
    ...def.fields.filter((f) => f.kind !== "entity" && f.kind !== "asset").map((f) => f.key),
  ];
}

/** The Inventory/Asset link field for a kind, when it has one. */
export function assetLinkField(kind: ElectricalEntityKind): EntityField | undefined {
  return ENTITIES[kind].fields.find((f) => f.kind === "asset");
}

/** Relationship (FK) fields for a kind, in display order. */
export function relationshipFields(kind: ElectricalEntityKind): EntityField[] {
  return ENTITIES[kind].fields.filter((f) => f.kind === "entity");
}

/** Fields most useful during field entry on a phone or tablet. */
export function fieldEntryFields(kind: ElectricalEntityKind): EntityField[] {
  return ENTITIES[kind].fields.filter((f) => f.field);
}


export function coerceValue(field: EntityField, raw: unknown): unknown {
  // Yes/No engineering fields are tri-state: "N" is false, blank/TBD is null
  // ("not stated"). Never fall back to Boolean(raw), which turned the text "N"
  // into true and a blank cell into false.
  if (field.kind === "bool") return parseBooleanCell(raw).value;

  if (field.key === "grid") {
    const g = classifyGrid(raw);
    return g.value;
  }

  if (field.kind === "number") {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    // Spreadsheet cells arrive as display text: "1,250", "85 %", "3/4"" etc.
    // A percent-formatted cell can render as "85%" or as the raw fraction 0.85.
    if (field.key === "completion_percent" || s.includes("%")) return parsePercent(s);
    const bare = s.replace(/[\s,]/g, "");
    const direct = Number(bare);
    if (Number.isFinite(direct)) return direct;
    // Engineering cells carry units and multi-value notation: "200 A",
    // "240V 1Ph", "120/240V". Pull the numeric tokens rather than dropping the
    // whole value, and take the nominal (highest) figure for voltages such as
    // "120/240" where the panel rating is the larger number.
    const tokens = (bare.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
    if (!tokens.length) return null;
    return field.key === "voltage" ? Math.max(...tokens) : tokens[0];
  }

  const s = String(raw ?? "").trim();
  return s || null;
}

