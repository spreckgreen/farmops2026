// FARMOPS-ELEC-CG-TOPOLOGY-V1 — topology-derived circuit-group reconciliation.
//
// The only assignment this module proposes is deterministic and relationship
// derived: a branch run whose *verified* endpoint load carries exactly one
// circuit-group assignment inherits that same circuit group. Nothing is ever
// read out of a branch, box or conduit *name*.
//
// Containers are deliberately excluded:
//   * a junction box may hold branches from several circuit groups, so it never
//     receives a single group (BR-105-01-01 → group E, BR-105-01-02 → group D);
//   * a raceway may carry multiple circuits, so it is never auto-assigned.
//
// Pure: it produces a reviewable plan and never writes.

export interface TopoBranchRow {
  id: string;
  branch_id: string;
  load_uuid?: string | null;
  dest_endpoint_ref?: string | null;
  circuit_group_uuid?: string | null;
  source_jbox_uuid?: string | null;
  source_endpoint_ref?: string | null;
}

export interface TopoLoadRow {
  id: string;
  load_id: string;
  circuit_group_uuid?: string | null;
}

export interface TopoGroupRow {
  id: string;
  circuit_group_id: string;
  description?: string | null;
  suggested_panel?: string | null;
  breaker_number?: number | null;
}

export interface TopoJboxRow {
  id: string;
  jbox_id: string;
}

const str = (v: unknown) => String(v ?? "").trim();

/** Panel/breaker reference for display, e.g. `PNL-FS-NW-B29`. */
export function circuitGroupBreakerText(group: {
  suggested_panel?: string | null;
  breaker_number?: number | null;
}): string {
  const panel = str(group.suggested_panel);
  const breaker = group.breaker_number;
  if (panel && breaker != null) return `${panel}-B${breaker}`;
  if (panel) return panel;
  if (breaker != null) return `B${breaker}`;
  return "";
}

/**
 * `circuit_group_id — description — panel/breaker`, with unknown parts omitted
 * instead of being invented. Used by every circuit-group selector and item page.
 */
export function circuitGroupDisplayLabel(group: TopoGroupRow): string {
  return [str(group.circuit_group_id), str(group.description), circuitGroupBreakerText(group)]
    .filter(Boolean)
    .join(" — ");
}

export interface BranchGroupProposal {
  branchRowId: string;
  branch_id: string;
  load_id: string;
  circuit_group_uuid: string;
  circuit_group_id: string;
  display: string;
  reason: string;
}

export interface BranchGroupSkip {
  branch_id: string;
  reason: string;
}

export interface ContainerNote {
  kind: "jbox" | "raceway";
  stable_id: string;
  circuitGroupIds: string[];
  reason: string;
}

export interface BranchGroupPlan {
  proposals: BranchGroupProposal[];
  /** Already correct — nothing to write. */
  satisfied: BranchGroupSkip[];
  /** Reported, never guessed: no endpoint, no load group, or a conflict. */
  skipped: BranchGroupSkip[];
  containers: ContainerNote[];
  totals: {
    branches: number;
    proposals: number;
    satisfied: number;
    skipped: number;
    containers: number;
  };
}

export const RACEWAY_NO_AUTO_ASSIGN_RULE =
  "A raceway may carry conductors from several circuits, so a circuit group is never assigned to it automatically.";

export const JBOX_NO_AUTO_ASSIGN_RULE =
  "A junction box may contain branches from more than one circuit group, so it is never given a single circuit group.";

export function deriveBranchCircuitGroups(input: {
  branches: TopoBranchRow[];
  loads: TopoLoadRow[];
  groups: TopoGroupRow[];
  jboxes?: TopoJboxRow[];
}): BranchGroupPlan {
  const loadById = new Map(input.loads.map((l) => [l.id, l]));
  const groupById = new Map(input.groups.map((g) => [g.id, g]));
  const jboxById = new Map((input.jboxes ?? []).map((b) => [b.id, b]));

  const proposals: BranchGroupProposal[] = [];
  const satisfied: BranchGroupSkip[] = [];
  const skipped: BranchGroupSkip[] = [];
  /** jbox uuid → circuit group stable IDs observed through its branches. */
  const byJbox = new Map<string, Set<string>>();

  const branches = [...input.branches].sort((a, b) => a.branch_id.localeCompare(b.branch_id));

  for (const branch of branches) {
    const load = str(branch.load_uuid) ? (loadById.get(str(branch.load_uuid)) ?? null) : null;
    const loadLabel = load?.load_id ?? str(branch.dest_endpoint_ref);

    if (!load) {
      skipped.push({
        branch_id: branch.branch_id,
        reason: str(branch.dest_endpoint_ref)
          ? `Endpoint "${str(branch.dest_endpoint_ref)}" is not linked to an existing load record — link the endpoint first.`
          : "No verified endpoint load on this branch.",
      });
      continue;
    }

    const group = str(load.circuit_group_uuid)
      ? (groupById.get(str(load.circuit_group_uuid)) ?? null)
      : null;
    if (!group) {
      skipped.push({
        branch_id: branch.branch_id,
        reason: `Endpoint load ${load.load_id} carries no single circuit-group assignment.`,
      });
      continue;
    }

    const jboxUuid = str(branch.source_jbox_uuid);
    if (jboxUuid) {
      const set = byJbox.get(jboxUuid) ?? new Set<string>();
      set.add(group.circuit_group_id);
      byJbox.set(jboxUuid, set);
    }

    const existing = str(branch.circuit_group_uuid);
    if (existing && existing === group.id) {
      satisfied.push({
        branch_id: branch.branch_id,
        reason: `Already on ${group.circuit_group_id} via ${load.load_id}.`,
      });
      continue;
    }
    if (existing) {
      const current = groupById.get(existing);
      skipped.push({
        branch_id: branch.branch_id,
        reason: `Conflict: branch is on ${current?.circuit_group_id ?? "another circuit group"} but endpoint load ${load.load_id} is on ${group.circuit_group_id} — resolve by hand.`,
      });
      continue;
    }

    proposals.push({
      branchRowId: branch.id,
      branch_id: branch.branch_id,
      load_id: load.load_id,
      circuit_group_uuid: group.id,
      circuit_group_id: group.circuit_group_id,
      display: circuitGroupDisplayLabel(group),
      reason: `Endpoint load ${loadLabel} has exactly one circuit-group assignment (${group.circuit_group_id}); the branch inherits the same relationship.`,
    });
  }

  const containers: ContainerNote[] = [];
  for (const [uuid, set] of [...byJbox.entries()].sort((a, b) =>
    (jboxById.get(a[0])?.jbox_id ?? a[0]).localeCompare(jboxById.get(b[0])?.jbox_id ?? b[0]),
  )) {
    const ids = [...set].sort();
    containers.push({
      kind: "jbox",
      stable_id: jboxById.get(uuid)?.jbox_id ?? uuid,
      circuitGroupIds: ids,
      reason:
        ids.length > 1
          ? `${JBOX_NO_AUTO_ASSIGN_RULE} This box carries ${ids.join(" and ")}.`
          : JBOX_NO_AUTO_ASSIGN_RULE,
    });
  }

  return {
    proposals,
    satisfied,
    skipped,
    containers,
    totals: {
      branches: branches.length,
      proposals: proposals.length,
      satisfied: satisfied.length,
      skipped: skipped.length,
      containers: containers.length,
    },
  };
}
