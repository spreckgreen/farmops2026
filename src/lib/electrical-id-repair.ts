// Phase 4.2 topology / encoded-ID repair planner.
//
// Junction boxes that were first entered without their sequence suffix (JB-105)
// have been corrected to the canonical JB-105-01 form. The relational FK and the
// corrected junction-box stable ID are authoritative; what remains is the stale
// dependent data that still spells the old, unsuffixed name:
//
//   1. raceway legacy endpoint reference text (`dest_endpoint_ref = 'JB-105'`)
//   2. branch-run stable IDs whose encoded junction-box sequence reflects the
//      mis-entered box (BR-105-02-02 linked to JB-105-01 -> BR-105-01-02)
//
// This module is pure and preview-first: it only ever proposes changes. Nothing
// is renamed unless the relational parent proves the correct value, and the
// junction-box IDs themselves are never reverted to satisfy validation.

import { parseHierarchicalId } from "@/lib/electrical";

export type Row = Record<string, unknown>;

export interface RefRepair {
  /** Raceway UUID. */
  id: string;
  stable_id: string;
  field: "source_endpoint_ref" | "dest_endpoint_ref";
  was: string;
  now: string;
  /** Which relational link proves the corrected value. */
  via: string;
}

export interface BranchIdRepair {
  id: string;
  was: string;
  now: string;
  /** The relational parent junction box that proves the corrected ID. */
  parent: string;
}

export interface RepairBlocked {
  stable_id: string;
  reason: string;
}

/**
 * A dependent record that spells a corrected branch-run stable ID. Renaming the
 * branch in place (same UUID, same relational parent) leaves this text stale, so
 * it is propagated in the same preview/apply pass.
 */
export interface DependentRefRepair {
  table: string;
  id: string;
  field: string;
  /** Stable ID of the dependent record, for display. */
  stable_id: string;
  was: string;
  now: string;
}

export interface RepairPlan {
  refs: RefRepair[];
  branchIds: BranchIdRepair[];
  dependents: DependentRefRepair[];
  blocked: RepairBlocked[];
}

const s = (v: unknown) => String(v ?? "").trim();

function stableIdMap(rows: Row[], field: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = s(row["id"]);
    const stable = s(row[field]);
    if (id && stable) map.set(id, stable);
  }
  return map;
}

export interface RepairInput {
  raceways: Row[];
  jboxes: Row[];
  panels: Row[];
  branches: Row[];
  /** Optional dependent collections that carry stable-ID text. */
  feeders?: Row[];
  labels?: Row[];
  exits?: Row[];
}


/**
 * Build the repair plan. Only exact, relationally proven corrections are
 * proposed; anything ambiguous is reported as blocked for manual review.
 */
export function planIdRepairs(input: RepairInput): RepairPlan {
  const jbox = stableIdMap(input.jboxes, "jbox_id");
  const panel = stableIdMap(input.panels, "panel_id");
  const refs: RefRepair[] = [];
  const branchIds: BranchIdRepair[] = [];
  const blocked: RepairBlocked[] = [];

  const endpoints: {
    rows: Row[];
    stableField: string;
    sides: { uuid: string; ref: RefRepair["field"] }[];
  }[] = [
    {
      rows: input.raceways,
      stableField: "conduit_id",
      sides: [
        { uuid: "source_panel_uuid", ref: "source_endpoint_ref" },
        { uuid: "source_jbox_uuid", ref: "source_endpoint_ref" },
        { uuid: "dest_panel_uuid", ref: "dest_endpoint_ref" },
        { uuid: "dest_jbox_uuid", ref: "dest_endpoint_ref" },
      ],
    },
    {
      rows: input.branches,
      stableField: "branch_id",
      sides: [
        { uuid: "source_panel_uuid", ref: "source_endpoint_ref" },
        { uuid: "source_jbox_uuid", ref: "source_endpoint_ref" },
      ],
    },
  ];

  for (const group of endpoints) {
    for (const row of group.rows) {
      const stable = s(row[group.stableField]);
      for (const side of group.sides) {
        const linkedUuid = s(row[side.uuid]);
        if (!linkedUuid) continue;
        const linked = side.uuid.includes("jbox")
          ? jbox.get(linkedUuid)
          : panel.get(linkedUuid);
        if (!linked) continue;
        const current = s(row[side.ref]);
        // A blank reference is incomplete data, not a contradiction; the write
        // trigger fills it in. Only rewrite text that actively disagrees.
        if (!current || current.toUpperCase() === linked.toUpperCase()) continue;
        refs.push({
          id: s(row["id"]),
          stable_id: stable,
          field: side.ref,
          was: current,
          now: linked,
          via: side.uuid,
        });
      }
    }
  }

  // Branch stable IDs: the relational junction box is authoritative.
  const taken = new Set(input.branches.map((b) => s(b["branch_id"]).toUpperCase()));
  for (const row of input.branches) {
    const was = s(row["branch_id"]);
    const parentUuid = s(row["source_jbox_uuid"]);
    if (!was || !parentUuid) continue;
    const parent = jbox.get(parentUuid);
    if (!parent) continue;
    const encoded = parseHierarchicalId(was);
    const parsedParent = parseHierarchicalId(parent);
    if (!parsedParent || parsedParent.prefix !== "JB" || !parsedParent.jbox) {
      // The parent itself is not canonical, so there is nothing to derive from.
      continue;
    }
    const expectedPrefix = `BR-${parsedParent.path}-${parsedParent.jbox}-`;
    if (encoded?.prefix === "BR" && encoded.jbox && encoded.branch) {
      if (encoded.path === parsedParent.path && encoded.jbox === parsedParent.jbox) continue;
      if (encoded.path !== parsedParent.path) {
        blocked.push({
          stable_id: was,
          reason: `Encoded raceway path ${encoded.path} differs from the relational parent ${parent}. That is a topology question, not a sequence typo — relink the branch or confirm the correct path before any ID change.`,
        });
        continue;
      }
      // Only the junction-box sequence was mis-entered. The installed physical
      // label keeps its own branch sequence, so the corrected ID is exact — it
      // is never bumped to another sequence. If that exact ID is already in use
      // by a different record, stop and report instead of guessing.
      const next = `${expectedPrefix}${String(Number(encoded.branch)).padStart(2, "0")}`;
      if (taken.has(next.toUpperCase())) {
        blocked.push({
          stable_id: was,
          reason: `${next} is already in use by another branch run. Confirm the installed labels for both records before any ID change.`,
        });
        continue;
      }
      taken.delete(was.toUpperCase());
      taken.add(next.toUpperCase());
      branchIds.push({ id: s(row["id"]), was, now: next, parent });
    }
  }

  // Propagate corrected branch stable IDs into dependent text references. The
  // record itself is renamed in place — same UUID, same relational parent.
  const renamed = new Map<string, string>();
  for (const r of branchIds) renamed.set(r.was.toUpperCase(), r.now);
  const dependents: DependentRefRepair[] = [];
  if (renamed.size) {
    const scan: { table: string; rows: Row[]; stableField: string; fields: string[] }[] = [
      {
        table: "electrical_raceways",
        rows: input.raceways,
        stableField: "conduit_id",
        fields: ["source_endpoint_ref", "dest_endpoint_ref"],
      },
      {
        table: "electrical_branch_runs",
        rows: input.branches,
        stableField: "branch_id",
        fields: ["source_endpoint_ref", "dest_endpoint_ref"],
      },
      {
        table: "electrical_feeders",
        rows: input.feeders ?? [],
        stableField: "feeder_id",
        fields: ["source_endpoint_ref", "dest_endpoint_ref", "raceway_ref"],
      },
      {
        table: "electrical_labels",
        rows: input.labels ?? [],
        stableField: "entity_stable_id",
        fields: ["entity_stable_id"],
      },
      {
        table: "electrical_panel_exits",
        rows: input.exits ?? [],
        stableField: "raceway_ref",
        fields: ["raceway_ref"],
      },
    ];
    for (const group of scan) {
      for (const row of group.rows) {
        for (const field of group.fields) {
          const current = s(row[field]);
          if (!current) continue;
          const now = renamed.get(current.toUpperCase());
          if (!now || now === current) continue;
          dependents.push({
            table: group.table,
            id: s(row["id"]),
            field,
            stable_id: s(row[group.stableField]) || s(row["id"]),
            was: current,
            now,
          });
        }
      }
    }
  }

  return { refs, branchIds, dependents, blocked };
}

export function repairPlanIsEmpty(plan: RepairPlan): boolean {
  return (
    plan.refs.length === 0 && plan.branchIds.length === 0 && plan.dependents.length === 0
  );
}

