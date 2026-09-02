// AI assistance for the Electrical pane.
//
// Read-only by construction: every scenario reads the as-installed record (or
// the audit log) and returns prose. Nothing here writes an electrical record,
// and nothing touches the canonical PremoFarmElectrical.ods workbook.
//
// Scoping: an administrator gets every scenario; anyone else gets the scenarios
// their electrical add-on already entitles them to. Engine/model selection is
// NOT decided here — each scenario names an AI feature area, so routing stays in
// Admin → AI runtime → Feature AI routing like every other AI feature.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasAddon } from "@/lib/addons.server";
import { isAdminRole } from "@/lib/admin-role.server";
import { electricalAccess } from "@/lib/electrical-access";
import {
  ELECTRICAL_AI_DENIED,
  ELECTRICAL_AI_SCENARIOS,
  canRunElectricalAiScenario,
  isEntitledToElectricalAiScenario,
  electricalAiScenariosFor,
  getElectricalAiScenario,
  isElectricalAiScenarioId,
  type ElectricalAiScenarioId,
} from "@/lib/electrical-ai-scenarios";
import type { AiEscalation } from "@/lib/ai-feature-areas";
import {
  NAMEPLATE_SYSTEM_PROMPT,
  inspectNameplateDataUrl,
  nameplateFields,
  parseNameplateDraft,
  type NameplateField,
} from "@/lib/electrical-nameplate";

type LooseDb = { from: (table: string) => any };

export interface ElectricalAiScenarioView {
  id: ElectricalAiScenarioId;
  /** Where model selection for this scenario is configured. */
  area: string;
  areaLabel: string;
  /** Current routing for that area, as configured in the AI admin pane. */
  backend: string;
  model: string | null;
}

/** Catalogue entry: every scenario, whether the caller may run it, and why. */
export interface ElectricalAiFeatureState {
  id: ElectricalAiScenarioId;
  available: boolean;
  /** Covered by the caller's own role/add-on, without any admin grant. */
  entitled: boolean;
  /** Unlocked by an administrator's approval. */
  granted: boolean;
  /** Latest request state, when the caller has ever asked for it. */
  requestStatus: "pending" | "approved" | "rejected" | "revoked" | null;
  requestedAt: string | null;
  decisionNote: string | null;
  /** May the caller submit (or re-submit) this one for approval? */
  requestable: boolean;
}

export interface ElectricalAiScopeReport {
  isAdmin: boolean;
  basis: "admin" | "full" | "field_write" | "read_only" | "scan" | "none";
  scenarios: ElectricalAiScenarioView[];
  /** All scenarios with their availability/approval state, for the request UI. */
  features: ElectricalAiFeatureState[];
}

async function resolveScope(supabase: unknown, userId: string) {
  const { loadApprovedAiScenarios } = await import("@/lib/electrical-ai-access.functions");
  const [isAdmin, full, fieldWrite, readOnly, scan, grants] = await Promise.all([
    isAdminRole(supabase, userId),
    hasAddon(supabase, userId, "electrical"),
    hasAddon(supabase, userId, "electrical_fieldwrite"),
    hasAddon(supabase, userId, "electrical_readonly"),
    hasAddon(supabase, userId, "electrical_scan"),
    loadApprovedAiScenarios(supabase, userId),
  ]);
  const access = electricalAccess({ full, fieldWrite, readOnly, scan });
  const basis: ElectricalAiScopeReport["basis"] = isAdmin
    ? "admin"
    : full
      ? "full"
      : fieldWrite
        ? "field_write"
        : readOnly
          ? "read_only"
          : scan
            ? "scan"
            : "none";
  return { isAdmin, access, basis, grants };
}

/** Which scenarios the signed-in caller may run, plus their configured routing. */
export const listElectricalAiScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ElectricalAiScopeReport> => {
    const { isAdmin, access, basis, grants } = await resolveScope(
      context.supabase,
      context.userId,
    );
    const scope = { access, isAdmin, grants };
    const allowed = electricalAiScenariosFor(scope);

    const { data: requestRows, error: requestErr } = await (
      context.supabase as unknown as LooseDb
    )
      .from("electrical_ai_feature_grants")
      .select("scenario, status, requested_at, decision_note")
      .eq("user_id", context.userId);
    if (requestErr) throw new Error(requestErr.message);
    const requests = (requestRows ?? []) as {
      scenario: string;
      status: ElectricalAiFeatureState["requestStatus"];
      requested_at: string | null;
      decision_note: string | null;
    }[];


    const features: ElectricalAiFeatureState[] = ELECTRICAL_AI_SCENARIOS.map((def) => {
      const req = requests.find((r) => r.scenario === def.id) ?? null;
      const entitled = isEntitledToElectricalAiScenario(scope, def);
      const available = canRunElectricalAiScenario(scope, def);
      return {
        id: def.id,
        available,
        entitled,
        granted: !entitled && available,
        requestStatus: req?.status ?? null,
        requestedAt: req?.requested_at ?? null,
        decisionNote: req?.decision_note ?? null,
        requestable:
          !available &&
          access.canView &&
          !access.scanOnly &&
          req?.status !== "pending",
      };
    });

    if (allowed.length === 0) return { isAdmin, basis, scenarios: [], features };

    const { loadRoutingConfig } = await import("@/lib/ai-routing.server");
    const { getAiArea, routeForArea } = await import("@/lib/ai-feature-areas");
    const config = await loadRoutingConfig(context.supabase);

    return {
      isAdmin,
      basis,
      features,
      scenarios: allowed.map((def) => {
        const route = routeForArea(config, def.area);
        return {
          id: def.id,
          area: def.area,
          areaLabel: getAiArea(def.area).label,
          backend: route.backend,
          model: route.model,
        };
      }),
    };
  });

export interface ElectricalAiAnswer {
  scenario: ElectricalAiScenarioId;
  area: string;
  areaLabel: string;
  engineLabel: string;
  model: string;
  backend: string;
  answer: string;
  /** Records actually put in front of the model, so the answer is auditable. */
  contextCounts: Record<string, number>;
  /** Nameplate scenario only: the transcribed draft fields for confirmation. */
  nameplate?: NameplateField[];
  latencyMs: number;
  escalation: AiEscalation | null;
}

const RunInput = z.object({
  scenario: z.string().refine(isElectricalAiScenarioId, "Unknown scenario"),
  text: z.string().trim().max(2000).optional(),
  /** Photo scenarios only: a base64 image data URL, e.g. "data:image/jpeg;base64,…". */
  image: z.string().max(9_000_000).optional(),
});

function compact(rows: Record<string, unknown>[], fields: string[], cap: number): string {
  return rows
    .slice(0, cap)
    .map((row) =>
      fields
        .map((f) => {
          const v = row[f];
          return v == null || v === "" ? null : `${f}=${String(v).slice(0, 80)}`;
        })
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

export const runElectricalAiScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunInput.parse(d))
  .handler(async ({ data, context }): Promise<ElectricalAiAnswer> => {
    const def = getElectricalAiScenario(data.scenario as ElectricalAiScenarioId);
    const { isAdmin, access, grants } = await resolveScope(
      context.supabase,
      context.userId,
    );
    if (!canRunElectricalAiScenario({ access, isAdmin, grants }, def)) {
      throw new Error(ELECTRICAL_AI_DENIED);
    }
    const question = (data.text ?? "").trim();
    if (def.input === "photo") {
      if (!data.image) throw new Error("Attach a nameplate photo first.");
    } else if (def.input !== "none" && question.length < 3) {
      throw new Error(`Enter a ${def.inputLabel.toLowerCase()} first.`);
    }

    const db = context.supabase as unknown as LooseDb;
    const contextCounts: Record<string, number> = {};
    let system = "";
    let contextBlock = "";

    if (def.id === "panel_qa" || def.id === "topology_explain") {
      const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
      const snap = await collectSnapshot(context.supabase);
      const panels = snap.panels as Record<string, unknown>[];
      const feeders = snap.feeders as Record<string, unknown>[];
      const groups = snap.circuit_groups as Record<string, unknown>[];
      const loads = snap.loads as Record<string, unknown>[];
      const positions = snap.panel_breaker_positions as Record<string, unknown>[];
      contextCounts.panels = panels.length;
      contextCounts.feeders = feeders.length;
      contextCounts.circuit_groups = groups.length;
      contextCounts.loads = loads.length;
      contextCounts.breaker_positions = positions.length;
      contextBlock =
        `PANELS:\n${compact(panels, ["stable_id", "name", "location", "building", "system_voltage", "bus_rating_amps", "spaces", "fed_from_panel_ref"], 80)}\n\n` +
        `FEEDERS:\n${compact(feeders, ["stable_id", "name", "source_ref", "destination_ref", "conductor", "ocp_rating_amps"], 80)}\n\n` +
        `CIRCUITS:\n${compact(groups, ["stable_id", "name", "panel_ref", "breaker_positions", "ocp_rating_amps", "voltage"], 150)}\n\n` +
        `LOADS:\n${compact(loads, ["stable_id", "name", "panel_ref", "circuit_ref", "voltage", "connected_va", "amps", "amps_semantic", "location"], 200)}\n\n` +
        `BREAKER POSITIONS:\n${compact(positions, ["panel_ref", "position", "poles", "ocp_rating_amps", "label", "circuit_ref"], 200)}`;
      system =
        def.id === "panel_qa"
          ? "You are an electrician's assistant reading a farm's as-installed electrical record. " +
            "Answer strictly from the supplied records. Cite stable IDs (PNL-*, CON-*, FS-*, BR-*) for every claim. " +
            "If the record does not contain the answer, say exactly what is missing — never estimate, never infer a rating, " +
            "and never suggest a value that is not in the data. You never change records; this is an answer only."
          : "You are an electrician's assistant. Describe the power path from service to load in plain language, " +
            "step by step, citing the stable ID at each hop (service → feeder → panel → circuit → load). " +
            "Use only the supplied records; state plainly where the chain breaks or a reference is missing. Read-only.";
    } else if (def.id === "qa_triage") {
      const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
      const snap = await collectSnapshot(context.supabase);
      const findings = snap.qa.findings as unknown as Record<string, unknown>[];
      contextCounts.findings = findings.length;
      contextBlock = `FINDINGS (${findings.length}):\n${compact(
        findings,
        ["code", "severity", "stable_id", "message"],
        300,
      )}`;
      system =
        "You triage electrical data-quality findings. Group them into systematic patterns (shared cause), " +
        "report each group as: pattern | affected stable IDs | likely cause | what evidence would resolve it. " +
        "These are suggestions for a human adjudicator: do not classify anything as resolved, do not propose " +
        "numeric corrections, and do not treat a derived value as evidence.";
    } else if (def.id === "audit_summary") {
      const { AUDIT_TABLE } = await import("@/lib/electrical-audit.server");
      const { data: rows, error } = await db
        .from(AUDIT_TABLE)
        .select("actor_email, section, entity_kind, entity_ref, action, summary, changes, reviewed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw new Error(error.message);
      const entries = (rows ?? []) as Record<string, unknown>[];
      contextCounts.audit_entries = entries.length;
      contextCounts.unreviewed = entries.filter((e) => !e.reviewed_at).length;
      contextBlock = `AUDITED CHANGES:\n${entries
        .slice(0, 150)
        .map((e) => {
          const changes = Array.isArray(e.changes)
            ? (e.changes as { field?: string; from?: unknown; to?: unknown }[])
                .slice(0, 8)
                .map((c) => `${c.field}: ${String(c.from ?? "∅")} → ${String(c.to ?? "∅")}`)
                .join("; ")
            : "";
          return `- ${String(e.created_at).slice(0, 16)} ${e.actor_email ?? "unknown"} ${e.action} ${e.entity_kind} ${e.entity_ref ?? ""} (${e.reviewed_at ? "reviewed" : "unreviewed"}) ${changes}`;
        })
        .join("\n")}`;
      system =
        "You prepare an administrator's review of audited electrician field writes. Summarise what changed, " +
        "group by actor, and call out safety-relevant edits first (voltage, ampacity, OCP/breaker rating, poles, " +
        "conductor, panel bus rating, grounding). Flag anything that looks like a typo or an unsupported value. " +
        "End with a short list of entries that most need a human to verify against the field.";
    } else if (def.id === "nameplate_extract") {
      // Nothing from the record goes in: the plate in the photo is the only
      // source, so the model cannot "helpfully" copy a stored value.
      system = NAMEPLATE_SYSTEM_PROMPT;
    } else {
      // field_note — no record context at all; it only tidies the observation.
      system =
        "You tidy an electrician's rough field observation into a draft change note. Keep every stable ID, " +
        "number and unit exactly as written; never add a value the note does not contain. Output: a one-line " +
        "summary, then a short bullet list of the specific fields the electrician appears to be changing. " +
        "State clearly that this is a draft — it writes nothing.";
    }

    const prompt =
      (def.input === "none" || def.input === "photo"
        ? question
          ? `CONTEXT FROM THE ELECTRICIAN (may be wrong; the plate wins):\n${question}\n\n`
          : ""
        : `${def.inputLabel.toUpperCase()}:\n${question}\n\n`) +
      (contextBlock ? `RECORDS:\n${contextBlock}` : "");

    const { resolveAreaAi, runAreaAi } = await import("@/lib/ai-routing.server");
    const ai = await resolveAreaAi(def.area, {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });
    const { generateText } = await import("ai");

    // Validated before the call so a 12 MB HEIC fails free instead of billing.
    const photo = def.input === "photo" && data.image ? data.image.trim() : null;
    if (photo) {
      const info = inspectNameplateDataUrl(photo);
      contextCounts.photo_kb = Math.round(info.bytes / 1024);
    }

    const started = Date.now();
    const run = await runAreaAi(
      ai,
      async (handle) => {
        const { text } = await generateText({
          model: handle.provider(handle.modelId),
          system,
          ...(photo
            ? {
                messages: [
                  {
                    role: "user" as const,
                    content: [
                      {
                        type: "text" as const,
                        text:
                          prompt +
                          "Transcribe this nameplate. Reply with the JSON object only.",
                      },
                      { type: "image" as const, image: photo },
                    ],
                  },
                ],
              }
            : { prompt: prompt || "(no input)" }),
        });
        return text.trim();
      },
      {
        isTruncated: (value) =>
          def.input === "photo"
            ? parseNameplateDraft(value) === null
            : value.length < 20,
        meter: {
          client: context.supabase,
          userId: context.userId,
          note: def.id,
        },
      },
    );

    return {
      scenario: def.id,
      area: def.area,
      areaLabel: ai.areaLabel,
      engineLabel: ai.engineLabel,
      model: run.modelId,
      backend: run.backend,
      answer: run.value,
      contextCounts,
      ...(def.input === "photo"
        ? { nameplate: nameplateFields(parseNameplateDraft(run.value)) }
        : {}),
      latencyMs: Date.now() - started,
      escalation: run.escalation,
    };
  });
