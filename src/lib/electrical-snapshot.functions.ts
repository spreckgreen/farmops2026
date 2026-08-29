// Phase 4.2 — read-only snapshot endpoint used by BosteadFarmsBuildDocs.
//
// Reads only. It never writes an electrical record and never touches the
// canonical PremoFarmElectrical.ods workbook.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import { runIntegrityChecks } from "@/lib/electrical-integrity";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";
import {
  buildElectricalSnapshot,
  type ElectricalSnapshot,
  type RawRow,
} from "@/lib/electrical-snapshot";
import type { ElectricalEntityKind } from "@/lib/electrical";

type LooseDb = {
  from: (table: string) => {
    select: (columns: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

/**
 * Collect every electrical row for the caller and fold it into the versioned
 * reconciliation snapshot. Shared by the server function and the API route.
 */
export async function collectSnapshot(supabase: unknown): Promise<ElectricalSnapshot> {
  const db = supabase as LooseDb;
  const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
  for (const kind of ENTITY_KINDS) {
    const { data, error } = await db.from(ENTITIES[kind].table).select("*");
    if (error) throw new Error(error.message);
    rows[kind] = (data ?? []) as RawRow[];
  }
  const { data: waypoints, error: wpError } = await db
    .from("electrical_raceway_waypoints")
    .select("*");
  if (wpError) throw new Error(wpError.message);
  const waypointRows = (waypoints ?? []) as RawRow[];

  const graph: ElectricalGraphData = {
    panel: rows.panel as Row[],
    circuit_group: rows.circuit_group as Row[],
    load: rows.load as Row[],
    raceway: rows.raceway as Row[],
    jbox: rows.jbox as Row[],
    branch: rows.branch as Row[],
    waypoint: waypointRows as Row[],
  };
  const qa = runIntegrityChecks(graph).map((f) => ({
    code: f.code,
    severity: f.severity,
    stable_id: f.stableId,
    message: f.message,
  }));

  return buildElectricalSnapshot({
    generatedAt: new Date().toISOString(),
    rows,
    waypoints: waypointRows,
    qa,
  });
}

/** Full snapshot for the in-app download on /electrical/export. */
export const electricalSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ElectricalSnapshot> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    return collectSnapshot(context.supabase);
  });
