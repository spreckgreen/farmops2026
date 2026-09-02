// Phase 4.4 — read-only parallel validation endpoint.
//
// Parses the supplied canonical workbook in memory, records its SHA-256, reads
// the current FarmOps reconciliation snapshot and returns a semantic comparison
// report. It performs no database writes and never writes the .ods file.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import {
  classifySheet,
  findHeaderRow,
  isNonEntitySheet,
  mapSheet,
  parseOdsContentXml,
} from "@/lib/electrical-ods";
import { collectSnapshot } from "@/lib/electrical-snapshot.functions";
import {
  runParallelComparison,
  type OdsSheetRows,
  type ValidationReport,
  type WorkbookMetadataSheet,
} from "@/lib/electrical-parallel-validation";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const runElectricalParallelValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ValidationReport> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");

    const { unzipSync, strFromU8 } = await import("fflate");
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const sha256 = await sha256Hex(bytes);

    const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
    const content = files["content.xml"];
    if (!content) {
      throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
    }
    const sheets = parseOdsContentXml(strFromU8(content));

    // Non-entity worksheets (workbook metadata, drop-down lists) are preserved
    // verbatim instead of being forced onto an entity: mapping them produced
    // panel/feeder findings for rows that have no stable identity at all.
    const workbookMetadata: WorkbookMetadataSheet[] = sheets
      .filter((sheet) => isNonEntitySheet(sheet.name))
      .map((sheet) => {
        const headerRow = findHeaderRow(sheet.rows);
        const header = headerRow >= 0 ? sheet.rows[headerRow] : [];
        const body = sheet.rows.slice(headerRow + 1);
        const width = Math.max(header.length, ...sheet.rows.map((r) => r.length), 0);
        const columns: WorkbookMetadataSheet["columns"] = [];
        for (let idx = 0; idx < width; idx++) {
          const values = body
            .map((row, i) => ({ row: headerRow + 2 + i, value: (row[idx] ?? "").trim() }))
            .filter((v) => v.value !== "");
          if (!values.length) continue;
          columns.push({
            header: (header[idx] ?? "").trim() || `(unnamed column ${idx + 1})`,
            column: idx + 1,
            populated_rows: values.length,
            values,
          });
        }
        return { sheet: sheet.name, columns };
      });

    const parsed: OdsSheetRows[] = sheets.map((sheet) => {
      const kind = classifySheet(sheet);
      if (!kind) return { sheet: sheet.name, kind: null, rows: [], unmapped: [] };
      const def = ENTITIES[kind];
      const mapped = mapSheet(sheet, kind, importColumns(kind), def.stableIdField);
      const headerRow = findHeaderRow(sheet.rows);
      const bodyRows = sheet.rows.slice(headerRow + 1);
      // Phase 4.4a: an unmapped column carries the workbook rows and values at
      // risk, so a LOSS finding names real engineering data.
      const stableIdIdx = mapped.columns.findIndex((c) => c.target === def.stableIdField);
      const unmapped = mapped.columns
        .map((col, idx) => ({ col, idx }))
        .filter(({ col }) => !col.target && col.source.trim())
        .map(({ col, idx }) => {
          const populatedRows = bodyRows.filter((row) => (row[idx] ?? "").trim() !== "");
          const header = col.source.trim();
          const duplicateHeader =
            mapped.columns.filter((c) => c.source.trim() === header && header).length > 1;
          return {
            column: header,
            collidedWith: col.collidedWith,
            columnIndex: idx,
            duplicateHeader,
            populated: populatedRows.length > 0,
            populatedRows: populatedRows.length,
            samples: populatedRows.slice(0, 5).map((row) => ({
              stableId: stableIdIdx >= 0 ? (row[stableIdIdx] ?? "").trim() : "",
              value: (row[idx] ?? "").trim(),
            })),
          };
        });
      return {
        sheet: sheet.name,
        kind,
        rows: mapped.rows.map((r) => ({
          stableId: r.stableId,
          values: r.values,
          sourceRow: r.sourceRow,
        })),
        unmapped,
      };
    });

    const snapshot = await collectSnapshot(context.supabase);
    const snapshotSha256 = await sha256Hex(
      new TextEncoder().encode(JSON.stringify(snapshot)),
    );

    return runParallelComparison({
      odsFileName: data.file_name,
      odsSha256: sha256,
      comparedAt: new Date().toISOString(),
      sheets: parsed,
      workbookMetadata,
      snapshot,
      snapshotSha256,
    });
  });

