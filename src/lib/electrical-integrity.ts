// Pure topology QA engine for the electrical records.
//
// Everything here is a *report*: it never mutates data. The database triggers
// (public.electrical_validate_*) are the hard boundary for new writes; this pass
// surfaces problems that already exist in the records — including ones imported
// before the constraints landed — so they can be resolved before any future
// ODS export.
//
// Pure and deterministic so it can be unit-tested without a database.
import {
  ENDPOINT_ENTITY_KIND,
  checkControlledValue,
  checkStableId,
  encodedParentMismatch,
  encodedPathNumber,
  findBreakerConflicts,
  type ElectricalEntityKind,
  type EndpointType,
} from "@/lib/electrical";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";

export type IntegritySeverity = "error" | "warning";

export interface IntegrityFinding {
  /** Stable machine code so the report can be grouped and tested. */
  code: string;
  severity: IntegritySeverity;
  kind: ElectricalEntityKind | "waypoint";
  /** Human-readable stable ID of the offending record — never a UUID. */
  stableId: string;
  /** Row UUID, for deep links. */
  id: string | null;
  message: string;
}

export const INTEGRITY_CODES = [
  "duplicate_stable_id",
  "malformed_stable_id",
  "invalid_controlled_value",
  "missing_endpoint",
  "unknown_endpoint",
  "endpoint_type_mismatch",
  "fk_ref_disagreement",
  "self_reference",
  "unknown_panel",
  "unknown_circuit_group",
  "unknown_load",
  "breaker_conflict",
  "orphan_endpoint",
  "incomplete_topology",
  "orphan_waypoint",
  "encoded_parent_mismatch",
  ...RACEWAY_PATH_CODES,
] as const;
export type IntegrityCode = (typeof INTEGRITY_CODES)[number];

const KINDS: ElectricalEntityKind[] = [
  "panel",
  "circuit_group",
  "load",
  "raceway",
  "jbox",
  "branch",
];

function text(row: Row, key: string): string {
  return String(row[key] ?? "").trim();
}

function sid(kind: ElectricalEntityKind, row: Row): string {
  return text(row, ENTITIES[kind].stableIdField);
}

function rowId(row: Row): string | null {
  return row.id ? String(row.id) : null;
}

interface Catalog {
  /** stable ID -> row, per kind. */
  byStableId: Record<ElectricalEntityKind, Map<string, Row>>;
  /** row UUID -> row, per kind. */
  byUuid: Record<ElectricalEntityKind, Map<string, Row>>;
}

function buildCatalog(graph: ElectricalGraphData): Catalog {
  const byStableId = {} as Catalog["byStableId"];
  const byUuid = {} as Catalog["byUuid"];
  for (const kind of KINDS) {
    const rows = graph[kind] ?? [];
    byStableId[kind] = new Map(rows.map((r) => [sid(kind, r), r]));
    byUuid[kind] = new Map(rows.filter((r) => r.id).map((r) => [String(r.id), r]));
  }
  return { byStableId, byUuid };
}

/** Which kind, if any, owns this stable ID. */
function resolveByStableId(
  catalog: Catalog,
  ref: string,
): { kind: ElectricalEntityKind; row: Row } | null {
  for (const kind of KINDS) {
    const row = catalog.byStableId[kind].get(ref);
    if (row) return { kind, row };
  }
  return null;
}

/**
 * Validate one endpoint (source or destination) of a raceway or branch run:
 * the declared type, the readable reference and the FK must all agree, and the
 * referenced entity must exist.
 */
function checkEndpoint(
  out: IntegrityFinding[],
  catalog: Catalog,
  kind: "raceway" | "branch",
  row: Row,
  side: "source" | "dest",
  opts: {
    required: boolean;
    fkColumns: { column: string; kind: ElectricalEntityKind }[];
    designText?: string;
  },

) {
  const id = sid(kind, row);
  const label = kind === "raceway" ? "Raceway" : "Branch run";
  const ref = text(row, `${side}_endpoint_ref`);
  const declared = text(row, `${side}_endpoint_type`) as EndpointType | "";
  const push = (code: IntegrityCode, severity: IntegritySeverity, message: string) =>
    out.push({ code, severity, kind, stableId: id, id: rowId(row), message });

  // FK is authoritative when present.
  let fkRow: { column: string; kind: ElectricalEntityKind; row: Row } | null = null;
  const linked = opts.fkColumns.filter((c) => text(row, c.column));
  if (linked.length > 1) {
    push(
      "endpoint_type_mismatch",
      "error",
      `${label} ${id} links its ${side} endpoint to more than one entity (${linked
        .map((c) => c.column)
        .join(", ")}).`,
    );
  }
  for (const c of linked) {
    const target = catalog.byUuid[c.kind].get(text(row, c.column));
    if (!target) {
      push(
        "unknown_endpoint",
        "error",
        `${label} ${id} ${side} endpoint links to a ${ENTITIES[c.kind].singular} that no longer exists.`,
      );
      continue;
    }
    fkRow = { ...c, row: target };
    const targetSid = sid(c.kind, target);
    if (ref && ref !== targetSid) {
      push(
        "fk_ref_disagreement",
        "error",
        `${label} ${id} ${side} endpoint is linked to ${targetSid} but its text reference still says ${ref}.`,
      );
    }
    const expected = c.kind === "panel" ? "panel" : c.kind === "jbox" ? "junction_box" : "load";
    if (declared && declared !== expected && !(expected === "load" && declared === "equipment")) {
      push(
        "endpoint_type_mismatch",
        "error",
        `${label} ${id} declares ${side} endpoint type "${declared}" but is linked to ${ENTITIES[c.kind].singular} ${targetSid}.`,
      );
    }
  }

  if (!ref && !fkRow) {
    if (opts.required) {
      // A missing as-built endpoint is INCOMPLETE, not invalid: the ODS design
      // text is the engineering intent and the physical topology simply has not
      // been established yet. Errors are reserved for provably wrong states.
      const design = opts.designText?.trim();
      push(
        "incomplete_topology",
        "warning",
        design
          ? `${label} ${id} ${side} endpoint is not linked yet — design value "${design}" still needs a record selected.`
          : `${label} ${id} has no ${side} endpoint linked yet.`,
      );
    }
    return;
  }


  // Legacy text-only reference: resolve it and check the declared type.
  if (!fkRow && ref) {
    const hit = resolveByStableId(catalog, ref);
    const expectedKind = declared ? ENDPOINT_ENTITY_KIND[declared] ?? null : null;
    if (!hit) {
      // Only an error when the declared type is something FarmOps models.
      if (!declared || expectedKind) {
        push(
          "unknown_endpoint",
          "error",
          `${label} ${id} ${side} endpoint ${ref} does not match any electrical record.`,
        );
      }
    } else if (expectedKind && expectedKind !== hit.kind) {
      push(
        "endpoint_type_mismatch",
        "error",
        `${label} ${id} declares ${side} endpoint type "${declared}" but ${ref} is a ${ENTITIES[hit.kind].singular}.`,
      );
    } else {
      push(
        "orphan_endpoint",
        "warning",
        `${label} ${id} ${side} endpoint ${ref} is text-only — link it to ${ENTITIES[hit.kind].singular} ${ref} so the relationship is authoritative.`,
      );
    }
  }
}

export function runIntegrityChecks(graph: ElectricalGraphData): IntegrityFinding[] {
  const catalog = buildCatalog(graph);
  const out: IntegrityFinding[] = [];

  // ------------------------------------------------ IDs and controlled values
  for (const kind of KINDS) {
    const seen = new Map<string, number>();
    for (const row of graph[kind] ?? []) {
      const id = sid(kind, row);
      seen.set(id, (seen.get(id) ?? 0) + 1);

      const check = checkStableId(kind, id);
      if (!check.ok) {
        out.push({
          code: "malformed_stable_id",
          severity: "error",
          kind,
          stableId: id,
          id: rowId(row),
          message: check.error ?? `${id} is not a valid ${ENTITIES[kind].stableIdLabel}.`,
        });
      }

      for (const field of ENTITIES[kind].fields) {
        const problem = checkControlledValue(field.key, row[field.key]);
        if (problem) {
          out.push({
            code: "invalid_controlled_value",
            severity: "error",
            kind,
            stableId: id,
            id: rowId(row),
            message: `${ENTITIES[kind].singular} ${id}: ${problem}`,
          });
        }
      }
    }
    for (const [id, count] of seen) {
      if (count > 1) {
        out.push({
          code: "duplicate_stable_id",
          severity: "error",
          kind,
          stableId: id,
          id: null,
          message: `${count} ${ENTITIES[kind].title.toLowerCase()} share the stable ID ${id}.`,
        });
      }
    }
  }

  // ------------------------------------------------------------- raceway ends
  for (const row of graph.raceway ?? []) {
    checkEndpoint(out, catalog, "raceway", row, "source", {
      required: true,
      designText: text(row, "from_label"),
      fkColumns: [
        { column: "source_panel_uuid", kind: "panel" },
        { column: "source_jbox_uuid", kind: "jbox" },
      ],
    });
    checkEndpoint(out, catalog, "raceway", row, "dest", {
      required: true,
      designText: text(row, "to_label"),
      fkColumns: [
        { column: "dest_panel_uuid", kind: "panel" },
        { column: "dest_jbox_uuid", kind: "jbox" },
      ],
    });

    const id = sid("raceway", row);
    const from = text(row, "source_endpoint_ref");
    const to = text(row, "dest_endpoint_ref");
    if (from && from === to) {
      out.push({
        code: "self_reference",
        severity: "error",
        kind: "raceway",
        stableId: id,
        id: rowId(row),
        message: `Raceway ${id} starts and ends at ${from}. A direction change along one run is a waypoint, not a second endpoint.`,
      });
    }
  }

  // -------------------------------------------------------------- branch ends
  for (const row of graph.branch ?? []) {
    checkEndpoint(out, catalog, "branch", row, "source", {
      required: true,
      fkColumns: [
        { column: "source_panel_uuid", kind: "panel" },
        { column: "source_jbox_uuid", kind: "jbox" },
      ],
    });
    checkEndpoint(out, catalog, "branch", row, "dest", {
      required: true,
      fkColumns: [{ column: "load_uuid", kind: "load" }],
    });
    const id = sid("branch", row);
    const groupUuid = text(row, "circuit_group_uuid");
    if (groupUuid && !catalog.byUuid.circuit_group.has(groupUuid)) {
      out.push({
        code: "unknown_circuit_group",
        severity: "error",
        kind: "branch",
        stableId: id,
        id: rowId(row),
        message: `Branch run ${id} is linked to a circuit group that no longer exists.`,
      });
    }
    if (!groupUuid && !text(row, "circuit_group_ref")) {
      out.push({
        code: "incomplete_topology",
        severity: "warning",
        kind: "branch",
        stableId: id,
        id: rowId(row),
        message: `Branch run ${id} is not assigned to a circuit group.`,
      });
    }

    // Encoded origin (BR-104-02-03 → JB-104-02) must agree with the linked box.
    const jboxUuid = text(row, "source_jbox_uuid");
    const linkedJbox = jboxUuid ? catalog.byUuid.jbox.get(jboxUuid) : null;
    if (linkedJbox) {
      const mismatch = encodedParentMismatch(id, sid("jbox", linkedJbox));
      if (mismatch) {
        out.push({
          code: "encoded_parent_mismatch",
          severity: "error",
          kind: "branch",
          stableId: id,
          id: rowId(row),
          message: `Branch run ${id} encodes origin ${mismatch.encoded} but is linked to ${mismatch.linked}. A branch must inherit the ID of the junction box it physically originates from.`,
        });
      }
    }
  }

  // ---------------------------------------- junction box encoded raceway path
  for (const row of graph.jbox ?? []) {
    const id = sid("jbox", row);
    const path = encodedPathNumber(id);
    if (!path) continue;
    const linkedRaceways = (graph.raceway ?? []).filter(
      (r) =>
        text(r, "source_jbox_uuid") === rowId(row) || text(r, "dest_jbox_uuid") === rowId(row),
    );
    if (!linkedRaceways.length) continue;
    const paths = linkedRaceways.map((r) => encodedPathNumber(sid("raceway", r))).filter(Boolean);
    if (paths.length && !paths.includes(path)) {
      out.push({
        code: "encoded_parent_mismatch",
        severity: "error",
        kind: "jbox",
        stableId: id,
        id: rowId(row),
        message: `Junction box ${id} encodes raceway path ${path} but is only linked to raceway ${linkedRaceways
          .map((r) => sid("raceway", r))
          .join(", ")}.`,
      });
    }
  }


  // ----------------------------------------------------- loads / circuit groups
  for (const row of graph.load ?? []) {
    const id = sid("load", row);
    const uuid = text(row, "circuit_group_uuid");
    const ref = text(row, "circuit_group_ref");
    if (uuid) {
      const target = catalog.byUuid.circuit_group.get(uuid);
      if (!target) {
        out.push({
          code: "unknown_circuit_group",
          severity: "error",
          kind: "load",
          stableId: id,
          id: rowId(row),
          message: `Load ${id} is linked to a circuit group that no longer exists.`,
        });
      } else if (ref && ref !== sid("circuit_group", target)) {
        out.push({
          code: "fk_ref_disagreement",
          severity: "error",
          kind: "load",
          stableId: id,
          id: rowId(row),
          message: `Load ${id} is linked to ${sid("circuit_group", target)} but its text reference says ${ref}.`,
        });
      }
    } else if (ref && !catalog.byStableId.circuit_group.has(ref)) {
      out.push({
        code: "unknown_circuit_group",
        severity: "warning",
        kind: "load",
        stableId: id,
        id: rowId(row),
        message: `Load ${id} references unknown circuit group ${ref}.`,
      });
    }
  }

  for (const row of graph.circuit_group ?? []) {
    const id = sid("circuit_group", row);
    const uuid = text(row, "panel_uuid");
    const ref = text(row, "suggested_panel");
    if (uuid) {
      const target = catalog.byUuid.panel.get(uuid);
      if (!target) {
        out.push({
          code: "unknown_panel",
          severity: "error",
          kind: "circuit_group",
          stableId: id,
          id: rowId(row),
          message: `Circuit group ${id} is linked to a panel that no longer exists.`,
        });
      } else if (ref && ref !== sid("panel", target)) {
        out.push({
          code: "fk_ref_disagreement",
          severity: "error",
          kind: "circuit_group",
          stableId: id,
          id: rowId(row),
          message: `Circuit group ${id} is linked to ${sid("panel", target)} but its text reference says ${ref}.`,
        });
      }
    } else if (ref && !catalog.byStableId.panel.has(ref)) {
      out.push({
        code: "unknown_panel",
        severity: "error",
        kind: "circuit_group",
        stableId: id,
        id: rowId(row),
        message: `Circuit group ${id} references unknown panel ${ref}.`,
      });
    } else if (!uuid && ref) {
      out.push({
        code: "orphan_endpoint",
        severity: "warning",
        kind: "circuit_group",
        stableId: id,
        id: rowId(row),
        message: `Circuit group ${id} names panel ${ref} as text only — select the panel record so the relationship is authoritative.`,
      });
    }
  }

  // --------------------------------------------------------- breaker conflicts
  for (const conflict of findBreakerConflicts(
    (graph.circuit_group ?? []).map((g) => ({
      circuit_group_id: sid("circuit_group", g),
      panel_uuid: text(g, "panel_uuid") || null,
      breaker_number: (g["breaker_number"] as number | null) ?? null,
    })),
  )) {
    const panel = catalog.byUuid.panel.get(conflict.panel_uuid);
    out.push({
      code: "breaker_conflict",
      severity: "error",
      kind: "circuit_group",
      stableId: conflict.ids.join(", "),
      id: null,
      message: `Breaker ${conflict.breaker_number} in ${panel ? sid("panel", panel) : "an unknown panel"} is claimed by ${conflict.ids.join(", ")}.`,
    });
  }

  // ------------------------------------------------------ junction box wiring
  const jboxUuidsInUse = new Set<string>();
  for (const r of [...(graph.raceway ?? []), ...(graph.branch ?? [])]) {
    for (const col of ["source_jbox_uuid", "dest_jbox_uuid"]) {
      const v = text(r, col);
      if (v) jboxUuidsInUse.add(v);
    }
  }
  const jboxRefsInUse = new Set<string>();
  for (const r of [...(graph.raceway ?? []), ...(graph.branch ?? [])]) {
    for (const col of ["source_endpoint_ref", "dest_endpoint_ref"]) {
      const v = text(r, col);
      if (v) jboxRefsInUse.add(v);
    }
  }
  for (const row of graph.jbox ?? []) {
    const id = sid("jbox", row);
    const uuid = rowId(row);
    if ((!uuid || !jboxUuidsInUse.has(uuid)) && !jboxRefsInUse.has(id)) {
      out.push({
        code: "incomplete_topology",
        severity: "warning",
        kind: "jbox",
        stableId: id,
        id: uuid,
        message: `Junction box ${id} has no raceway or branch run connected. A box only exists for a real accessible junction — a route change belongs on a raceway as a waypoint.`,
      });
    }
  }

  // ------------------------------------------------------------- waypoints
  const racewayUuids = new Set((graph.raceway ?? []).map((r) => String(r.id ?? "")));
  for (const w of graph.waypoint ?? []) {
    const parent = text(w, "raceway_id");
    if (parent && !racewayUuids.has(parent)) {
      out.push({
        code: "orphan_waypoint",
        severity: "warning",
        kind: "waypoint",
        stableId: text(w, "label") || `sequence ${text(w, "sequence")}`,
        id: rowId(w),
        message: `A path waypoint points at a raceway that no longer exists.`,
      });
    }
  }

  // Phase 4.4b — continuous raceway / ordered junction-box topology.
  out.push(...racewayPathFindings(graph));

  // Deterministic ordering: errors first, then code, kind, stable ID, message.

  const rank = (f: IntegrityFinding) => (f.severity === "error" ? 0 : 1);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.code.localeCompare(b.code) ||
      a.kind.localeCompare(b.kind) ||
      a.stableId.localeCompare(b.stableId) ||
      a.message.localeCompare(b.message),
  );
}

/**
 * Three QA categories: Errors (provably wrong) | Warnings/Incomplete (topology
 * not established yet) | Valid (records with nothing outstanding). `records` is
 * the total number of electrical records scanned, so Valid can be reported.
 */
export function integritySummary(findings: IntegrityFinding[], records?: number) {
  const byCode: Record<string, number> = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  const flagged = new Set(findings.map((f) => `${f.kind}:${f.id ?? f.stableId}`));
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  return {
    errors,
    warnings,
    incomplete: warnings,
    records: records ?? 0,
    valid: records == null ? 0 : Math.max(0, records - flagged.size),
    byCode,
    exportReady: errors === 0,
  };
}

