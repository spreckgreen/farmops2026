// Pure helpers for the model picker's one-click rollback.
//
// Whenever the app changes the active AI model (manual pick, derived num_ctx
// model, or "switch to suggested"), it stores a rollback point so the operator
// can put the previous model back with one click — and optionally delete the
// derived tag that was created along the way.
//
// The record is persisted as JSON in a shared vault row (env_key
// CUSTOM_AI_MODEL_ROLLBACK), so it survives restarts like the model itself.

export type ModelChangeKind = "manual" | "derived_context" | "switch_model";

export interface ModelRollbackPoint {
  /** Model that was active before the change. null = nothing was set yet. */
  previousModel: string | null;
  /** Model that became active. */
  appliedModel: string;
  /** What kind of change produced this rollback point. */
  kind: ModelChangeKind;
  /**
   * Tag created in Ollama by the change (the derived `…-ctx32k` model, or a
   * freshly pulled model). Safe to offer for deletion on rollback.
   */
  createdTag: string | null;
  /** ISO timestamp of the change. */
  changedAt: string;
}

const KINDS: ModelChangeKind[] = ["manual", "derived_context", "switch_model"];

export function serializeRollbackPoint(point: ModelRollbackPoint): string {
  return JSON.stringify(point);
}

/** Tolerant parse — a malformed/legacy value yields null instead of throwing. */
export function parseRollbackPoint(raw: string | null | undefined): ModelRollbackPoint | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.appliedModel !== "string" || !o.appliedModel) return null;
  const kind = KINDS.includes(o.kind as ModelChangeKind) ? (o.kind as ModelChangeKind) : "manual";
  return {
    previousModel: typeof o.previousModel === "string" && o.previousModel ? o.previousModel : null,
    appliedModel: o.appliedModel,
    kind,
    createdTag: typeof o.createdTag === "string" && o.createdTag ? o.createdTag : null,
    changedAt: typeof o.changedAt === "string" && o.changedAt ? o.changedAt : new Date(0).toISOString(),
  };
}

/**
 * A rollback is only offered when there is a previous model to go back to and
 * it isn't already the active one.
 */
export function canRollback(
  point: ModelRollbackPoint | null,
  currentModel: string | null,
): boolean {
  if (!point?.previousModel) return false;
  return point.previousModel !== currentModel;
}

const KIND_LABEL: Record<ModelChangeKind, string> = {
  manual: "model change",
  derived_context: "num_ctx fix",
  switch_model: "model switch",
};

/** e.g. "Undo num_ctx fix: llama3.2-3b-ctx32k → llama3.2:3b" */
export function describeRollback(point: ModelRollbackPoint): string {
  return `Undo ${KIND_LABEL[point.kind]}: ${point.appliedModel} → ${point.previousModel ?? "unset"}`;
}

/**
 * Only delete a tag the app itself created, and never the model we are about to
 * restore (a derived model can be based on the previous one, but the tags
 * differ — if they somehow match, keep it).
 */
export function deletableTag(point: ModelRollbackPoint): string | null {
  if (!point.createdTag) return null;
  if (point.createdTag === point.previousModel) return null;
  return point.createdTag;
}
