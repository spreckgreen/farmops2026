// What a record connects to, expressed as a list of independent lookups.
//
// Detail pages must open even when the topology is incomplete or when a newer
// relationship table/column is not present in a given deployment. So the plan
// is pure data here, each lookup is executed and *failed* independently by the
// server function, and a failing relationship lookup degrades into a warning
// instead of taking the whole record down with it.
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";

export interface TopologyLookup {
  /** Entity table to search. */
  kind: ElectricalEntityKind;
  /** Column on that table compared against `value`. */
  column: string;
  /** Stable ID being matched. Empty values are dropped from the plan. */
  value: string;
  /** Human phrase describing the relationship direction. */
  relation: string;
}

export interface RelatedRecord {
  kind: ElectricalEntityKind;
  stable_id: string;
  label: string;
  relation: string;
}

/** A relationship lookup that could not be completed in this deployment. */
export interface TopologyWarning {
  kind: ElectricalEntityKind;
  column: string;
  relation: string;
  message: string;
}

type Rec = Record<string, unknown>;

function str(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Relationship lookups for one record. Never throws and never assumes a
 * relationship exists: a record with no topology simply yields fewer lookups.
 */
export function topologyLookups(
  kind: ElectricalEntityKind,
  record: Rec,
  stableId: string,
): TopologyLookup[] {
  const plan: TopologyLookup[] = [];
  const add = (
    k: ElectricalEntityKind,
    column: string,
    value: string,
    relation: string,
  ) => {
    if (str(value)) plan.push({ kind: k, column, value: str(value), relation });
  };

  if (kind === "panel") {
    add("circuit_group", "suggested_panel", stableId, "circuit on this panel");
    add("raceway", "source_endpoint_ref", stableId, "raceway leaving panel");
    add("raceway", "dest_endpoint_ref", stableId, "raceway entering panel");
  } else if (kind === "circuit_group") {
    add("load", "circuit_group_ref", stableId, "load on this circuit");
    add("panel", "panel_id", str(record["suggested_panel"]), "panel");
  } else if (kind === "load") {
    add("circuit_group", "circuit_group_id", str(record["circuit_group_ref"]), "circuit group");
    add("branch", "dest_endpoint_ref", stableId, "branch run feeding load");
  } else if (kind === "raceway") {
    for (const ref of [record["source_endpoint_ref"], record["dest_endpoint_ref"]]) {
      const value = str(ref);
      if (value.startsWith("PNL-")) add("panel", "panel_id", value, "endpoint");
      if (value.startsWith("JB-")) add("jbox", "jbox_id", value, "endpoint");
    }
  } else if (kind === "jbox") {
    add("raceway", "source_endpoint_ref", stableId, "raceway leaving box");
    add("raceway", "dest_endpoint_ref", stableId, "raceway entering box");
    add("branch", "source_endpoint_ref", stableId, "branch run from box");
  } else if (kind === "branch") {
    for (const ref of [record["source_endpoint_ref"], record["dest_endpoint_ref"]]) {
      const value = str(ref);
      if (value.startsWith("PNL-")) add("panel", "panel_id", value, "endpoint");
      if (value.startsWith("JB-")) add("jbox", "jbox_id", value, "endpoint");
      if (/^(FS|PH|BL)-/.test(value)) add("load", "load_id", value, "endpoint");
    }
  }
  return plan;
}

/** Map lookup result rows onto display records. Tolerates missing columns. */
export function relatedFromRows(lookup: TopologyLookup, rows: Rec[]): RelatedRecord[] {
  const target = ENTITIES[lookup.kind];
  return (rows ?? []).map((r) => ({
    kind: lookup.kind,
    stable_id: str(r[target.stableIdField]),
    label: str(r["description"]) || str(r["dest_endpoint_ref"]),
    relation: lookup.relation,
  }));
}

/** Stable, readable warning for a relationship lookup that failed. */
export function topologyWarning(lookup: TopologyLookup, message: string): TopologyWarning {
  return {
    kind: lookup.kind,
    column: lookup.column,
    relation: lookup.relation,
    message: `Could not read ${ENTITIES[lookup.kind].title.toLowerCase()} by ${lookup.column}: ${message}`,
  };
}

export function sortRelated(rows: RelatedRecord[]): RelatedRecord[] {
  return [...rows].sort(
    (a, b) =>
      a.relation.localeCompare(b.relation) ||
      a.kind.localeCompare(b.kind) ||
      a.stable_id.localeCompare(b.stable_id),
  );
}
