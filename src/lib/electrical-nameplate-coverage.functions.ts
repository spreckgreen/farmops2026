// Administrator-only nameplate coverage scan for large loads.
//
// Three steps, each admin-gated on the server:
//   1. scanLargeLoadNameplates — which sizeable loads carry a nameplate record
//   2. lookupNameplateSpecs    — AI search for published ratings of one model
//   3. recordScannedNameplate  — write the confirmed values, audited
//
// The write path reuses the approval-gated request table: the administrator's
// own confirmation is the approval, and the request row remains the record of
// who recorded what, from which source.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import {
  NAMEPLATE_LOOKUP_SYSTEM_PROMPT,
  scanNameplateCoverage,
  summarizeCoverage,
  type NameplateCoverageInput,
  type NameplateCoverageItem,
  type NameplateCoverageSummary,
} from "@/lib/electrical-nameplate-coverage";
import { nameplateFields, parseNameplateDraft, type NameplateField } from "@/lib/electrical-nameplate";
import {
  nameplateChanges,
  nameplateColumnPatch,
  sanitizeNameplateProposal,
  type NameplateFieldChange,
} from "@/lib/electrical-nameplate-write";
import { NAMEPLATE_WRITE_TABLE } from "@/lib/electrical-nameplate-write.functions";

type LooseDb = { from: (table: string) => any };

const SCAN_COLS = [
  "id",
  "load_id",
  "description",
  "location",
  "area",
  "volts",
  "amps",
  "connected_va",
  "equipment_model",
  "dedicated",
  "equipment_fla",
  "minimum_circuit_ampacity",
  "maximum_overcurrent_protection",
  "nameplate_manufacturer",
  "nameplate_model",
  "nameplate_serial",
  "nameplate_volts",
  "nameplate_phase",
  "nameplate_fla_rla",
  "nameplate_mca",
  "nameplate_mocp",
  "nameplate_source",
  "nameplate_captured_at",
].join(", ");

export interface NameplateCoverageReport {
  items: NameplateCoverageItem[];
  summary: NameplateCoverageSummary;
  /** Total load rows examined, large or not. */
  scanned: number;
}

/** Scan existing loads for large equipment and report nameplate coverage. */
export const scanLargeLoadNameplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NameplateCoverageReport> => {
    await requireAdminRole(context.supabase, context.userId);
    const { data: rows, error } = await (context.supabase as unknown as LooseDb)
      .from("electrical_loads")
      .select(SCAN_COLS)
      .order("load_id");
    if (error) throw new Error(error.message);
    const loads = (rows ?? []) as NameplateCoverageInput[];
    const items = scanNameplateCoverage(loads);
    return { items, summary: summarizeCoverage(items), scanned: loads.length };
  });

const LookupInput = z.object({
  loadUuid: z.string().uuid(),
  /** Manufacturer + model text to search for; defaults to the row's own hint. */
  query: z.string().trim().max(200).optional(),
});

export interface NameplateLookupResult {
  loadUuid: string;
  ref: string | null;
  query: string;
  /** Draft fields, all null when nothing could be attributed to this model. */
  fields: NameplateField[];
  /** True when at least one rating came back. */
  found: boolean;
  notes: string | null;
  model: string;
  backend: string;
  engineLabel: string;
  latencyMs: number;
}

/**
 * AI search for the published nameplate of one equipment row. Draft only — it
 * writes nothing, and a model that is not certain must return nulls.
 */
export const lookupNameplateSpecs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LookupInput.parse(d))
  .handler(async ({ context, data }): Promise<NameplateLookupResult> => {
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;
    const { data: load, error } = await db
      .from("electrical_loads")
      .select(SCAN_COLS)
      .eq("id", data.loadUuid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!load) throw new Error("That equipment row could not be found.");
    const row = load as NameplateCoverageInput;

    const { nameplateSearchHint } = await import("@/lib/electrical-nameplate-coverage");
    const query = (data.query ?? nameplateSearchHint(row) ?? "").trim();
    if (query.length < 3) {
      throw new Error(
        "No manufacturer or model to search for. Add the model to the equipment row, or type one in.",
      );
    }

    const { resolveAreaAi, runAreaAi } = await import("@/lib/ai-routing.server");
    const ai = await resolveAreaAi("electrical.nameplate_extract", {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });
    const { generateText } = await import("ai");

    const started = Date.now();
    const run = await runAreaAi(
      ai,
      async (handle) => {
        const { text } = await generateText({
          model: handle.provider(handle.modelId),
          system: NAMEPLATE_LOOKUP_SYSTEM_PROMPT,
          prompt:
            `EQUIPMENT: ${query}\n` +
            (row.description ? `DESCRIPTION IN RECORD: ${row.description}\n` : "") +
            (row.volts ? `CIRCUIT VOLTAGE IN RECORD: ${row.volts} (context only — do not copy it)\n` : "") +
            "\nReturn the published nameplate ratings for this exact model, or nulls with an explanation in `notes`. JSON object only.",
        });
        return text.trim();
      },
      {
        isTruncated: (value) => parseNameplateDraft(value) === null,
        meter: {
          client: context.supabase,
          userId: context.userId,
          note: "nameplate_spec_lookup",
        },
      },
    );

    const draft = parseNameplateDraft(run.value);
    const fields = nameplateFields(draft).map((f) =>
      f.id === "serial" ? { ...f, value: null } : f,
    );
    return {
      loadUuid: data.loadUuid,
      ref: row.load_id ?? null,
      query,
      fields,
      found: fields.some((f) => f.id !== "notes" && f.value != null),
      notes: draft?.["notes"] ?? null,
      model: run.modelId,
      backend: run.backend,
      engineLabel: ai.engineLabel,
      latencyMs: Date.now() - started,
    };
  });

const RecordInput = z.object({
  loadUuid: z.string().uuid(),
  values: z.record(z.string(), z.union([z.string(), z.null()])),
  source: z.enum(["ai_spec_lookup", "admin_entry"]),
  note: z.string().trim().max(500).optional(),
});

export interface NameplateRecordResult {
  loadUuid: string;
  applied: Record<string, string>;
  changes: NameplateFieldChange[];
  requestId: string;
}

/**
 * Record a confirmed nameplate against the equipment row. Administrator-only and
 * audited: a request row is written with the proposal, the source and the
 * decision, and only the `nameplate_*` columns are touched.
 */
export const recordScannedNameplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecordInput.parse(d))
  .handler(async ({ context, data }): Promise<NameplateRecordResult> => {
    await requireAdminRole(context.supabase, context.userId);
    const proposal = sanitizeNameplateProposal(data.values);
    if (Object.keys(proposal).length === 0) {
      throw new Error("Nothing to record — confirm at least one legible value.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as LooseDb;

    const { data: load, error: loadError } = await db
      .from("electrical_loads")
      .select(SCAN_COLS)
      .eq("id", data.loadUuid)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!load) throw new Error("That equipment row could not be found.");
    const row = load as unknown as Record<string, unknown>;

    const changes = nameplateChanges(proposal, row);
    if (changes.length === 0) {
      throw new Error("The equipment row already holds these nameplate values.");
    }
    const applied = Object.fromEntries(changes.map((c) => [c.id, c.proposed]));
    const now = new Date().toISOString();

    const { error: writeError } = await db
      .from("electrical_loads")
      .update({
        ...nameplateColumnPatch(applied),
        nameplate_source: data.source,
        nameplate_captured_at: now,
        nameplate_applied_by: context.userId,
      })
      .eq("id", data.loadUuid);
    if (writeError) throw new Error(writeError.message);

    const { data: request, error: reqError } = await db
      .from(NAMEPLATE_WRITE_TABLE)
      .insert({
        requested_by: context.userId,
        load_uuid: data.loadUuid,
        load_ref: (row["load_id"] as string | null) ?? null,
        load_label: (row["description"] as string | null) ?? null,
        proposed: proposal,
        request_note:
          data.note ??
          (data.source === "ai_spec_lookup"
            ? "Recorded by administrator from an AI specification lookup."
            : "Recorded by administrator during the large-load nameplate scan."),
        status: "approved",
        decided_by: context.userId,
        decided_at: now,
        decision_note: `Administrator scan (${data.source}).`,
        applied_at: now,
        applied_fields: applied,
      })
      .select("id")
      .single();
    if (reqError) throw new Error(reqError.message);

    return {
      loadUuid: data.loadUuid,
      applied,
      changes,
      requestId: (request as { id: string }).id,
    };
  });
