// Phase 4.4b — preview-first population of the continuous-raceway topology.
//
// Preview re-reads the live junction boxes and raceways and reports the exact
// proposal per record. Apply requires `confirm: true` and writes ONLY
// raceway_uuid / raceway_sequence / raceway_ref on the junction box. It never
// touches stable IDs, other relationships, ods_extras, engineering values,
// labels, installation state or the canonical ODS.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import {
  orderedJunctionPoints,
  planJboxRacewayPopulation,
  type PathProposal,
} from "@/lib/electrical-raceway-path";

export interface PathPopulationRow extends PathProposal {
  outcome: "would_change" | "skipped" | "applied" | "failed" | "drifted";
  detail?: string;
}

export interface PathPopulationResult {
  applied: boolean;
  changed: number;
  skipped: number;
  rows: PathPopulationRow[];
}

export const previewRacewayPathPopulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        /** Junction-box stable IDs to act on. Empty = every eligible proposal. */
        jbox_ids: z.array(z.string().trim().min(1)).max(2000).default([]),
        confirm: z.boolean().default(false),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<PathPopulationResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as { from: (t: string) => any };
    const [jb, rw] = await Promise.all([
      db.from("electrical_junction_boxes").select("*"),
      db.from("electrical_raceways").select("*"),
    ]);
    if (jb.error) throw new Error(jb.error.message);
    if (rw.error) throw new Error(rw.error.message);

    const plan = planJboxRacewayPopulation({
      panel: [],
      circuit_group: [],
      load: [],
      raceway: rw.data ?? [],
      jbox: jb.data ?? [],
      branch: [],
    } as never);
    const wanted = new Set(data.jbox_ids.map((s) => s.trim().toUpperCase()));
    const rows: PathPopulationRow[] = [];
    let changed = 0;
    let skipped = 0;

    for (const proposal of plan) {
      const selected = wanted.size === 0 || wanted.has(proposal.jbox_id.toUpperCase());
      if (!selected) continue;
      if (proposal.status !== "proposed" || !proposal.jbox_uuid || !proposal.proposed_raceway_uuid) {
        rows.push({ ...proposal, outcome: "skipped", detail: proposal.evidence });
        skipped++;
        continue;
      }
      if (!data.confirm) {
        rows.push({ ...proposal, outcome: "would_change" });
        changed++;
        continue;
      }
      const { error } = await db
        .from("electrical_junction_boxes")
        .update({
          raceway_uuid: proposal.proposed_raceway_uuid,
          raceway_sequence: proposal.proposed_sequence,
          raceway_ref: proposal.proposed_raceway,
        })
        .eq("id", proposal.jbox_uuid)
        // Drift protection: only write when the record is still unlinked.
        .is("raceway_uuid", null);
      if (error) {
        rows.push({ ...proposal, outcome: "failed", detail: error.message });
        skipped++;
        continue;
      }
      rows.push({ ...proposal, outcome: "applied" });
      changed++;
    }

    return { applied: data.confirm, changed, skipped, rows };
  });

export const listRacewayJunctionPoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ raceway_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as { from: (t: string) => any };
    const { data: rows, error } = await db
      .from("electrical_junction_boxes")
      .select("id, jbox_id, box_type, description, raceway_uuid, raceway_sequence, install_status")
      .eq("raceway_uuid", data.raceway_id);
    if (error) throw new Error(error.message);
    return orderedJunctionPoints(data.raceway_id, rows ?? []).map((p) => ({
      id: p.id,
      stable_id: p.stableId,
      sequence: p.sequence,
      box_type: String(p.row["box_type"] ?? ""),
      description: String(p.row["description"] ?? ""),
      install_status: String(p.row["install_status"] ?? ""),
    }));
  });
