// Load_Master Contract v3 controlled reconciliation gate — read-only server fn.
//
// Parses the supplied canonical workbook in memory, hashes it so the report is
// SHA-bound, materialises the frozen Contract v3 binding, simulates the canonical
// projection, reads current FarmOps electrical_loads and returns the preview-only
// reconciliation. There is no apply path and no FarmOps write anywhere here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";
import { sha256Hex } from "@/lib/electrical-adjudication-baseline.functions";
import { simulateContractReimport } from "@/lib/electrical-load-import-contract";
import {
  IMPORT_CONTRACT_V3_VERSION,
  alignContractRegistry,
  buildContractV3,
} from "@/lib/electrical-load-contract-v3";
import {
  buildV3Reconciliation,
  type CanonicalProjectedRow,
  type ReconReport,
} from "@/lib/electrical-contract-v3-reconciliation";

type LooseDb = { from: (table: string) => any };

export interface ReconciliationPayload extends ReconReport {
  file_name: string;
  ods_sha256: string;
  generated_at: string;
  farmops_row_count: number;
}

export const reconcileContractV3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ReconciliationPayload> => {
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
    const headerRow0 = mapped.headerRow;
    const contract = buildContractV3(loadSheet, headerRow0);
    const alignment = alignContractRegistry(loadSheet, headerRow0);
    const odsRows = mapped.rows.map((r) => ({ sourceRow: r.sourceRow - 1, stableId: r.stableId }));

    const simulation = simulateContractReimport({
      sheet: loadSheet,
      headerRow: headerRow0,
      odsRows,
      contract,
      contractVersion: IMPORT_CONTRACT_V3_VERSION,
    });

    // Canonical projection: raw cell text per stable ID, keyed by physical column.
    const canonicalRows: CanonicalProjectedRow[] = odsRows.map((r) => {
      const raw: Record<number, string> = {};
      for (const col of simulation.binding.columns) {
        raw[col.physical_column] = String(
          loadSheet.rows[r.sourceRow]?.[col.physical_column - 1] ?? "",
        ).trim();
      }
      return { stable_id: r.stableId, raw };
    });

    const db = context.supabase as unknown as LooseDb;
    const { data: rows, error } = await db.from(def.table).select("*");
    if (error) throw new Error(error.message);
    const farmOpsRows = (rows ?? []) as Record<string, unknown>[];

    const report = buildV3Reconciliation({
      binding: simulation.binding,
      canonicalRows,
      farmOpsRows,
      live: {
        ods_sha256,
        observed_columns: simulation.binding.observed_column_count,
        bound_columns: simulation.binding.bound,
        row_count: simulation.row_count,
        semantic_loss: simulation.totals.semantic_loss,
        unknown_populated_columns: alignment.unknown_populated_columns,
        critical_rules_pass: simulation.reproduces_canonical,
      },
    });

    return {
      ...report,
      file_name: data.file_name,
      ods_sha256,
      farmops_row_count: farmOpsRows.length,
      generated_at: new Date().toISOString(),
    };
  });
