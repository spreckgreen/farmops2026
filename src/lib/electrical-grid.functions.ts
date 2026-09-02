// Grid QA audit + targeted Grid-only correction for electrical loads.
// The audit is read-only. The correction path updates the single `grid` column
// matched by stable Load ID — it never deletes, recreates or renumbers a load,
// and it never copies a neighbouring cell into Grid.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { buildGridAudit, classifyGrid, type GridAudit } from "@/lib/electrical-grid";

type LooseDb = { from: (table: string) => any };

const AuditInput = z
  .object({
    /** Optional canonical ODS Load_Master Grid values, keyed by Load ID. */
    ods: z
      .array(z.object({ load_id: z.string().trim().min(1).max(60), grid: z.string().max(120).nullable() }))
      .max(5000)
      .optional(),
  })
  .optional();

export interface GridAuditPayload extends GridAudit {
  generatedAt: string;
  odsSupplied: boolean;
}

export const electricalGridAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AuditInput.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<GridAuditPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const { data: rows, error } = await db.from("electrical_loads").select("load_id, grid");
    if (error) throw new Error(error.message);
    const odsMap: Record<string, string | null> = {};
    for (const r of data?.ods ?? []) odsMap[r.load_id] = r.grid;
    const audit = buildGridAudit((rows ?? []) as { load_id: string; grid: string | null }[], odsMap);
    return { ...audit, generatedAt: new Date().toISOString(), odsSupplied: Boolean(data?.ods?.length) };
  });

const ApplyInput = z.object({
  rows: z
    .array(
      z.object({
        load_id: z.string().trim().min(1).max(60),
        grid: z.string().max(120).nullable(),
      }),
    )
    .min(1)
    .max(5000),
});

/** Write corrected Grid values only, matched by stable Load ID. */
export const applyGridCorrections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    let updated = 0;
    const errors: { load_id: string; message: string }[] = [];
    for (const row of data.rows) {
      const g = classifyGrid(row.grid);
      if (row.grid != null && row.grid.trim() && g.status === "invalid") {
        errors.push({ load_id: row.load_id, message: g.reason ?? "invalid grid value" });
        continue;
      }
      const { error } = await db
        .from("electrical_loads")
        .update({ grid: g.value })
        .eq("load_id", row.load_id);
      if (error) errors.push({ load_id: row.load_id, message: error.message });
      else updated++;
    }
    return { updated, errors };
  });
