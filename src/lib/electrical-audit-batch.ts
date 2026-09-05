// FARMOPS-ELEC-AUDIT-BATCH-V1 — pure logic for the bulk electrical field audit.
//
// Everything in this module is deterministic and side-effect free so that
// import, validation, classification, preview diffing, ODS candidate export and
// compensating-batch generation are unit testable without a database.
//
// Authority boundaries this module enforces:
//   ODS       — engineering design / planned values. Never written from a field
//               audit; a planned observation becomes an ODS *candidate* only.
//   FarmOps   — approved field / as-built observations, install state, physical
//               breaker positions and relational as-built topology.
//   Generated — derived rollups. Never imported as facts.
import { z } from "zod";

import {
  checkStableId,
  encodedBranchOrigin,
  parseHierarchicalId,
  type ElectricalEntityKind,
} from "@/lib/electrical";
import { diffFieldChanges, type FieldChange } from "@/lib/electrical-dependents";
import { breakerRelationshipLabel } from "@/lib/electrical-breaker-reference";
import { checkSwitchControlId } from "@/lib/electrical-switch-controls";

/** JSON-safe value: server functions serialize these across the wire. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export const AUDIT_BATCH_SCHEMA_VERSION = "farmops.electrical.audit-batch.v1";
export const AUDIT_BATCH_GATE_VERSION = "FARMOPS-ELEC-AUDIT-BATCH-V1";

/* ------------------------------------------------------------------ *
 * Pole grid location model (FS_POLE_GRID_V1)
 * ------------------------------------------------------------------ */

export const POLE_SCHEME = "FS_POLE_GRID_V1";

/** The only accepted perimeter post references, in clockwise order. */
export const POLE_SEQUENCE = [
  "01NE",
  "02NE",
  "03NE",
  "04SE",
  "05SE",
  "06SE",
  "07SE",
  "08SE",
  "09SE",
  "10S",
  "11S",
  "12SW",
  "13SW",
  "14SW",
  "15SW",
  "16SW",
  "17NW",
  "18NW",
  "19NW",
  "20NW",
  "21NW",
  "22N",
  "23N",
  "24NE",
  "25NE",
  "26NE",
] as const;

export type PoleRef = (typeof POLE_SEQUENCE)[number];

export const POLE_CORNERS: readonly string[] = ["01NE", "06SE", "14SW", "19NW"];

export const POLE_LOCATION_KINDS = ["AT_POST", "BETWEEN_POSTS", "NOT_APPLICABLE"] as const;
export type PoleLocationKind = (typeof POLE_LOCATION_KINDS)[number];

export interface PoleObservation {
  pole_scheme?: string | null;
  pole_location_kind: PoleLocationKind;
  pole_ref_start?: string | null;
  pole_ref_end?: string | null;
}

const norm = (v: unknown) => (v == null ? "" : String(v)).trim().toUpperCase();

export function isPoleRef(raw: unknown): boolean {
  return (POLE_SEQUENCE as readonly string[]).includes(norm(raw));
}

/** Adjacent in the clockwise sequence (the ring wraps 26NE → 01NE). */
export function polesAdjacent(a: unknown, b: unknown): boolean {
  const seq = POLE_SEQUENCE as readonly string[];
  const i = seq.indexOf(norm(a));
  const j = seq.indexOf(norm(b));
  if (i < 0 || j < 0) return false;
  const n = seq.length;
  return (i + 1) % n === j || (j + 1) % n === i;
}

/** Human token: `03NE` at a post, `04SE/05SE` between two posts. */
export function poleToken(p: PoleObservation | null | undefined): string {
  if (!p) return "";
  if (p.pole_location_kind === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (p.pole_location_kind === "AT_POST") return norm(p.pole_ref_start);
  return `${norm(p.pole_ref_start)}/${norm(p.pole_ref_end)}`;
}

/** Validation errors for one structured pole observation. Empty = valid. */
export function validatePole(p: PoleObservation | null | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  const scheme = (p.pole_scheme ?? POLE_SCHEME).trim();
  if (scheme !== POLE_SCHEME) {
    out.push(`Unknown pole scheme "${scheme}". Only ${POLE_SCHEME} is accepted.`);
  }
  const start = norm(p.pole_ref_start);
  const end = norm(p.pole_ref_end);

  if (p.pole_location_kind === "AT_POST") {
    if (!start) out.push("AT_POST requires a start post reference.");
    else if (!isPoleRef(start)) out.push(`${start} is not a valid post in ${POLE_SCHEME}.`);
    if (end) out.push("AT_POST must not carry an end post reference.");
    return out;
  }
  if (p.pole_location_kind === "BETWEEN_POSTS") {
    if (!start || !end) {
      out.push("BETWEEN_POSTS requires both a start and an end post reference.");
      return out;
    }
    if (!isPoleRef(start)) out.push(`${start} is not a valid post in ${POLE_SCHEME}.`);
    if (!isPoleRef(end)) out.push(`${end} is not a valid post in ${POLE_SCHEME}.`);
    if (out.length) return out;
    if (start === end) out.push("BETWEEN_POSTS requires two different posts.");
    else if (!polesAdjacent(start, end)) {
      out.push(`${start} and ${end} are not adjacent in the clockwise post sequence.`);
    }
    return out;
  }
  // NOT_APPLICABLE
  if (start || end) {
    out.push("NOT_APPLICABLE requires both post references to be empty.");
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Field grid references (fractional cells allowed)
 * ------------------------------------------------------------------ */

export interface FieldGridRef {
  raw: string;
  row: string;
  column: number;
  fractional: boolean;
}

/**
 * Audit coordinates may be fractional (F3.5, D2.5). They are preserved in the
 * field-location layer and never coerced into the integer legacy `grid` field.
 */
export function parseFieldGrid(raw: unknown): FieldGridRef | null {
  const id = norm(raw);
  const m = /^([A-Z])((?:\d{1,2})(?:\.5)?)$/.exec(id);
  if (!m) return null;
  const column = Number(m[2]);
  if (!Number.isFinite(column) || column <= 0) return null;
  return { raw: id, row: m[1], column, fractional: !Number.isInteger(column) };
}

/* ------------------------------------------------------------------ *
 * Observation classes, operations, dispositions
 * ------------------------------------------------------------------ */

export const OBSERVATION_CLASSES = [
  "FIELD_AS_BUILT",
  "ROUGH_IN",
  "TEMPORARY",
  "PLANNED_DESIGN",
  "APPROVED_PLANNED_DESIGN",
  "PROPOSED_RESEARCH",
  "HOLD_UNRESOLVED",
] as const;
export type ObservationClass = (typeof OBSERVATION_CLASSES)[number];

export const AUDIT_OPERATIONS = [
  "CREATE",
  "UPDATE",
  "LINK",
  "NO_CHANGE",
  "HOLD_UNRESOLVED",
  "CONFLICT",
  "ODS_CORRECTION_CANDIDATE",
] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

export const AUDIT_DISPOSITIONS = [
  "ready",
  "no_change",
  "hold",
  "conflict",
  "ods_candidate",
  "applied",
  "failed",
] as const;
export type AuditDisposition = (typeof AUDIT_DISPOSITIONS)[number];

/** Only these dispositions may ever be selected by the owner for apply. */
export function selectable(d: AuditDisposition): boolean {
  return d === "ready";
}

/* ------------------------------------------------------------------ *
 * Install state vocabulary
 * ------------------------------------------------------------------ */

export const AUDIT_INSTALL_STATES = [
  "as_built_verified",
  "installed",
  "rough_in",
  "temporary",
  "planned",
  "not_wired",
] as const;
export type AuditInstallState = (typeof AUDIT_INSTALL_STATES)[number];

/**
 * Map the audit vocabulary onto the existing FarmOps `install_status` column.
 * Only `installed` and `as_built_verified` may reach a completed status —
 * rough-in, temporary and not-wired states must never display as a finished
 * installation, and energized status is never inferred from conductor presence.
 *
 * A FIELD_AS_BUILT observation that explicitly traced a load as physically
 * connected to an installed breaker/circuit group advances the load straight to
 * `complete`: the intermediate material-ready / rough-in stages exist for work
 * being tracked forward, and are never required retroactively for an
 * installation that field evidence already found finished.
 */
export const INSTALL_STATE_TO_FARMOPS: Record<AuditInstallState, string> = {
  as_built_verified: "as_built_verified",
  installed: "complete",
  rough_in: "rough_in_started",
  temporary: "conductors_installed",
  planned: "planned",
  not_wired: "planned",
};

/** Install states that are legal for a given observation class. */
export function installStatesFor(cls: ObservationClass): AuditInstallState[] {
  if (cls === "FIELD_AS_BUILT") return ["as_built_verified", "installed", "not_wired"];
  if (cls === "ROUGH_IN") return ["rough_in", "not_wired"];
  if (cls === "TEMPORARY") return ["temporary"];
  return ["planned", "not_wired"];
}

/* ------------------------------------------------------------------ *
 * Entity targets and writable columns
 * ------------------------------------------------------------------ */

export type AuditEntityKind =
  | "panel"
  | "breaker_position"
  | "circuit_group"
  | "raceway"
  | "jbox"
  | "branch"
  | "load"
  | "switch_bank"
  | "switch_device"
  | "control_group"
  | "control_target"
  | "control_wiring_segment";

/** Apply order: parents before the records that reference them. */
export const APPLY_ORDER: readonly AuditEntityKind[] = [
  "panel",
  "breaker_position",
  "circuit_group",
  "raceway",
  "jbox",
  "branch",
  "load",
  "switch_bank",
  "control_group",
  "switch_device",
  "control_target",
  "control_wiring_segment",
];

const LOCATION_FIELDS = [
  "pole_scheme",
  "pole_location_kind",
  "pole_ref_start",
  "pole_ref_end",
  "field_grid_reference",
  "field_verification_status",
  "verification_notes",
  "location_evidence",
  "verified_at",
];

const STATE_FIELDS = ["install_status", "label_status", "completion_percent", "notes"];

/**
 * Deterministic metadata consequences of a confirmed FIELD_AS_BUILT load
 * observation. They are *consequences of authoritative relationships*, never
 * inferences: sharing follows from how many loads occupy the approved circuit
 * group, and building context follows from the panel the group is on. They are
 * writable only for a FIELD_AS_BUILT observation.
 */
export const AS_BUILT_CONSEQUENCE_FIELDS = ["dedicated_shared", "dedicated", "location"] as const;

/**
 * Legacy outlet current metadata a FIELD_AS_BUILT observation may clear once the
 * audited circuit-group relationship establishes that the recorded amperage was
 * a branch-circuit rating rather than the outlet's own load current. Clearing is
 * the only correction this permits: a null value means "not recorded", never
 * zero load and never zero circuit capacity. Writable for FIELD_AS_BUILT only.
 */
export const LEGACY_CURRENT_METADATA_FIELDS = [
  "amps",
  "connected_va",
  "amps_semantic",
  "amps_semantic_provenance",
] as const;

/**
 * Fields an APPROVED_PLANNED_DESIGN observation may write on a load. These are
 * approved *design* facts — a structured planned location, its corner/face
 * geometry, mounting classification and height, the proposed physical source
 * panel, and the logical resilience/load-shed classification. They never claim
 * field verification, never advance a lifecycle state and never touch the
 * equipment description, breaker or circuit-group identity.
 */
export const APPROVED_PLANNED_DESIGN_FIELDS = [
  "location",
  "design_location_source",
  "corner_reference",
  "mounting_wall_face",
  "coverage_direction",
  "mounting_classification",
  "mounting_height_ft",
  "design_x_ft",
  "design_y_ft",
  "design_grid",
  "suggested_panel",
  "resilience_class",
  "load_shed_capable",
  "dedicated",
  "dedicated_shared",
  "notes",
] as const;

/** Fields only a FIELD_AS_BUILT load observation may write. */
export const FIELD_AS_BUILT_ONLY_FIELDS = [
  ...AS_BUILT_CONSEQUENCE_FIELDS,
  ...LEGACY_CURRENT_METADATA_FIELDS,
] as const;



export interface EntityTarget {
  table: string;
  stableIdColumn: string | null;
  /** Entity kind used for stable-ID validation, when one applies. */
  idKind: ElectricalEntityKind | null;
  /** Switch/control stable-ID family, when the kind uses one. */
  switchIdKind?: "switch_bank" | "switch_device" | "control_group";
  /** Columns a field audit may ever write. Everything else is ODS-owned. */
  writable: readonly string[];
  /** Relational link columns (used to classify an item as LINK). */
  links: readonly string[];
  /** CREATE is only legal for the physical as-built child records. */
  creatable: boolean;
  title: string;
}

export const AUDIT_ENTITY_TARGETS: Record<AuditEntityKind, EntityTarget> = {
  panel: {
    table: "electrical_panels",
    stableIdColumn: "panel_id",
    idKind: "panel",
    writable: [...STATE_FIELDS, ...LOCATION_FIELDS],
    links: [],
    creatable: false,
    title: "Panels",
  },
  breaker_position: {
    table: "electrical_breaker_positions",
    stableIdColumn: null,
    idKind: null,
    writable: [
      "side",
      "position",
      "breaker_number",
      "poles",
      "ocp_amps",
      "label",
      "panel_uuid",
      "circuit_group_uuid",
      "load_uuid",
      ...STATE_FIELDS,
    ],
    links: ["panel_uuid", "circuit_group_uuid", "load_uuid"],
    creatable: true,
    title: "Breaker positions",
  },
  circuit_group: {
    table: "electrical_circuit_groups",
    stableIdColumn: "circuit_group_id",
    idKind: "circuit_group",
    writable: [
      "panel_uuid",
      // Observed circuit label (blue tape / panel schedule text). It is a field
      // observation, never part of the permanent CG-<site>-### identity.
      "description",
      "breaker_number",
      "breaker_position",
      "circuit_rating_amps",
      ...STATE_FIELDS,
    ],
    links: ["panel_uuid"],
    creatable: true,
    title: "Circuit groups",
  },
  raceway: {
    table: "electrical_raceways",
    stableIdColumn: "raceway_id",
    idKind: "raceway",
    writable: [...STATE_FIELDS],
    links: [],
    creatable: false,
    title: "Raceways",
  },
  jbox: {
    table: "electrical_junction_boxes",
    stableIdColumn: "jbox_id",
    idKind: "jbox",
    writable: ["raceway_uuid", "raceway_sequence", ...STATE_FIELDS, ...LOCATION_FIELDS],
    links: ["raceway_uuid"],
    creatable: true,
    title: "Junction boxes",
  },
  branch: {
    table: "electrical_branch_runs",
    stableIdColumn: "branch_id",
    idKind: "branch",
    writable: [
      "source_endpoint_type",
      "source_endpoint_ref",
      "source_panel_uuid",
      "source_jbox_uuid",
      "dest_endpoint_type",
      "dest_endpoint_ref",
      "load_uuid",
      "circuit_group_uuid",
      "device_side_connected",
      "source_side_connected",
      "measured_length_ft",
      ...STATE_FIELDS,
    ],
    links: [
      "source_panel_uuid",
      "source_jbox_uuid",
      "load_uuid",
      "circuit_group_uuid",
    ],
    creatable: true,
    title: "Branch runs",
  },
  load: {
    table: "electrical_loads",
    stableIdColumn: "load_id",
    idKind: "load",
    writable: [
      "circuit_group_uuid",
      "circuit_group_ref",
      "source_circuit",
      ...APPROVED_PLANNED_DESIGN_FIELDS,
      ...FIELD_AS_BUILT_ONLY_FIELDS,
      ...STATE_FIELDS,
      ...LOCATION_FIELDS,
    ],
    links: ["circuit_group_uuid"],
    creatable: false,
    title: "Loads",
  },
  // ---- Switching and control topology (FARMOPS-ELEC-SWITCH-CONTROL-V1) ----
  // A switching device is never a load and a control group is never a circuit
  // group. Raceway or cable presence never advances a device past planned, so
  // component states are written individually from explicit observation.
  switch_bank: {
    table: "electrical_switch_banks",
    stableIdColumn: "switch_bank_id",
    idKind: null,
    switchIdKind: "switch_bank",
    writable: [
      "description",
      "building",
      "location_note",
      "enclosure_type",
      "gang_count",
      "installed_device_count",
      "supplying_circuit_group_uuid",
      "source_jbox_uuid",
      "lifecycle_status",
      "box_state",
      "raceway_state",
      "conductors_state",
      "devices_state",
      "termination_state",
      "function_test_state",
      "evidence",
      "notes",
      ...LOCATION_FIELDS,
    ],
    links: ["supplying_circuit_group_uuid", "source_jbox_uuid"],
    creatable: true,
    title: "Switch banks",
  },
  switch_device: {
    table: "electrical_switch_devices",
    stableIdColumn: "switch_device_id",
    idKind: null,
    switchIdKind: "switch_device",
    writable: [
      "description",
      "switch_bank_uuid",
      "gang_position",
      "switch_type",
      "poles",
      "switching_arrangement",
      "rated_voltage",
      "rated_current_amps",
      "supplying_circuit_group_uuid",
      "control_group_uuid",
      "is_disconnecting_means",
      "disconnecting_means_verified",
      "lifecycle_status",
      "device_state",
      "termination_state",
      "function_test_state",
      "design_only",
      "evidence",
      "notes",
      "field_verification_status",
    ],
    links: ["switch_bank_uuid", "supplying_circuit_group_uuid", "control_group_uuid"],
    creatable: true,
    title: "Switching devices",
  },
  control_group: {
    table: "electrical_control_groups",
    stableIdColumn: "control_group_id",
    idKind: null,
    switchIdKind: "control_group",
    writable: [
      "description",
      "building",
      "control_method",
      "expected_device_count",
      "supplying_circuit_group_uuid",
      "design_only",
      "lifecycle_status",
      "field_verification_status",
      "evidence",
      "notes",
    ],
    links: ["supplying_circuit_group_uuid"],
    creatable: true,
    title: "Control groups",
  },
  control_target: {
    table: "electrical_control_targets",
    stableIdColumn: null,
    idKind: null,
    writable: [
      "control_group_uuid",
      "target_kind",
      "load_uuid",
      "device_uuid",
      "target_ref",
      "target_note",
      "design_only",
      "field_verification_status",
      "evidence",
    ],
    links: ["control_group_uuid", "load_uuid"],
    creatable: true,
    title: "Control targets",
  },
  control_wiring_segment: {
    table: "electrical_control_wiring_segments",
    stableIdColumn: "segment_id",
    idKind: null,
    writable: [
      "description",
      "supplying_circuit_group_uuid",
      "raceway_uuid",
      "branch_run_uuid",
      "source_kind",
      "source_switch_bank_uuid",
      "source_jbox_uuid",
      "source_panel_uuid",
      "dest_kind",
      "dest_switch_bank_uuid",
      "dest_jbox_uuid",
      "dest_load_uuid",
      "cable_or_raceway_label",
      "conductor_count",
      // Conductor function is written only from tracing or testing; an observed
      // marking is stored in observed_marking and never converted to a function.
      "conductor_function",
      "observed_marking",
      "install_state",
      "field_verification_status",
      "evidence",
      "notes",
    ],
    links: [
      "supplying_circuit_group_uuid",
      "source_switch_bank_uuid",
      "source_jbox_uuid",
      "source_panel_uuid",
      "dest_switch_bank_uuid",
      "dest_jbox_uuid",
      "dest_load_uuid",
    ],
    creatable: true,
    title: "Control wiring segments",
  },
};


/**
 * Which columns this observation class may write. A temporary observation may
 * only record an observed label, notes and its own non-complete install state —
 * it can never become a permanent design fact or a stable circuit identity.
 *
 * The as-built metadata consequences (sharing, building context) are reserved
 * for FIELD_AS_BUILT: a planned, rough-in, temporary or proposed observation
 * never restates them.
 */
export function fieldsAllowed(kind: AuditEntityKind, cls: ObservationClass): string[] {
  const all = [...new Set(AUDIT_ENTITY_TARGETS[kind].writable)];
  if (cls === "APPROVED_PLANNED_DESIGN") {
    // Approved design facts only: no verification fields, no lifecycle change.
    return all.filter((c) => (APPROVED_PLANNED_DESIGN_FIELDS as readonly string[]).includes(c));
  }
  if (cls === "TEMPORARY") {
    return all.filter((c) => ["label", "notes", "install_status", "label_status"].includes(c));
  }
  if (cls === "ROUGH_IN") {
    return all.filter(
      (c) =>
        !c.startsWith("verified_") &&
        !(FIELD_AS_BUILT_ONLY_FIELDS as readonly string[]).includes(c),
    );
  }
  if (cls !== "FIELD_AS_BUILT") {
    return all.filter((c) => !(FIELD_AS_BUILT_ONLY_FIELDS as readonly string[]).includes(c));
  }
  return all;
}


/* ------------------------------------------------------------------ *
 * Manifest schema
 * ------------------------------------------------------------------ */

const poleSchema = z.object({
  pole_scheme: z.string().trim().default(POLE_SCHEME),
  pole_location_kind: z.enum(POLE_LOCATION_KINDS),
  pole_ref_start: z.string().trim().nullish(),
  pole_ref_end: z.string().trim().nullish(),
});

export const auditBatchItemSchema = z.object({
  item_key: z.string().trim().min(1).max(160),
  entity_kind: z.enum(
    Object.keys(AUDIT_ENTITY_TARGETS) as [AuditEntityKind, ...AuditEntityKind[]],
  ),
  target_stable_id: z.string().trim().max(80).nullish(),
  observation_class: z.enum(OBSERVATION_CLASSES),
  /** Optional hint; the server always recomputes the operation. */
  operation: z.enum(AUDIT_OPERATIONS).nullish(),
  /** Column values proposed by the audit. */
  fields: z.record(z.string(), z.any() as unknown as z.ZodType<Json>).default({}),
  install_state: z.enum(AUDIT_INSTALL_STATES).nullish(),
  pole: poleSchema.nullish(),
  field_grid_reference: z.string().trim().max(20).nullish(),
  /** Human-readable references kept as evidence only, never as authority. */
  refs: z
    .object({
      panel_ref: z.string().trim().max(80).nullish(),
      circuit_group_ref: z.string().trim().max(80).nullish(),
      load_ref: z.string().trim().max(80).nullish(),
      jbox_ref: z.string().trim().max(80).nullish(),
      raceway_ref: z.string().trim().max(80).nullish(),
      switch_bank_ref: z.string().trim().max(80).nullish(),
      source_switch_bank_ref: z.string().trim().max(80).nullish(),
      dest_switch_bank_ref: z.string().trim().max(80).nullish(),
      control_group_ref: z.string().trim().max(80).nullish(),
    })
    .default({}),
  observed_label: z.string().trim().max(120).nullish(),
  evidence: z.string().trim().max(400),
  notes: z.string().trim().max(2000).nullish(),
  reason: z.string().trim().max(400).nullish(),
  /** ODS candidate payload: canonical header + candidate value. */
  ods_field: z.string().trim().max(120).nullish(),
  ods_candidate_value: z.string().trim().max(400).nullish(),
});

export type AuditBatchItemInput = z.infer<typeof auditBatchItemSchema>;

export const auditBatchManifestSchema = z.object({
  schema_version: z.literal(AUDIT_BATCH_SCHEMA_VERSION),
  batch_id: z.string().trim().min(3).max(80),
  title: z.string().trim().min(1).max(200),
  scope: z.string().trim().max(400).nullish(),
  building: z.string().trim().max(120).nullish(),
  observed_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "observed_date must be YYYY-MM-DD")
    .nullish(),
  observed_time_precision: z.string().trim().max(40).nullish(),
  timezone: z.string().trim().max(60).nullish(),
  source: z.string().trim().max(200).nullish(),
  evidence: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        label: z.string().trim().max(200).nullish(),
        subject: z.string().trim().max(200).nullish(),
      }),
    )
    .default([]),
  compensates_batch_id: z.string().trim().max(80).nullish(),
  items: z.array(auditBatchItemSchema).min(1).max(2000),
});

export type AuditBatchManifest = z.infer<typeof auditBatchManifestSchema>;

export interface ManifestParse {
  ok: boolean;
  manifest: AuditBatchManifest | null;
  errors: string[];
}

export function parseManifest(raw: unknown): ManifestParse {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return { ok: false, manifest: null, errors: [`Manifest is not valid JSON: ${String(err)}`] };
    }
  }
  const parsed = auditBatchManifestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      manifest: null,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "manifest"}: ${i.message}`),
    };
  }
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const item of parsed.data.items) {
    if (seen.has(item.item_key)) dupes.push(item.item_key);
    seen.add(item.item_key);
  }
  if (dupes.length) {
    return {
      ok: false,
      manifest: null,
      errors: [`Duplicate item_key values in the manifest: ${dupes.join(", ")}`],
    };
  }
  return { ok: true, manifest: parsed.data, errors: [] };
}

/* ------------------------------------------------------------------ *
 * Checksum
 * ------------------------------------------------------------------ */

/** Stable key-sorted JSON so the same manifest always hashes identically. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function manifestChecksum(manifest: unknown): Promise<string> {
  return sha256Hex(canonicalJson(manifest));
}

/** How an incoming manifest relates to what is already stored under its batch ID. */
export type StoredManifestVerdict =
  | { kind: "new" }
  | { kind: "same" }
  | { kind: "already_applied" }
  | { kind: "fingerprint_conflict"; message: string };

/**
 * Strict fingerprint rule for a stored manifest: a batch ID is bound to the
 * exact bytes first imported under it. Re-importing or pulling the same ID with
 * different content is a hard conflict — corrections are published under a new
 * batch ID, never by editing a stored audit.
 */
export function classifyStoredManifest(
  incoming: { batch_id: string; checksum: string },
  stored: { manifest_sha256: string; status: string } | null,
): StoredManifestVerdict {
  if (!stored) return { kind: "new" };
  if (stored.manifest_sha256.trim() !== incoming.checksum) {
    return {
      kind: "fingerprint_conflict",
      message: `Batch ${incoming.batch_id} already exists with a different manifest checksum. Issue a new batch ID instead of editing an imported audit.`,
    };
  }
  if (["applied", "partially_applied"].includes(stored.status.trim())) {
    return { kind: "already_applied" };
  }
  return { kind: "same" };
}


/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

export interface ValidationMessage {
  level: "error" | "warning" | "info";
  text: string;
  /**
   * What part of the observation the message is about. "location" marks a
   * physical-location problem (grid cell, perimeter post, precision). Location
   * problems must never suppress an otherwise valid electrical relationship —
   * see `LOCATION_DOES_NOT_SUPPRESS_LINKS_RULE`.
   */
  scope?: "location" | "link" | "general";
}

export interface ClassifyContext {
  /** Current row for the target, or null when no record exists. */
  target: Record<string, unknown> | null;
  /** Existing branch run IDs, used for branch-run sequence availability. */
  existingBranchIds?: string[];
  /** Existing junction-box IDs, used to prove an encoded branch run origin. */
  existingJboxIds?: string[];
  /** Resolved relational UUIDs by `kind|stable_id`, e.g. `panel|PNL-FS-NW`. */
  resolved?: Map<string, string>;
  /**
   * Manifest-local CREATE items keyed `kind|stable_id` → item_key. A reference
   * that matches one of these resolves symbolically during preview and to the
   * returned UUID during apply.
   */
  pendingCreates?: Map<string, string>;
}


export interface ClassifiedItem {
  item_key: string;
  entity_kind: AuditEntityKind;
  target_stable_id: string | null;
  observation_class: ObservationClass;
  operation: AuditOperation;
  disposition: AuditDisposition;
  /** Patch that apply would write. Empty for holds, no-change and candidates. */
  patch: JsonObject;
  changes: FieldChange[];
  unchanged: string[];
  before: JsonObject | null;
  after: JsonObject | null;
  expected_updated_at: string | null;
  messages: ValidationMessage[];
  evidence: string;
  pole_token: string;
  payload: AuditBatchItemInput;
}

const err = (text: string): ValidationMessage => ({ level: "error", text });
const info = (text: string): ValidationMessage => ({ level: "info", text });
/** An error about where a record physically is, not about what it connects to. */
const locErr = (text: string): ValidationMessage => ({
  level: "error",
  text,
  scope: "location",
});

/**
 * Automated validation rule.
 *
 * An observed electrical relationship is direct evidence: FS-044 observed on
 * PNL-FS-NW-B37 is a fact about the circuit, not about the grid. So an
 * incomplete or disputed location — FS-044 with no finished grid reference, or
 * FS-076 recorded at a questionable 14NW — must never hold back the link item.
 *
 * When every blocking error on an item is location-scoped and the item still
 * proposes at least one valid relationship column, the location fields are
 * dropped and the item stays a preview-ready LINK. Location reconciliation
 * continues separately, on its own evidence.
 */
export const LOCATION_DOES_NOT_SUPPRESS_LINKS_RULE =
  "Location incompleteness never suppresses an observed load-to-breaker relationship: link columns stay ready and the location claim is reconciled separately.";

/** The columns that state where a record physically is. */
export const LOCATION_PATCH_COLUMNS = [
  "field_grid_reference",
  "pole_scheme",
  "pole_location_kind",
  "pole_ref_start",
  "pole_ref_end",
  "location_evidence",
  "grid",
  "grid_reference",
  "grid_reference_precision",
  "location_x_ft",
  "location_y_ft",
] as const;

function holdResult(
  item: AuditBatchItemInput,
  ctx: ClassifyContext,
  messages: ValidationMessage[],
  operation: AuditOperation = "HOLD_UNRESOLVED",
  disposition: AuditDisposition = "hold",
): ClassifiedItem {
  return {
    item_key: item.item_key,
    entity_kind: item.entity_kind,
    target_stable_id: item.target_stable_id ?? null,
    observation_class: item.observation_class,
    operation,
    disposition,
    patch: {},
    changes: [],
    unchanged: [],
    before: (ctx.target as JsonObject | null) ?? null,
    after: null,
    expected_updated_at: (ctx.target?.["updated_at"] as string | undefined) ?? null,
    messages,
    evidence: item.evidence,
    pole_token: poleToken(item.pole ?? null),
    payload: item,
  };
}

/**
 * Append `addition` to `existing` notes unless it is already present.
 * Never replaces text the manifest did not ask to change.
 */
export function mergeNotes(existing: string | null | undefined, addition: string): string {
  const base = (existing ?? "").trim();
  const add = addition.trim();
  if (!add) return base;
  if (!base) return add;
  if (base.toLowerCase().includes(add.toLowerCase())) return base;
  return `${base} ${add}`;
}

/** Build the column patch a field observation proposes, with its messages. */
export function buildPatch(
  item: AuditBatchItemInput,
  before?: JsonObject | null,
): { patch: Record<string, unknown>; messages: ValidationMessage[] } {
  const messages: ValidationMessage[] = [];
  const allowed = new Set(fieldsAllowed(item.entity_kind, item.observation_class));
  const patch: Record<string, unknown> = {};


  for (const [k, v] of Object.entries(item.fields ?? {})) {
    if (!allowed.has(k)) {
      messages.push(
        err(
          `Field "${k}" is not writable for a ${item.observation_class} ${item.entity_kind} observation — it stays ODS or design owned.`,
        ),
      );
      continue;
    }
    if (k === "notes" && typeof v === "string") {
      // Explicit notes request: append with de-duplication, never overwrite.
      const merged = mergeNotes(
        typeof before?.["notes"] === "string" ? (before["notes"] as string) : null,
        v,
      );
      if (merged !== ((before?.["notes"] as string | null | undefined) ?? null)) {
        patch["notes"] = merged;
      }
      continue;
    }
    patch[k] = v;
  }


  if (item.install_state) {
    const legal = installStatesFor(item.observation_class);
    if (!legal.includes(item.install_state)) {
      messages.push(
        err(
          `Install state "${item.install_state}" is not legal for a ${item.observation_class} observation (allowed: ${legal.join(", ")}).`,
        ),
      );
    } else if (allowed.has("install_status")) {
      patch["install_status"] = INSTALL_STATE_TO_FARMOPS[item.install_state];
    }
  }

  if (item.observed_label && allowed.has("label")) {
    patch["label"] = item.observed_label;
  } else if (item.observed_label && allowed.has("notes")) {
    messages.push(
      info(`Observed label "${item.observed_label}" recorded as a note, not a circuit identity.`),
    );
  }

  if (item.pole) {
    const poleErrors = validatePole(item.pole);
    for (const text of poleErrors) messages.push(locErr(text));
    if (!poleErrors.length && allowed.has("pole_location_kind")) {
      patch["pole_scheme"] = POLE_SCHEME;
      patch["pole_location_kind"] = item.pole.pole_location_kind;
      patch["pole_ref_start"] = item.pole.pole_ref_start
        ? norm(item.pole.pole_ref_start)
        : null;
      patch["pole_ref_end"] = item.pole.pole_ref_end ? norm(item.pole.pole_ref_end) : null;
    } else if (!poleErrors.length && !allowed.has("pole_location_kind")) {
      messages.push(locErr(`${item.entity_kind} records cannot carry a pole location.`));
    }
  }

  if (item.field_grid_reference) {
    const grid = parseFieldGrid(item.field_grid_reference);
    if (!grid) {
      messages.push(locErr(`"${item.field_grid_reference}" is not a valid field grid reference.`));
    } else if (!allowed.has("field_grid_reference")) {
      messages.push(locErr(`${item.entity_kind} records cannot carry a field grid reference.`));
    } else {
      patch["field_grid_reference"] = grid.raw;
      if (grid.fractional) {
        messages.push(
          info(
            `${grid.raw} is a fractional audit coordinate; it is preserved in the field-location layer and the legacy grid field is left untouched.`,
          ),
        );
      }
    }
  }

  // Text references are evidence only; the relational UUID is the authority.
  const refNotes: string[] = [];
  for (const [k, v] of Object.entries(item.refs ?? {})) {
    if (v) refNotes.push(`${k}=${v}`);
  }

  // Evidence, observed references and class annotations are journal-only: they
  // are never written into the entity's notes column, because doing so would
  // replace notes the manifest never asked to change. They surface here as
  // preview messages and are persisted by the field-observation journal.
  if (item.observation_class === "TEMPORARY") {
    messages.push(
      info(
        `TEMPORARY observed installation${item.observed_label ? ` (tape label ${item.observed_label})` : ""} — recorded in the field journal only.`,
      ),
    );
  }
  if (item.observation_class === "ROUGH_IN") {
    messages.push(
      info(
        "ROUGH_IN observed; device/termination not confirmed and not energized — recorded in the field journal only.",
      ),
    );
  }
  if (refNotes.length) {
    messages.push(info(`Observed references (journal only): ${refNotes.join(", ")}.`));
  }
  messages.push(info(`Evidence (journal only): ${item.evidence}.`));

  // Notes are only touched when the manifest explicitly requests a notes value,
  // and then they are appended with de-duplication instead of overwritten.
  const requestedNote =
    typeof item.notes === "string" && item.notes.trim() ? item.notes.trim() : null;
  if (requestedNote) {
    if (!allowed.has("notes")) {
      messages.push(err(`${item.entity_kind} records cannot carry an audit note.`));
    } else {
      const existing = typeof before?.["notes"] === "string" ? (before["notes"] as string) : null;
      const merged = mergeNotes(existing, requestedNote);
      if (merged !== (existing ?? null)) patch["notes"] = merged;
      else messages.push(info("Requested note is already present; notes are left unchanged."));
    }
  }


  if (allowed.has("location_evidence") && (item.pole || item.field_grid_reference)) {
    patch["location_evidence"] = `${item.evidence}${
      item.pole ? ` — pole ${poleToken(item.pole)}` : ""
    }`;
  }

  return { patch, messages };
}

/**
 * Symbolic reference to a record this manifest proposes to create. The real
 * UUID does not exist until apply, so preview shows the symbol and apply
 * substitutes the UUID returned by the parent insert.
 */
export const PENDING_REF_PREFIX = "pending:";

export const pendingRef = (itemKey: string) => `${PENDING_REF_PREFIX}${itemKey}`;

export const isPendingRef = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(PENDING_REF_PREFIX);

export const pendingRefItemKey = (value: string) => value.slice(PENDING_REF_PREFIX.length);

/** Resolve relational links from human references. Missing links are errors. */
export function resolveLinks(
  item: AuditBatchItemInput,
  resolved: Map<string, string>,
  pendingCreates?: Map<string, string>,
): { patch: Record<string, unknown>; messages: ValidationMessage[] } {
  const messages: ValidationMessage[] = [];
  const patch: Record<string, unknown> = {};
  const target = AUDIT_ENTITY_TARGETS[item.entity_kind];
  const want: [string, string | null | undefined, string][] = [
    ["panel_uuid", item.refs?.panel_ref, "panel"],
    ["circuit_group_uuid", item.refs?.circuit_group_ref, "circuit_group"],
    ["load_uuid", item.refs?.load_ref, "load"],
    ["source_jbox_uuid", item.refs?.jbox_ref, "jbox"],
    ["raceway_uuid", item.refs?.raceway_ref, "raceway"],
    // Switching and control topology.
    ["supplying_circuit_group_uuid", item.refs?.circuit_group_ref, "circuit_group"],
    ["switch_bank_uuid", item.refs?.switch_bank_ref, "switch_bank"],
    ["source_switch_bank_uuid", item.refs?.source_switch_bank_ref, "switch_bank"],
    ["dest_switch_bank_uuid", item.refs?.dest_switch_bank_ref, "switch_bank"],
    ["dest_load_uuid", item.refs?.load_ref, "load"],
    ["control_group_uuid", item.refs?.control_group_ref, "control_group"],
  ];
  for (const [column, ref, kind] of want) {
    if (!ref) continue;
    if (!target.links.includes(column)) continue;
    const key = `${kind}|${norm(ref)}`;
    const uuid = resolved.get(key);
    if (uuid) {
      patch[column] = uuid;
      continue;
    }
    const pendingKey = pendingCreates?.get(key);
    if (pendingKey && pendingKey !== item.item_key) {
      // Manifest-local dependency: linked to the record this batch creates
      // first, in the same transaction. Never invented, never orphaned.
      patch[column] = pendingRef(pendingKey);
      messages.push(
        info(
          `${ref} resolves to the ${kind} this manifest creates (${pendingKey}); the link is written with its returned UUID in the same transaction.`,
        ),
      );
      continue;
    }
    messages.push(
      err(`${ref} could not be resolved to an existing ${kind} record — nothing is invented.`),
    );
  }
  return { patch, messages };
}


/**
 * Classify one manifest item against the live snapshot. Never writes; the
 * result is the exact patch that apply would perform.
 */
export function classifyItem(item: AuditBatchItemInput, ctx: ClassifyContext): ClassifiedItem {
  const messages: ValidationMessage[] = [];
  const target = AUDIT_ENTITY_TARGETS[item.entity_kind];
  const resolved = ctx.resolved ?? new Map<string, string>();

  if (!item.evidence) {
    return holdResult(item, ctx, [err("Every observation requires an evidence label.")]);
  }

  // Planned design intent leaves FarmOps untouched and becomes an ODS candidate.
  if (item.observation_class === "PLANNED_DESIGN") {
    return holdResult(
      item,
      ctx,
      [
        info(
          "Planned design change exported as an ODS correction candidate; it is not applied as verified field state.",
        ),
      ],
      "ODS_CORRECTION_CANDIDATE",
      "ods_candidate",
    );
  }
  if (item.observation_class === "HOLD_UNRESOLVED") {
    return holdResult(item, ctx, [
      err(item.reason || "Held as unresolved by the audit; never applied."),
    ]);
  }
  if (item.observation_class === "PROPOSED_RESEARCH") {
    return holdResult(item, ctx, [
      err(
        item.reason ||
          "Research recommendation. It stays on hold until the owner approves it as a separate change.",
      ),
    ]);
  }

  // Stable ID sanity — existing IDs are never renamed or invented.
  const stableId = (item.target_stable_id ?? "").trim();
  if (target.stableIdColumn) {
    if (!stableId) {
      return holdResult(item, ctx, [err("A target stable ID is required for this entity type.")]);
    }
    if (target.idKind) {
      const check = checkStableId(target.idKind, stableId, {
        mode: ctx.target ? "existing" : "create",
      });
      if (!check.ok) return holdResult(item, ctx, [err(check.error ?? "Invalid stable ID.")]);
      if (check.warning) messages.push(info(check.warning));
    }
    if (target.switchIdKind) {
      const check = checkSwitchControlId(target.switchIdKind, stableId);
      if (!check.ok) return holdResult(item, ctx, [err(check.error ?? "Invalid stable ID.")]);
    }
  }

  // A branch run may only be created when its ID's encoded origin is proven and its
  // sequence is genuinely the next unused number under that junction box.
  if (item.entity_kind === "branch" && !ctx.target) {
    const parsed = parseHierarchicalId(stableId);
    const origin = encodedBranchOrigin(stableId);
    if (!parsed || !origin) {
      return holdResult(item, ctx, [
        err(`${stableId} is not a canonical branch run ID (BR-###-##-##).`),
      ]);
    }
    // A J-box created earlier in the same manifest counts as a proven origin.
    const pendingJboxes = [...(ctx.pendingCreates?.keys() ?? [])]
      .filter((k) => k.startsWith("jbox|"))
      .map((k) => k.slice("jbox|".length));
    const jboxes = [...(ctx.existingJboxIds ?? []), ...pendingJboxes].map((s) => norm(s));

    if (!jboxes.includes(origin)) {
      return holdResult(item, ctx, [
        err(`${stableId} encodes origin ${origin}, which does not exist in FarmOps.`),
      ]);
    }
    const declaredOrigin = norm(item.refs?.jbox_ref);
    if (declaredOrigin && declaredOrigin !== origin) {
      return holdResult(item, ctx, [
        err(
          `${stableId} encodes origin ${origin} but the audit states ${declaredOrigin}. A branch-run sequence is never derived from a breaker number.`,
        ),
      ]);
    }
    const taken = new Set((ctx.existingBranchIds ?? []).map((s) => norm(s)));
    if (taken.has(norm(stableId))) {
      return holdResult(item, ctx, [err(`${stableId} already exists; IDs are never recycled.`)]);
    }
    const seq = Number(parsed.branch);
    let expected = 1;
    for (const id of taken) {
      const p = parseHierarchicalId(id);
      if (p?.prefix === "BR" && p.path === parsed.path && p.jbox === parsed.jbox && p.branch) {
        expected = Math.max(expected, Number(p.branch) + 1);
      }
    }
    if (seq !== expected) {
      return holdResult(item, ctx, [
        err(
          `${stableId} is not the next unused branch run under ${origin} (next available is ${String(expected).padStart(2, "0")}).`,
        ),
      ]);
    }
  }

  const built = buildPatch(item, (ctx.target as JsonObject | null) ?? null);
  const links = resolveLinks(item, resolved, ctx.pendingCreates);
  messages.push(...built.messages, ...links.messages);
  const patch = { ...built.patch, ...links.patch };

  let effectivePatch: Record<string, unknown> = patch;
  const errors = messages.filter((m) => m.level === "error");
  if (errors.length) {
    // Rule: location-only failures never suppress a known relationship.
    const locationOnly = errors.every((m) => m.scope === "location");
    const linkColumns = Object.keys(links.patch).filter(
      (c) => target.links.includes(c) && !LOCATION_PATCH_COLUMNS.includes(c as never),
    );
    if (locationOnly && !links.messages.some((m) => m.level === "error") && linkColumns.length) {
      effectivePatch = Object.fromEntries(
        Object.entries(patch).filter(([c]) => !LOCATION_PATCH_COLUMNS.includes(c as never)),
      );
      messages.push(
        info(
          `${LOCATION_DOES_NOT_SUPPRESS_LINKS_RULE} Relationship column(s) kept: ${linkColumns.join(", ")}. The location claim on this item is withheld and reconciled on its own evidence.`,
        ),
      );
    } else {
      return holdResult(item, ctx, messages);
    }
  }
  if (!Object.keys(effectivePatch).length) {
    return holdResult(item, ctx, [
      ...messages,
      err("The observation proposes no writable field value."),
    ]);
  }

  if (!ctx.target) {
    if (!target.creatable) {
      return holdResult(item, ctx, [
        ...messages,
        err(
          `No FarmOps ${item.entity_kind} record for ${stableId || item.item_key}. A field audit never invents a ${item.entity_kind}.`,
        ),
      ]);
    }
    const after = { ...effectivePatch };
    if (target.stableIdColumn) after[target.stableIdColumn] = stableId;
    return {
      item_key: item.item_key,
      entity_kind: item.entity_kind,
      target_stable_id: stableId || null,
      observation_class: item.observation_class,
      operation: "CREATE",
      disposition: "ready",
      patch: after as JsonObject,
      changes: diffFieldChanges({}, after).changes,
      unchanged: [],
      before: null,
      after: after as JsonObject,
      expected_updated_at: null,
      messages,
      evidence: item.evidence,
      pole_token: poleToken(item.pole ?? null),
      payload: item,
    };
  }

  const diff = diffFieldChanges(ctx.target, effectivePatch);
  const onlyLinks =
    diff.changes.length > 0 && diff.changes.every((c) => target.links.includes(c.column));
  const operation: AuditOperation = diff.changes.length
    ? onlyLinks
      ? "LINK"
      : "UPDATE"
    : "NO_CHANGE";

  return {
    item_key: item.item_key,
    entity_kind: item.entity_kind,
    target_stable_id: stableId || null,
    observation_class: item.observation_class,
    operation,
    disposition: diff.changes.length ? "ready" : "no_change",
    patch: (diff.changes.length
      ? Object.fromEntries(diff.changes.map((c) => [c.column, effectivePatch[c.column]]))
      : {}) as JsonObject,
    changes: diff.changes,
    unchanged: diff.unchanged,
    before: ctx.target as JsonObject,
    after: { ...ctx.target, ...effectivePatch } as JsonObject,
    expected_updated_at: (ctx.target["updated_at"] as string | undefined) ?? null,
    messages,
    evidence: item.evidence,
    pole_token: poleToken(item.pole ?? null),
    payload: item,
  };
}

/* ------------------------------------------------------------------ *
 * Summaries and exports
 * ------------------------------------------------------------------ */

export interface BatchSummary {
  items: number;
  by_operation: Record<string, number>;
  by_disposition: Record<string, number>;
  by_class: Record<string, number>;
  ready: number;
  holds: number;
  conflicts: number;
  ods_candidates: number;
  no_change: number;
  applied: number;
  failed: number;
}

export function summarize(
  items: { operation: string; disposition: string; observation_class: string }[],
): BatchSummary {
  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  const by_operation: Record<string, number> = {};
  const by_disposition: Record<string, number> = {};
  const by_class: Record<string, number> = {};
  for (const i of items) {
    bump(by_operation, i.operation);
    bump(by_disposition, i.disposition);
    bump(by_class, i.observation_class);
  }
  return {
    items: items.length,
    by_operation,
    by_disposition,
    by_class,
    ready: by_disposition["ready"] ?? 0,
    holds: by_disposition["hold"] ?? 0,
    conflicts: by_disposition["conflict"] ?? 0,
    ods_candidates: by_disposition["ods_candidate"] ?? 0,
    no_change: by_disposition["no_change"] ?? 0,
    applied: by_disposition["applied"] ?? 0,
    failed: by_disposition["failed"] ?? 0,
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

/** Preview report: one row per proposed change. */
/**
 * Derived, display-only breaker relationship for one audit item:
 * breaker_reference -> circuit_group_id [description]. Built from the item's
 * evidence refs, never stored, and null whenever either side is missing.
 */
export function itemBreakerRelationship(
  item: Pick<AuditBatchItemInput, "entity_kind" | "target_stable_id" | "fields" | "refs" | "observed_label">,
): string | null {
  const fields = (item.fields ?? {}) as Record<string, unknown>;
  const refs = item.refs ?? {};
  const group =
    item.entity_kind === "circuit_group"
      ? (item.target_stable_id ?? refs.circuit_group_ref ?? null)
      : (refs.circuit_group_ref ?? null);
  return breakerRelationshipLabel({
    panel_id: refs.panel_ref ?? null,
    breaker_number: (fields["breaker_number"] as number | string | null | undefined) ?? null,
    circuit_group_id: group,
    description: item.observed_label ?? null,
  });
}

/** Same projection for a classified preview row. */
export function classifiedBreakerRelationship(item: ClassifiedItem): string | null {
  return itemBreakerRelationship(item.payload);
}

export function previewCsv(items: ClassifiedItem[]): string {
  return csv(
    [
      "item_key",
      "entity_kind",
      "stable_id",
      "observation_class",
      "operation",
      "disposition",
      "pole",
      "column",
      "current_value",
      "proposed_value",
      "breaker_relationship",
      "evidence",
      "messages",
    ],
    items.flatMap((i) => {
      const msgs = i.messages.map((m) => `${m.level}: ${m.text}`).join(" | ");
      if (!i.changes.length) {
        return [
          [
            i.item_key,
            i.entity_kind,
            i.target_stable_id,
            i.observation_class,
            i.operation,
            i.disposition,
            i.pole_token,
            "",
            "",
            "",
            classifiedBreakerRelationship(i) ?? "",
            i.evidence,
            msgs,
          ],
        ];
      }
      return i.changes.map((c) => [
        i.item_key,
        i.entity_kind,
        i.target_stable_id,
        i.observation_class,
        i.operation,
        i.disposition,
        i.pole_token,
        c.column,
        c.before,
        c.after,
        classifiedBreakerRelationship(i) ?? "",
        i.evidence,
        msgs,
      ]);
    }),
  );
}

/** Hold report: every item the gate refuses to apply, with its reason. */
export function holdCsv(items: ClassifiedItem[]): string {
  return csv(
    ["item_key", "entity_kind", "stable_id", "observation_class", "disposition", "reason"],
    items
      .filter((i) => i.disposition === "hold" || i.disposition === "conflict")
      .map((i) => [
        i.item_key,
        i.entity_kind,
        i.target_stable_id,
        i.observation_class,
        i.disposition,
        i.messages.map((m) => m.text).join(" | "),
      ]),
  );
}

export interface OdsCandidateRow {
  stable_id: string;
  canonical_field: string;
  old_value: string;
  candidate_value: string;
  reason: string;
  audit_batch_id: string;
  evidence: string;
}

/**
 * ODS correction candidates. Generated for export only — the workbook is never
 * opened, written or regenerated by this feature.
 */
export function odsCandidateRows(
  batchId: string,
  items: ClassifiedItem[],
): OdsCandidateRow[] {
  return items
    .filter((i) => i.disposition === "ods_candidate")
    .map((i) => {
      const field = i.payload.ods_field ?? Object.keys(i.payload.fields ?? {})[0] ?? "";
      const candidate =
        i.payload.ods_candidate_value ??
        (field ? String((i.payload.fields ?? {})[field] ?? "") : "");
      return {
        stable_id: i.target_stable_id ?? "",
        canonical_field: field,
        old_value: field ? String(i.before?.[field] ?? "") : "",
        candidate_value: candidate,
        reason: i.payload.reason ?? "Planned design change observed during the field audit.",
        audit_batch_id: batchId,
        evidence: i.evidence,
      };
    });
}

export function odsCandidateCsv(batchId: string, items: ClassifiedItem[]): string {
  return csv(
    [
      "stable_id",
      "canonical_field",
      "old_value",
      "candidate_value",
      "reason",
      "audit_batch_id",
      "evidence",
    ],
    odsCandidateRows(batchId, items).map((r) => [
      r.stable_id,
      r.canonical_field,
      r.old_value,
      r.candidate_value,
      r.reason,
      r.audit_batch_id,
      r.evidence,
    ]),
  );
}

/**
 * Recovery is a *forward* compensating batch: it restores the previous values
 * of applied items. Audit history is never deleted.
 */
export function compensatingManifest(
  batch: { batch_id: string; title: string; building?: string | null },
  applied: ClassifiedItem[],
): AuditBatchManifest {
  const items: AuditBatchItemInput[] = applied
    .filter((i) => i.operation === "UPDATE" || i.operation === "LINK")
    .map((i) => ({
      item_key: `revert:${i.item_key}`,
      entity_kind: i.entity_kind,
      target_stable_id: i.target_stable_id,
      observation_class: "FIELD_AS_BUILT" as ObservationClass,
      operation: "UPDATE" as AuditOperation,
      fields: Object.fromEntries(i.changes.map((c) => [c.column, c.before])),
      install_state: null,
      pole: null,
      field_grid_reference: null,
      refs: {},
      observed_label: null,
      evidence: `Compensating reversal of ${batch.batch_id}`,
      notes: `Restores the values recorded before ${batch.batch_id} applied ${i.item_key}.`,
      reason: null,
      ods_field: null,
      ods_candidate_value: null,
    }));
  return {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: `${batch.batch_id}-REVERT`,
    title: `Compensating reversal of ${batch.title}`,
    scope: `Restores field values written by ${batch.batch_id}.`,
    building: batch.building ?? null,
    observed_date: null,
    observed_time_precision: null,
    timezone: null,
    source: `compensating:${batch.batch_id}`,
    evidence: [],
    compensates_batch_id: batch.batch_id,
    items,
  };
}

/* ------------------------------------------------------------------ *
 * 9.1 Manifest-local dependency resolution
 * ------------------------------------------------------------------ */

/** Reference keys (`kind|STABLE_ID`) an item declares. */
export function itemReferenceKeys(item: AuditBatchItemInput): string[] {
  const refs = item.refs ?? {};
  const pairs: [string, string | null | undefined][] = [
    ["panel", refs.panel_ref],
    ["circuit_group", refs.circuit_group_ref],
    ["load", refs.load_ref],
    ["jbox", refs.jbox_ref],
    ["raceway", refs.raceway_ref],
  ];
  return pairs.filter(([, v]) => Boolean(v)).map(([k, v]) => `${k}|${norm(v)}`);
}

export interface ManifestGraph {
  /** `kind|STABLE_ID` → item_key of the CREATE item that will produce it. */
  pendingCreates: Map<string, string>;
  /** item_key → item_keys it depends on inside this manifest. */
  dependsOn: Map<string, string[]>;
  /** Blocking ambiguity: the same proposed stable ID appears more than once. */
  conflicts: string[];
}

/**
 * Build the manifest dependency graph before classification, so an item may
 * reference a record another item in the same manifest creates. A duplicate or
 * ambiguous proposed stable ID is a blocking conflict, never a guess.
 */
export function buildManifestGraph(
  items: AuditBatchItemInput[],
  existing: (kind: string, stableId: string) => boolean = () => false,
): ManifestGraph {
  const pendingCreates = new Map<string, string>();
  const conflicts: string[] = [];
  const seen = new Map<string, string[]>();

  for (const item of items) {
    const id = norm(item.target_stable_id);
    if (!id) continue;
    if (!AUDIT_ENTITY_TARGETS[item.entity_kind].creatable) continue;
    if (existing(item.entity_kind, id)) continue; // already a real record
    const key = `${item.entity_kind}|${id}`;
    seen.set(key, [...(seen.get(key) ?? []), item.item_key]);
  }
  for (const [key, keys] of seen) {
    if (keys.length > 1) {
      conflicts.push(
        `${key.split("|")[1]} is proposed for creation by more than one item (${keys.join(", ")}); the reference is ambiguous and the batch cannot apply.`,
      );
      continue;
    }
    pendingCreates.set(key, keys[0]!);
  }

  const dependsOn = new Map<string, string[]>();
  for (const item of items) {
    const deps = itemReferenceKeys(item)
      .map((k) => pendingCreates.get(k))
      .filter((k): k is string => Boolean(k) && k !== item.item_key);
    dependsOn.set(item.item_key, [...new Set(deps)]);
  }
  return { pendingCreates, dependsOn, conflicts };
}

/**
 * Order items for apply: entity dependency order first, then a topological
 * pass so a manifest-local parent is always written before its dependents.
 */
export function orderForApply<T extends { item_key: string; entity_kind: AuditEntityKind }>(
  items: T[],
  dependsOn: Map<string, string[]>,
): T[] {
  const rank = new Map(APPLY_ORDER.map((k, i) => [k, i] as const));
  const base = [...items].sort(
    (a, b) => (rank.get(a.entity_kind) ?? 99) - (rank.get(b.entity_kind) ?? 99),
  );
  const byKey = new Map(base.map((i) => [i.item_key, i]));
  const out: T[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (item: T) => {
    if (done.has(item.item_key) || visiting.has(item.item_key)) return;
    visiting.add(item.item_key);
    for (const dep of dependsOn.get(item.item_key) ?? []) {
      const parent = byKey.get(dep);
      if (parent) visit(parent);
    }
    visiting.delete(item.item_key);
    done.add(item.item_key);
    out.push(item);
  };
  for (const item of base) visit(item);
  return out;
}

/* ------------------------------------------------------------------ *
 * Circuit-group identity (CG-FS-##)
 * ------------------------------------------------------------------ */

/** Placeholder a manifest uses to ask FarmOps to propose the next group ID. */
export const AUTO_CIRCUIT_GROUP_ID = "AUTO";

export const CIRCUIT_GROUP_ID_RE = /^CG-([A-Z]{2,6})-(\d{2,})$/;

/**
 * Next unused circuit-group ID for a prefix. Identity is independent of panel,
 * breaker number and blue-tape label; existing IDs are never reused.
 */
export function nextCircuitGroupId(existingIds: Iterable<string>, prefix = "FS"): string {
  let max = 0;
  for (const raw of existingIds) {
    const m = CIRCUIT_GROUP_ID_RE.exec(norm(raw));
    if (m && m[1] === prefix.toUpperCase()) max = Math.max(max, Number(m[2]));
  }
  // Three digits to match the CG-<site>-### standard used everywhere else.
  return `CG-${prefix.toUpperCase()}-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Replace `AUTO` (or a missing) circuit-group ID with the next unused CG-<prefix>-##
 * deterministically, in manifest order, and rewrite the references that point
 * at the placeholder so downstream links still resolve. The owner still has to
 * approve every proposed ID during preview.
 */
export function assignProposedCircuitGroupIds(
  items: AuditBatchItemInput[],
  existingIds: Iterable<string>,
  prefix = "FS",
): { items: AuditBatchItemInput[]; proposed: Record<string, string> } {
  const taken = new Set([...existingIds].map((v) => norm(v)));
  const proposed: Record<string, string> = {};

  const out = items.map((item) => {
    if (item.entity_kind !== "circuit_group") return item;
    const id = norm(item.target_stable_id);
    if (id && id !== AUTO_CIRCUIT_GROUP_ID && !id.startsWith("AUTO:")) return item;
    const next = nextCircuitGroupId(taken, prefix);
    taken.add(next);
    proposed[item.item_key] = next;
    if (id.startsWith("AUTO:")) proposed[id] = next;
    return { ...item, target_stable_id: next };
  });

  if (!Object.keys(proposed).length) return { items, proposed };

  // Rewrite placeholder references (AUTO:<token>) to the proposed IDs.
  const rewritten = out.map((item) => {
    const ref = norm(item.refs?.circuit_group_ref);
    if (!ref || !proposed[ref]) return item;
    return { ...item, refs: { ...item.refs, circuit_group_ref: proposed[ref] } };
  });
  return { items: rewritten, proposed };
}
