// Per-feature AI on/off switches.
//
// A row in `ai_feature_toggles` only exists once an admin has flipped a feature;
// an absent row means "on". So a fresh deployment behaves exactly as before, and
// turning "Weekly report" off writes `{ area: 'summary.weekly', enabled: false }`
// which every call path checks before resolving a provider.
import type { AiAreaId } from "./ai-feature-areas";

type LooseDb = { from: (table: string) => any };

export const AI_TOGGLE_TABLE = "ai_feature_toggles";

export interface AiToggleRow {
  area: string;
  enabled: boolean;
  note: string | null;
  updated_at: string | null;
}

export async function loadAiFeatureToggles(client?: unknown): Promise<AiToggleRow[]> {
  if (!client) return [];
  const { data, error } = await (client as LooseDb)
    .from(AI_TOGGLE_TABLE)
    .select("area, enabled, note, updated_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as AiToggleRow[];
}

export async function isAreaEnabled(area: AiAreaId, client?: unknown): Promise<boolean> {
  if (!client) return true;
  try {
    const { data, error } = await (client as LooseDb)
      .from(AI_TOGGLE_TABLE)
      .select("enabled")
      .eq("area", area)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return true;
    return (data as { enabled: boolean }).enabled !== false;
  } catch (err) {
    // A read failure must not silently disable a feature — log and allow.
    console.warn("[ai-toggles] could not read feature switches:", err);
    return true;
  }
}

/** Throws a user-facing error when an admin has turned this feature off. */
export async function assertAreaEnabled(
  area: AiAreaId,
  label: string,
  client?: unknown,
): Promise<void> {
  if (await isAreaEnabled(area, client)) return;
  throw new Error(
    `AI feature "${label}" is turned off. An administrator can re-enable it under Admin → AI runtime → AI feature switches.`,
  );
}
