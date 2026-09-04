/**
 * Manifest revision diff — pure, read-only.
 *
 * Compares two audit-batch manifests (a base revision and the revision awaiting
 * approval) so an owner can see exactly what changed before approving anything.
 * Nothing here writes, approves or applies. Item identity is the `item_key`.
 */

import type { AuditBatchManifest } from "./electrical-audit-batch";

export type ManifestDiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface FieldChange {
  path: string;
  /** Rendered as text so the diff is transport-safe across the server boundary. */
  before: string | null;
  after: string | null;
}

/** Compact, human-readable rendering of any manifest value. */
export function renderValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return stable(v);
}

export interface ManifestItemDiff {
  item_key: string;
  status: ManifestDiffStatus;
  entity_kind: string | null;
  target_stable_id: string | null;
  operation: string | null;
  changes: FieldChange[];
}

export interface ManifestDiff {
  base_batch_id: string;
  revision_batch_id: string;
  header_changes: FieldChange[];
  items: ManifestItemDiff[];
  counts: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    header_changes: number;
  };
  identical: boolean;
}

const HEADER_FIELDS = [
  "schema_version",
  "title",
  "scope",
  "building",
  "observed_date",
  "observed_time_precision",
  "timezone",
  "source",
  "compensates_batch_id",
] as const;

function norm(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  return v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(norm(v) ?? null);
}

/** Recursive field-level comparison, flattened to dotted paths. */
function walk(prefix: string, before: unknown, after: unknown, out: FieldChange[]): void {
  const b = norm(before);
  const a = norm(after);
  if (stable(b) === stable(a)) return;
  if (isPlainObject(b) && isPlainObject(a)) {
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
    for (const k of keys) walk(prefix ? `${prefix}.${k}` : k, b[k], a[k], out);
    return;
  }
  out.push({ path: prefix || "value", before: renderValue(b), after: renderValue(a) });
}

const ITEM_FIELDS = [
  "entity_kind",
  "target_stable_id",
  "observation_class",
  "operation",
  "fields",
  "install_state",
  "pole",
  "field_grid_reference",
  "refs",
  "observed_label",
  "evidence",
  "notes",
  "reason",
  "ods_field",
  "ods_candidate_value",
  "depends_on",
  "allocate_stable_id",
] as const;

type LooseItem = Record<string, unknown>;

function itemFieldDiff(before: LooseItem, after: LooseItem): FieldChange[] {
  const out: FieldChange[] = [];
  const keys = Array.from(
    new Set([...ITEM_FIELDS, ...Object.keys(before), ...Object.keys(after)]),
  ).filter((k) => k !== "item_key");
  for (const k of keys.sort()) walk(k, before[k], after[k], out);
  return out;
}

/**
 * Diffs two manifests. `base` is the earlier revision, `revision` is the one
 * pending approval. Unchanged items are reported for counting but carry no
 * change rows.
 */
export function diffManifests(
  base: AuditBatchManifest,
  revision: AuditBatchManifest,
): ManifestDiff {
  const header: FieldChange[] = [];
  for (const f of HEADER_FIELDS) {
    walk(f, (base as LooseItem)[f], (revision as LooseItem)[f], header);
  }
  walk("evidence", base.evidence ?? [], revision.evidence ?? [], header);

  const baseItems = new Map<string, LooseItem>(
    (base.items ?? []).map((i) => [String((i as LooseItem)["item_key"]), i as LooseItem]),
  );
  const revItems = new Map<string, LooseItem>(
    (revision.items ?? []).map((i) => [String((i as LooseItem)["item_key"]), i as LooseItem]),
  );

  const keys = Array.from(new Set([...baseItems.keys(), ...revItems.keys()])).sort();
  const items: ManifestItemDiff[] = keys.map((key) => {
    const b = baseItems.get(key);
    const a = revItems.get(key);
    const source = a ?? b!;
    const meta = {
      item_key: key,
      entity_kind: source["entity_kind"] == null ? null : String(source["entity_kind"]),
      target_stable_id:
        source["target_stable_id"] == null ? null : String(source["target_stable_id"]),
      operation: source["operation"] == null ? null : String(source["operation"]),
    };
    if (!b) return { ...meta, status: "added" as const, changes: [] };
    if (!a) return { ...meta, status: "removed" as const, changes: [] };
    const changes = itemFieldDiff(b, a);
    return {
      ...meta,
      status: (changes.length ? "changed" : "unchanged") as ManifestDiffStatus,
      changes,
    };
  });

  const counts = {
    added: items.filter((i) => i.status === "added").length,
    removed: items.filter((i) => i.status === "removed").length,
    changed: items.filter((i) => i.status === "changed").length,
    unchanged: items.filter((i) => i.status === "unchanged").length,
    header_changes: header.length,
  };

  return {
    base_batch_id: base.batch_id,
    revision_batch_id: revision.batch_id,
    header_changes: header,
    items,
    counts,
    identical:
      counts.added === 0 && counts.removed === 0 && counts.changed === 0 && header.length === 0,
  };
}

/**
 * Batch IDs are versioned by suffix (`FA-FS-2026-09-03-PM`, `…-R1`, `…-R1-LINKS`).
 * The revision root is the ID with any trailing revision suffixes removed, so
 * sibling revisions of the same audit can be offered as comparison bases.
 */
export function revisionRoot(batchId: string): string {
  let id = String(batchId ?? "").trim().toUpperCase();
  for (;;) {
    const next = id.replace(/-(R\d+|LINKS|REVERT|FIX\d*|CORRECTED)$/i, "");
    if (next === id) return id;
    id = next;
  }
}

/** True when two batch IDs are revisions of the same audit. */
export function sameRevisionFamily(a: string, b: string): boolean {
  return revisionRoot(a) === revisionRoot(b) && a !== b;
}
