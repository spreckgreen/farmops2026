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
  buildRacewaysByPath,
  orderedJunctionPoints,
  planJboxRacewayPopulation,
  resolveJboxRacewayCandidates,
  type PathProposal,
  type PathResolution,
} from "@/lib/electrical-raceway-path";

export interface PathPopulationRow extends PathProposal {
  outcome: "would_change" | "skipped" | "applied" | "failed" | "drifted";
  detail?: string;
}

/**
 * One diagnostic row per junction box, straight from the shared resolver. This
 * is returned unfiltered so a box can never be invisible in the report:
 * jbox_id | extracted_path | raceway_uuid | sequence | matching_raceways |
 * status | rejection_reason.
 */
export interface PathDiagnosticRow {
  jbox_id: string;
  extracted_path: string | null;
  raceway_uuid: string | null;
  sequence: number | null;
  matching_raceways: string[];
  endpoint_raceways: string[];
  status: PathResolution["status"];
  rejection_reason: string;
  proposed_raceway: string | null;
  proposed_sequence: number | null;
}

/**
 * Read-only facts about the data the preview actually saw. Without these a
 * production preview that reports "nothing to correct" is indistinguishable
 * from one that never saw the junction boxes at all.
 */
export interface PathPopulationDiagnostics {
  /** Junction-box rows visible to the signed-in user. */
  jboxRows: number;
  /** Raceway rows visible to the signed-in user. */
  racewayRows: number;
  /** Junction boxes that already carry a parent raceway link. */
  linkedJboxes: number;
  /** Proposal statuses, so "all already linked" reads differently to "no evidence". */
  statusCounts: Record<PathProposal["status"], number>;
  /** Counts per precise resolver state, so no state hides inside a bucket. */
  resolutionCounts: Record<PathResolution["status"], number>;
  /** Every raceway stable ID per encoded path number, e.g. "104": ["CON-104"]. */
  racewaysByPath: { path: string; raceways: string[] }[];
  /** Backend totals, used to prove the preview did not silently stop at an API row cap. */
  databaseTotals: { jboxes: number; raceways: number };
  /** Per-record decision for every junction box, never filtered. */
  resolutions: PathDiagnosticRow[];
}

export interface PathPopulationResult {
  applied: boolean;
  changed: number;
  skipped: number;
  rows: PathPopulationRow[];
  diagnostics: PathPopulationDiagnostics;
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
    const readAll = async (table: string) => {
      const pageSize = 500;
      const rows: Record<string, unknown>[] = [];
      let total = 0;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error, count } = await db
          .from(table)
          .select("*", { count: "exact" })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        if (from === 0) total = count ?? 0;
        const batch = (page ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < pageSize) break;
      }
      // A partial graph can produce a confident but false "nothing to correct".
      if (rows.length !== total) {
        throw new Error(
          `Raceway path preview read ${rows.length} of ${total} rows from ${table}; no proposals were produced from incomplete data.`,
        );
      }
      return { rows, total };
    };
    const [jb, rw] = await Promise.all([
      readAll("electrical_junction_boxes"),
      readAll("electrical_raceways"),
    ]);

    const plan = planJboxRacewayPopulation({
      panel: [],
      circuit_group: [],
      load: [],
      raceway: rw.rows,
      jbox: jb.rows,
      branch: [],
    } as never);
    const jboxRowsRead = jb.rows;
    const racewayRowsRead = rw.rows;
    const byPath = new Map<string, string[]>();
    for (const r of racewayRowsRead) {
      const id = String(r["conduit_id"] ?? "").trim();
      const path = racewayPathNumber(id);
      if (!path) continue;
      byPath.set(path, [...(byPath.get(path) ?? []), id].sort());
    }
    const statusCounts: Record<PathProposal["status"], number> = {
      proposed: 0,
      already_linked: 0,
      no_evidence: 0,
      conflict: 0,
    };
    for (const p of plan) statusCounts[p.status]++;
    const diagnostics: PathPopulationDiagnostics = {
      jboxRows: jboxRowsRead.length,
      racewayRows: racewayRowsRead.length,
      linkedJboxes: jboxRowsRead.filter((j) => String(j["raceway_uuid"] ?? "").trim()).length,
      statusCounts,
      racewaysByPath: [...byPath.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([path, raceways]) => ({ path, raceways })),
      databaseTotals: { jboxes: jb.total, raceways: rw.total },
    };

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

    return { applied: data.confirm, changed, skipped, rows, diagnostics };
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
