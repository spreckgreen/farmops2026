// Load_Master Import Contract v2 — read-only server function.
//
// Parses the supplied canonical workbook in memory (never stored), hashes it so
// the contract and the simulation are SHA-bound, binds the 41 contract columns
// by physical position + exact header, and simulates a complete re-import of
// every canonical row. There is no apply path and no FarmOps write.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";
import { sha256Hex } from "@/lib/electrical-adjudication-baseline.functions";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import {
  simulateContractReimport,
  type ContractSimulation,
} from "@/lib/electrical-load-import-contract";

/** `rows` (the projected records) stay server-side: the payload is a report. */
export interface ImportContractPayload extends Omit<ContractSimulation, "rows"> {
  file_name: string;
  ods_sha256: string;
  sha_authorized: boolean;
  generated_at: string;
}

export const loadMasterImportContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ImportContractPayload> => {
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

    const simulation = simulateContractReimport({
      sheet: loadSheet,
      headerRow: mapped.headerRow,
      // mapSheet reports 1-based worksheet rows; the contract indexes sheet.rows.
      odsRows: mapped.rows.map((r) => ({ sourceRow: r.sourceRow - 1, stableId: r.stableId })),
    });

    const { rows: _projected, ...report } = simulation;
    return {
      ...report,
      file_name: data.file_name,
      ods_sha256,
      sha_authorized: ods_sha256.toLowerCase() === PHASE_44A_BASELINE_SHA256,
      generated_at: new Date().toISOString(),
    };
  });
