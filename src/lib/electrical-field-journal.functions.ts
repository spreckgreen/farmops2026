// Phase 4.4b — field-observation journal.
//
// Every accepted photo-derived value is recorded as evidence when a
// reconciliation is applied. This read-only journal answers the audit question
// "which photo said this, and did the value actually land in FarmOps?" — it
// never writes, and it never re-interprets the evidence it lists.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";

type LooseDb = { from: (table: string) => any };

const OBS_TABLE = "electrical_field_observations";

export interface JournalEntry {
  id: string;
  created_at: string;
  observed_at: string | null;
  scope: string | null;
  panel_ref: string;
  positions_text: string | null;
  side: string | null;
  position: number | null;
  poles: number | null;
  field: string;
  observed_text: string;
  interpreted_value: string | null;
  canonical_value: string | null;
  farmops_value: string | null;
  confidence: string | null;
  classification: string | null;
  proposed_action: string | null;
  disposition: string;
  verification_status: string | null;
  /** Outcome of the FarmOps write: changed, already_correct, drifted, ... */
  apply_status: string | null;
  applied_value: string | null;
  applied_previous_value: string | null;
  applied_at: string | null;
  /** Provenance: which workbook / worksheet / cell / photo produced the value. */
  workbook: string;
  worksheet: string | null;
  source_row: number | null;
  source_column: string | null;
  source_photo: string | null;
  photo_bucket: string | null;
  photo_path: string | null;
  photo_name: string | null;
}

export interface JournalResult {
  entries: JournalEntry[];
  totals: {
    entries: number;
    /** Values written into FarmOps by this journal's entries. */
    in_farmops: number;
    already_correct: number;
    /** Recorded as evidence only — nothing was written. */
    evidence_only: number;
    /** Skipped because FarmOps drifted, the row was missing, or the write failed. */
    not_written: number;
    awaiting_field_verification: number;
    with_photo: number;
  };
  truncated: boolean;
}

const journalInput = z.object({
  scope: z.enum(["all", "house", "farm_shop"]).default("all"),
  /** Only entries whose value was actually written into FarmOps. */
  applied_only: z.boolean().default(false),
  panel_ref: z.string().trim().max(60).optional(),
  limit: z.number().int().positive().max(1000).default(300),
});

export const listFieldObservationJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => journalInput.parse(d))
  .handler(async ({ context, data }): Promise<JournalResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;

    let q = db
      .from(OBS_TABLE)
      .select(
        [
          "id",
          "created_at",
          "observed_at",
          "scope",
          "panel_ref",
          "positions_text",
          "side",
          "position",
          "poles",
          "field",
          "observed_text",
          "interpreted_value",
          "canonical_value",
          "farmops_value",
          "confidence",
          "classification",
          "proposed_action",
          "disposition",
          "verification_status",
          "apply_status",
          "applied_value",
          "applied_previous_value",
          "applied_at",
          "workbook",
          "worksheet",
          "source_row",
          "source_column",
          "source_photo",
          "photo_bucket",
          "photo_path",
          "photo_name",
        ].join(", "),
      )
      .order("created_at", { ascending: false })
      .limit(data.limit + 1);

    if (data.scope !== "all") q = q.eq("scope", data.scope);
    if (data.applied_only) q = q.eq("apply_status", "changed");
    if (data.panel_ref) q = q.eq("panel_ref", data.panel_ref);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const all = (rows ?? []) as JournalEntry[];
    const truncated = all.length > data.limit;
    const entries = truncated ? all.slice(0, data.limit) : all;

    return {
      entries,
      totals: {
        entries: entries.length,
        in_farmops: entries.filter((e) => e.apply_status === "changed").length,
        already_correct: entries.filter((e) => e.apply_status === "already_correct").length,
        evidence_only: entries.filter(
          (e) => e.apply_status === "not_applied" || e.apply_status === null,
        ).length,
        not_written: entries.filter((e) =>
          ["drifted", "not_found", "failed"].includes(e.apply_status ?? ""),
        ).length,
        awaiting_field_verification: entries.filter((e) => e.verification_status === "required")
          .length,
        with_photo: entries.filter((e) => !!e.photo_path).length,
      },
      truncated,
    };
  });
