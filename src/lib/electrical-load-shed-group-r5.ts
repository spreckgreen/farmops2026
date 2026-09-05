// FARMOPS-ELEC-R5-LOAD-SHED-GROUP-V1 — immutable preview-only corrective batch.
//
// FA-FS-2026-09-05-CAMERA-LOAD-SHED-GROUP corrects the load-shedding group of
// the exterior camera records that carry the *physical* panelboard PNL-FS-NE in
// that field. Load shedding is a resilience grouping decision, so the field must
// read the logical panel PNL-FS-CRIT — the physical supply path is already held
// separately in suggested_panel and must not be duplicated here.
//
// Scope is exactly one field (`load_shed_group`) on exactly the two affected
// records. Physical panel assignment, logical panel link, resilience class,
// load-shed capability, locations, geometry, lifecycle state, breaker positions,
// circuit groups, voltage, amperage, connected VA, descriptions and stable IDs
// are out of scope and untouched. A record is only staged when the field reads
// exactly the physical panel token; anything else is held for review rather than
// overwritten.
import {
  AUDIT_BATCH_SCHEMA_VERSION,
  type AuditBatchItemInput,
  type AuditBatchManifest,
} from "@/lib/electrical-audit-batch";
import {
  RING_CAMERA_LOGICAL_PANEL_TOKEN,
  RING_CAMERA_PROPOSED_PANEL,
} from "@/lib/electrical-ring-camera-design";

export const LOAD_SHED_GROUP_BATCH_ID = "FA-FS-2026-09-05-CAMERA-LOAD-SHED-GROUP";

/** The batches this correction follows. None of them is modified. */
export const LOAD_SHED_GROUP_PRESERVED_BATCH_IDS = [
  "FA-FS-2026-09-03-PM-R2",
  "FA-FS-2026-09-03-PM-R3-METADATA",
  "FA-FS-2026-09-03-PM-R3-OUTLET-METADATA",
  "FA-FS-2026-09-03-PM-R3A-OUTLET-CLASSIFICATION",
  "FA-FS-2026-09-05-RING-CAMERA-DESIGN",
] as const;

/** The records this batch inspects. */
export const LOAD_SHED_GROUP_LOADS = ["FS-003", "FS-004"] as const;

/** The only field this batch may write. */
export const LOAD_SHED_GROUP_FIELD = "load_shed_group" as const;

export const LOAD_SHED_GROUP_OUT_OF_SCOPE_NOTE =
  "Load-shedding group only. Physical panel assignment, logical panel link, resilience class, load-shed capability, location and geometry, lifecycle state, breaker position, circuit group, voltage, amperage, connected VA, description and stable ID are out of scope and unchanged.";

export interface LoadShedGroupRow {
  load_id: string;
  found: boolean;
  before: string | null;
  after: string | null;
  /** True when the field already reads the logical panel. */
  already_correct: boolean;
  /** True when the field reads something else entirely, so it is held. */
  held: boolean;
  note: string;
}

export interface LoadShedGroupBuild {
  manifest: AuditBatchManifest;
  rows: LoadShedGroupRow[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
  held: string[];
}

export interface LoadShedGroupLoadRow {
  load_id: string;
  load_shed_group?: string | null;
  suggested_panel?: string | null;
  logical_panel_ref?: string | null;
  resilience_class?: string | null;
}

const str = (v: unknown): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};

const EVIDENCE = `Owner-approved Farm Shop exterior camera design, 05 Sep 2026: load shedding is decided on the logical resilience grouping ${RING_CAMERA_LOGICAL_PANEL_TOKEN}, which is assigned to the physical panelboard ${RING_CAMERA_PROPOSED_PANEL}. Recording the physical panel in the load-shedding group duplicates the supply path already held in suggested_panel and hides the grouping the shedding decision belongs to.`;

/**
 * Build the immutable preview-only load-shedding group correction from live
 * rows. Deterministic: identical input yields byte-identical JSON, so the
 * fingerprint recorded at import is stable.
 */
export function buildLoadShedGroupR5(input: {
  loads: readonly LoadShedGroupLoadRow[];
}): LoadShedGroupBuild {
  const byId = new Map(
    input.loads.map((r) => [String(r.load_id).trim().toUpperCase(), r] as const),
  );
  const rows: LoadShedGroupRow[] = [];
  const items: AuditBatchItemInput[] = [];
  const loadsNotFound: string[] = [];
  const alreadyCorrect: string[] = [];
  const held: string[] = [];

  for (const loadId of LOAD_SHED_GROUP_LOADS) {
    const row = byId.get(loadId.toUpperCase());
    if (!row) {
      loadsNotFound.push(loadId);
      rows.push({
        load_id: loadId,
        found: false,
        before: null,
        after: null,
        already_correct: false,
        held: true,
        note: `No FarmOps load record ${loadId} in this instance, so its load-shedding group cannot be read or corrected.`,
      });
      items.push({
        item_key: `${loadId.toLowerCase()}-load-shed-group-hold`,
        entity_kind: "load",
        target_stable_id: loadId,
        observation_class: "HOLD_UNRESOLVED",
        operation: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: EVIDENCE,
        notes: `Held: no FarmOps load record ${loadId} exists in this instance.`,
        reason: `No load record ${loadId}; load-shedding group correction withheld.`,
      });
      continue;
    }

    const before = str(row.load_shed_group);
    const upper = (before ?? "").toUpperCase();

    if (upper === RING_CAMERA_LOGICAL_PANEL_TOKEN) {
      alreadyCorrect.push(loadId);
      rows.push({
        load_id: loadId,
        found: true,
        before,
        after: before,
        already_correct: true,
        held: false,
        note: `Already reads the logical panel ${RING_CAMERA_LOGICAL_PANEL_TOKEN}; nothing staged.`,
      });
      continue;
    }

    if (upper !== RING_CAMERA_PROPOSED_PANEL) {
      held.push(loadId);
      rows.push({
        load_id: loadId,
        found: true,
        before,
        after: null,
        already_correct: false,
        held: true,
        note: `Load-shedding group reads ${
          before ?? "nothing"
        }, which is neither the physical panel ${RING_CAMERA_PROPOSED_PANEL} nor the logical panel ${RING_CAMERA_LOGICAL_PANEL_TOKEN}. Held for owner review rather than overwritten.`,
      });
      items.push({
        item_key: `${loadId.toLowerCase()}-load-shed-group-review-hold`,
        entity_kind: "load",
        target_stable_id: loadId,
        observation_class: "HOLD_UNRESOLVED",
        operation: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: EVIDENCE,
        notes: `Held: ${loadId} load_shed_group = ${
          before ?? "not recorded"
        }. Only an exact ${RING_CAMERA_PROPOSED_PANEL} value is a deterministic physical/logical confusion; any other value needs owner disposition.`,
        reason: `${loadId} load-shedding group is not the physical panel token, so no deterministic correction exists.`,
      });
      continue;
    }

    rows.push({
      load_id: loadId,
      found: true,
      before,
      after: RING_CAMERA_LOGICAL_PANEL_TOKEN,
      already_correct: false,
      held: false,
      note: `Physical panel ${RING_CAMERA_PROPOSED_PANEL} replaced by the logical panel ${RING_CAMERA_LOGICAL_PANEL_TOKEN}; the physical supply path stays in suggested_panel.`,
    });
    items.push({
      item_key: `${loadId.toLowerCase()}-load-shed-group`,
      entity_kind: "load",
      target_stable_id: loadId,
      observation_class: "APPROVED_PLANNED_DESIGN",
      operation: "UPDATE",
      fields: { load_shed_group: RING_CAMERA_LOGICAL_PANEL_TOKEN } as AuditBatchItemInput["fields"],
      refs: {},
      evidence: EVIDENCE,
      notes: `Before: load_shed_group=${before}. After: load_shed_group=${RING_CAMERA_LOGICAL_PANEL_TOKEN}. Physical proposed source panel remains ${
        str(row.suggested_panel) ?? "unchanged"
      } and the logical panel link remains ${
        str(row.logical_panel_ref) ?? "unchanged"
      }. ${LOAD_SHED_GROUP_OUT_OF_SCOPE_NOTE}`,
      reason:
        "Record the load-shedding group on the logical resilience grouping rather than on the physical panelboard, which is already held as the proposed physical source.",
    });
  }

  const manifest: AuditBatchManifest = {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: LOAD_SHED_GROUP_BATCH_ID,
    title: "Farm Shop exterior camera load-shedding group correction",
    scope: `Single-field correction of ${LOAD_SHED_GROUP_LOADS.join(
      " and ",
    )}: load_shed_group ${RING_CAMERA_PROPOSED_PANEL} → ${RING_CAMERA_LOGICAL_PANEL_TOKEN}. ${LOAD_SHED_GROUP_OUT_OF_SCOPE_NOTE}`,
    building: "Farm Shop",
    observed_date: "2026-09-05",
    observed_time_precision: "design",
    timezone: "America/Chicago",
    source: `load-shed-group-correction-following:${LOAD_SHED_GROUP_PRESERVED_BATCH_IDS.join(",")}`,
    evidence: [
      {
        name: "logical-resilience-grouping",
        label: `Load shedding belongs to ${RING_CAMERA_LOGICAL_PANEL_TOKEN}, assigned to ${RING_CAMERA_PROPOSED_PANEL}`,
        subject: LOAD_SHED_GROUP_LOADS.join(", "),
      },
    ],
    compensates_batch_id: null,
    items: items.length
      ? items
      : [
          {
            item_key: "load-shed-group-no-change",
            entity_kind: "load",
            target_stable_id: null,
            observation_class: "HOLD_UNRESOLVED",
            operation: "HOLD_UNRESOLVED",
            fields: {},
            refs: {},
            evidence: EVIDENCE,
            notes: `Both records already record the load-shedding group as ${RING_CAMERA_LOGICAL_PANEL_TOKEN}; nothing is staged.`,
            reason: "No load-shedding group change required.",
          },
        ],
  };

  return { manifest, rows, loadsNotFound, alreadyCorrect, held };
}

/** CSV of the before/after preview. */
export function loadShedGroupCsv(rows: readonly LoadShedGroupRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["load_id", "found", "load_shed_group_before", "load_shed_group_after", "held", "note"];
  return [
    head.join(","),
    ...rows.map((r) =>
      [r.load_id, r.found, r.before ?? "", r.after ?? "", r.held, r.note].map(esc).join(","),
    ),
  ].join("\n");
}
