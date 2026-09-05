// Phase 4.2 — read-only snapshot endpoint used by BosteadFarmsBuildDocs.
//
// Reads only. It never writes an electrical record and never touches the
// canonical PremoFarmElectrical.ods workbook.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import { runIntegrityChecks } from "@/lib/electrical-integrity";
import { validatePanelLayout } from "@/lib/electrical-panel-layout";
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

  // Phase 4.3 child collections.
  const { data: positions, error: bpError } = await db
    .from("electrical_breaker_positions")
    .select("*");
  if (bpError) throw new Error(bpError.message);
  const { data: exits, error: exError } = await db.from("electrical_panel_exits").select("*");
  if (exError) throw new Error(exError.message);
  const breakerPositions = (positions ?? []) as RawRow[];
  const panelExits = (exits ?? []) as RawRow[];

  const graph: ElectricalGraphData = {
    panel: rows.panel as Row[],
    circuit_group: rows.circuit_group as Row[],
    load: rows.load as Row[],
    raceway: rows.raceway as Row[],
    jbox: rows.jbox as Row[],
    branch: rows.branch as Row[],
    rack: rows.rack as Row[],
    power_asset: rows.power_asset as Row[],
    device: rows.device as Row[],
    waypoint: waypointRows as Row[],
  };
  const layoutFindings = validatePanelLayout({
    panels: rows.panel as Record<string, unknown>[],
    positions: breakerPositions as Record<string, unknown>[],
    exits: panelExits as Record<string, unknown>[],
    raceways: rows.raceway as Record<string, unknown>[],
  }).map((f) => ({
    code: f.code,
    severity: f.severity,
    stable_id: f.panelId,
    message: f.message,
  }));
  const qa = runIntegrityChecks(graph).map((f) => ({
    code: f.code,
    severity: f.severity,
    stable_id: f.stableId,
    message: f.message,
  })).concat(layoutFindings);

  // Schema 1.3 switching and control topology.
  const switchTables = [
    "electrical_switch_banks",
    "electrical_switch_devices",
    "electrical_control_groups",
    "electrical_control_targets",
    "electrical_control_wiring_segments",
  ] as const;
  const switchRows: RawRow[][] = [];
  for (const table of switchTables) {
    const { data, error } = await db.from(table).select("*");
    if (error) throw new Error(error.message);
    switchRows.push((data ?? []) as RawRow[]);
  }

  return buildElectricalSnapshot({
    generatedAt: new Date().toISOString(),
    rows,
    waypoints: waypointRows,
    breakerPositions,
    panelExits,
    switchBanks: switchRows[0] ?? [],
    switchDevices: switchRows[1] ?? [],
    controlGroups: switchRows[2] ?? [],
    controlTargets: switchRows[3] ?? [],
    controlWiringSegments: switchRows[4] ?? [],
    qa,
  });
}

/** Full snapshot for the in-app download on /electrical/export. */
export const electricalSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ElectricalSnapshot> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    return collectSnapshot(context.supabase);
  });
