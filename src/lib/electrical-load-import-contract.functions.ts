// Load_Master Import Contract v3 — read-only server function.
//
// Parses the supplied canonical workbook in memory (never stored), hashes it so
// the contract and the simulation are SHA-bound, binds every contract column
// by physical position + exact observed header + canonical semantic identity, and simulates a complete re-import of
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
import {
  IMPORT_CONTRACT_V3_VERSION,
  alignContractRegistry,
  buildContractV3,
  type AlignmentAudit,
} from "@/lib/electrical-load-contract-v3";

/** `rows` (the projected records) stay server-side: the payload is a report. */
export interface ImportContractPayload extends Omit<ContractSimulation, "rows"> {
  file_name: string;
  ods_sha256: string;
  sha_authorized: boolean;
  generated_at: string;
  /** v2 -> v3 registry alignment, physical column by physical column. */
  alignment: AlignmentAudit;
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

    // Contract v3 is materialised from this authorized workbook's own header row:
    // physical column + exact observed header + registered canonical semantic.
    // v2 stays untouched and is reported as alignment history only.
    const headerRow0 = mapped.headerRow;
    const alignment = alignContractRegistry(loadSheet, headerRow0);
    const contract = buildContractV3(loadSheet, headerRow0);

    const simulation = simulateContractReimport({
      sheet: loadSheet,
      headerRow: headerRow0,
      // mapSheet reports 1-based worksheet rows; the contract indexes sheet.rows.
      odsRows: mapped.rows.map((r) => ({ sourceRow: r.sourceRow - 1, stableId: r.stableId })),
      contract,
      contractVersion: IMPORT_CONTRACT_V3_VERSION,
    });

    const { rows: _projected, ...report } = simulation;
    return {
      ...report,
      file_name: data.file_name,
      ods_sha256,
      sha_authorized: ods_sha256.toLowerCase() === PHASE_44A_BASELINE_SHA256,
      alignment,
      generated_at: new Date().toISOString(),
    };
  });
