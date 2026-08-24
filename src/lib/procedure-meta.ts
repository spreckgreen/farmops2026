// Client-safe metadata extraction for procedure documents.
// Maintenance plan pages written by ai-actions/maintenance-plan-doc.server.ts
// carry `''Type:'' Maintenance plan`, `''Asset:'' <name>` and a service
// interval table, so we can classify + filter them without a schema change.

export interface ProcedureMeta {
  /** e.g. "Maintenance plan", or null when the page has no Type line. */
  type: string | null;
  /** Asset name from the ''Asset:'' line, when present. */
  asset: string | null;
  /** Distinct interval labels, e.g. ["every 50 hours", "every 12 months"]. */
  intervals: string[];
}

const TYPE_RE = /''Type:''\s*([^\n|]+)/i;
const ASSET_RE = /''Asset:''\s*([^\n|]+)/i;
/** Table cell like `|every 50 hours|` produced by the plan builder. */
const INTERVAL_RE = /every\s+(\d+(?:\.\d+)?)\s+([a-z]+)/gi;

/** Strip HTML tags so we can read the wiki text out of a stored document. */
function toText(content: string): string {
  return String(content ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n");
}

export function parseProcedureMeta(content: string): ProcedureMeta {
  const text = toText(content);
  const type = text.match(TYPE_RE)?.[1]?.trim() || null;
  const asset = text.match(ASSET_RE)?.[1]?.trim() || null;
  const intervals: string[] = [];
  for (const m of text.matchAll(INTERVAL_RE)) {
    const label = `every ${m[1]} ${m[2].toLowerCase()}`;
    if (!intervals.includes(label)) intervals.push(label);
  }
  intervals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { type, asset, intervals };
}

export const MAINTENANCE_PLAN_TYPE = "Maintenance plan";

export function isMaintenancePlan(meta: ProcedureMeta): boolean {
  return (meta.type ?? "").toLowerCase() === MAINTENANCE_PLAN_TYPE.toLowerCase();
}
