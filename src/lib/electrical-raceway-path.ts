// Phase 4.4b — continuous raceway / ordered junction-box topology.
//
// One physical raceway (e.g. CON-104) can pass through several junction boxes in
// physical order. The authoritative topology is relational:
//
//   junction box → raceway_uuid → raceway    plus    raceway_sequence
//
// The encoded stable ID (JB-104-02) is only ever a *consistency check* — never
// the source of the relationship. Everything in this module is pure and
// deterministic so the QA rules, the diagram ordering and the preview-first
// population tool are all unit-testable without a database.
import { parseHierarchicalId } from "@/lib/electrical";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";

function text(row: Row, key: string): string {
  return String(row[key] ?? "").trim();
}

function num(row: Row, key: string): number | null {
  const raw = row[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sid(kind: "jbox" | "raceway" | "branch", row: Row): string {
  return text(row, ENTITIES[kind].stableIdField);
}

export interface JunctionPoint {
  /** Junction box row UUID, when known. */
  id: string | null;
  stableId: string;
  /** Physical order along the raceway. Null when not recorded yet. */
  sequence: number | null;
  row: Row;
}

/**
 * Junction boxes located along one continuous raceway, ordered by
 * `raceway_sequence` ascending. Boxes with no sequence sort last (they are
 * flagged by QA, never dropped) and ties fall back to the stable ID so the
 * order is always deterministic.
 */
export function orderedJunctionPoints(racewayUuid: string, jboxes: Row[]): JunctionPoint[] {
  const uuid = (racewayUuid ?? "").trim();
  if (!uuid) return [];
  return (jboxes ?? [])
    .filter((j) => text(j, "raceway_uuid") === uuid)
    .map((j) => ({
      id: j.id ? String(j.id) : null,
      stableId: sid("jbox", j),
      sequence: num(j, "raceway_sequence"),
      row: j,
    }))
    .sort(
      (a, b) =>
        (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) ||
        a.stableId.localeCompare(b.stableId),
    );
}

/** Two-digit position label used by the raceway detail page: 1 -> "01". */
export function positionLabel(sequence: number | null): string {
  return sequence == null ? "—" : String(sequence).padStart(2, "0");
}

// ------------------------------------------------------------------- QA rules

export const RACEWAY_PATH_CODES = [
  "duplicate_raceway_sequence",
  "missing_raceway_sequence",
  "sequence_without_raceway",
  "encoded_path_disagreement",
  "encoded_sequence_disagreement",
  "branch_jbox_disagreement",
  "orphan_path_topology",
] as const;
export type RacewayPathCode = (typeof RACEWAY_PATH_CODES)[number];

export interface PathFinding {
  code: RacewayPathCode;
  severity: "error" | "warning";
  kind: "jbox" | "branch";
  stableId: string;
  id: string | null;
  message: string;
}

/**
 * The path number a raceway ID encodes: CON-104 / EMT-104 -> "104".
 *
 * The canonical form is a bare `CON-###`. A stored ID that carries decorative
 * text after the canonical token (an entry artefact such as
 * `CON-104 — NW EMT, 3/4" EMT`) still *identifies* path 104, so the leading
 * canonical token is read rather than silently discarding the record. Nothing
 * here renames or rewrites the stored ID.
 */
export function racewayPathNumber(conduitId: string): string | null {
  const p = parseHierarchicalId(conduitId);
  if (p) return p.prefix === "CON" || p.prefix === "EMT" ? p.path : null;
  const m = /^(?:CON|EMT)-(\d{3})\b/.exec(String(conduitId ?? "").trim().toUpperCase());
  return m ? m[1]! : null;
}

/** Raceway rows grouped by the path number their stable ID encodes. */
export function buildRacewaysByPath(raceways: Row[]): Map<string, Row[]> {
  const byPath = new Map<string, Row[]>();
  for (const r of raceways ?? []) {
    const path = racewayPathNumber(sid("raceway", r));
    if (!path) continue;
    byPath.set(path, [...(byPath.get(path) ?? []), r]);
  }
  return byPath;
}

/** Raceways that name a junction box (by UUID) as their own source/dest endpoint. */
export function buildEndpointRaceways(raceways: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of raceways ?? []) {
    for (const col of ["source_jbox_uuid", "dest_jbox_uuid"]) {
      const boxUuid = text(r, col);
      if (!boxUuid) continue;
      const list = out.get(boxUuid) ?? [];
      if (!list.some((x) => String(x.id) === String(r.id))) list.push(r);
      out.set(boxUuid, list);
    }
  }
  return out;
}

/**
 * Every terminal state a junction box can be in with respect to the continuous
 * raceway its ID names. There is deliberately no implicit "dropped" state: one
 * of these is always reported.
 *
 * - `proposed`            actionable: unlinked, path/position parse, exactly one
 *                         visible raceway on that path, position free.
 * - `already_linked`      the stored link and position already match.
 * - `ambiguous_raceway`   several visible raceways encode the same path number.
 * - `no_matching_raceway` no visible raceway encodes the path number.
 * - `parent_conflict`     already linked to a different raceway.
 * - `sequence_conflict`   the encoded position is held by another box.
 * - `unparseable_id`      the ID encodes no canonical path/position.
 */
export const PATH_RESOLUTION_STATUSES = [
  "proposed",
  "already_linked",
  "ambiguous_raceway",
  "no_matching_raceway",
  "parent_conflict",
  "sequence_conflict",
  "unparseable_id",
] as const;
export type PathResolutionStatus = (typeof PATH_RESOLUTION_STATUSES)[number];

export interface PathResolution {
  jbox_id: string;
  jbox_uuid: string | null;
  /** Path number read from the box's own stable ID, e.g. "104". */
  extracted_path: string | null;
  /** Position encoded by the box ID, e.g. JB-104-02 -> 2. */
  encoded_sequence: number | null;
  current_raceway_uuid: string | null;
  current_raceway: string | null;
  current_sequence: number | null;
  /** Every visible raceway on the extracted path, after endpoint narrowing. */
  matching_raceways: { id: string | null; stable_id: string }[];
  /** Raceways that record this box as one of their own endpoints (evidence only). */
  endpoint_raceways: string[];
  target_raceway_uuid: string | null;
  target_raceway: string | null;
  proposed_sequence: number | null;
  status: PathResolutionStatus;
  /** Why this box is (or is not) actionable. Never empty. */
  reason: string;
}

/** True when the correction preview can propose this link without a human choice. */
export function isActionableResolution(r: PathResolution): boolean {
  return r.status === "proposed";
}

/**
 * The single candidate-resolution implementation. Both the `orphan_path_topology`
 * QA rule and the preview-first population planner call this, so a box can never
 * be reported as an actionable orphan by one and silently dropped by the other.
 *
 * An endpoint relationship (`CON-104.dest_jbox_uuid = JB-104-01`) is *supporting
 * evidence* about the same physical run: it can narrow an ambiguous path, and it
 * never disqualifies that box or any box further along the run.
 */
export function resolveJboxRacewayCandidates(graph: ElectricalGraphData): PathResolution[] {
  const jboxes = graph.jbox ?? [];
  const raceways = graph.raceway ?? [];
  const racewayByUuid = new Map(raceways.filter((r) => r.id).map((r) => [String(r.id), r]));
  const racewaysByPath = buildRacewaysByPath(raceways);
  const endpointRaceways = buildEndpointRaceways(raceways);

  // Positions already stored, so a proposal never collides with a saved one.
  const taken = new Map<string, string>();
  for (const jb of jboxes) {
    const parentUuid = text(jb, "raceway_uuid");
    const sequence = num(jb, "raceway_sequence");
    if (parentUuid && sequence != null) taken.set(`${parentUuid}:${sequence}`, sid("jbox", jb));
  }
  const nextFreeSequence = (racewayUuid: string): number => {
    let n = 1;
    while (taken.has(`${racewayUuid}:${n}`)) n++;
    return n;
  };

  const out: PathResolution[] = [];
  for (const jb of jboxes) {
    const id = sid("jbox", jb);
    const uuid = jb.id ? String(jb.id) : null;
    const currentUuid = text(jb, "raceway_uuid") || null;
    const currentSeq = num(jb, "raceway_sequence");
    const current = currentUuid ? racewayByUuid.get(currentUuid) : undefined;
    const encoded = parseHierarchicalId(id);
    const endpointCandidates = uuid ? (endpointRaceways.get(uuid) ?? []) : [];
    const endpointIds = endpointCandidates.map((r) => sid("raceway", r)).sort();
    const base = {
      jbox_id: id,
      jbox_uuid: uuid,
      current_raceway_uuid: currentUuid,
      current_raceway: current ? sid("raceway", current) : null,
      current_sequence: currentSeq,
      endpoint_raceways: endpointIds,
    };
    const asRow = (r: Row) => ({ id: r.id ? String(r.id) : null, stable_id: sid("raceway", r) });

    if (!encoded || encoded.prefix !== "JB" || !encoded.jbox) {
      // The ID encodes nothing, but a single endpoint relationship can still
      // pin exactly one parent run.
      if (endpointCandidates.length === 1 && !currentUuid) {
        const r = endpointCandidates[0]!;
        const rUuid = r.id ? String(r.id) : "";
        const seq = nextFreeSequence(rUuid);
        out.push({
          ...base,
          extracted_path: null,
          encoded_sequence: null,
          matching_raceways: [asRow(r)],
          target_raceway_uuid: rUuid,
          target_raceway: sid("raceway", r),
          proposed_sequence: seq,
          status: "proposed",
          reason: `${sid("raceway", r)} already records ${id} as one of its endpoints and is the only run naming this box, so position ${seq} is the next free junction point on it.`,
        });
        continue;
      }
      out.push({
        ...base,
        extracted_path: null,
        encoded_sequence: null,
        matching_raceways: endpointCandidates.map(asRow),
        target_raceway_uuid: null,
        target_raceway: null,
        proposed_sequence: null,
        status: "unparseable_id",
        reason: `${id} does not encode a canonical JB-###-## path/position, so no relationship can be proposed from its ID.`,
      });
      continue;
    }

    const path = encoded.path;
    const proposedSeq = Number(encoded.jbox);
    let candidates = racewaysByPath.get(path) ?? [];
    // Endpoint evidence narrows an ambiguous path; it never removes candidates
    // when it points nowhere, and never applies to boxes further along the run.
    if (candidates.length > 1 && endpointCandidates.length) {
      const narrowed = candidates.filter((c) =>
        endpointCandidates.some((e) => String(e.id) === String(c.id)),
      );
      if (narrowed.length === 1) candidates = narrowed;
    }
    const matching = candidates.map(asRow);

    if (candidates.length === 0) {
      out.push({
        ...base,
        extracted_path: path,
        encoded_sequence: proposedSeq,
        matching_raceways: matching,
        target_raceway_uuid: null,
        target_raceway: null,
        proposed_sequence: null,
        status: "no_matching_raceway",
        reason: `No visible raceway record encodes path ${path}, so ${id} has no candidate parent run.`,
      });
      continue;
    }
    if (candidates.length > 1) {
      out.push({
        ...base,
        extracted_path: path,
        encoded_sequence: proposedSeq,
        matching_raceways: matching,
        target_raceway_uuid: null,
        target_raceway: null,
        proposed_sequence: null,
        status: "ambiguous_raceway",
        reason: `Path ${path} matches ${candidates.length} raceways (${matching
          .map((m) => m.stable_id)
          .sort()
          .join(", ")}) — the parent must be chosen by hand.`,
      });
      continue;
    }

    const target = candidates[0]!;
    const targetUuid = target.id ? String(target.id) : "";
    const targetId = sid("raceway", target);
    const evidence = `${id} encodes path ${path} position ${proposedSeq}; ${targetId} is the only raceway on path ${path}.`;
    const shared = {
      ...base,
      extracted_path: path,
      encoded_sequence: proposedSeq,
      matching_raceways: matching,
      target_raceway_uuid: targetUuid,
      target_raceway: targetId,
      proposed_sequence: proposedSeq,
    };

    if (currentUuid === targetUuid && currentSeq === proposedSeq) {
      out.push({ ...shared, status: "already_linked", reason: evidence });
      continue;
    }
    if (currentUuid && currentUuid !== targetUuid) {
      out.push({
        ...shared,
        status: "parent_conflict",
        reason: `${id} is already linked to ${base.current_raceway ?? "another raceway"}; ${evidence} Resolve by hand — FarmOps will not overwrite an existing relationship.`,
      });
      continue;
    }
    const holder = taken.get(`${targetUuid}:${proposedSeq}`);
    if (holder && holder !== id) {
      out.push({
        ...shared,
        status: "sequence_conflict",
        reason: `Position ${proposedSeq} on ${targetId} is already held by ${holder}.`,
      });
      continue;
    }
    out.push({ ...shared, status: "proposed", reason: evidence });
  }

  return out.sort((a, b) => a.jbox_id.localeCompare(b.jbox_id));
}

/**
 * Continuous-raceway QA. Reports only — nothing here rewrites an ID, infers a
 * relationship or mutates a record.
 */
export function racewayPathFindings(graph: ElectricalGraphData): PathFinding[] {
  const out: PathFinding[] = [];
  const jboxes = graph.jbox ?? [];
  const raceways = graph.raceway ?? [];
  const racewayByUuid = new Map(raceways.filter((r) => r.id).map((r) => [String(r.id), r]));
  const racewaysByPath = new Map<string, Row[]>();
  for (const r of raceways) {
    const path = racewayPathNumber(sid("raceway", r));
    if (!path) continue;
    racewaysByPath.set(path, [...(racewaysByPath.get(path) ?? []), r]);
  }

  const seen = new Map<string, string[]>();
  for (const jb of jboxes) {
    const id = sid("jbox", jb);
    const uuid = jb.id ? String(jb.id) : null;
    const parentUuid = text(jb, "raceway_uuid");
    const sequence = num(jb, "raceway_sequence");
    const parent = parentUuid ? racewayByUuid.get(parentUuid) : undefined;
    const parentId = parent ? sid("raceway", parent) : "";
    const encoded = parseHierarchicalId(id);

    if (parentUuid && sequence == null) {
      out.push({
        code: "missing_raceway_sequence",
        severity: "warning",
        kind: "jbox",
        stableId: id,
        id: uuid,
        message: `Junction box ${id} is on ${parentId || "a raceway"} but has no position along it — the ordered topology is incomplete.`,
      });
    }
    if (!parentUuid && sequence != null) {
      out.push({
        code: "sequence_without_raceway",
        severity: "error",
        kind: "jbox",
        stableId: id,
        id: uuid,
        message: `Junction box ${id} has position ${sequence} but no parent raceway — a position only exists along a raceway.`,
      });
    }
    if (parentUuid && sequence != null) {
      const key = `${parentUuid}:${sequence}`;
      seen.set(key, [...(seen.get(key) ?? []), id]);
    }
    if (parent && encoded?.prefix === "JB") {
      const parentPath = racewayPathNumber(parentId);
      if (parentPath && parentPath !== encoded.path) {
        out.push({
          code: "encoded_path_disagreement",
          severity: "error",
          kind: "jbox",
          stableId: id,
          id: uuid,
          message: `Junction box ${id} encodes path ${encoded.path} but is linked to ${parentId} (path ${parentPath}). Identity and topology must agree; IDs are never renamed automatically.`,
        });
      }
      if (sequence != null && encoded.jbox && Number(encoded.jbox) !== sequence) {
        out.push({
          code: "encoded_sequence_disagreement",
          severity: "error",
          kind: "jbox",
          stableId: id,
          id: uuid,
          message: `Junction box ${id} encodes position ${Number(encoded.jbox)} but its recorded position on ${parentId} is ${sequence}.`,
        });
      }
    }
    // A box whose ID names a known path but which has no relational parent.
    if (!parentUuid && encoded?.prefix === "JB" && (racewaysByPath.get(encoded.path)?.length ?? 0) > 0) {
      out.push({
        code: "orphan_path_topology",
        severity: "warning",
        kind: "jbox",
        stableId: id,
        id: uuid,
        message: `Junction box ${id} names path ${encoded.path} in its ID but has no parent raceway link. Review and link it — FarmOps never infers topology from the ID alone.`,
      });
    }
  }

  for (const [key, ids] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ids.length < 2) continue;
    const [parentUuid, sequence] = key.split(":");
    const parent = racewayByUuid.get(parentUuid!);
    out.push({
      code: "duplicate_raceway_sequence",
      severity: "error",
      kind: "jbox",
      stableId: [...ids].sort().join(", "),
      id: null,
      message: `Position ${sequence} on ${parent ? sid("raceway", parent) : "one raceway"} is claimed by ${[...ids].sort().join(", ")}. Each junction point along a continuous raceway is a distinct position.`,
    });
  }

  // Branch runs must leave the junction box their ID encodes.
  const jboxByUuid = new Map(jboxes.filter((j) => j.id).map((j) => [String(j.id), j]));
  for (const br of graph.branch ?? []) {
    const id = sid("branch", br);
    const encoded = parseHierarchicalId(id);
    const linkedUuid = text(br, "source_jbox_uuid");
    if (!encoded || encoded.prefix !== "BR" || !encoded.jbox || !linkedUuid) continue;
    const linked = jboxByUuid.get(linkedUuid);
    if (!linked) continue;
    const expected = `JB-${encoded.path}-${encoded.jbox}`;
    const actual = sid("jbox", linked);
    if (actual && actual.toUpperCase() !== expected) {
      out.push({
        code: "branch_jbox_disagreement",
        severity: "error",
        kind: "branch",
        stableId: id,
        id: br.id ? String(br.id) : null,
        message: `Branch run ${id} encodes ${expected} as its origin but is linked to ${actual}.`,
      });
    }
  }

  const rank = (f: PathFinding) => (f.severity === "error" ? 0 : 1);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.code.localeCompare(b.code) ||
      a.stableId.localeCompare(b.stableId) ||
      a.message.localeCompare(b.message),
  );
}

// ------------------------------------------- preview-first population planning

export interface PathProposal {
  jbox_id: string;
  jbox_uuid: string | null;
  current_raceway: string | null;
  proposed_raceway: string | null;
  current_raceway_uuid: string | null;
  proposed_raceway_uuid: string | null;
  current_sequence: number | null;
  proposed_sequence: number | null;
  evidence: string;
  status: "proposed" | "already_linked" | "no_evidence" | "conflict";
}

/**
 * Propose (never write) the parent raceway / position for junction boxes that
 * do not have them yet. Evidence is canonical stable-ID agreement plus the
 * existing relational records; every proposal still requires explicit review.
 */
export function planJboxRacewayPopulation(graph: ElectricalGraphData): PathProposal[] {
  const jboxes = graph.jbox ?? [];
  const raceways = graph.raceway ?? [];
  const racewayByUuid = new Map(raceways.filter((r) => r.id).map((r) => [String(r.id), r]));
  const racewaysByPath = new Map<string, Row[]>();
  for (const r of raceways) {
    const path = racewayPathNumber(sid("raceway", r));
    if (!path) continue;
    racewaysByPath.set(path, [...(racewaysByPath.get(path) ?? []), r]);
  }
  // Raceways that name a junction box as their own source/destination endpoint.
  // An endpoint relationship is *evidence of membership*, never a substitute for
  // it: the box still needs its ordered-path link, so this map only ever adds
  // proposals — it must not suppress them for the box or for any box downstream.
  const endpointRaceways = new Map<string, Row[]>();
  for (const r of raceways) {
    for (const col of ["source_jbox_uuid", "dest_jbox_uuid"]) {
      const boxUuid = text(r, col);
      if (!boxUuid) continue;
      const list = endpointRaceways.get(boxUuid) ?? [];
      if (!list.some((x) => String(x.id) === String(r.id))) list.push(r);
      endpointRaceways.set(boxUuid, list);
    }
  }
  // Positions already taken, so a proposal never collides with a stored one.
  const taken = new Map<string, string>();
  for (const jb of jboxes) {
    const parentUuid = text(jb, "raceway_uuid");
    const sequence = num(jb, "raceway_sequence");
    if (parentUuid && sequence != null) taken.set(`${parentUuid}:${sequence}`, sid("jbox", jb));
  }
  /** Lowest free position on a raceway, used only when the ID encodes none. */
  const nextFreeSequence = (racewayUuid: string): number => {
    let n = 1;
    while (taken.has(`${racewayUuid}:${n}`)) n++;
    return n;
  };


  const out: PathProposal[] = [];
  for (const jb of jboxes) {
    const id = sid("jbox", jb);
    const uuid = jb.id ? String(jb.id) : null;
    const currentUuid = text(jb, "raceway_uuid") || null;
    const currentSeq = num(jb, "raceway_sequence");
    const current = currentUuid ? racewayByUuid.get(currentUuid) : undefined;
    const base = {
      jbox_id: id,
      jbox_uuid: uuid,
      current_raceway: current ? sid("raceway", current) : null,
      current_raceway_uuid: currentUuid,
      current_sequence: currentSeq,
    };
    const encoded = parseHierarchicalId(id);
    const endpointCandidates = uuid ? (endpointRaceways.get(uuid) ?? []) : [];
    if (!encoded || encoded.prefix !== "JB" || !encoded.jbox) {
      // The ID says nothing, but a raceway endpoint relationship can still pin
      // exactly one parent run.
      if (endpointCandidates.length === 1 && !currentUuid) {
        const r = endpointCandidates[0]!;
        const rUuid = r.id ? String(r.id) : "";
        const seq = nextFreeSequence(rUuid);
        out.push({
          ...base,
          proposed_raceway: sid("raceway", r),
          proposed_raceway_uuid: rUuid,
          proposed_sequence: seq,
          evidence: `${sid("raceway", r)} already records ${id} as one of its endpoints; that raceway is the only run naming this box, so position ${seq} is the next free junction point on it.`,
          status: "proposed",
        });
        continue;
      }
      out.push({
        ...base,
        proposed_raceway: null,
        proposed_raceway_uuid: null,
        proposed_sequence: null,
        evidence: `${id} does not encode a canonical path/position, so no relationship can be proposed from its ID.`,
        status: "no_evidence",
      });
      continue;
    }
    let candidates = racewaysByPath.get(encoded.path) ?? [];
    // Disambiguate several raceways on one path number using the endpoint
    // relationship, when it points at exactly one of those candidates.
    if (candidates.length > 1 && endpointCandidates.length) {
      const narrowed = candidates.filter((c) =>
        endpointCandidates.some((e) => String(e.id) === String(c.id)),
      );
      if (narrowed.length === 1) candidates = narrowed;
    }
    if (candidates.length !== 1) {
      out.push({
        ...base,
        proposed_raceway: null,
        proposed_raceway_uuid: null,
        proposed_sequence: null,
        evidence:
          candidates.length === 0
            ? `No raceway records path ${encoded.path}.`
            : `Path ${encoded.path} matches ${candidates.length} raceways (${candidates
                .map((r) => sid("raceway", r))
                .sort()
                .join(", ")}) — the parent must be chosen by hand.`,
        status: "no_evidence",
      });
      continue;
    }
    const target = candidates[0]!;
    const targetUuid = target.id ? String(target.id) : "";
    const targetId = sid("raceway", target);

    const proposedSeq = Number(encoded.jbox);
    const evidence = `${id} encodes path ${encoded.path} position ${proposedSeq}; ${targetId} is the only raceway on path ${encoded.path}.`;

    if (currentUuid === targetUuid && currentSeq === proposedSeq) {
      out.push({
        ...base,
        proposed_raceway: targetId,
        proposed_raceway_uuid: targetUuid,
        proposed_sequence: proposedSeq,
        evidence,
        status: "already_linked",
      });
      continue;
    }
    // Existing relational topology that disagrees is never overwritten here.
    if (currentUuid && currentUuid !== targetUuid) {
      out.push({
        ...base,
        proposed_raceway: targetId,
        proposed_raceway_uuid: targetUuid,
        proposed_sequence: proposedSeq,
        evidence: `${id} is already linked to ${base.current_raceway ?? "another raceway"}; ${evidence} Resolve by hand — FarmOps will not overwrite an existing relationship.`,
        status: "conflict",
      });
      continue;
    }
    const holder = taken.get(`${targetUuid}:${proposedSeq}`);
    if (holder && holder !== id) {
      out.push({
        ...base,
        proposed_raceway: targetId,
        proposed_raceway_uuid: targetUuid,
        proposed_sequence: proposedSeq,
        evidence: `Position ${proposedSeq} on ${targetId} is already held by ${holder}.`,
        status: "conflict",
      });
      continue;
    }
    out.push({
      ...base,
      proposed_raceway: targetId,
      proposed_raceway_uuid: targetUuid,
      proposed_sequence: proposedSeq,
      evidence,
      status: "proposed",
    });
  }

  return out.sort((a, b) => a.jbox_id.localeCompare(b.jbox_id));
}

export function pathProposalCsv(rows: PathProposal[]): string {
  const head = [
    "jbox_id",
    "current_parent",
    "proposed_parent",
    "current_sequence",
    "proposed_sequence",
    "status",
    "evidence",
  ];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.jbox_id,
        r.current_raceway ?? "",
        r.proposed_raceway ?? "",
        r.current_sequence ?? "",
        r.proposed_sequence ?? "",
        r.status,
        r.evidence,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}
