// Circuit groups are derived from Load_Master data, not from a separate
// worksheet. This module is pure: it turns the existing load rows into a
// reviewable plan of circuit group records to create and load links to set.
//
// Conservative by rule: nothing is deleted or reconstructed. A load is linked
// only when its group reference resolves to exactly one group; anything
// ambiguous or unresolvable is reported instead of guessed.

import { checkCircuitGroupId } from "./electrical-breaker-reference";

export type LoadRow = {
  id: string;
  load_id: string;
  description?: string | null;
  area?: string | null;
  notes?: string | null;
  circuit_group_ref?: string | null;
  circuit_group_uuid?: string | null;
  source_circuit?: string | null;
  dedicated?: boolean | null;
  critical?: boolean | null;
  volts?: number | null;
};

export type GroupRow = {
  id: string;
  circuit_group_id: string;
  description?: string | null;
};

/** Where a load's group reference came from, in precedence order. */
export type RefSource = "circuit_group_ref" | "source_circuit" | "legacy_note";

export interface LoadGroupRef {
  ref: string;
  source: RefSource;
}

const NOTE_PATTERN = /source\s*circuit\s*:\s*([A-Za-z0-9][A-Za-z0-9._/-]*)/i;

/** Resolve the circuit group reference carried by a load row, if any. */
export function loadGroupRef(load: LoadRow): LoadGroupRef | null {
  const direct = (load.circuit_group_ref ?? "").trim();
  if (direct) return { ref: direct, source: "circuit_group_ref" };
  const sourceCircuit = (load.source_circuit ?? "").trim();
  if (sourceCircuit) return { ref: sourceCircuit, source: "source_circuit" };
  const m = NOTE_PATTERN.exec(load.notes ?? "");
  if (m) return { ref: m[1].trim(), source: "legacy_note" };
  return null;
}

export interface DerivedGroup {
  circuit_group_id: string;
  description: string;
  /** true when this group already exists in the database. */
  exists: boolean;
  existingId: string | null;
  loadIds: string[];
  /** Distinct sources the reference was read from. */
  sources: RefSource[];
  shared: boolean;
  /**
   * Set when a NEW group would be created under a non-compliant stable ID.
   * Apply refuses these; existing records are never renamed.
   */
  id_error: string | null;
}

export interface DerivedLink {
  loadRowId: string;
  load_id: string;
  circuit_group_id: string;
  /** Set when the group must be created before linking. */
  pending: boolean;
}

export interface DerivationPlan {
  groups: DerivedGroup[];
  links: DerivedLink[];
  /** Loads with no resolvable group reference — reported, never guessed. */
  unresolved: { load_id: string; reason: string }[];
  /** Group references that collide with more than one existing group row. */
  ambiguous: { ref: string; existing: string[] }[];
  totals: {
    loads: number;
    withRef: number;
    groups: number;
    sharedGroups: number;
    createGroups: number;
    linkLoads: number;
    unresolved: number;
  };
}

function groupDescription(ref: string, loads: LoadRow[]): string {
  const areas = [...new Set(loads.map((l) => (l.area ?? "").trim()).filter(Boolean))];
  const descriptions = [
    ...new Set(loads.map((l) => (l.description ?? "").trim()).filter(Boolean)),
  ];
  if (descriptions.length === 1) {
    return areas.length === 1 ? `${areas[0]} — ${descriptions[0]}` : descriptions[0];
  }
  const scope = areas.length ? areas.join(" / ") : "Shared";
  return `${scope} — circuit ${ref} (${loads.length} load${loads.length === 1 ? "" : "s"})`;
}

/**
 * Build the reviewable derivation plan from the current loads and groups.
 * `existingGroups` may contain duplicates; duplicate stable IDs are reported as
 * ambiguous and left untouched.
 */
export function deriveCircuitGroups(loads: LoadRow[], existingGroups: GroupRow[]): DerivationPlan {
  const byStableId = new Map<string, GroupRow[]>();
  for (const g of existingGroups) {
    const key = (g.circuit_group_id ?? "").trim();
    if (!key) continue;
    byStableId.set(key, [...(byStableId.get(key) ?? []), g]);
  }

  const buckets = new Map<string, { loads: LoadRow[]; sources: Set<RefSource> }>();
  const unresolved: { load_id: string; reason: string }[] = [];

  for (const load of loads) {
    const ref = loadGroupRef(load);
    if (!ref) {
      unresolved.push({
        load_id: load.load_id,
        reason: "No circuit group ID, source circuit, or legacy source-circuit note on this load.",
      });
      continue;
    }
    const bucket = buckets.get(ref.ref) ?? { loads: [], sources: new Set<RefSource>() };
    bucket.loads.push(load);
    bucket.sources.add(ref.source);
    buckets.set(ref.ref, bucket);
  }

  const groups: DerivedGroup[] = [];
  const links: DerivedLink[] = [];
  const ambiguous: { ref: string; existing: string[] }[] = [];

  for (const ref of [...buckets.keys()].sort((a, b) => a.localeCompare(b))) {
    const bucket = buckets.get(ref)!;
    const matches = byStableId.get(ref) ?? [];
    if (matches.length > 1) {
      ambiguous.push({ ref, existing: matches.map((m) => m.id) });
      continue;
    }
    const existing = matches[0] ?? null;
    groups.push({
      circuit_group_id: ref,
      description: existing?.description?.trim() || groupDescription(ref, bucket.loads),
      exists: Boolean(existing),
      existingId: existing?.id ?? null,
      loadIds: bucket.loads.map((l) => l.load_id).sort((a, b) => a.localeCompare(b)),
      sources: [...bucket.sources].sort(),
      shared: bucket.loads.length > 1,
      id_error: existing ? null : (checkCircuitGroupId(ref).error ?? null),
    });
    for (const load of bucket.loads) {
      if (load.circuit_group_uuid && existing && load.circuit_group_uuid === existing.id) continue;
      links.push({
        loadRowId: load.id,
        load_id: load.load_id,
        circuit_group_id: ref,
        pending: !existing,
      });
    }
  }

  return {
    groups,
    links,
    unresolved,
    ambiguous,
    totals: {
      loads: loads.length,
      withRef: loads.length - unresolved.length,
      groups: groups.length,
      sharedGroups: groups.filter((g) => g.shared).length,
      createGroups: groups.filter((g) => !g.exists).length,
      linkLoads: links.length,
      unresolved: unresolved.length,
    },
  };
}
