// Farm Shop grid-reference migration — read-only server data collection.
//
// Reads the existing canonical stable IDs and Grid values already held in
// FarmOps. It performs no writes of any kind and never touches the canonical
// PremoFarmElectrical.ods workbook.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  migrateAll,
  summarizeMigration,
  type GridMigrationRow,
  type MigrationInputRow,
  type MigrationSummary,
} from "@/lib/electrical-grid-migration";

type LooseDb = { from: (table: string) => any };

export interface GridMigrationPayload {
  generated_at: string;
  rows: GridMigrationRow[];
  summary: MigrationSummary;
  population: { farm_shop_loads_with_grid: number; farm_shop_panels: number };
}

const FARM_SHOP_AREA = /farm\s*shop/i;

export const previewFarmShopGridMigration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GridMigrationPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const [loadRes, panelRes] = await Promise.all([
      db.from("electrical_loads").select("load_id, description, grid, location, area"),
      db.from("electrical_panels").select("panel_id, description, grid, building"),
    ]);
    if (loadRes.error) throw new Error(loadRes.error.message);
    if (panelRes.error) throw new Error(panelRes.error.message);

    const loadRows = (loadRes.data ?? []) as Record<string, unknown>[];
    const panelRows = (panelRes.data ?? []) as Record<string, unknown>[];

    const s = (v: unknown) => (v == null ? "" : String(v)).trim();

    const loads: MigrationInputRow[] = loadRows
      .filter((r) => {
        const id = s(r["load_id"]);
        return (
          (id.startsWith("FS-") || FARM_SHOP_AREA.test(s(r["area"]))) && s(r["grid"]).length > 0
        );
      })
      .map((r) => ({
        kind: "load" as const,
        stable_id: s(r["load_id"]),
        description: s(r["description"]),
        grid: s(r["grid"]),
        location: s(r["location"]),
        area: s(r["area"]),
      }));

    const panels: MigrationInputRow[] = panelRows
      .filter((r) => s(r["panel_id"]).toUpperCase().startsWith("PNL-FS-"))
      .map((r) => ({
        kind: "panel" as const,
        stable_id: s(r["panel_id"]),
        description: s(r["description"]),
        grid: s(r["grid"]),
        location: s(r["building"]),
      }));

    const rows = migrateAll([...panels, ...loads]);
    return {
      generated_at: new Date().toISOString(),
      rows,
      summary: summarizeMigration(rows),
      population: { farm_shop_loads_with_grid: loads.length, farm_shop_panels: panels.length },
    };
  });
