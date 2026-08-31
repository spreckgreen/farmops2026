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
  /** Authenticated subject used by the explicit owner-scoped reads. */
  authUid: string;
  /** Deploy identity plus a source marker proving this diagnostic build is running. */
  buildVersion: string;
  diagnosticVersion: "raceway-path-data-path-v1";
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
  /** Exact pre/post-resolver evidence for the production path-104 investigation. */
  path104: {
    auth_uid: string;
    jbox_104_01_visible: boolean;
    jbox_104_02_visible: boolean;
    jbox_104_03_visible: boolean;
    con_104_visible: boolean;
    jboxes_fetched: number;
    raceways_fetched: number;
    rows_passed_to_resolver: number;
    resolver_results: number;
  };
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
        /** Junction-box stable IDs to inspect. Empty = every resolver result. */
        jbox_ids: z.array(z.string().trim().min(1)).max(2000).default([]),
        /** Production verification is intentionally read-only. */
        confirm: z.literal(false).default(false),
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
          .eq("user_id", context.userId)
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

    const graph = {
      panel: [],
      circuit_group: [],
      load: [],
      raceway: rw.rows,
      jbox: jb.rows,
      branch: [],
    } as never;
    const plan = planJboxRacewayPopulation(graph);
    const resolutions = resolveJboxRacewayCandidates(graph);
    const jboxRowsRead = jb.rows;
    const racewayRowsRead = rw.rows;
    const byPath = buildRacewaysByPath(racewayRowsRead as never);
    const jboxIdsRead = new Set(
      jboxRowsRead.map((row) => String(row["jbox_id"] ?? "").trim().toUpperCase()),
    );
    const racewayIdsRead = new Set(
      racewayRowsRead.map((row) => String(row["conduit_id"] ?? "").trim().toUpperCase()),
    );
    const buildVersion =
      process.env["GIT_COMMIT"] ??
      process.env["SOURCE_COMMIT"] ??
      process.env["BUILD_ID"] ??
      "not-injected";
    const statusCounts: Record<PathProposal["status"], number> = {
      proposed: 0,
      already_linked: 0,
      no_evidence: 0,
      conflict: 0,
    };
    for (const p of plan) statusCounts[p.status]++;
    const resolutionCounts: Record<PathResolution["status"], number> = {
      proposed: 0,
      already_linked: 0,
      ambiguous_raceway: 0,
      no_matching_raceway: 0,
      parent_conflict: 0,
      sequence_conflict: 0,
      unparseable_id: 0,
    };
    for (const r of resolutions) resolutionCounts[r.status]++;
    const diagnostics: PathPopulationDiagnostics = {
      authUid: context.userId,
      buildVersion,
      diagnosticVersion: "raceway-path-data-path-v1",
      jboxRows: jboxRowsRead.length,
      racewayRows: racewayRowsRead.length,
      linkedJboxes: jboxRowsRead.filter((j) => String(j["raceway_uuid"] ?? "").trim()).length,
      statusCounts,
      resolutionCounts,
      racewaysByPath: [...byPath.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([path, rows]) => ({
          path,
          raceways: rows.map((r) => String(r["conduit_id"] ?? "").trim()).sort(),
        })),
      databaseTotals: { jboxes: jb.total, raceways: rw.total },
      path104: {
        auth_uid: context.userId,
        jbox_104_01_visible: jboxIdsRead.has("JB-104-01"),
        jbox_104_02_visible: jboxIdsRead.has("JB-104-02"),
        jbox_104_03_visible: jboxIdsRead.has("JB-104-03"),
        con_104_visible: racewayIdsRead.has("CON-104"),
        jboxes_fetched: jboxRowsRead.length,
        raceways_fetched: racewayRowsRead.length,
        rows_passed_to_resolver: jboxRowsRead.length,
        resolver_results: resolutions.length,
      },
      // Unfiltered: every junction box the preview saw, with its exact decision.
      resolutions: resolutions.map((r) => ({
        jbox_id: r.jbox_id,
        extracted_path: r.extracted_path,
        raceway_uuid: r.current_raceway_uuid,
        sequence: r.current_sequence,
        matching_raceways: r.matching_raceways.map((m) => m.stable_id),
        endpoint_raceways: r.endpoint_raceways,
        status: r.status,
        rejection_reason: r.reason,
        proposed_raceway: r.target_raceway,
        proposed_sequence: r.proposed_sequence,
      })),
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
      rows.push({ ...proposal, outcome: "would_change" });
      changed++;
    }

    return { applied: false, changed, skipped, rows, diagnostics };
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
