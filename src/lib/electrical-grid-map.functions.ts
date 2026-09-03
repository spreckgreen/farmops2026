// Read-only data feed for the Farm Shop grid dot map.
// It reads loads, circuit groups, breaker positions and panels, resolves the
// panel for each load through proven relationships only, and never writes.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  buildGridMapPoints,
  summarizeGridMap,
  type GridMapLoadInput,
  type GridMapPoint,
  type GridMapSummary,
} from "@/lib/electrical-grid-map";

type LooseDb = { from: (table: string) => any };
type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

export interface GridMapPayload {
  points: GridMapPoint[];
  summary: GridMapSummary;
  /** Panels that at least one plotted load resolves to, plus the unassigned bucket. */
  panels: { panel: string; count: number; basis: string }[];
  areas: string[];
  gaps: string[];
  generatedAt: string;
}

export const electricalGridMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GridMapPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const [loadsRes, groupsRes, positionsRes, panelsRes] = await Promise.all([
      db
        .from("electrical_loads")
        .select(
          "id, load_id, description, area, location, grid, legacy_grid, grid_reference, location_x_ft, location_y_ft, dedicated, dedicated_shared, circuit_group_ref, circuit_group_uuid, suggested_panel, amps, volts, connected_va, design_circuit_ampacity, installed_ocp_rating, minimum_circuit_ampacity, maximum_overcurrent_protection",
        )
        .order("load_id"),
      db.from("electrical_circuit_groups").select("id, circuit_group_id, panel_uuid"),
      db.from("electrical_breaker_positions").select("panel_uuid, load_uuid, circuit_group_uuid"),
      db.from("electrical_panels").select("id, panel_id"),
    ]);
    for (const r of [loadsRes, groupsRes, positionsRes, panelsRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const panelById = new Map<string, string>();
    for (const p of (panelsRes.data ?? []) as Row[]) panelById.set(s(p.id), s(p.panel_id));
    const groupById = new Map<string, Row>();
    for (const g of (groupsRes.data ?? []) as Row[]) groupById.set(s(g.id), g);
    const positionByLoad = new Map<string, Row>();
    const positionByGroup = new Map<string, Row>();
    for (const pos of (positionsRes.data ?? []) as Row[]) {
      if (s(pos.load_uuid)) positionByLoad.set(s(pos.load_uuid), pos);
      if (s(pos.circuit_group_uuid)) positionByGroup.set(s(pos.circuit_group_uuid), pos);
    }

    const inputs: GridMapLoadInput[] = ((loadsRes.data ?? []) as Row[]).map((row) => {
      const group = groupById.get(s(row.circuit_group_uuid)) ?? null;
      const pos =
        positionByLoad.get(s(row.id)) ??
        (group ? positionByGroup.get(s(group.id)) : undefined) ??
        null;
      let panel: string | null = null;
      let panelBasis: string | null = null;
      if (group && s(group.panel_uuid) && panelById.get(s(group.panel_uuid))) {
        panel = panelById.get(s(group.panel_uuid))!;
        panelBasis = `Proven: circuit ${s(group.circuit_group_id) || "group"} → panel.`;
      } else if (pos && panelById.get(s(pos.panel_uuid))) {
        panel = panelById.get(s(pos.panel_uuid))!;
        panelBasis = "Proven: breaker position → panel.";
      } else if (s(row.suggested_panel)) {
        panel = s(row.suggested_panel);
        panelBasis = "Design intent only (Suggested Panel); no proven breaker relationship.";
      }
      return {
        load_id: s(row.load_id),
        description: (row.description as string | null) ?? null,
        area: (row.area as string | null) ?? null,
        location: (row.location as string | null) ?? null,
        grid: (row.grid as string | null) ?? null,
        legacy_grid: (row.legacy_grid as string | null) ?? null,
        grid_reference: (row.grid_reference as string | null) ?? null,
        location_x_ft: (row.location_x_ft as number | null) ?? null,
        location_y_ft: (row.location_y_ft as number | null) ?? null,
        dedicated: (row.dedicated as boolean | null) ?? null,
        dedicated_shared: (row.dedicated_shared as string | null) ?? null,
        circuit_group_ref: (row.circuit_group_ref as string | null) ?? null,
        amps: (row.amps as number | null) ?? null,
        volts: (row.volts as number | null) ?? null,
        connected_va: (row.connected_va as number | null) ?? null,
        design_circuit_ampacity: (row.design_circuit_ampacity as number | null) ?? null,
        installed_ocp_rating: (row.installed_ocp_rating as number | null) ?? null,
        minimum_circuit_ampacity: (row.minimum_circuit_ampacity as number | null) ?? null,
        maximum_overcurrent_protection:
          (row.maximum_overcurrent_protection as number | null) ?? null,
        panel,
        panelBasis,
      };
    });

    // The plan drawing is the Farm Shop, so only Farm Shop rows are plotted.
    const shopInputs = inputs.filter((r) => s(r.area).toLowerCase().includes("farm shop"));
    const points = buildGridMapPoints(shopInputs);
    const summary = summarizeGridMap(points);

    const panelCounts = new Map<string, { count: number; basis: string }>();
    for (const p of points) {
      const key = p.panel;
      const cur = panelCounts.get(key) ?? { count: 0, basis: p.panelBasis };
      cur.count += 1;
      panelCounts.set(key, cur);
    }
    const panels = [...panelCounts.entries()]
      .map(([panel, v]) => ({ panel, count: v.count, basis: v.basis }))
      .sort((a, b) => (a.panel === "NOT IN RECORD" ? 1 : b.panel === "NOT IN RECORD" ? -1 : a.panel.localeCompare(b.panel)));

    // Panels that exist as records but have no load resolving to them.
    const shopPanels = [...panelById.values()].filter((p) => p.startsWith("PNL-FS"));
    for (const p of shopPanels) {
      if (!panelCounts.has(p)) {
        panels.push({
          panel: p,
          count: 0,
          basis: "Panel record exists; no load resolves to it in the record yet.",
        });
      }
    }

    const gaps: string[] = [];
    if (summary.unplaced) {
      gaps.push(
        `${summary.unplaced} of ${summary.total} Farm Shop loads have no position: the grid value is MOBILE, blank or a non-location artifact, and no physical X/Y is recorded.`,
      );
    }
    if (!points.some((p) => p.coordinateBasis === "RECORDED_XY")) {
      gaps.push(
        "No Farm Shop load carries a recorded physical X/Y yet, so every dot is derived from the legacy grid through the frozen transformation.",
      );
    }
    if (panelCounts.size === 1 && panelCounts.has("NOT IN RECORD")) {
      gaps.push(
        "No load resolves to a panel: circuit groups, breaker positions and Suggested Panel are all empty in the record, so panel filtering has nothing proven to filter on.",
      );
    }
    if (summary.counts.UNCLASSIFIED) {
      gaps.push(
        `${summary.counts.UNCLASSIFIED} load(s) cannot be classified: Dedicated/Shared, circuit rating and recorded current/VA are all absent.`,
      );
    }

    const areas = [...new Set(inputs.map((r) => s(r.area)).filter(Boolean))].sort();

    return { points, summary, panels, areas, gaps, generatedAt: new Date().toISOString() };
  });
