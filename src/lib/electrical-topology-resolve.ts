// Topology reconciliation for ODS-derived raceways.
//
// The canonical workbook carries engineering `Conduit_Runs.From` / `.To` text.
// FarmOps keeps that text verbatim (read-only Design/Legacy fields) and models
// the *as-built* relationship separately as source/destination FKs. A raceway
// with design text but no FK is INCOMPLETE, not invalid.
//
// This module is pure and never mutates: it reports which raceways still need a
// physical endpoint and, only when a design value resolves to exactly one
// existing record by stable ID, proposes that relationship. Anything ambiguous
// stays unresolved with the original text intact — no silent guessing.
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";

export type EndpointKind = "panel" | "jbox";

export interface TopologySlot {
  slot: "source" | "dest";
  /** Verbatim ODS Conduit_Runs From/To text for this side. */
  designText: string;
  /** Legacy stable-ID reference column, if the import filled it. */
  legacyRef: string;
  linkedKind: EndpointKind | null;
  linkedId: string | null;
  linkedStableId: string;
  /** High-confidence single-match proposal, or nulls when unresolved. */
  proposalKind: EndpointKind | null;
  proposalId: string | null;
  proposalStableId: string;
  /** Why the proposal is safe, or why nothing could be proposed. */
  reason: string;
}

export interface TopologyGap {
  id: string;
  conduitId: string;
  description: string;
  routeGroup: string;
  installStatus: string;
  designFrom: string;
  designTo: string;
  slots: TopologySlot[];
  /** True once both endpoints are linked to a record. */
  complete: boolean;
}

const ENDPOINT_KINDS: EndpointKind[] = ["panel", "jbox"];

function text(row: Row, key: string): string {
  return String(row[key] ?? "").trim();
}

function stableId(kind: EndpointKind, row: Row): string {
  return text(row, ENTITIES[kind].stableIdField);
}

interface Index {
  byUuid: Map<string, { kind: EndpointKind; stableId: string }>;
  byStableId: Map<string, { kind: EndpointKind; id: string; stableId: string }[]>;
}

function buildIndex(graph: ElectricalGraphData): Index {
  const byUuid = new Map<string, { kind: EndpointKind; stableId: string }>();
  const byStableId = new Map<string, { kind: EndpointKind; id: string; stableId: string }[]>();
  for (const kind of ENDPOINT_KINDS) {
    for (const row of graph[kind] ?? []) {
      const sid = stableId(kind, row);
      const id = text(row, "id");
      if (id) byUuid.set(id, { kind, stableId: sid });
      if (!sid || !id) continue;
      const key = sid.toUpperCase();
      byStableId.set(key, [...(byStableId.get(key) ?? []), { kind, id, stableId: sid }]);
    }
  }
  return { byUuid, byStableId };
}

/** Stable-ID-looking tokens inside a free-text design value, in order. */
export function stableIdTokens(value: string): string[] {
  const out: string[] = [];
  const whole = value.trim();
  if (whole) out.push(whole);
  for (const token of whole.split(/[^A-Za-z0-9_-]+/)) {
    const t = token.trim();
    if (t && t !== whole) out.push(t);
  }
  return out;
}

function resolveSlot(
  index: Index,
  candidates: string[],
): { hit: { kind: EndpointKind; id: string; stableId: string } | null; reason: string } {
  for (const candidate of candidates) {
    const matches = index.byStableId.get(candidate.toUpperCase());
    if (!matches || !matches.length) continue;
    if (matches.length > 1) {
      return {
        hit: null,
        reason: `"${candidate}" matches ${matches.length} records — pick the right one by hand.`,
      };
    }
    return {
      hit: matches[0]!,
      reason: `"${candidate}" matches exactly one existing ${ENTITIES[matches[0]!.kind].singular} (${matches[0]!.stableId}).`,
    };
  }
  return { hit: null, reason: "" };
}

function slotFor(
  index: Index,
  row: Row,
  slot: "source" | "dest",
  designText: string,
): TopologySlot {
  const legacyRef = text(row, `${slot}_endpoint_ref`);
  const panelUuid = text(row, `${slot}_panel_uuid`);
  const jboxUuid = text(row, `${slot}_jbox_uuid`);
  const linkedId = panelUuid || jboxUuid || null;
  const linked = linkedId ? index.byUuid.get(linkedId) ?? null : null;

  const base: TopologySlot = {
    slot,
    designText,
    legacyRef,
    linkedKind: linked?.kind ?? (panelUuid ? "panel" : jboxUuid ? "jbox" : null),
    linkedId,
    linkedStableId: linked?.stableId ?? "",
    proposalKind: null,
    proposalId: null,
    proposalStableId: "",
    reason: "",
  };

  if (linkedId) {
    return { ...base, reason: linked ? "Already linked." : "Linked record no longer exists." };
  }

  const { hit, reason } = resolveSlot(index, [
    ...(legacyRef ? stableIdTokens(legacyRef) : []),
    ...stableIdTokens(designText),
  ]);
  if (hit) {
    return {
      ...base,
      proposalKind: hit.kind,
      proposalId: hit.id,
      proposalStableId: hit.stableId,
      reason,
    };
  }
  return {
    ...base,
    reason:
      reason ||
      (designText
        ? `Design value "${designText}" does not name an existing panel or junction box — select the record.`
        : "No design value and no link — select the record."),
  };
}

/**
 * Every raceway whose as-built topology is not fully established, newest design
 * text preserved verbatim. Ordered by conduit ID so the punch list is stable.
 */
export function topologyGaps(graph: ElectricalGraphData): TopologyGap[] {
  const index = buildIndex(graph);
  const gaps: TopologyGap[] = [];
  for (const row of graph.raceway ?? []) {
    const designFrom = text(row, "from_label");
    const designTo = text(row, "to_label");
    const slots = [
      slotFor(index, row, "source", designFrom),
      slotFor(index, row, "dest", designTo),
    ];
    const complete = slots.every((s) => Boolean(s.linkedId));
    if (complete) continue;
    gaps.push({
      id: text(row, "id"),
      conduitId: text(row, ENTITIES.raceway.stableIdField),
      description: text(row, "description"),
      routeGroup: text(row, "route_group"),
      installStatus: text(row, "install_status"),
      designFrom,
      designTo,
      slots,
      complete,
    });
  }
  return gaps.sort((a, b) => a.conduitId.localeCompare(b.conduitId));
}

export function topologyGapSummary(gaps: TopologyGap[]) {
  const openSlots = gaps.flatMap((g) => g.slots.filter((s) => !s.linkedId));
  return {
    raceways: gaps.length,
    openSlots: openSlots.length,
    proposals: openSlots.filter((s) => s.proposalId).length,
    unresolved: openSlots.filter((s) => !s.proposalId).length,
  };
}
