// Read-only Load_Master comparison. Parses the supplied workbook, compares
// every ODS-owned Load field against FarmOps and returns a report. It never
// writes: releasing engineering values stays an explicit ODS import decision.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";
import {
  compareLoads,
  type LoadCompareReport,
  type OdsLoadRow,
} from "@/lib/electrical-load-compare";

type LooseDb = { from: (table: string) => any };

export interface LoadComparePayload extends LoadCompareReport {
  fileName: string;
  sheetName: string | null;
  generatedAt: string;
}

export const compareLoadMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<LoadComparePayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");

    const { unzipSync, strFromU8 } = await import("fflate");
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
    const content = files["content.xml"];
    if (!content) {
      throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
    }
    const sheets = parseOdsContentXml(strFromU8(content));

    const loadSheet = sheets.find((s) => classifySheet(s) === "load");
    if (!loadSheet) {
      throw new Error("No Load_Master sheet was found in that workbook.");
    }

    const def = ENTITIES.load;
    const mapped = mapSheet(loadSheet, "load", importColumns("load"), def.stableIdField);
    const odsRows: OdsLoadRow[] = mapped.rows.map((r) => ({
      stableId: r.stableId,
      values: r.values,
    }));

    const db = context.supabase as unknown as LooseDb;
    const { data: rows, error } = await db.from(def.table).select("*");
    if (error) throw new Error(error.message);

    const report = compareLoads(odsRows, (rows ?? []) as Record<string, unknown>[]);
    return {
      ...report,
      fileName: data.file_name,
      sheetName: loadSheet.name,
      generatedAt: new Date().toISOString(),
    };
  });

/** Apply only reviewed, valid Complete % values, matched by permanent Load ID. */
export const applyLoadCompletionCorrections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rows: z
          .array(
            z.object({
              load_id: z.string().trim().min(1).max(60),
              completion_percent: z.number().int().min(0).max(100),
            }),
          )
          .min(1)
          .max(5000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    let updated = 0;
    const errors: { load_id: string; message: string }[] = [];

    for (const row of data.rows) {
      const { data: changed, error } = await db
        .from("electrical_loads")
        .update({ completion_percent: row.completion_percent })
        .eq("user_id", context.userId)
        .eq("load_id", row.load_id)
        .select("load_id");
      if (error) errors.push({ load_id: row.load_id, message: error.message });
      else if (!changed?.length) errors.push({ load_id: row.load_id, message: "Load ID was not found." });
      else updated++;
    }

    return { updated, errors };
  });
