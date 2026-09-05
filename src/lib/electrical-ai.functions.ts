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
  const { loadApprovedAiScenarios, loadDeniedAiScenarios } = await import(
    "@/lib/electrical-ai-access.functions"
  );
  const [isAdmin, full, fieldWrite, readOnly, scan, grants, denied] = await Promise.all([
    isAdminRole(supabase, userId),
    hasAddon(supabase, userId, "electrical"),
    hasAddon(supabase, userId, "electrical_fieldwrite"),
    hasAddon(supabase, userId, "electrical_readonly"),
    hasAddon(supabase, userId, "electrical_scan"),
    loadApprovedAiScenarios(supabase, userId),
    loadDeniedAiScenarios(supabase, userId),
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
  return { isAdmin, access, basis, grants, denied };
}

/** Which scenarios the signed-in caller may run, plus their configured routing. */
export const listElectricalAiScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ElectricalAiScopeReport> => {
    const { isAdmin, access, basis, grants, denied } = await resolveScope(
      context.supabase,
      context.userId,
    );
    const scope = { access, isAdmin, grants, denied };
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
  /** Epoch ms the answer was produced — drives the 24h answer cache in the UI. */
  finishedAt: number;
  /** What this run cost: 0 on the self-hosted engine, priced tokens on cloud. */
  cost: {
    metered: boolean;
    usd: number;
    estimated: boolean;
    inputTokens: number;
    outputTokens: number;
  } | null;
  escalation: AiEscalation | null;
}


const RunInput = z.object({
  scenario: z.string().refine(isElectricalAiScenarioId, "Unknown scenario"),
  text: z.string().trim().max(2000).optional(),
  /** Photo scenarios only: a base64 image data URL, e.g. "data:image/jpeg;base64,…". */
  image: z.string().max(9_000_000).optional(),
  /**
   * The user accepted the estimated cloud cost for this one question, so run it
   * on the configured cloud engine even though the area routes to self-hosted.
   */
  useCloud: z.boolean().optional(),
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

/** Shared by the estimate and the run so both measure the same prompt. */
async function buildRecordContext(supabase: unknown, question: string) {
  const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
  const { buildElectricalRecordContext } = await import("@/lib/electrical-ai-context");
  const snap = await collectSnapshot(supabase as never);
  return buildElectricalRecordContext({
    panels: snap.panels as Record<string, unknown>[],
    feeders: snap.feeders as Record<string, unknown>[],
    circuitGroups: snap.circuit_groups as Record<string, unknown>[],
    loads: snap.loads as Record<string, unknown>[],
    positions: snap.panel_breaker_positions as Record<string, unknown>[],
    question,
  });
}

function containsEveryStableId(answer: string, stableIds: string[]): boolean {
  const normalized = answer.toUpperCase();
  return stableIds.every((id) => normalized.includes(id.toUpperCase()));
}


export const runElectricalAiScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunInput.parse(d))
  .handler(async ({ data, context }): Promise<ElectricalAiAnswer> => {
    const def = getElectricalAiScenario(data.scenario as ElectricalAiScenarioId);
    const { isAdmin, access, grants, denied } = await resolveScope(
      context.supabase,
      context.userId,
    );
    if (!canRunElectricalAiScenario({ access, isAdmin, grants, denied }, def)) {
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
    let groundedLoadAnswer: string | null = null;
    let matchedLoadIds: string[] = [];
    let loadTraceAnswer: string | null = null;

    if (def.id === "panel_qa" || def.id === "topology_explain" || def.id === "load_trace") {
      const built = await buildRecordContext(context.supabase, question);
      Object.assign(contextCounts, built.counts);
      contextBlock = built.block;
      groundedLoadAnswer = built.groundedLoadAnswer;
      matchedLoadIds = built.matchedLoadIds;
      if (def.id === "load_trace") {
        loadTraceAnswer = built.loadTraceAnswer;
        contextBlock =
          (built.loadTraceAnswer
            ? `DETERMINISTIC TRACE (authoritative — do not contradict it):\n${built.loadTraceAnswer}\n\n`
            : "") + contextBlock;
      }

      const terminologyRules = " " + TERMINOLOGY_PROMPT_RULES + " ";

      const loadFirstRules =
        "Most questions here are one of three kinds: (a) a LOAD question ('which panel are the " +
        "mini-splits on', 'what feeds the freezer'), (b) a PANEL/topology question, or (c) a TRACE " +
        "question for a load type. Decide which kind was asked and answer THAT. " +
        "For a load question, the LOAD ANSWER SET block is your answer source: give one bullet per " +
        "matched load — load_id, description, area, then panel, circuit and breaker taken from its " +
        "`path:` line, then the recorded electrical values. Never answer a load question with a " +
        "summary of panel or breaker inventory. " +
        "Equipment naming varies ('Mini Split SE' = mini-split = ductless head = condenser); treat the " +
        "matched rows as the equipment the user meant, and say so if you think a match is wrong. " +
        "Where a path hop reads NOT IN RECORD, say plainly what is known today (for example: three " +
        "planned mini-split loads FS-082/083/084 in the Farm Shop, no circuit or panel assigned yet, " +
        "panels serving that area listed as candidates only) and name the field that must be filled to " +
        "close the path. Never invent an assignment, rating or route. " +
        "If the answer set is empty, say which equipment term you searched for and that no load row " +
        "matches it — do not fall back to describing other records." +
        terminologyRules;

      system =
        def.id === "panel_qa"
          ? "You are an electrician's assistant reading a farm's as-installed and planned electrical record. " +
            "The RECORDS block is one line per row; each field is written as key=value. " +
            loadFirstRules +
            " Cite stable IDs (PNL-*, CON-*, FS-*, BR-*, EMT-*) for every claim. " +
            "Never describe the shape of the data, never list possible questions, never add generic " +
            "labelling recommendations the user did not ask for. Read-only: you change nothing."
          : def.id === "load_trace"
            ? "You annotate a deterministic electrical trace. The DETERMINISTIC TRACE block already contains " +
              "the correct hop chain for each matched load (service/source → feeder → panel → breaker → circuit → load). " +
              "Never restate a hop differently, never fill a [GAP] hop with a guess. For each traced load add: " +
              "what is proven by the record today, which named field closes each gap, and the practical field " +
              "step to confirm it. " +
              loadFirstRules +
              " Read-only: you change nothing."
            : "You are an electrician's assistant. Describe the power path from service to load in plain language, " +
              "step by step, citing the stable ID at each hop (service → feeder → panel → breaker → circuit → load). " +
              loadFirstRules +
              " Use only the supplied records; state plainly where the chain breaks or a reference is missing. Read-only.";




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
    const resolved = await resolveAreaAi(def.area, {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });
    // The user accepted the estimated cloud cost for this question: run it on
    // the configured cloud engine instead of the self-hosted one. Metering still
    // records it as a hosted run, so it shows up on the AI bill.
    let ai = resolved;
    if (data.useCloud && resolved.backend === "local") {
      if (!resolved.hostedProvider) {
        throw new Error(
          "No cloud AI engine is configured, so this question cannot be escalated. Configure one in Admin → AI engines.",
        );
      }
      ai = {
        ...resolved,
        backend: "hosted",
        provider: resolved.hostedProvider,
        modelId: resolved.hostedModelId,
      };
    }
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

    // Small local models can ignore even a focused answer set and summarize the
    // surrounding panel inventory instead. Never return that non-answer: if the
    // matcher found loads, every matched stable ID must appear in the response.
    const narration =
      groundedLoadAnswer && !containsEveryStableId(run.value, matchedLoadIds)
        ? groundedLoadAnswer
        : run.value;
    // The trace itself is record-derived, so it is always shown; the model only
    // annotates it underneath.
    const answer = loadTraceAnswer
      ? `${loadTraceAnswer}\n\n---\n\n## Notes\n\n${narration}`
      : loadTraceAnswer === null && def.id === "load_trace"
        ? `No load row matched that description, so there is no path to trace. Searched terms are listed in the record context.\n\n${narration}`
        : narration;


    return {
      scenario: def.id,
      area: def.area,
      areaLabel: ai.areaLabel,
      engineLabel: ai.engineLabel,
      model: run.modelId,
      backend: run.backend,
      answer,
      contextCounts,
      ...(def.input === "photo"
        ? { nameplate: nameplateFields(parseNameplateDraft(run.value)) }
        : {}),
      latencyMs: Date.now() - started,
      finishedAt: Date.now(),
      cost: run.usage
        ? {
            metered: run.usage.metered,
            usd: run.usage.costUsd,
            estimated: run.usage.estimated,
            inputTokens: run.usage.inputTokens,
            outputTokens: run.usage.outputTokens,
          }
        : null,
      escalation: run.escalation,
    };
  });

/**
 * Pre-flight estimate for one question: how much record it has to send, whether
 * the self-hosted model is likely to cope, and what a cloud run would cost.
 * The UI shows this before spending two minutes of local GPU on a non-answer.
 */
export interface ElectricalAiEstimate {
  scenario: ElectricalAiScenarioId;
  area: string;
  areaLabel: string;
  backend: string;
  engineLabel: string;
  localModel: string | null;
  hostedModel: string | null;
  hostedAvailable: boolean;
  contextTokens: number;
  /** Loads whose text matched the question — reassures that data was found. */
  matchedLoadIds: string[];
  recommendCloud: boolean;
  reason: string;
  costLabel: string;
  costUsd: number | null;
}

const EstimateInput = z.object({
  scenario: z.string().refine(isElectricalAiScenarioId, "Unknown scenario"),
  text: z.string().trim().max(2000).optional(),
});

export const estimateElectricalAiRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EstimateInput.parse(d))
  .handler(async ({ data, context }): Promise<ElectricalAiEstimate> => {
    const def = getElectricalAiScenario(data.scenario as ElectricalAiScenarioId);
    const { isAdmin, access, grants, denied } = await resolveScope(
      context.supabase,
      context.userId,
    );
    if (!canRunElectricalAiScenario({ access, isAdmin, grants, denied }, def)) {
      throw new Error(ELECTRICAL_AI_DENIED);
    }

    const question = (data.text ?? "").trim();
    let contextTokens = 0;
    let matchedLoadIds: string[] = [];
    if (def.id === "panel_qa" || def.id === "topology_explain") {
      const built = await buildRecordContext(context.supabase, question);
      contextTokens = built.approxTokens;
      matchedLoadIds = built.matchedLoadIds;
    }

    const { resolveAreaAi } = await import("@/lib/ai-routing.server");
    const { buildCloudOffer } = await import("@/lib/ai-escalation-offer");
    const ai = await resolveAreaAi(def.area, {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });
    const offer = buildCloudOffer({
      area: def.area,
      backend: ai.backend,
      localModel: ai.backend === "local" ? ai.modelId : null,
      hostedModel: ai.hostedModelId,
      hostedAvailable: Boolean(ai.hostedProvider),
      contextTokens,
    });

    return {
      scenario: def.id,
      area: def.area,
      areaLabel: ai.areaLabel,
      backend: ai.backend,
      engineLabel: ai.engineLabel,
      localModel: offer.localModel,
      hostedModel: offer.hostedModel,
      hostedAvailable: Boolean(ai.hostedProvider),
      contextTokens,
      matchedLoadIds: matchedLoadIds.slice(0, 40),
      recommendCloud: offer.recommended,
      reason: offer.reason,
      costLabel: offer.costLabel,
      costUsd: offer.cost?.usd ?? null,
    };
  });
