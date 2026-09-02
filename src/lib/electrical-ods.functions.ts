// ODS import server functions: dry-run first, then apply only what was reviewed.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES, coerceValue, importColumns } from "@/lib/electrical-entities";
import {
  checkStableId,
  completionFromStatus,
  mergeLegacyStatusNote,
  mergeOdsExtras,
  normalizeInstallStatus,
  ODS_EXTRAS_FIELD,
  ODS_EXTRAS_SOURCE_KEY,
  parseOdsExtras,
  type ElectricalEntityKind,
} from "@/lib/electrical";

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
    await requireElectricalAccess(context.supabase, context.userId, "write");
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
          mapping: [],
          rows: [],
          mergeProposals: [],
          rejected: [],
        });
        continue;
      }
      const def = ENTITIES[kind];
      const mapped = mapSheet(sheet, kind, importColumns(kind), def.stableIdField);
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
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    let created = 0;
    let updated = 0;
    const errors: { stable_id: string; message: string }[] = [];
    // Engineering status text that had to be moved into notes to be writable.
    const normalized: { stable_id: string; was: string; now: string }[] = [];


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

      const allowed = new Set(importColumns(kind));
      const patch: Record<string, unknown> = { [def.stableIdField]: row.stable_id };
      for (const [key, raw] of Object.entries(row.values)) {
        if (!allowed.has(key) || key === def.stableIdField) continue;
        const field = def.fields.find((f) => f.key === key)!;
        patch[key] = coerceValue(field, raw);
      }
      // Engineering status text ("Design Basis") is not an install status. Keep
      // the words verbatim in notes, store a valid controlled value so the row
      // can be written at all, and report every such rewrite — nothing about an
      // engineering-owned field changes silently.
      if (Object.prototype.hasOwnProperty.call(row.values, "install_status")) {
        const norm = normalizeInstallStatus(patch["install_status"]);
        if (norm.legacy) {
          patch["notes"] = mergeLegacyStatusNote(patch["notes"], norm.legacy);
          normalized.push({ stable_id: row.stable_id, was: norm.legacy, now: norm.status });
        }
        patch["install_status"] = norm.status;
      }
      // Only derive completion from status when the sheet didn't supply an
      // explicit Complete % — the workbook value wins when present.
      const suppliedCompletion = Object.prototype.hasOwnProperty.call(
        row.values,
        "completion_percent",
      );
      if (!suppliedCompletion && typeof patch["install_status"] === "string") {
        patch["completion_percent"] = completionFromStatus(patch["install_status"] as string);
      }



      if (row.existing_id) {
        // Lossless capture is merged with whatever is already preserved on the
        // record, never replaced: several canonical worksheets describe the same
        // record, and an import of one must not erase another's preserved keys.
        if (patch[ODS_EXTRAS_FIELD] != null) {
          const { data: current } = await db
            .from(def.table)
            .select(ODS_EXTRAS_FIELD)
            .eq("id", row.existing_id)
            .maybeSingle();
          const merged = mergeOdsExtras(
            (current as Record<string, unknown> | null)?.[ODS_EXTRAS_FIELD],
            patch[ODS_EXTRAS_FIELD],
          );
          if (merged) patch[ODS_EXTRAS_FIELD] = merged;
        }
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

    return { created, updated, errors, normalized };
  });

/* ---------------------------------------------- 4.4a preservation backfill */

export interface PreservationProposal {
  sheet: string;
  kind: ElectricalEntityKind;
  stable_id: string;
  existing_id: string;
  was: string;
  now: string;
  columns: string[];
}

export interface PreservationPlan {
  file_name: string;
  proposals: PreservationProposal[];
  already_preserved: number;
  missing_records: { sheet: string; stable_id: string }[];
}

/**
 * Dry run for the lossless-capture backfill. Records imported before the
 * capture column existed carry no preserved copy of the canonical columns that
 * have no typed FarmOps destination, which the validator correctly reports as
 * semantic loss. This proposes writing that capture — and nothing else — for
 * existing records only. It performs no writes and never creates records.
 */
export const previewOdsPreservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        base64: z.string().min(1).max(30_000_000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<PreservationPlan> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const sheets = await odsToSheets(data.base64);
    const proposals: PreservationProposal[] = [];
    const missing: { sheet: string; stable_id: string }[] = [];
    let alreadyPreserved = 0;

    for (const sheet of sheets) {
      const kind = classifySheet(sheet);
      if (!kind) continue;
      const def = ENTITIES[kind];
      if (!def.fields.some((f) => f.key === ODS_EXTRAS_FIELD)) continue;
      const mapped = mapSheet(sheet, kind, importColumns(kind), def.stableIdField);
      const { data: rows, error } = await db.from(def.table).select("*");
      if (error) throw new Error(error.message);
      const existing = new Map<string, Record<string, unknown>>();
      for (const r of (rows ?? []) as Record<string, unknown>[]) {
        existing.set(String(r[def.stableIdField] ?? "").trim(), r);
      }
      for (const row of mapped.rows) {
        const captured = row.values[ODS_EXTRAS_FIELD];
        if (!captured) continue;
        const record = existing.get(row.stableId.trim());
        if (!record) {
          missing.push({ sheet: sheet.name, stable_id: row.stableId });
          continue;
        }
        const was = typeof record[ODS_EXTRAS_FIELD] === "string"
          ? (record[ODS_EXTRAS_FIELD] as string)
          : "";
        // Additive: already-preserved keys from other worksheets are kept.
        const next = mergeOdsExtras(was, captured) ?? captured;
        if (was === next) {
          alreadyPreserved++;
          continue;
        }
        const parsed = parseOdsExtras(next) ?? {};
        proposals.push({
          sheet: sheet.name,
          kind,
          stable_id: row.stableId,
          existing_id: String(record["id"]),
          was,
          now: next,
          columns: Object.keys(parsed)
            .filter((k) => k !== ODS_EXTRAS_SOURCE_KEY)
            .sort(),
        });
      }
    }

    return {
      file_name: data.file_name,
      proposals,
      already_preserved: alreadyPreserved,
      missing_records: missing,
    };
  });

/**
 * Apply reviewed preservation proposals. Writes only the lossless-capture
 * column on existing records: no engineering field, stable ID, relationship or
 * install state is touched, and no record is created or deleted.
 */
export const applyOdsPreservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rows: z
          .array(
            z.object({
              kind: z.string().min(1).max(40),
              stable_id: z.string().trim().min(1).max(60),
              existing_id: z.string().uuid(),
              now: z.string().min(1).max(200_000),
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
    const errors: { stable_id: string; message: string }[] = [];
    for (const row of data.rows) {
      const def = ENTITIES[row.kind as ElectricalEntityKind];
      if (!def || !def.fields.some((f) => f.key === ODS_EXTRAS_FIELD)) {
        errors.push({ stable_id: row.stable_id, message: `Unknown record type ${row.kind}.` });
        continue;
      }
      // The payload must be the capture JSON the importer produced; anything
      // else is refused rather than stored as unverifiable evidence.
      if (!parseOdsExtras(row.now)) {
        errors.push({ stable_id: row.stable_id, message: "Preserved capture is not valid JSON." });
        continue;
      }
      const { error } = await db
        .from(def.table)
        .update({ [ODS_EXTRAS_FIELD]: row.now })
        .eq("id", row.existing_id);
      if (error) errors.push({ stable_id: row.stable_id, message: error.message });
      else updated++;
    }
    return { updated, errors };
  });
