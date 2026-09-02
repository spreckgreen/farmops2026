// Per-feature AI routing: which local or configured cloud backend
// handles each AI feature area of the app.
//
// Pure + dependency-free so it runs on the server (resolving a provider) and in
// tests. The server side lives in ai-routing.server.ts.
//
// Motivation: a small local model (llama3.2:3b on modest hardware) is fine for
// short narratives and triage, but silently truncates a yearly rollup or a
// 16k-context manual. Rather than one global backend, each area picks its own.

export type AiBackend = "local" | "hosted";
/**
 * What an area is set to:
 *   "default"      — follow the recommended/global resolution
 *   "local"        — self-hosted engine
 *   "hosted"       — whichever cloud engine is the configured cloud default
 *   engine id      — one specific engine ("ollama_cloud", "other_cloud")
 */
export type AiAreaChoice =
  | AiBackend
  | "default"
  | "ollama_cloud"
  | "other_cloud";

export const AI_AREA_CHOICES: readonly AiAreaChoice[] = [
  "default",
  "local",
  "ollama_cloud",
  "other_cloud",
  "hosted",
] as const;

export type AiAreaId =
  | "summary.daily"
  | "summary.weekly"
  | "summary.monthly"
  | "summary.quarterly"
  | "summary.yearly"
  | "summary.task"
  | "consultant"
  | "procedures"
  | "kb_ingest"
  | "maintenance.schedule"
  | "maintenance.symptom"
  | "maintenance.forecast"
  | "food.preservation"
  | "food.prices"
  | "electrical.panel_qa"
  | "electrical.load_trace"
  | "electrical.topology_explain"

  | "electrical.qa_triage"
  | "electrical.audit_summary"
  | "electrical.field_note"
  | "electrical.nameplate_extract"
  | "diagnostics";

export interface AiAreaDef {
  id: AiAreaId;
  label: string;
  group:
    | "Summaries"
    | "Service schedule"
    | "Food preservation"
    | "Knowledge"
    | "Electrical"
    | "Diagnostics";
  /** What the call does, in the user's terms. */
  description: string;
  /** Rough context/output weight — drives the "heavy" warning in the UI. */
  load: "light" | "medium" | "heavy";
  /** Recommended default backend for modest self-host hardware. */
  recommended: AiBackend;
  /** Minimum useful context window in tokens for this area. */
  minContext: number;
}

export const AI_FEATURE_AREAS: readonly AiAreaDef[] = [
  {
    id: "summary.daily",
    label: "Daily recap",
    group: "Summaries",
    description: "One-day recap of the activity log.",
    load: "light",
    recommended: "local",
    minContext: 4096,
  },
  {
    id: "summary.task",
    label: "Task / project update",
    group: "Summaries",
    description: "Short update for a single task or project rollup.",
    load: "light",
    recommended: "local",
    minContext: 4096,
  },
  {
    id: "summary.weekly",
    label: "Weekly report",
    group: "Summaries",
    description: "Full week of log lines, per-project sections, JSON structure.",
    load: "heavy",
    recommended: "hosted",
    minContext: 8192,
  },
  {
    id: "summary.monthly",
    label: "Monthly rollup",
    group: "Summaries",
    description: "A month of activity rolled up per project.",
    load: "heavy",
    recommended: "hosted",
    minContext: 16384,
  },
  {
    id: "summary.quarterly",
    label: "Quarterly review",
    group: "Summaries",
    description: "Quarter review per project: decisions, blockers, next steps.",
    load: "heavy",
    recommended: "hosted",
    minContext: 16384,
  },
  {
    id: "summary.yearly",
    label: "Yearly rollup",
    group: "Summaries",
    description: "A full year of activity — the largest prompt the app builds.",
    load: "heavy",
    recommended: "hosted",
    minContext: 32768,
  },
  {
    id: "consultant",
    label: "Farm consultant chat",
    group: "Knowledge",
    description: "Multi-turn chat with knowledge-base context.",
    load: "heavy",
    recommended: "hosted",
    minContext: 16384,
  },
  {
    id: "procedures",
    label: "Procedures & manual generation",
    group: "Knowledge",
    description: "Answers over procedure documents and long manual drafting.",
    load: "heavy",
    recommended: "hosted",
    minContext: 16384,
  },
  {
    id: "kb_ingest",
    label: "Knowledge-base ingest",
    group: "Knowledge",
    description: "Converts uploaded manuals and pages into procedures.",
    load: "heavy",
    recommended: "hosted",
    minContext: 16384,
  },
  {
    id: "maintenance.schedule",
    label: "Service schedule planner",
    group: "Service schedule",
    description: "Builds maintenance schedules from asset and usage history.",
    load: "medium",
    recommended: "hosted",
    minContext: 8192,
  },
  {
    id: "maintenance.symptom",
    label: "Symptom diagnosis",
    group: "Service schedule",
    description: "Triages a described symptom into likely causes.",
    load: "medium",
    recommended: "local",
    minContext: 8192,
  },
  {
    id: "maintenance.forecast",
    label: "Maintenance forecast narrative",
    group: "Service schedule",
    description: "Short narrative over the computed forecast buckets.",
    load: "light",
    recommended: "local",
    minContext: 4096,
  },
  {
    id: "food.preservation",
    label: "Preservation coach",
    group: "Food preservation",
    description: "Recommends a safe preservation method for a harvest.",
    load: "medium",
    recommended: "local",
    minContext: 8192,
  },
  {
    id: "food.prices",
    label: "Food price reference",
    group: "Food preservation",
    description: "Estimates Southern Ohio retail $/lb for plan foods.",
    load: "light",
    recommended: "local",
    minContext: 4096,
  },
  {
    id: "electrical.panel_qa",
    label: "Panel & circuit Q&A",
    group: "Electrical",
    description:
      "Answers field questions (\"what feeds PNL-H1?\") from the as-installed panel, feeder, breaker and load record. Read-only.",
    load: "medium",
    recommended: "local",
    minContext: 8192,
  },
  {
    id: "electrical.topology_explain",
    label: "Topology explanation",
    group: "Electrical",
    description:
      "Turns a service/topology snapshot into a plain-language description of how power reaches a load.",
    load: "medium",
    recommended: "local",
    minContext: 8192,
  },
  {
    id: "electrical.qa_triage",
    label: "QA / validation finding triage",
    group: "Electrical",
    description:
      "Groups reconciliation and QA findings into systematic patterns. Suggestions only — adjudication stays rule-based.",
    load: "heavy",
    recommended: "hosted",
    minContext: 16384,
  },
  {
    id: "electrical.audit_summary",
    label: "Electrician change-audit review",
    group: "Electrical",
    description:
      "Summarises audited electrician field writes for administrator review, flagging safety-relevant fields.",
    load: "medium",
    recommended: "hosted",
    minContext: 8192,
  },
  {
    id: "electrical.field_note",
    label: "Field note → draft change summary",
    group: "Electrical",
    description:
      "Turns a spoken or typed field observation into a tidy draft note. Never writes an electrical record.",
    load: "light",
    recommended: "local",
    minContext: 4096,
  },
  {
    id: "electrical.nameplate_extract",
    label: "Nameplate photo extraction",
    group: "Electrical",
    description:
      "Reads an equipment nameplate photo (voltage, phase, FLA/MCA, HP, MOCP, model, serial) into a draft you confirm. Needs a vision-capable model, e.g. google/gemini-3.6-flash.",
    load: "medium",
    recommended: "hosted",
    minContext: 8192,
  },
  {
    id: "diagnostics",
    label: "AI diagnostics & workflow tests",
    group: "Diagnostics",
    description: "Connection, weekly-report and manual test probes.",
    load: "light",
    recommended: "local",
    minContext: 4096,
  },
] as const;

const AREA_IDS = new Set<string>(AI_FEATURE_AREAS.map((a) => a.id));

export function isAiAreaId(value: unknown): value is AiAreaId {
  return typeof value === "string" && AREA_IDS.has(value);
}

export function getAiArea(id: AiAreaId): AiAreaDef {
  const found = AI_FEATURE_AREAS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown AI feature area: ${id}`);
  return found;
}

/** Per-area override. `model` is optional and only used for that area. */
export interface AiAreaRoute {
  backend: AiAreaChoice;
  model: string | null;
}

export interface AiRoutingConfig {
  /** Retry a failed/truncated local call on hosted AI once. */
  autoFallback: boolean;
  areas: Partial<Record<AiAreaId, AiAreaRoute>>;
}

export const DEFAULT_ROUTING: AiRoutingConfig = {
  autoFallback: true,
  areas: Object.fromEntries(
    AI_FEATURE_AREAS.map((a) => [a.id, { backend: a.recommended, model: null }]),
  ) as Partial<Record<AiAreaId, AiAreaRoute>>,
};

function normalizeChoice(value: unknown): AiAreaChoice | null {
  if (value === "lovable") return "hosted";
  return typeof value === "string" && (AI_AREA_CHOICES as readonly string[]).includes(value)
    ? (value as AiAreaChoice)
    : null;
}

/** Parse the JSON blob stored in the shared vault (CUSTOM_AI_FEATURE_ROUTING). */
export function parseRoutingConfig(raw: string | null | undefined): AiRoutingConfig | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { autoFallback?: unknown; areas?: unknown };
  const areas: Partial<Record<AiAreaId, AiAreaRoute>> = {};
  const rawAreas = (obj.areas ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawAreas)) {
    if (!isAiAreaId(key) || !value || typeof value !== "object") continue;
    const entry = value as { backend?: unknown; model?: unknown };
    const backend = normalizeChoice(entry.backend);
    if (!backend) continue;
    const model =
      typeof entry.model === "string" && entry.model.trim() ? entry.model.trim() : null;
    areas[key] = { backend, model };
  }
  return {
    autoFallback: obj.autoFallback !== false,
    areas,
  };
}

export function serializeRoutingConfig(config: AiRoutingConfig): string {
  return JSON.stringify({ autoFallback: config.autoFallback, areas: config.areas });
}

/** Merge stored overrides over the recommended defaults. */
export function resolveRoutingConfig(raw: string | null | undefined): AiRoutingConfig {
  const parsed = parseRoutingConfig(raw);
  const areas: Partial<Record<AiAreaId, AiAreaRoute>> = {};
  for (const area of AI_FEATURE_AREAS) {
    const stored = parsed?.areas[area.id];
    areas[area.id] = stored ?? { backend: area.recommended, model: null };
  }
  return { autoFallback: parsed ? parsed.autoFallback : true, areas };
}

export function routeForArea(config: AiRoutingConfig, id: AiAreaId): AiAreaRoute {
  return config.areas[id] ?? { backend: getAiArea(id).recommended, model: null };
}

/** Map a summary mode to its feature area. */
export function areaForSummaryMode(mode: string): AiAreaId {
  switch (mode) {
    case "daily_recap":
      return "summary.daily";
    case "weekly_report":
      return "summary.weekly";
    case "monthly_rollup":
      return "summary.monthly";
    case "quarter_review":
      return "summary.quarterly";
    case "yearly_rollup":
      return "summary.yearly";
    default:
      return "summary.task";
  }
}

/** Told the user their local call got escalated to hosted AI. */
export interface AiEscalation {
  area: AiAreaId;
  areaLabel: string;
  fromModel: string;
  toModel: string;
  reason: "error" | "truncated";
  detail: string;
}
