// Farm Shop grid-map recovery validation — read-only server function.
//
// Parses the supplied canonical workbook in memory, hashes it so the report is
// SHA-bound, materialises the frozen Contract v3 binding, and takes the Grid /
// Load Description / Area / Location values from their *canonical* physical
// columns. Current FarmOps grid is read for comparison only and is never used
// as the source of location. There is no write path and no apply path here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";
import { sha256Hex } from "@/lib/electrical-adjudication-baseline.functions";
import { buildContractV3 } from "@/lib/electrical-load-contract-v3";
import {
  buildGridRecovery,
  type CanonicalGridRow,
  type FarmOpsGridRow,
  type RecoveryReport,
} from "@/lib/electrical-grid-recovery";

type LooseDb = { from: (table: string) => any };
type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const FARM_SHOP_AREA = /farm\s*shop/i;

export interface GridRecoveryPayload extends RecoveryReport {
  file_name: string;
  ods_sha256: string;
  generated_at: string;
  canonical_rows_total: number;
  farm_shop_canonical_rows: number;
  farm_shop_panels: number;
  /** Physical column the canonical Grid semantic actually binds to. */
  grid_physical_column: number | null;
  grid_observed_header: string;
}

export const validateFarmShopGridRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<GridRecoveryPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");

    const { unzipSync, strFromU8 } = await import("fflate");
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ods_sha256 = await sha256Hex(bytes);

    const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
    const content = files["content.xml"];
    if (!content) {
      throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
    }
    const sheets = parseOdsContentXml(strFromU8(content));
    const loadSheet = sheets.find((sh) => classifySheet(sh) === "load");
    if (!loadSheet) throw new Error("No Load_Master sheet was found in that workbook.");

    const def = ENTITIES.load;
    const mapped = mapSheet(loadSheet, "load", importColumns("load"), def.stableIdField);
    const contract = buildContractV3(loadSheet, mapped.headerRow);

    const colFor = (semantic: string) =>
      contract.find((c) => c.canonical_semantic === semantic) ?? null;
    const gridCol = colFor("grid");
    const descCol = colFor("description");
    const areaCol = colFor("area");
    const locCol = colFor("location");
    if (!gridCol) {
      throw new Error(
        "Contract v3 could not bind the canonical Grid semantic in this workbook, so no canonical-derived map can be built.",
      );
    }

    const cell = (rowIndex: number, physicalColumn: number | undefined): string =>
      physicalColumn == null
        ? ""
        : s(loadSheet.rows[rowIndex]?.[physicalColumn - 1] as unknown as string);

    const allCanonical: CanonicalGridRow[] = mapped.rows.map((r) => {
      const idx = r.sourceRow - 1;
      return {
        stable_id: r.stableId,
        description: cell(idx, descCol?.physical_column),
        area: cell(idx, areaCol?.physical_column),
        location: cell(idx, locCol?.physical_column),
        canonical_grid_raw: cell(idx, gridCol.physical_column),
      };
    });

    const canonical = allCanonical.filter(
      (r) =>
        (r.stable_id.toUpperCase().startsWith("FS-") || FARM_SHOP_AREA.test(r.area)) &&
        r.canonical_grid_raw.length > 0,
    );

    const db = context.supabase as unknown as LooseDb;
    const [loadRes, panelRes] = await Promise.all([
      db.from("electrical_loads").select("load_id, description, area, location, grid"),
      db.from("electrical_panels").select("panel_id, description, building, grid"),
    ]);
    if (loadRes.error) throw new Error(loadRes.error.message);
    if (panelRes.error) throw new Error(panelRes.error.message);

    const farmOps: FarmOpsGridRow[] = ((loadRes.data ?? []) as Row[]).map((r) => ({
      stable_id: s(r["load_id"]),
      description: s(r["description"]),
      area: s(r["area"]),
      location: s(r["location"]),
      grid: s(r["grid"]),
    }));

    const panels: FarmOpsGridRow[] = ((panelRes.data ?? []) as Row[])
      .filter((r) => s(r["panel_id"]).toUpperCase().startsWith("PNL-FS-"))
      .map((r) => ({
        stable_id: s(r["panel_id"]),
        description: s(r["description"]),
        area: "Farm Shop",
        location: s(r["building"]),
        grid: s(r["grid"]),
      }));

    const report = buildGridRecovery({ canonical, farmOps, panels });

    return {
      ...report,
      file_name: data.file_name,
      ods_sha256,
      generated_at: new Date().toISOString(),
      canonical_rows_total: allCanonical.length,
      farm_shop_canonical_rows: canonical.length,
      farm_shop_panels: panels.length,
      grid_physical_column: gridCol.physical_column,
      grid_observed_header: gridCol.exact_header,
    };
  });
