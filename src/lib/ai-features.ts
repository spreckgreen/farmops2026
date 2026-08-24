// Central registry of user-facing AI features. Used by the AI settings page
// to enable/disable individual capabilities, and by feature gates to decide
// whether to render heavy AI UI.
//
// Weight indicators reflect *expected* per-invocation cost on a self-hosted
// model or a paid API:
//   - light:  short prompt, <500 output tokens, <5s typical  (e.g. weather summary)
//   - medium: 500-2k output tokens, 5-20s typical            (e.g. diagnose, forecast narrative)
//   - heavy:  structured plan generation, >2k tokens or multi-step, 20-60s+
//
// Adding a feature here does NOT automatically wire it — the corresponding
// UI must call useAiFeatureEnabled(id) and gate itself.

export type AiWeight = "light" | "medium" | "heavy";

export interface AiFeatureDef {
  id: string;
  label: string;
  description: string;
  weight: AiWeight;
  /** Route(s) or surface(s) where this feature appears (for docs only). */
  surfaces: string[];
  /** Enabled by default on new installs. */
  defaultEnabled: boolean;
}

export const AI_FEATURES: AiFeatureDef[] = [
  {
    id: "consultant",
    label: "Farm consultant chat",
    description:
      "Floating context-aware chat window on every page. Short prompts, but frequent.",
    weight: "medium",
    surfaces: ["Global (floating button)"],
    defaultEnabled: true,
  },
  {
    id: "maintenance.forecast",
    label: "Maintenance forecast narrative",
    description:
      "AI summary of predicted service list per asset over the next 30/60/90 days.",
    weight: "medium",
    surfaces: ["/maintenance/forecast"],
    defaultEnabled: true,
  },
  {
    id: "maintenance.diagnose",
    label: "Symptom → procedure",
    description:
      "Describe a machine issue and get a matching procedure and parts list.",
    weight: "medium",
    surfaces: ["/maintenance/diagnose"],
    defaultEnabled: true,
  },
  {
    id: "maintenance.generate-schedule",
    label: "Generate maintenance schedule",
    description:
      "Full structured schedule plan for an asset. Longest and heaviest AI call.",
    weight: "heavy",
    surfaces: ["/maintenance/generate-schedule"],
    defaultEnabled: true,
  },
  {
    id: "maintenance.import-manual",
    label: "Import service manual",
    description:
      "Read an AI-written service manual for one asset: intervals become maintenance records and missing parts are stocked in inventory.",
    weight: "heavy",
    surfaces: ["/maintenance/import-manual"],
    defaultEnabled: true,
  },
  {
    id: "food.preserve",
    label: "Preservation coach",
    description:
      "Recommends processing method, jar counts, and safety-gated procedure for a harvest.",
    weight: "medium",
    surfaces: ["/food/preserve"],
    defaultEnabled: true,
  },
  {
    id: "kb.ingest",
    label: "KB ingest & summarize",
    description:
      "Turn a data export (ChatGPT, Markdown, CSV/JSON, PDF/DOCX) into summarized TinyWiki KB articles. One model call per article.",
    weight: "heavy",
    surfaces: ["/procedures/ingest"],
    defaultEnabled: true,
  },
  {
    id: "weather.daily-summary",
    label: "Daily-note weather summary",
    description:
      "Short natural-language weather blurb prepended to today's daily note.",
    weight: "light",
    surfaces: ["/log (daily note open)"],
    defaultEnabled: true,
  },

];

export function getAiFeature(id: string): AiFeatureDef | undefined {
  return AI_FEATURES.find((f) => f.id === id);
}

export const AI_SETTINGS_STORAGE_KEY = "farmops.ai-settings.v1";

export interface AiSettingsState {
  /** Master switch — when false, every feature is treated as disabled. */
  masterEnabled: boolean;
  /** Per-feature overrides. Missing entries fall back to defaultEnabled. */
  features: Record<string, boolean>;
}

export const DEFAULT_AI_SETTINGS: AiSettingsState = {
  masterEnabled: true,
  features: Object.fromEntries(
    AI_FEATURES.map((f) => [f.id, f.defaultEnabled]),
  ),
};

export function isFeatureEnabled(
  state: AiSettingsState,
  id: string,
): boolean {
  if (!state.masterEnabled) return false;
  if (id in state.features) return state.features[id];
  const def = getAiFeature(id);
  return def?.defaultEnabled ?? false;
}

export const WEIGHT_META: Record<
  AiWeight,
  { label: string; blurb: string; className: string }
> = {
  light: {
    label: "Light",
    blurb: "<5s, short prompts",
    className:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
  medium: {
    label: "Medium",
    blurb: "5–20s, moderate tokens",
    className:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  heavy: {
    label: "Heavy",
    blurb: "20–60s+, large plans",
    className:
      "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  },
};
