// Field descriptors for the electrical entities. Both the UI (generic list /
// edit forms) and the server functions (column whitelists) read from here, so
// there is exactly one definition of each entity's shape.
import {
  ENDPOINT_TYPES,
  INSTALL_STATUSES,
  LABEL_STATUSES,
  PANEL_EXIT_SIDES,
  RACEWAY_ENVIRONMENTS,
  type ElectricalEntityKind,
} from "@/lib/electrical";


export type FieldKind = "text" | "textarea" | "number" | "bool" | "select" | "entity";

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
      { key: "building", label: "Building / location", kind: "text", list: true },
      { key: "grid", label: "Grid", kind: "text", list: true },
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
  raceway: {
    kind: "raceway",
    table: "electrical_raceways",
    stableIdField: "conduit_id",
    stableIdLabel: "Conduit ID",
    title: "Raceways",
    singular: "raceway",
    fields: [
      { key: "description", label: "Description", kind: "text", list: true },
      { key: "environment", label: "Environment", kind: "select", options: RACEWAY_ENVIRONMENTS, list: true },
      { key: "raceway_type", label: "Raceway type", kind: "text" },
      { key: "trade_size", label: "Trade size", kind: "text", list: true },
      { key: "material", label: "Material", kind: "text" },
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
      { key: "planned_length_ft", label: "Planned length (ft)", kind: "number" },
      { key: "measured_length_ft", label: "Measured length (ft)", kind: "number", list: true, field: true },
      { key: "circuit_refs", label: "Conductor / circuit refs", kind: "text" },
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
      { key: "grid", label: "Grid", kind: "text", list: true },
      { key: "elevation_zone", label: "Elevation / zone", kind: "text" },
      { key: "box_type", label: "Box type", kind: "text", list: true },
      { key: "dimensions", label: "Dimensions", kind: "text" },
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
      { key: "grid", label: "Grid", kind: "text", list: true },
      { key: "location", label: "Location", kind: "text" },
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
      { key: "amps", label: "Amps", kind: "number", engineering: true },
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
};

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

/** Relationship (FK) fields for a kind, in display order. */
export function relationshipFields(kind: ElectricalEntityKind): EntityField[] {
  return ENTITIES[kind].fields.filter((f) => f.kind === "entity");
}

/** Fields most useful during field entry on a phone or tablet. */
export function fieldEntryFields(kind: ElectricalEntityKind): EntityField[] {
  return ENTITIES[kind].fields.filter((f) => f.field);
}


export function coerceValue(field: EntityField, raw: unknown): unknown {
  if (field.kind === "bool") return Boolean(raw);
  if (field.kind === "number") {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(raw ?? "").trim();
  return s || null;
}
