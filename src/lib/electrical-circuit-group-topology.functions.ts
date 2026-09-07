// Preview and apply topology-derived circuit-group assignment for branch runs.
// Apply only ever sets `circuit_group_uuid` on branches whose verified endpoint
// load has exactly one circuit group. Conflicts stay untouched, and containers
// (junction boxes, raceways) are never assigned.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  circuitGroupDisplayLabel,
  deriveBranchCircuitGroups,
  type BranchGroupPlan,
  type TopoBranchRow,
  type TopoGroupRow,
  type TopoJboxRow,
  type TopoLoadRow,
} from "@/lib/electrical-circuit-group-topology";

type LooseDb = { from: (table: string) => any };

async function read<T>(db: LooseDb, table: string, columns: string, order?: string): Promise<T[]> {
  let q = db.from(table).select(columns);
  if (order) q = q.order(order);
  const { data, error } = await q;
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function loadPlan(db: LooseDb): Promise<BranchGroupPlan> {
  const [branches, loads, groups, jboxes] = await Promise.all([
    read<TopoBranchRow>(
      db,
      "electrical_branch_runs",
      "id, branch_id, load_uuid, dest_endpoint_ref, circuit_group_uuid, source_jbox_uuid, source_endpoint_ref",
      "branch_id",
    ),
    read<TopoLoadRow>(db, "electrical_loads", "id, load_id, circuit_group_uuid", "load_id"),
    read<TopoGroupRow>(
      db,
      "electrical_circuit_groups",
      "id, circuit_group_id, description, suggested_panel, breaker_number",
      "circuit_group_id",
    ),
    read<TopoJboxRow>(db, "electrical_junction_boxes", "id, jbox_id", "jbox_id"),
  ]);
  return deriveBranchCircuitGroups({ branches, loads, groups, jboxes });
}

/** Reviewable plan — read only. */
export const previewBranchCircuitGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BranchGroupPlan> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    return loadPlan(context.supabase as unknown as LooseDb);
  });

export interface BranchGroupApplyResult {
  linked: number;
  messages: string[];
}

/** Set the derived circuit group on the selected branch runs. */
export const applyBranchCircuitGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ branchIds: z.array(z.string().trim().min(1)).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<BranchGroupApplyResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const plan = await loadPlan(db);
    const selected = data.branchIds?.length ? new Set(data.branchIds) : null;
    const messages: string[] = [];
    let linked = 0;

    for (const p of plan.proposals) {
      if (selected && !selected.has(p.branch_id)) continue;
      const upd = await db
        .from("electrical_branch_runs")
        .update({ circuit_group_uuid: p.circuit_group_uuid })
        .eq("id", p.branchRowId)
        .eq("user_id", context.userId)
        .is("circuit_group_uuid", null);
      if (upd.error) {
        messages.push(`${p.branch_id}: ${upd.error.message}`);
        continue;
      }
      linked++;
    }

    for (const s of plan.skipped) messages.push(`${s.branch_id}: ${s.reason}`);
    for (const c of plan.containers) messages.push(`${c.stable_id}: ${c.reason}`);
    return { linked, messages };
  });

export interface CircuitGroupChoice {
  id: string;
  circuit_group_id: string;
  description: string;
  panelBreaker: string;
  display: string;
  install_status: string;
}

/**
 * Every circuit group in the permanent circuit-group table, including records
 * created by applied audit batches. No legacy-classification filter is applied,
 * so FIELD_AS_BUILT and audit-created groups are always selectable. A read
 * failure throws so the UI can show an explicit load error instead of an empty
 * selector.
 */
export const listCircuitGroupChoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CircuitGroupChoice[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const rows = await read<TopoGroupRow & { install_status?: string | null }>(
      context.supabase as unknown as LooseDb,
      "electrical_circuit_groups",
      "id, circuit_group_id, description, suggested_panel, breaker_number, install_status",
      "circuit_group_id",
    );
    return rows.map((r) => ({
      id: r.id,
      circuit_group_id: String(r.circuit_group_id ?? ""),
      description: String(r.description ?? ""),
      panelBreaker: circuitGroupDisplayLabel(r).split(" — ").slice(2).join(" — "),
      display: circuitGroupDisplayLabel(r),
      install_status: String(r.install_status ?? ""),
    }));
  });
