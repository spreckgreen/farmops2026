// Phase 4.4b Task 1B — preview-first Category-A boolean correction tool.
//
// Preview re-reads the live rows and reports exactly what would change. Apply
// requires an explicit confirm flag and writes ONE boolean column per row.
// It never touches stable IDs, relationships, ods_extras, installation state,
// topology, other engineering fields, or the canonical ODS.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { ENTITIES } from "@/lib/electrical-entities";

type LooseDb = { from: (table: string) => any };

const ALLOWED = new Map<string, { stableIdField: string; columns: Set<string> }>(
  Object.values(ENTITIES).map((def) => [
    def.table,
    {
      stableIdField: def.stableIdField,
      columns: new Set(def.fields.filter((f) => f.kind === "bool" && !f.readOnly).map((f) => f.key)),
    },
  ]),
);

const entrySchema = z.object({
  table: z.string().trim().min(1),
  stable_id: z.string().trim().min(1),
  column: z.string().trim().min(1),
  /** Value the diagnostics believed FarmOps holds; guards against drift. */
  expected_current: z.union([z.boolean(), z.null()]),
  proposed_value: z.union([z.boolean(), z.null()]),
  evidence: z.string().max(500).default(""),
});

const inputSchema = z.object({
  entries: z.array(entrySchema).min(1).max(2000),
  /** Must be true to write. Anything else is a dry run. */
  confirm: z.boolean().default(false),
});

export interface BooleanCorrectionRow {
  table: string;
  stable_id: string;
  column: string;
  live_value: boolean | null;
  proposed_value: boolean | null;
  evidence: string;
  status: "would_change" | "already_correct" | "drifted" | "not_found" | "applied" | "failed";
  detail?: string;
}

export interface BooleanCorrectionResult {
  applied: boolean;
  changed: number;
  skipped: number;
  rows: BooleanCorrectionRow[];
}

export const previewBooleanCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ context, data }): Promise<BooleanCorrectionResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const rows: BooleanCorrectionRow[] = [];
    let changed = 0;
    let skipped = 0;

    for (const entry of data.entries) {
      const meta = ALLOWED.get(entry.table);
      if (!meta || !meta.columns.has(entry.column)) {
        rows.push({ ...base(entry), live_value: null, status: "failed", detail: "Not a correctable Yes/No column." });
        skipped++;
        continue;
      }
      const { data: found, error } = await db
        .from(entry.table)
        .select(`id, ${meta.stableIdField}, ${entry.column}`)
        .eq(meta.stableIdField, entry.stable_id)
        .maybeSingle();
      if (error) {
        rows.push({ ...base(entry), live_value: null, status: "failed", detail: error.message });
        skipped++;
        continue;
      }
      if (!found) {
        rows.push({ ...base(entry), live_value: null, status: "not_found" });
        skipped++;
        continue;
      }
      const live = (found as Record<string, unknown>)[entry.column];
      const liveValue = typeof live === "boolean" ? live : null;
      if (liveValue === entry.proposed_value) {
        rows.push({ ...base(entry), live_value: liveValue, status: "already_correct" });
        skipped++;
        continue;
      }
      if (liveValue !== entry.expected_current) {
        rows.push({
          ...base(entry),
          live_value: liveValue,
          status: "drifted",
          detail: "The stored value changed since the report was generated; re-run validation.",
        });
        skipped++;
        continue;
      }
      if (!data.confirm) {
        rows.push({ ...base(entry), live_value: liveValue, status: "would_change" });
        changed++;
        continue;
      }
      const { error: upErr } = await db
        .from(entry.table)
        .update({ [entry.column]: entry.proposed_value })
        .eq("id", (found as { id: string }).id);
      if (upErr) {
        rows.push({ ...base(entry), live_value: liveValue, status: "failed", detail: upErr.message });
        skipped++;
        continue;
      }
      rows.push({ ...base(entry), live_value: liveValue, status: "applied" });
      changed++;
    }

    return { applied: data.confirm, changed, skipped, rows };
  });

function base(entry: z.infer<typeof entrySchema>) {
  return {
    table: entry.table,
    stable_id: entry.stable_id,
    column: entry.column,
    proposed_value: entry.proposed_value,
    evidence: entry.evidence,
  };
}
