// FARMOPS-ELEC-RING-CAMERA-R4-V1 — immutable preview-only reconciliation of the
// eight Farm Shop exterior Ring camera locations as an APPROVED PLANNED DESIGN.
//
// Scope, and nothing else:
//   * structured planned location description (`location`) for FS-002…FS-009;
//   * approved corner/face design geometry (corner, wall face, coverage
//     direction, exact corner coordinates, derived grid read-out);
//   * exterior mounting classification and 8 ft planned mounting height;
//   * proposed *physical* source panel PNL-FS-NE (planned assignment only);
//   * logical resilience classification (critical-camera group) and planned
//     load-shed capability, held separately from the physical supply path;
//   * removal of a "dedicated" flag that only ever reflected an unknown circuit
//     group.
//
// Explicitly untouched: the equipment/load description ("Outside light / Ring
// Camera"), stable IDs, lifecycle/install status, field verification, breaker
// positions, circuit groups, voltage, amperage, connected VA and equipment
// model. FS-010 is held, not given a duplicate corner location.
import {
  AUDIT_BATCH_SCHEMA_VERSION,
  type AuditBatchItemInput,
  type AuditBatchManifest,
} from "@/lib/electrical-audit-batch";
import {
  RING_CAMERA_DESIGN,
  RING_CAMERA_HELD_LOAD,
  RING_CAMERA_LOADS,
  RING_CAMERA_LOGICAL_PANEL_TOKEN,
  RING_CAMERA_PROPOSED_PANEL,
  RING_CAMERA_RESILIENCE_CLASS,
  RING_CAMERA_UNRESOLVED_NOTE,
  ringCameraDesignFields,
  type RingCameraDesign,
} from "@/lib/electrical-ring-camera-design";

export const RING_CAMERA_BATCH_ID = "FA-FS-2026-09-05-RING-CAMERA-DESIGN";

export const RING_CAMERA_PRESERVED_BATCH_IDS = [
  "FA-FS-2026-09-03-PM-R2",
  "FA-FS-2026-09-03-PM-R3-METADATA",
  "FA-FS-2026-09-03-PM-R3-OUTLET-METADATA",
  "FA-FS-2026-09-03-PM-R3A-OUTLET-CLASSIFICATION",
] as const;

export const RING_CAMERA_OUT_OF_SCOPE_NOTE =
  "Approved planned design only. Equipment/load description, stable ID, install lifecycle, field verification, breaker position, circuit group, voltage, amperage, connected VA and equipment model are out of scope and unchanged.";

/** Live row shape read for the preview. */
export interface RingCameraLoadRow {
  load_id: string;
  description?: string | null;
  location?: string | null;
  design_location_source?: string | null;
  corner_reference?: string | null;
  mounting_wall_face?: string | null;
  coverage_direction?: string | null;
  mounting_classification?: string | null;
  mounting_height_ft?: number | null;
  design_x_ft?: number | null;
  design_y_ft?: number | null;
  design_grid?: string | null;
  suggested_panel?: string | null;
  backup_panel?: string | null;
  load_shed_group?: string | null;
  resilience_class?: string | null;
  load_shed_capable?: boolean | null;
  dedicated?: boolean | null;
  dedicated_shared?: string | null;
  install_status?: string | null;
  logical_panel_ref?: string | null;
  logical_panel_uuid?: string | null;
  updated_at?: string | null;
}

export interface RingCameraChange {
  column: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

export interface RingCameraRow {
  load_id: string;
  wording: string | null;
  corner: string | null;
  wall_face: string | null;
  found: boolean;
  held: boolean;
  already_correct: boolean;
  changes: RingCameraChange[];
  /** Set when a logical grouping token is sitting in a physical panel field. */
  logical_panel_warning: string | null;
}

export interface RingCameraBuild {
  manifest: AuditBatchManifest;
  rows: RingCameraRow[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
}

const EVIDENCE =
  "Owner-approved Farm Shop exterior camera design, 05 Sep 2026: eight Ring cameras clockwise from the north-east corner, two per corner sharing the corner coordinate with distinct wall faces, exterior wall mount at 8 ft. Planned design — not a field observation and not as-built verified.";

type Cell = string | number | boolean | null;

const norm = (v: unknown): Cell => {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? null : s;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
};

function diffFor(row: RingCameraLoadRow, after: Record<string, unknown>): RingCameraChange[] {
  const out: RingCameraChange[] = [];
  for (const [column, value] of Object.entries(after)) {
    const before = norm((row as unknown as Record<string, unknown>)[column]);
    const target = norm(value);
    if (before !== target) out.push({ column, before, after: target });
  }
  return out;
}

/** Is a logical critical grouping token sitting in a physical panel field? */
function logicalPanelWarning(row: RingCameraLoadRow): string | null {
  const fields: Array<[string, unknown]> = [
    ["suggested_panel", row.suggested_panel],
    ["backup_panel", row.backup_panel],
    ["load_shed_group", row.load_shed_group],
  ];
  const hits = fields
    .filter(([, v]) => String(v ?? "").trim().toUpperCase() === RING_CAMERA_LOGICAL_PANEL_TOKEN)
    .map(([c]) => c);
  if (!hits.length) return null;
  return `${RING_CAMERA_LOGICAL_PANEL_TOKEN} is a logical critical-load grouping, not physical panelboard equipment; it is recorded in ${hits.join(
    ", ",
  )}. The physical proposed source becomes ${RING_CAMERA_PROPOSED_PANEL} and the resilience grouping is represented as ${RING_CAMERA_RESILIENCE_CLASS}.`;
}

/** Deterministic: identical rows produce a byte-identical manifest. */
export function buildRingCameraDesignBatch(input: {
  loads: readonly RingCameraLoadRow[];
  /** UUID of the logical panel PNL-FS-CRIT, when it is on record. */
  logicalPanelUuid?: string | null;
}): RingCameraBuild {
  const byId = new Map(
    input.loads.map((r) => [String(r.load_id).trim().toUpperCase(), r] as const),
  );
  const rows: RingCameraRow[] = [];
  const items: AuditBatchItemInput[] = [];
  const loadsNotFound: string[] = [];
  const alreadyCorrect: string[] = [];

  const push = (d: RingCameraDesign) => {
    const row = byId.get(d.load_id.toUpperCase());
    const after = ringCameraDesignFields(d, { logicalPanelUuid: input.logicalPanelUuid ?? null });
    if (!row) {
      loadsNotFound.push(d.load_id);
      rows.push({
        load_id: d.load_id,
        wording: d.wording,
        corner: d.corner,
        wall_face: d.wallFace,
        found: false,
        held: true,
        already_correct: false,
        changes: [],
        logical_panel_warning: null,
      });
      items.push({
        item_key: `${d.load_id.toLowerCase()}-ring-camera-hold`,
        entity_kind: "load",
        target_stable_id: d.load_id,
        observation_class: "HOLD_UNRESOLVED",
        operation: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: EVIDENCE,
        notes: `Held: no FarmOps load record ${d.load_id} exists in this instance, so its planned design cannot be reconciled.`,
        reason: `No load record ${d.load_id}; planned design withheld.`,
      } as AuditBatchItemInput);
      return;
    }

    // dedicated is only corrected when it currently claims dedicated.
    const proposed: Record<string, unknown> = { ...after };
    if (row.dedicated !== true) delete proposed["dedicated"];

    const changes = diffFor(row, proposed);
    const warning = logicalPanelWarning(row);
    const already = changes.length === 0;
    if (already) alreadyCorrect.push(d.load_id);
    rows.push({
      load_id: d.load_id,
      wording: d.wording,
      corner: d.corner,
      wall_face: d.wallFace,
      found: true,
      held: false,
      already_correct: already,
      changes,
      logical_panel_warning: warning,
    });
    if (already) return;

    const fields: Record<string, unknown> = {};
    for (const c of changes) fields[c.column] = c.after;

    items.push({
      item_key: `${d.load_id.toLowerCase()}-ring-camera-design`,
      entity_kind: "load",
      target_stable_id: d.load_id,
      observation_class: "APPROVED_PLANNED_DESIGN",
      operation: "UPDATE",
      fields: fields as AuditBatchItemInput["fields"],
      refs: {},
      evidence: EVIDENCE,
      notes: [
        `${d.wording}: ${d.corner} corner (${d.xFt} ft E / ${d.yFt} ft S), ${d.wallFace} wall face, coverage ${d.coverageDirection}, exterior wall mount at 8 ft planned height.`,
        `Physical proposed source panel ${RING_CAMERA_PROPOSED_PANEL}; logical resilience classification ${RING_CAMERA_RESILIENCE_CLASS}; load shedding planned. Breaker position and circuit group remain unresolved.`,
        warning ?? "",
        RING_CAMERA_UNRESOLVED_NOTE,
        RING_CAMERA_OUT_OF_SCOPE_NOTE,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 2000),
      reason:
        "Reconcile the approved planned exterior camera design: shared corner coordinate per pair with a distinct mounting face and coverage direction, exterior mounting at 8 ft, physical proposed panel separated from the logical critical-camera grouping.",
    } as AuditBatchItemInput);
  };

  for (const d of RING_CAMERA_DESIGN) push(d);

  // FS-010 — outside the eight-camera corner pattern until evidence says otherwise.
  const held = byId.get(RING_CAMERA_HELD_LOAD.toUpperCase());
  rows.push({
    load_id: RING_CAMERA_HELD_LOAD,
    wording: null,
    corner: null,
    wall_face: null,
    found: Boolean(held),
    held: true,
    already_correct: false,
    changes: [],
    logical_panel_warning: held ? logicalPanelWarning(held) : null,
  });
  items.push({
    item_key: `${RING_CAMERA_HELD_LOAD.toLowerCase()}-outside-corner-pattern-hold`,
    entity_kind: "load",
    target_stable_id: RING_CAMERA_HELD_LOAD,
    observation_class: "HOLD_UNRESOLVED",
    operation: "HOLD_UNRESOLVED",
    fields: {},
    refs: {},
    evidence: EVIDENCE,
    notes: `${RING_CAMERA_HELD_LOAD} is not part of the eight-camera corner pattern. No corner, face, coordinate or grid value is assigned, so no duplicate location is created. ${RING_CAMERA_UNRESOLVED_NOTE}`,
    reason: `Additional evidence required before ${RING_CAMERA_HELD_LOAD} is given a planned exterior camera location.`,
  } as AuditBatchItemInput);

  const manifest: AuditBatchManifest = {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: RING_CAMERA_BATCH_ID,
    title: "Farm Shop exterior Ring camera approved planned design",
    // Kept under the 400-character manifest scope limit; the full out-of-scope
    // note travels with every item.
    scope: `Approved planned design for ${RING_CAMERA_LOADS[0]}…${RING_CAMERA_LOADS[RING_CAMERA_LOADS.length - 1]} (8 exterior cameras): planned location, corner/face geometry, exterior mounting at 8 ft, proposed physical panel ${RING_CAMERA_PROPOSED_PANEL}, logical ${RING_CAMERA_RESILIENCE_CLASS} with planned load shedding. ${RING_CAMERA_HELD_LOAD} held. Descriptions, stable IDs, lifecycle, breakers, circuit groups and engineering values unchanged.`,
    building: "Farm Shop",
    observed_date: "2026-09-05",
    observed_time_precision: "design",
    timezone: "America/Chicago",
    source: `approved-planned-design-following:${RING_CAMERA_PRESERVED_BATCH_IDS.join(",")}`,
    evidence: [
      {
        name: "ring-camera-corner-pattern",
        label: "Two cameras per corner, clockwise from the north-east corner",
        subject: RING_CAMERA_LOADS.join(", "),
      },
    ],
    compensates_batch_id: null,
    items,
  };

  return { manifest, rows, loadsNotFound, alreadyCorrect };
}

/** CSV of the exact before/after preview. */
export function ringCameraCsv(rows: readonly RingCameraRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["load_id", "wording", "corner", "wall_face", "found", "held", "column", "before", "after"];
  const lines = [head.join(",")];
  for (const r of rows) {
    if (!r.changes.length) {
      lines.push(
        [r.load_id, r.wording, r.corner, r.wall_face, r.found, r.held, "", "", ""].map(esc).join(","),
      );
      continue;
    }
    for (const c of r.changes)
      lines.push(
        [r.load_id, r.wording, r.corner, r.wall_face, r.found, r.held, c.column, c.before, c.after]
          .map(esc)
          .join(","),
      );
  }
  return lines.join("\n");
}
