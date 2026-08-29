// ODS import server functions: dry-run first, then apply only what was reviewed.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireAddon } from "@/lib/addons.server";
import { ENTITIES, coerceValue, writableColumns } from "@/lib/electrical-entities";
import { checkStableId, completionFromStatus, type ElectricalEntityKind } from "@/lib/electrical";
import {
  buildPlanSheet,
  classifySheet,
  mapSheet,
  parseOdsContentXml,
  planTotals,
  type ImportPlanSheet,
} from "@/lib/electrical-ods";

type LooseDb = { from: (table: string) => any };

async function odsToSheets(base64: string) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
  const content = files["content.xml"];
  if (!content) throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
  return parseOdsContentXml(strFromU8(content));
}

export interface ImportPlan {
  file_name: string;
  sheets: ImportPlanSheet[];
  totals: { create: number; update: number; unchanged: number; warnings: number };
}

/** Dry run: parse, classify, map and diff the workbook without writing. */
export const previewOdsImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ImportPlan> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const sheets = await odsToSheets(data.base64);

    const plan: ImportPlanSheet[] = [];
    for (const sheet of sheets) {
      const kind = classifySheet(sheet);
      if (!kind) {
        plan.push({
          sheet: sheet.name,
          kind: null,
          skipped: sheet.rows.length,
          unmapped: [],
          rows: [],
          mergeProposals: [],
        });
        continue;
      }
      const def = ENTITIES[kind];
      const mapped = mapSheet(sheet, kind, writableColumns(kind), def.stableIdField);
      const { data: rows, error } = await db.from(def.table).select("*");
      if (error) throw new Error(error.message);
      const existing: Record<string, Record<string, unknown>> = {};
      for (const r of (rows ?? []) as Record<string, unknown>[]) {
        existing[String(r[def.stableIdField] ?? "")] = r;
      }
      plan.push(buildPlanSheet(mapped, existing, def.stableIdField));
    }

    return { file_name: data.file_name, sheets: plan, totals: planTotals(plan) };
  });

const ApplyInput = z.object({
  rows: z
    .array(
      z.object({
        kind: z.string().min(1).max(40),
        stable_id: z.string().trim().min(1).max(60),
        existing_id: z.string().uuid().nullable().optional(),
        values: z.record(z.string(), z.string()),
      }),
    )
    .min(1)
    .max(5000),
});

/** Apply only the rows the reviewer checked in the dry-run report. */
export const applyOdsImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    let created = 0;
    let updated = 0;
    const errors: { stable_id: string; message: string }[] = [];

    for (const row of data.rows) {
      const kind = row.kind as ElectricalEntityKind;
      const def = ENTITIES[kind];
      if (!def) {
        errors.push({ stable_id: row.stable_id, message: `Unknown record type ${row.kind}.` });
        continue;
      }
      const check = checkStableId(kind, row.stable_id);
      if (!check.ok) {
        errors.push({ stable_id: row.stable_id, message: check.error ?? "Invalid stable ID." });
        continue;
      }

      const allowed = new Set(writableColumns(kind));
      const patch: Record<string, unknown> = { [def.stableIdField]: row.stable_id };
      for (const [key, raw] of Object.entries(row.values)) {
        if (!allowed.has(key) || key === def.stableIdField) continue;
        const field = def.fields.find((f) => f.key === key)!;
        patch[key] = coerceValue(field, raw);
      }
      if (typeof patch["install_status"] === "string") {
        patch["completion_percent"] = completionFromStatus(patch["install_status"] as string);
      }

      if (row.existing_id) {
        const { error } = await db.from(def.table).update(patch).eq("id", row.existing_id);
        if (error) errors.push({ stable_id: row.stable_id, message: error.message });
        else updated++;
      } else {
        const { error } = await db
          .from(def.table)
          .insert({ ...patch, user_id: context.userId });
        if (error) errors.push({ stable_id: row.stable_id, message: error.message });
        else created++;
      }
    }

    return { created, updated, errors };
  });
