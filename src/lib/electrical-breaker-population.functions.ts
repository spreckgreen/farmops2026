// Phase 4.4b — breaker-position population (server layer).
//
// Preview performs ZERO writes: it parses the observation workbook, reads live
// FarmOps breaker positions, and returns one proposed record per unique logical
// breaker with its blocking reason. Apply requires an explicit confirm flag,
// re-reads live state first, refuses any slot that is now occupied, and inserts
// only the explicitly selected records.
//
// Never touched: panel IDs, service configurations/revisions, canonical ODS
// captures, topology relationships, and any row not explicitly selected.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { parseOdsContentXml } from "@/lib/electrical-ods";
import {
  FIELD_RECONCILIATION_SCOPES,
  parseHousePanelSheets,
  type FarmOpsBreaker,
} from "@/lib/electrical-house-panel-field";
import {
  BREAKER_POPULATION_PHASE,
  breakerPopulationCsv,
  breakerPopulationDiagnostics,
  breakerPopulationMarkdown,
  planBreakerPopulation,
  type BreakerPopulationDiagnostics,
  type BreakerPopulationRow,
} from "@/lib/electrical-breaker-population";
import {
  analysePanelCoverage,
  panelCoverageCsv,
  type PanelCoverageReport,
} from "@/lib/electrical-panel-coverage";

type LooseDb = { from: (table: string) => any };

const BREAKERS = "electrical_breaker_positions";

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

interface PanelRow {
  id: string;
  panel_id: string;
  spaces: number | null;
  breaker_columns: number | null;
  positions_per_column: number | null;
}

async function readPanels(db: LooseDb) {
  const { data, error } = await db
    .from("electrical_panels")
    .select("id, panel_id, spaces, breaker_columns, positions_per_column");
  if (error) throw new Error(error.message);
  return (data ?? []) as PanelRow[];
}

async function readBreakers(db: LooseDb, byUuid: Map<string, string>): Promise<FarmOpsBreaker[]> {
  const { data, error } = await db
    .from(BREAKERS)
    .select("panel_uuid, side, position, breaker_number, poles, ocp_amps, label");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[])
    .map((b) => ({
      panel_id: byUuid.get(String(b["panel_uuid"])) ?? "",
      side: String(b["side"] ?? ""),
      position: Number(b["position"] ?? 0),
      breaker_number: b["breaker_number"] === null ? null : Number(b["breaker_number"]),
      poles: b["poles"] === null ? null : Number(b["poles"]),
      ocp_amps: b["ocp_amps"] === null ? null : Number(b["ocp_amps"]),
      label: b["label"] === null || b["label"] === undefined ? null : String(b["label"]),
    }))
    .filter((b) => b.panel_id);
}

export interface BreakerPopulationPreview {
  phase: string;
  scope: "house" | "farm_shop";
  scope_label: string;
  workbook: string;
  generated_at: string;
  rows: BreakerPopulationRow[];
  diagnostics: BreakerPopulationDiagnostics;
  warnings: string[];
  csv: string;
  markdown: string;
  /** Always false for Preview. */
  wrote_anything: false;
  sor_authority: "canonical_ods";
}

const previewInput = z.object({
  file_name: z.string().trim().min(1).max(200),
  base64: z.string().min(1).max(30_000_000),
  scope: z.enum(["house", "farm_shop"]).default("house"),
});

export const previewBreakerPopulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => previewInput.parse(d))
  .handler(async ({ context, data }): Promise<BreakerPopulationPreview> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const scope = FIELD_RECONCILIATION_SCOPES[data.scope];
    const sheets = await odsToSheets(data.base64);
    const panelRows = await readPanels(db);
    const byUuid = new Map(panelRows.map((p) => [p.id, p.panel_id]));

    const parsed = parseHousePanelSheets(sheets, {
      workbook: data.file_name,
      aliases: scope.aliases,
      sheetPanelHints: scope.sheet_panel_hints,
      knownPanelIds: panelRows.map((p) => p.panel_id),
    });

    const farmops = await readBreakers(db, byUuid);
    const rows = planBreakerPopulation({
      observations: parsed.observations,
      farmops,
      conflicts: parsed.conflicts,
      scope,
    });
    const diagnostics = breakerPopulationDiagnostics(rows);
    const generated_at = new Date().toISOString();

    return {
      phase: BREAKER_POPULATION_PHASE,
      scope: data.scope,
      scope_label: scope.label,
      workbook: parsed.workbook,
      generated_at,
      rows,
      diagnostics,
      warnings: parsed.warnings,
      csv: breakerPopulationCsv(rows),
      markdown: breakerPopulationMarkdown(rows, diagnostics, generated_at, scope),
      wrote_anything: false,
      sor_authority: "canonical_ods",
    };
  });

// ------------------------------------------------------------------- apply

const photoSchema = z.object({
  bucket: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1).max(400),
  name: z.string().trim().min(1).max(200),
  mime: z.string().trim().max(120).default(""),
  size: z.number().int().nonnegative().default(0),
});

const applyInput = z.object({
  /** Must be true; Preview never sets it. */
  confirm: z.boolean(),
  scope: z.enum(["house", "farm_shop"]).default("house"),
  records: z
    .array(
      z.object({
        panel_id: z.string().trim().min(1),
        positions_text: z.string().trim().max(60).default(""),
        poles: z.number().int().min(1).max(3),
        ocp_amps: z.number().positive().nullable().default(null),
        label: z.string().trim().max(300).nullable().default(null),
        /**
         * Safety-gate verdict computed by the Preview. BLOCKED rows are refused
         * server-side even if a client sends them.
         */
        safety_class: z
          .enum(["SAFE_STRUCTURAL_CREATE", "CREATE_WITH_VERIFICATION_FLAGS", "BLOCKED"])
          .default("SAFE_STRUCTURAL_CREATE"),
        requires_field_verification: z.boolean().default(false),
        /** Verification flag + verbatim uncertain observed text; never an engineering value. */
        notes: z.string().trim().max(2000).nullable().default(null),
        slots: z
          .array(
            z.object({
              breaker_number: z.number().int().positive(),
              side: z.enum(["Left", "Right"]),
              position: z.number().int().positive(),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .max(400),

  /**
   * Supporting photos, one per observed circuit. These are evidence, not
   * engineering values: they land in electrical_field_observations keyed by
   * panel + occupied positions and are never copied into breaker fields.
   */
  evidence: z
    .array(
      z.object({
        panel_id: z.string().trim().max(60).nullable().default(null),
        panel_source_name: z.string().trim().max(120).default(""),
        positions_text: z.string().trim().max(60).default(""),
        poles: z.number().int().min(1).max(3).nullable().default(null),
        observed_text: z.string().trim().max(500).default(""),
        notes: z.string().trim().max(1000).nullable().default(null),
        confidence: z.string().trim().max(40).nullable().default(null),
        verification_status: z.string().trim().max(40).nullable().default(null),
        proposed_action: z.string().trim().max(60).nullable().default(null),
        worksheet: z.string().trim().max(200).nullable().default(null),
        workbook: z.string().trim().max(200).default(""),
        photo: photoSchema,
      }),
    )
    .max(400)
    .default([]),
});

export type BreakerCreateStatus =
  | "would_create"
  | "created"
  | "blocked_now_exists"
  | "blocked_safety_gate"
  | "failed";

export interface BreakerCreateResult {
  panel_id: string;
  positions_text: string;
  status: BreakerCreateStatus;
  detail: string;
  positions_created: number;
  safety_class?: string;
  requires_field_verification?: boolean;
}

export interface BreakerPopulationApplyResult {
  confirmed: boolean;
  results: BreakerCreateResult[];
  created: number;
  created_with_verification_flags: number;
  blocked: number;
  failed: number;
  /**
   * After a confirmed Apply the same workbook must be re-previewed: those
   * records must classify as existing instead of proposing a duplicate create.
   */
  repreview_required: boolean;

  /** Photo evidence rows written to the observation journal. */
  evidence_recorded: number;
  evidence_errors: string[];
}


export const applyBreakerPopulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => applyInput.parse(d))
  .handler(async ({ context, data }): Promise<BreakerPopulationApplyResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;

    const panelRows = await readPanels(db);
    const byUuid = new Map(panelRows.map((p) => [p.id, p.panel_id]));
    const uuidByPanel = new Map(panelRows.map((p) => [p.panel_id, p.id]));

    // Live state is re-read here, so a slot filled since Preview is blocked.
    const live = new Set(
      (await readBreakers(db, byUuid)).map((b) => `${b.panel_id}|${b.side}|${b.position}`),
    );

    const results: BreakerCreateResult[] = [];
    for (const rec of data.records) {
      if (rec.safety_class === "BLOCKED") {
        results.push({
          panel_id: rec.panel_id,
          positions_text: rec.positions_text,
          status: "blocked_safety_gate",
          detail: "The safety gate classified this breaker as BLOCKED; nothing was created.",
          positions_created: 0,
          safety_class: rec.safety_class,
        });
        continue;
      }
      const panelUuid = uuidByPanel.get(rec.panel_id);

      if (!panelUuid) {
        results.push({
          panel_id: rec.panel_id,
          positions_text: rec.positions_text,
          status: "failed",
          detail: `Panel ${rec.panel_id} no longer exists.`,
          positions_created: 0,
        });
        continue;
      }
      if (rec.poles > 1 && rec.slots.length !== rec.poles) {
        results.push({
          panel_id: rec.panel_id,
          positions_text: rec.positions_text,
          status: "failed",
          detail: `A ${rec.poles}-pole breaker must occupy ${rec.poles} positions.`,
          positions_created: 0,
        });
        continue;
      }
      const occupied = rec.slots.filter((s) => live.has(`${rec.panel_id}|${s.side}|${s.position}`));
      if (occupied.length) {
        results.push({
          panel_id: rec.panel_id,
          positions_text: rec.positions_text,
          status: "blocked_now_exists",
          detail: `Slot${occupied.length === 1 ? "" : "s"} ${occupied
            .map((s) => `${s.side} ${s.position}`)
            .join(", ")} ${occupied.length === 1 ? "is" : "are"} already occupied in FarmOps; nothing was overwritten.`,
          positions_created: 0,
        });
        continue;
      }

      if (!data.confirm) {
        results.push({
          panel_id: rec.panel_id,
          positions_text: rec.positions_text,
          status: "would_create",
          detail: `${rec.slots.length} position${rec.slots.length === 1 ? "" : "s"} would be created.`,
          positions_created: 0,
        });
        continue;
      }

      // Only structural facts are written. NULL stays NULL: nothing is filled
      // in later by inference, and no directory text becomes an amperage.
      const payload = rec.slots.map((s) => ({
        user_id: context.userId,
        panel_uuid: panelUuid,
        side: s.side,
        position: s.position,
        breaker_number: s.breaker_number,
        poles: rec.poles,
        ocp_amps: rec.ocp_amps,
        label: rec.label,
        notes: rec.notes,
      }));
      const { error } = await db.from(BREAKERS).insert(payload);
      if (error) {
        results.push({
          panel_id: rec.panel_id,
          positions_text: rec.positions_text,
          status: "failed",
          detail: error.message,
          positions_created: 0,
          safety_class: rec.safety_class,
        });
        continue;
      }
      for (const s of rec.slots) live.add(`${rec.panel_id}|${s.side}|${s.position}`);
      results.push({
        panel_id: rec.panel_id,
        positions_text: rec.positions_text,
        status: "created",
        detail: `${rec.slots.length} position${rec.slots.length === 1 ? "" : "s"} created${
          rec.requires_field_verification ? " and flagged for field verification" : ""
        }.`,
        positions_created: rec.slots.length,
        safety_class: rec.safety_class,
        requires_field_verification: rec.requires_field_verification,
      });

    }

    // Photo evidence is recorded per observed circuit, alongside whatever the
    // create attempt did with that circuit. It is written only on confirm.
    const evidence_errors: string[] = [];
    let evidence_recorded = 0;
    if (data.confirm && data.evidence.length) {
      const outcomeByCircuit = new Map(
        results.map((r) => [`${r.panel_id}|${r.positions_text}`, r]),
      );
      const now = new Date().toISOString();
      const payload = data.evidence.map((ev) => {
        const outcome = ev.panel_id
          ? outcomeByCircuit.get(`${ev.panel_id}|${ev.positions_text}`)
          : undefined;
        return {
          user_id: context.userId,
          scope: data.scope,
          workbook: ev.workbook || "(photo upload)",
          worksheet: ev.worksheet,
          panel_ref: ev.panel_id ?? (ev.panel_source_name || null),
          panel_uuid: ev.panel_id ? (uuidByPanel.get(ev.panel_id) ?? null) : null,
          positions_text: ev.positions_text,
          poles: ev.poles,
          field: "breaker_position_photo",
          observed_text: ev.observed_text || ev.positions_text || "(photo only)",
          notes: ev.notes,
          confidence: ev.confidence,
          verification_status: ev.verification_status,
          proposed_action: ev.proposed_action,
          disposition: "evidence_recorded",
          apply_status: outcome?.status ?? "photo_only",
          applied_at: now,
          observed_at: now,
          photo_bucket: ev.photo.bucket,
          photo_path: ev.photo.path,
          photo_name: ev.photo.name,
          photo_mime: ev.photo.mime || null,
          photo_size: ev.photo.size || null,
          photo_uploaded_at: now,
        };
      });
      const { error } = await db.from("electrical_field_observations").insert(payload);
      if (error) evidence_errors.push(error.message);
      else evidence_recorded = payload.length;
    }

    const created = results.filter((r) => r.status === "created");
    return {
      confirmed: data.confirm,
      results,
      created: created.length,
      created_with_verification_flags: created.filter((r) => r.requires_field_verification).length,
      blocked: results.filter(
        (r) => r.status === "blocked_now_exists" || r.status === "blocked_safety_gate",
      ).length,
      failed: results.filter((r) => r.status === "failed").length,
      repreview_required: data.confirm && created.length > 0,
      evidence_recorded,
      evidence_errors,
    };


  });
