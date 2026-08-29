// Migration audit for electrical reference migration (text ref -> FK).
//
// Pure and deterministic: given the current graph it classifies every
// relationship slot on every record as an exact match, a null FK, or a
// conflict, with an explicit reason. Records are never modified here — the
// audit only reports, so ambiguity is surfaced instead of resolved silently.
import { ENTITIES } from "@/lib/electrical-entities";
import { relationsFor, type RelationSpec } from "@/lib/electrical-relations";
import type { ElectricalEntityKind } from "@/lib/electrical";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";

export type AuditDisposition = "exact_match" | "null_fk" | "conflict";

export const AUDIT_REASONS = [
  "fk_matches_reference",
  "fk_set_no_legacy_reference",
  "no_reference_present",
  "exact_match_available_not_linked",
  "reference_not_found",
  "ambiguous_reference",
  "fk_reference_disagreement",
  "fk_target_missing",
  "slot_collision",
  "self_reference",
] as const;
export type AuditReason = (typeof AUDIT_REASONS)[number];

export interface RefAuditRow {
  kind: ElectricalEntityKind;
  /** Human-readable stable ID of the record being audited. */
  stableId: string;
  id: string;
  /** FK column under audit. */
  fkColumn: string;
  targetKind: ElectricalEntityKind;
  slot: "source" | "dest" | "";
  /** Legacy free-text reference stored on the record. */
  reference: string;
  /** Stable ID of the row the FK actually points at. */
  fkTarget: string;
  disposition: AuditDisposition;
  reason: AuditReason;
  detail: string;
  /** How many existing records share the legacy reference's stable ID. */
  candidates: number;
}

export interface RefAuditReport {
  rows: RefAuditRow[];
  summary: {
    total: number;
    exact_match: number;
    null_fk: number;
    conflict: number;
    byReason: Record<string, number>;
  };
}

function stableIdOf(kind: ElectricalEntityKind, row: Row): string {
  const field = ENTITIES[kind].stableIdField;
  return String(row[field] ?? "").trim();
}

function text(row: Row, column: string): string {
  const v = row[column];
  return v == null ? "" : String(v).trim();
}

function targetIndex(kind: ElectricalEntityKind, rows: Row[]) {
  const byId = new Map<string, Row>();
  const byStableId = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.id) byId.set(String(row.id), row);
    const sid = stableIdOf(kind, row);
    if (sid) byStableId.set(sid, [...(byStableId.get(sid) ?? []), row]);
  }
  return { byId, byStableId };
}

const AUDIT_KINDS: ElectricalEntityKind[] = [
  "panel",
  "circuit_group",
  "load",
  "raceway",
  "jbox",
  "branch",
];

/** Classify every relationship slot in the graph. */
export function buildRefAudit(graph: ElectricalGraphData): RefAuditReport {
  const indexes = {} as Record<ElectricalEntityKind, ReturnType<typeof targetIndex>>;
  for (const kind of AUDIT_KINDS) indexes[kind] = targetIndex(kind, graph[kind] ?? []);

  const rows: RefAuditRow[] = [];

  for (const kind of AUDIT_KINDS) {
    const specs = relationsFor(kind);
    if (!specs.length) continue;

    for (const row of graph[kind] ?? []) {
      const selfStableId = stableIdOf(kind, row);
      const selfId = String(row.id ?? "");

      // A slot may only be filled by one FK; report the collision once.
      const collided = new Set<string>();
      for (const slot of ["source", "dest"] as const) {
        const filled = specs.filter((s) => s.slot === slot && text(row, s.fkColumn));
        if (filled.length > 1) for (const s of filled) collided.add(s.fkColumn);
      }

      for (const spec of specs) {
        const audited = auditSlot(kind, row, spec, indexes, {
          selfStableId,
          selfId,
          collided: collided.has(spec.fkColumn),
        });
        rows.push(audited);
      }
    }
  }

  rows.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.stableId.localeCompare(b.stableId) ||
      a.fkColumn.localeCompare(b.fkColumn),
  );

  const summary = {
    total: rows.length,
    exact_match: rows.filter((r) => r.disposition === "exact_match").length,
    null_fk: rows.filter((r) => r.disposition === "null_fk").length,
    conflict: rows.filter((r) => r.disposition === "conflict").length,
    byReason: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {}),
  };

  return { rows, summary };
}

function auditSlot(
  kind: ElectricalEntityKind,
  row: Row,
  spec: RelationSpec,
  indexes: Record<ElectricalEntityKind, ReturnType<typeof targetIndex>>,
  ctx: { selfStableId: string; selfId: string; collided: boolean },
): RefAuditRow {
  const index = indexes[spec.targetKind];
  const reference = text(row, spec.refColumn);
  const fk = text(row, spec.fkColumn);
  const candidates = index.byStableId.get(reference) ?? [];
  const fkRow = fk ? index.byId.get(fk) : undefined;
  const fkTarget = fkRow ? stableIdOf(spec.targetKind, fkRow) : "";

  const base = {
    kind,
    stableId: ctx.selfStableId,
    id: ctx.selfId,
    fkColumn: spec.fkColumn,
    targetKind: spec.targetKind,
    slot: (spec.slot ?? "") as "source" | "dest" | "",
    reference,
    fkTarget,
    candidates: candidates.length,
  };

  if (ctx.collided) {
    return {
      ...base,
      disposition: "conflict",
      reason: "slot_collision",
      detail: `More than one ${spec.slot} endpoint is set on this record; only one is valid.`,
    };
  }

  if (fk) {
    if (!fkRow) {
      return {
        ...base,
        disposition: "conflict",
        reason: "fk_target_missing",
        detail: "The linked record no longer exists; the link was left in place for review.",
      };
    }
    if (fk === ctx.selfId) {
      return {
        ...base,
        disposition: "conflict",
        reason: "self_reference",
        detail: "The record is linked to itself.",
      };
    }
    if (reference && fkTarget && reference !== fkTarget) {
      return {
        ...base,
        disposition: "conflict",
        reason: "fk_reference_disagreement",
        detail: `Link points at ${fkTarget} but the legacy reference reads ${reference}; neither was changed.`,
      };
    }
    if (!reference) {
      return {
        ...base,
        disposition: "exact_match",
        reason: "fk_set_no_legacy_reference",
        detail: `Linked to ${fkTarget || "an existing record"}; no legacy reference text was present.`,
      };
    }
    return {
      ...base,
      disposition: "exact_match",
      reason: "fk_matches_reference",
      detail: `Legacy reference ${reference} resolved to exactly one record and is linked.`,
    };
  }

  if (!reference) {
    return {
      ...base,
      disposition: "null_fk",
      reason: "no_reference_present",
      detail: "No legacy reference and no link — nothing to resolve.",
    };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      disposition: "conflict",
      reason: "ambiguous_reference",
      detail: `${candidates.length} records share the stable ID ${reference}; the link was left empty.`,
    };
  }
  if (candidates.length === 1) {
    const target = stableIdOf(spec.targetKind, candidates[0]);
    if (candidates[0].id && candidates[0].id === ctx.selfId) {
      return {
        ...base,
        disposition: "conflict",
        reason: "self_reference",
        detail: `Reference ${reference} points at this same record.`,
      };
    }
    return {
      ...base,
      disposition: "null_fk",
      reason: "exact_match_available_not_linked",
      detail: `Reference ${reference} matches exactly one ${target ? `record (${target})` : "record"} but is not linked yet.`,
    };
  }
  return {
    ...base,
    disposition: "null_fk",
    reason: "reference_not_found",
    detail: `No ${spec.targetKind.replace("_", " ")} exists with stable ID ${reference}; the link was left empty.`,
  };
}

// --------------------------------------------------------------- export files

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  "record_kind",
  "stable_id",
  "relationship",
  "target_kind",
  "slot",
  "legacy_reference",
  "linked_record",
  "match_candidates",
  "handling",
  "reason",
  "detail",
];

/** Deterministic CSV of the audit — identical data produces identical output. */
export function refAuditToCsv(report: RefAuditReport): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        r.kind,
        r.stableId,
        r.fkColumn,
        r.targetKind,
        r.slot,
        r.reference,
        r.fkTarget,
        r.candidates,
        r.disposition,
        r.reason,
        r.detail,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Human-readable audit for the documentation record. */
export function refAuditToMarkdown(report: RefAuditReport, generatedAt: string): string {
  const { summary } = report;
  const out: string[] = [
    "# Electrical reference migration audit",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Reports how every text reference on the electrical records was handled when",
    "relationships moved to database links. No records were deleted, renamed, or",
    "reconstructed; ambiguous references were left unlinked and are listed below.",
    "",
    "## Summary",
    "",
    `- Relationship slots audited: ${summary.total}`,
    `- Exact match (linked): ${summary.exact_match}`,
    `- Null FK (left unlinked): ${summary.null_fk}`,
    `- Conflict (needs a decision): ${summary.conflict}`,
    "",
    "### By reason",
    "",
  ];
  for (const reason of Object.keys(summary.byReason).sort()) {
    out.push(`- ${reason}: ${summary.byReason[reason]}`);
  }

  const sections: { title: string; filter: (r: RefAuditRow) => boolean }[] = [
    { title: "Conflicts", filter: (r) => r.disposition === "conflict" },
    {
      title: "Null FK — unresolved or ambiguous references",
      filter: (r) => r.disposition === "null_fk" && r.reason !== "no_reference_present",
    },
    { title: "Exact matches", filter: (r) => r.disposition === "exact_match" },
  ];

  for (const section of sections) {
    const rows = report.rows.filter(section.filter);
    out.push("", `## ${section.title} (${rows.length})`, "");
    if (!rows.length) {
      out.push("None.");
      continue;
    }
    out.push(
      "| Record | Relationship | Reference | Linked | Handling | Reason | Detail |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const r of rows) {
      out.push(
        `| ${r.kind} ${r.stableId} | ${r.fkColumn} | ${r.reference || "—"} | ${
          r.fkTarget || "—"
        } | ${r.disposition} | ${r.reason} | ${r.detail} |`,
      );
    }
  }

  const skipped = report.rows.filter((r) => r.reason === "no_reference_present").length;
  out.push(
    "",
    `Slots with no reference and no link (nothing to migrate): ${skipped}.`,
    "",
    "The canonical workbook remains the engineering release authority; this audit",
    "does not change any engineering value.",
    "",
  );
  return out.join("\n");
}
