// Derive circuit group records from Load_Master data (no separate worksheet).
// Preview is always available; apply only ever inserts missing groups and links
// loads that resolve to exactly one group. Nothing is deleted or rebuilt.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import {
  deriveCircuitGroups,
  type DerivationPlan,
  type GroupRow,
  type LoadRow,
} from "@/lib/electrical-circuit-groups";

type LooseDb = { from: (table: string) => any };

async function loadPlan(db: LooseDb, userId: string): Promise<DerivationPlan> {
  const loads = await db
    .from("electrical_loads")
    .select(
      "id, load_id, description, area, notes, circuit_group_ref, circuit_group_uuid, source_circuit, dedicated, critical, volts",
    )
    .eq("user_id", userId)
    .order("load_id");
  if (loads.error) throw new Error(loads.error.message);
  const groups = await db
    .from("electrical_circuit_groups")
    .select("id, circuit_group_id, description")
    .eq("user_id", userId);
  if (groups.error) throw new Error(groups.error.message);
  return deriveCircuitGroups(
    (loads.data ?? []) as LoadRow[],
    (groups.data ?? []) as GroupRow[],
  );
}

/** Reviewable derivation plan — read only. */
export const previewCircuitGroupDerivation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DerivationPlan> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    return loadPlan(context.supabase as unknown as LooseDb, context.userId);
  });

export interface DerivationResult {
  createdGroups: number;
  linkedLoads: number;
  unresolved: number;
  ambiguous: number;
  messages: string[];
}

/** Create missing circuit groups and link loads that resolve unambiguously. */
export const applyCircuitGroupDerivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ groupIds: z.array(z.string().trim().min(1)).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<DerivationResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const plan = await loadPlan(db, context.userId);
    const selected = data.groupIds?.length ? new Set(data.groupIds) : null;
    const groups = plan.groups.filter((g) => !selected || selected.has(g.circuit_group_id));

    const messages: string[] = [];
    const idByStableId = new Map<string, string>();
    for (const g of groups) if (g.existingId) idByStableId.set(g.circuit_group_id, g.existingId);

    const toCreate = groups.filter((g) => !g.exists);
    if (toCreate.length) {
      const insert = await db
        .from("electrical_circuit_groups")
        .insert(
          toCreate.map((g) => ({
            user_id: context.userId,
            circuit_group_id: g.circuit_group_id,
            description: g.description,
          })),
        )
        .select("id, circuit_group_id");
      if (insert.error) throw new Error(insert.error.message);
      for (const row of (insert.data ?? []) as GroupRow[]) {
        idByStableId.set(row.circuit_group_id, row.id);
      }
    }

    let linked = 0;
    for (const link of plan.links) {
      if (selected && !selected.has(link.circuit_group_id)) continue;
      const groupId = idByStableId.get(link.circuit_group_id);
      if (!groupId) {
        messages.push(`${link.load_id}: circuit group ${link.circuit_group_id} was not created.`);
        continue;
      }
      const upd = await db
        .from("electrical_loads")
        .update({ circuit_group_uuid: groupId })
        .eq("id", link.loadRowId)
        .eq("user_id", context.userId);
      if (upd.error) {
        messages.push(`${link.load_id}: ${upd.error.message}`);
        continue;
      }
      linked++;
    }

    for (const a of plan.ambiguous) {
      messages.push(
        `Circuit group ID ${a.ref} matches ${a.existing.length} existing records — left untouched for manual review.`,
      );
    }
    if (plan.unresolved.length) {
      messages.push(
        `${plan.unresolved.length} load(s) carry no circuit group reference and were not linked.`,
      );
    }

    return {
      createdGroups: toCreate.length,
      linkedLoads: linked,
      unresolved: plan.unresolved.length,
      ambiguous: plan.ambiguous.length,
      messages,
    };
  });
