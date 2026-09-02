// Phase 4.4b — Boolean Category-A production correction gate.
//
// Preview re-reads every live row by UUID and reports exactly what would change.
// Preview writes nothing at all. Apply requires confirm: true AND an explicit
// list of approved keys, and writes ONE boolean column on ONE row per approved
// correction — never a whole-row replacement. It never touches stable IDs,
// relationships, ods_extras, installation state, topology, breaker positions,
// House field observations, other engineering fields, or the canonical ODS.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES } from "@/lib/electrical-entities";
import {
  artifactStillJustified,
  gateKey,
  type GateRow,
  type GateStatus,
} from "@/lib/electrical-boolean-gate";

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
  /** Value the reconciliation finding was based on; guards against drift. */
  expected_current: z.union([z.boolean(), z.null()]),
  proposed_value: z.union([z.boolean(), z.null()]),
  artifact_type: z.enum(["A1_N_COERCED_TRUE", "A2_BLANK_DEFAULTED_FALSE"]),
  ods_value: z.string().max(200).default(""),
  evidence: z.string().max(500).default(""),
});

const inputSchema = z.object({
  entries: z.array(entrySchema).min(1).max(2000),
  /** Must be true to write. Anything else is a dry run. */
  confirm: z.boolean().default(false),
  /**
   * Explicitly approved rows, as `table|stable_id|column`. Apply writes nothing
   * outside this list; every other row is reported as not_approved.
   */
  approved: z.array(z.string()).default([]),
});

export type BooleanCorrectionRow = GateRow;

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
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const approved = new Set(data.approved);
    const rows: BooleanCorrectionRow[] = [];
    let changed = 0;
    let skipped = 0;

    const push = (
      entry: z.infer<typeof entrySchema>,
      patch: { row_uuid?: string | null; live_value: boolean | null; status: GateStatus; detail?: string },
    ) => {
      rows.push({
        table: entry.table,
        stable_id: entry.stable_id,
        row_uuid: patch.row_uuid ?? null,
        column: entry.column,
        ods_value: entry.ods_value,
        reconciliation_value: entry.expected_current,
        live_value: patch.live_value,
        artifact_type: entry.artifact_type,
        proposed_value: entry.proposed_value,
        status: patch.status,
        evidence: entry.evidence,
        ...(patch.detail ? { detail: patch.detail } : {}),
      });
    };

    for (const entry of data.entries) {
      const meta = ALLOWED.get(entry.table);
      if (!meta || !meta.columns.has(entry.column)) {
        push(entry, { live_value: null, status: "failed", detail: "Not a correctable Yes/No column." });
        skipped++;
        continue;
      }
      const { data: found, error } = await db
        .from(entry.table)
        .select(`id, ${meta.stableIdField}, ${entry.column}`)
        .eq(meta.stableIdField, entry.stable_id)
        .maybeSingle();
      if (error) {
        push(entry, { live_value: null, status: "failed", detail: error.message });
        skipped++;
        continue;
      }
      if (!found) {
        push(entry, { live_value: null, status: "not_found" });
        skipped++;
        continue;
      }
      const uuid = (found as { id: string }).id;
      const live = (found as Record<string, unknown>)[entry.column];
      const liveValue = typeof live === "boolean" ? live : null;

      if (liveValue === entry.proposed_value) {
        push(entry, { row_uuid: uuid, live_value: liveValue, status: "already_correct" });
        skipped++;
        continue;
      }
      if (liveValue !== entry.expected_current) {
        push(entry, {
          row_uuid: uuid,
          live_value: liveValue,
          status: "drifted",
          detail: "The live value no longer matches the reconciliation finding; re-run validation.",
        });
        skipped++;
        continue;
      }
      const justified = artifactStillJustified({
        artifact_type: entry.artifact_type,
        table: entry.table,
        column: entry.column,
        live_value: liveValue,
        proposed_value: entry.proposed_value,
      });
      if (!justified.ok) {
        push(entry, { row_uuid: uuid, live_value: liveValue, status: "failed", detail: justified.reason });
        skipped++;
        continue;
      }
      if (!data.confirm) {
        push(entry, { row_uuid: uuid, live_value: liveValue, status: "would_change" });
        changed++;
        continue;
      }
      if (!approved.has(gateKey(entry))) {
        push(entry, {
          row_uuid: uuid,
          live_value: liveValue,
          status: "not_approved",
          detail: "Not in the explicitly approved correction set.",
        });
        skipped++;
        continue;
      }

      // Immediately before the write: re-read this exact row by UUID and verify
      // the value has not moved since the preview read above.
      const { data: fresh, error: reErr } = await db
        .from(entry.table)
        .select(`id, ${entry.column}`)
        .eq("id", uuid)
        .maybeSingle();
      if (reErr || !fresh) {
        push(entry, {
          row_uuid: uuid,
          live_value: liveValue,
          status: "failed",
          detail: reErr?.message ?? "Row disappeared before the write.",
        });
        skipped++;
        continue;
      }
      const freshRaw = (fresh as Record<string, unknown>)[entry.column];
      const freshValue = typeof freshRaw === "boolean" ? freshRaw : null;
      if (freshValue !== liveValue) {
        push(entry, {
          row_uuid: uuid,
          live_value: freshValue,
          status: "drifted",
          detail: "Value changed between preview and write; skipped.",
        });
        skipped++;
        continue;
      }
      const stillOk = artifactStillJustified({
        artifact_type: entry.artifact_type,
        table: entry.table,
        column: entry.column,
        live_value: freshValue,
        proposed_value: entry.proposed_value,
      });
      if (!stillOk.ok) {
        push(entry, { row_uuid: uuid, live_value: freshValue, status: "failed", detail: stillOk.reason });
        skipped++;
        continue;
      }

      const { error: upErr } = await db
        .from(entry.table)
        .update({ [entry.column]: entry.proposed_value })
        .eq("id", uuid);
      if (upErr) {
        push(entry, { row_uuid: uuid, live_value: freshValue, status: "failed", detail: upErr.message });
        skipped++;
        continue;
      }
      push(entry, { row_uuid: uuid, live_value: freshValue, status: "applied" });
      changed++;
    }

    return { applied: data.confirm, changed, skipped, rows };
  });
