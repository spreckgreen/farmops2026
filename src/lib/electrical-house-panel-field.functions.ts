// Phase 4.4b — House panel photo reconciliation (server layer).
//
// Preview parses the observation workbook, reads FarmOps and the preserved
// canonical values, and returns the three-way comparison. It performs ZERO
// writes. Apply requires an explicit confirm flag, re-reads every live row,
// refuses drifted rows, and writes only the single selected column.
//
// Never touched: stable IDs, ods_extras, unrelated engineering fields,
// relationships, service identities, non-current service revisions, boolean
// reconciliation state and the canonical ODS.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { parseOdsContentXml } from "@/lib/electrical-ods";
import {
  FIELD_RECONCILIATION_PHASE,
  HOUSE_PANEL_ALIASES,
  fieldReconciliationCsv,
  fieldReconciliationMarkdown,
  parseHousePanelSheets,
  reconcileHousePanelObservations,
  reconciliationTotals,
  type FarmOpsBreaker,
  type ObservationDisposition,
  type ReconciliationRow,
  type ReconciliationTotals,
} from "@/lib/electrical-house-panel-field";

type LooseDb = { from: (table: string) => any };

const OBS_TABLE = "electrical_field_observations";
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

/**
 * Canonical engineering values preserved verbatim from the canonical ODS on the
 * panel record (`ods_extras`). Read-only: nothing here rewrites that capture,
 * so the Phase 4.4a LOSS = 0 guarantee is untouched.
 */
function canonicalFromPanel(panelId: string, extrasRaw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof extrasRaw !== "string" || !extrasRaw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extrasRaw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    // e.g. "circuit 26 amps", "breaker 26 description"
    const m = /(?:circuit|breaker|ckt)\s*#?\s*(\d{1,3})\s*(amps?|poles?|description|label)?/i.exec(key);
    if (!m) continue;
    const breaker = m[1];
    const attr = (m[2] ?? "").toLowerCase();
    const field = attr.startsWith("amp")
      ? "ocp_amps"
      : attr.startsWith("pole")
        ? "poles"
        : attr === "description" || attr === "label"
          ? "label"
          : "label";
    out[`${panelId}|${breaker}|${field}`] = String(value);
  }
  return out;
}

export interface HousePanelPreview {
  phase: string;
  workbook: string;
  generated_at: string;
  rows: ReconciliationRow[];
  totals: ReconciliationTotals;
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
});

export const previewHousePanelFieldReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => previewInput.parse(d))
  .handler(async ({ context, data }): Promise<HousePanelPreview> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const sheets = await odsToSheets(data.base64);

    const { data: panels, error: panelErr } = await db
      .from("electrical_panels")
      .select("id, panel_id, ods_extras");
    if (panelErr) throw new Error(panelErr.message);
    const panelRows = (panels ?? []) as { id: string; panel_id: string; ods_extras: string | null }[];

    const parsed = parseHousePanelSheets(sheets, {
      workbook: data.file_name,
      aliases: HOUSE_PANEL_ALIASES,
      knownPanelIds: panelRows.map((p) => p.panel_id),
    });

    const byUuid = new Map(panelRows.map((p) => [p.id, p.panel_id]));
    const { data: breakers, error: brErr } = await db
      .from(BREAKERS)
      .select("panel_uuid, side, position, breaker_number, poles, ocp_amps, label");
    if (brErr) throw new Error(brErr.message);
    const farmops: FarmOpsBreaker[] = ((breakers ?? []) as Record<string, unknown>[])
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

    const canonical: Record<string, string> = {};
    for (const p of panelRows) Object.assign(canonical, canonicalFromPanel(p.panel_id, p.ods_extras));

    // Current-revision parent of PNL-H2, read only from the CURRENT service
    // configuration. Proposed/future revisions are never consulted or changed.
    let currentSubpanelParent: string | null = null;
    const { data: configs } = await db
      .from("electrical_service_configurations")
      .select("id, is_current")
      .eq("is_current", true);
    const currentIds = ((configs ?? []) as { id: string }[]).map((c) => c.id);
    if (currentIds.length) {
      const { data: links } = await db
        .from("electrical_service_panels")
        .select("panel_ref, panel_uuid, fed_from_kind, fed_from_panel_ref, fed_from_panel_uuid, service_config_uuid")
        .in("service_config_uuid", currentIds);
      for (const l of ((links ?? []) as Record<string, unknown>[])) {
        const ref = String(l["panel_ref"] ?? byUuid.get(String(l["panel_uuid"])) ?? "");
        if (ref !== "PNL-H2") continue;
        if (String(l["fed_from_kind"] ?? "") !== "panel") continue;
        currentSubpanelParent =
          String(l["fed_from_panel_ref"] ?? byUuid.get(String(l["fed_from_panel_uuid"])) ?? "") || null;
      }
    }

    const rows = reconcileHousePanelObservations({ parsed, farmops, canonical, currentSubpanelParent });
    const generated_at = new Date().toISOString();
    return {
      phase: FIELD_RECONCILIATION_PHASE,
      workbook: data.file_name,
      generated_at,
      rows,
      totals: reconciliationTotals(parsed, rows),
      warnings: parsed.warnings,
      csv: fieldReconciliationCsv(rows),
      markdown: fieldReconciliationMarkdown(parsed, rows, generated_at),
      wrote_anything: false,
      sor_authority: "canonical_ods",
    };
  });

// ------------------------------------------------------------------- applying

const applyStatus = [
  "would_change",
  "changed",
  "already_correct",
  "drifted",
  "not_found",
  "failed",
] as const;
export type ApplyStatus = (typeof applyStatus)[number];

const fieldEntry = z.object({
  panel_id: z.string().trim().min(1).max(60),
  side: z.string().trim().min(1).max(10),
  position: z.number().int().positive(),
  column: z.enum(["ocp_amps", "poles", "label"]),
  expected_current: z.union([z.string(), z.number(), z.null()]),
  proposed_value: z.union([z.string(), z.number()]),
  positions_text: z.string().max(40).default(""),
  poles: z.number().int().positive().nullable().default(null),
  observed_text: z.string().max(500).default(""),
  canonical_value: z.string().max(500).nullable().default(null),
  classification: z.string().max(60).default(""),
  confidence: z.string().max(20).default(""),
  workbook: z.string().max(200).default(""),
  worksheet: z.string().max(200).default(""),
  source_row: z.number().int().nonnegative().default(0),
  source_column: z.string().max(200).default(""),
  source_photo: z.string().max(300).default(""),
});

const topologyEntry = z.object({
  panel_id: z.string().trim().min(1).max(60),
  expected_current_parent: z.string().max(60).nullable(),
  proposed_parent: z.string().trim().min(1).max(60),
  evidence: z.string().max(500).default(""),
});

const observationEntry = fieldEntry
  .omit({ expected_current: true, proposed_value: true, column: true, side: true, position: true })
  .extend({
    field: z.string().max(40),
    side: z.string().max(10).default(""),
    position: z.number().int().nonnegative().nullable().default(null),
    farmops_value: z.string().max(500).nullable().default(null),
    proposed_action: z.string().max(40).default(""),
    disposition: z.enum([
      "observed",
      "verified",
      "accepted",
      "rejected",
      "superseded",
      "needs_field_verification",
    ] as [ObservationDisposition, ...ObservationDisposition[]]),
  });

const applyInput = z.object({
  confirm: z.boolean().default(false),
  fields: z.array(fieldEntry).max(2000).default([]),
  topology: z.array(topologyEntry).max(20).default([]),
  /** Evidence rows recorded verbatim with their provenance and disposition. */
  observations: z.array(observationEntry).max(2000).default([]),
});

export interface ApplyFieldRow {
  panel_id: string;
  side: string;
  position: number;
  column: string;
  live_value: string | null;
  proposed_value: string | number;
  status: ApplyStatus;
  detail?: string;
}

export interface ApplyTopologyRow {
  panel_id: string;
  current_parent: string | null;
  proposed_parent: string;
  status: ApplyStatus;
  detail?: string;
}

export interface HousePanelApplyResult {
  applied: boolean;
  fields: ApplyFieldRow[];
  topology: ApplyTopologyRow[];
  observations_recorded: number;
  changed: number;
  skipped: number;
}

const asText = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

export const applyHousePanelFieldUpdates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => applyInput.parse(d))
  .handler(async ({ context, data }): Promise<HousePanelApplyResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;

    const { data: panels, error: panelErr } = await db.from("electrical_panels").select("id, panel_id");
    if (panelErr) throw new Error(panelErr.message);
    const panelUuid = new Map(
      ((panels ?? []) as { id: string; panel_id: string }[]).map((p) => [p.panel_id, p.id]),
    );

    const fields: ApplyFieldRow[] = [];
    const topology: ApplyTopologyRow[] = [];
    let changed = 0;
    let skipped = 0;

    for (const e of data.fields) {
      const base = {
        panel_id: e.panel_id,
        side: e.side,
        position: e.position,
        column: e.column,
        proposed_value: e.proposed_value,
      };
      const uuid = panelUuid.get(e.panel_id);
      if (!uuid) {
        fields.push({ ...base, live_value: null, status: "not_found", detail: "Unknown panel identity." });
        skipped++;
        continue;
      }
      const { data: found, error } = await db
        .from(BREAKERS)
        .select(`id, ${e.column}`)
        .eq("panel_uuid", uuid)
        .eq("side", e.side)
        .eq("position", e.position)
        .maybeSingle();
      if (error) {
        fields.push({ ...base, live_value: null, status: "failed", detail: error.message });
        skipped++;
        continue;
      }
      if (!found) {
        fields.push({ ...base, live_value: null, status: "not_found" });
        skipped++;
        continue;
      }
      const liveRaw = (found as Record<string, unknown>)[e.column];
      const live = asText(liveRaw);
      const proposed = asText(e.proposed_value);
      if (live !== null && proposed !== null && Number(live) === Number(proposed) && live !== proposed) {
        // Numerically identical (e.g. "60" vs 60).
        fields.push({ ...base, live_value: live, status: "already_correct" });
        skipped++;
        continue;
      }
      if (live === proposed) {
        fields.push({ ...base, live_value: live, status: "already_correct" });
        skipped++;
        continue;
      }
      if (live !== asText(e.expected_current)) {
        fields.push({
          ...base,
          live_value: live,
          status: "drifted",
          detail: "The stored value changed after Preview; re-run the reconciliation.",
        });
        skipped++;
        continue;
      }
      if (!data.confirm) {
        fields.push({ ...base, live_value: live, status: "would_change" });
        changed++;
        continue;
      }
      const value = e.column === "label" ? String(e.proposed_value) : Number(e.proposed_value);
      const { error: upErr } = await db
        .from(BREAKERS)
        .update({ [e.column]: value })
        .eq("id", (found as { id: string }).id);
      if (upErr) {
        fields.push({ ...base, live_value: live, status: "failed", detail: upErr.message });
        skipped++;
        continue;
      }
      fields.push({ ...base, live_value: live, status: "changed" });
      changed++;
    }

    // Topology: only the CURRENT service revision may be adjusted, and only the
    // parent-panel columns of the named panel's membership row.
    for (const t of data.topology) {
      const base = {
        panel_id: t.panel_id,
        current_parent: t.expected_current_parent,
        proposed_parent: t.proposed_parent,
      };
      const { data: configs } = await db
        .from("electrical_service_configurations")
        .select("id")
        .eq("is_current", true);
      const currentIds = ((configs ?? []) as { id: string }[]).map((c) => c.id);
      if (!currentIds.length) {
        topology.push({ ...base, status: "not_found", detail: "No current service revision exists." });
        skipped++;
        continue;
      }
      const { data: links, error: linkErr } = await db
        .from("electrical_service_panels")
        .select("id, panel_ref, panel_uuid, fed_from_kind, fed_from_panel_ref, service_config_uuid")
        .in("service_config_uuid", currentIds);
      if (linkErr) {
        topology.push({ ...base, status: "failed", detail: linkErr.message });
        skipped++;
        continue;
      }
      const target = ((links ?? []) as Record<string, unknown>[]).find(
        (l) => String(l["panel_ref"] ?? "") === t.panel_id,
      );
      if (!target) {
        topology.push({
          ...base,
          status: "not_found",
          detail: `${t.panel_id} has no membership row in the current service revision.`,
        });
        skipped++;
        continue;
      }
      const liveParent =
        String(target["fed_from_kind"] ?? "") === "panel"
          ? asText(target["fed_from_panel_ref"])
          : null;
      if (liveParent === t.proposed_parent) {
        topology.push({ ...base, status: "already_correct" });
        skipped++;
        continue;
      }
      if (liveParent !== t.expected_current_parent) {
        topology.push({
          ...base,
          status: "drifted",
          detail: "The current revision's parent changed after Preview.",
        });
        skipped++;
        continue;
      }
      if (!data.confirm) {
        topology.push({ ...base, status: "would_change" });
        changed++;
        continue;
      }
      const parentUuid = panelUuid.get(t.proposed_parent) ?? null;
      const { error: upErr } = await db
        .from("electrical_service_panels")
        .update({
          fed_from_kind: "panel",
          fed_from_panel_ref: t.proposed_parent,
          fed_from_panel_uuid: parentUuid,
        })
        .eq("id", String(target["id"]));
      if (upErr) {
        topology.push({ ...base, status: "failed", detail: upErr.message });
        skipped++;
        continue;
      }
      topology.push({ ...base, status: "changed" });
      changed++;
    }

    // Field evidence is stored with its provenance so a later reader can always
    // separate "what the photo appeared to say" from FarmOps and canonical.
    let recorded = 0;
    if (data.confirm && data.observations.length) {
      const payload = data.observations.map((o) => ({
        user_id: context.userId,
        workbook: o.workbook || "(unknown workbook)",
        worksheet: o.worksheet || null,
        source_row: o.source_row || null,
        source_column: o.source_column || null,
        source_photo: o.source_photo || null,
        panel_ref: o.panel_id,
        panel_uuid: panelUuid.get(o.panel_id) ?? null,
        positions_text: o.positions_text || null,
        side: o.side || null,
        position: o.position,
        poles: o.poles,
        field: o.field,
        observed_text: o.observed_text,
        interpreted_value: null,
        confidence: o.confidence || null,
        canonical_value: o.canonical_value,
        farmops_value: o.farmops_value,
        classification: o.classification || null,
        proposed_action: o.proposed_action || null,
        disposition: o.disposition,
        verification_status: o.disposition === "needs_field_verification" ? "required" : "not_required",
      }));
      const { error } = await db.from(OBS_TABLE).insert(payload);
      if (error) throw new Error(error.message);
      recorded = payload.length;
    }

    return {
      applied: data.confirm,
      fields,
      topology,
      observations_recorded: recorded,
      changed,
      skipped,
    };
  });
