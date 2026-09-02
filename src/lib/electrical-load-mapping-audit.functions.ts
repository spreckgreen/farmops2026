// Load_Master field-mapping audit — read-only server function.
//
// Parses the supplied canonical workbook in memory (never stored), hashes it so
// the audit is SHA-bound, and compares the worksheet's physical columns against
// the current importer bindings and the live FarmOps load rows. There is no
// apply path in this module by design.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";
import { sha256Hex } from "@/lib/electrical-adjudication-baseline.functions";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import {
  auditLoadMasterMapping,
  type LoadMappingAudit,
} from "@/lib/electrical-load-mapping-audit";

type LooseDb = { from: (table: string) => any };

export interface LoadMappingAuditPayload extends LoadMappingAudit {
  file_name: string;
  ods_sha256: string;
  is_phase_44a_baseline: boolean;
  generated_at: string;
}

export const auditLoadMasterFieldMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<LoadMappingAuditPayload> => {
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
    const loadSheet = sheets.find((s) => classifySheet(s) === "load");
    if (!loadSheet) throw new Error("No Load_Master sheet was found in that workbook.");

    const def = ENTITIES.load;
    const mapped = mapSheet(loadSheet, "load", importColumns("load"), def.stableIdField);

    const db = context.supabase as unknown as LooseDb;
    const { data: rows, error } = await db.from(def.table).select("*");
    if (error) throw new Error(error.message);

    const audit = auditLoadMasterMapping({
      sheet: loadSheet,
      headerRow: mapped.headerRow,
      importerColumns: mapped.columns,
      // mapSheet reports 1-based worksheet rows; the audit indexes sheet.rows.
      odsRows: mapped.rows.map((r) => ({ sourceRow: r.sourceRow - 1, stableId: r.stableId })),
      dbRows: (rows ?? []) as Record<string, unknown>[],
    });

    return {
      ...audit,
      file_name: data.file_name,
      ods_sha256,
      is_phase_44a_baseline: ods_sha256.toLowerCase() === PHASE_44A_BASELINE_SHA256,
      generated_at: new Date().toISOString(),
    };
  });
