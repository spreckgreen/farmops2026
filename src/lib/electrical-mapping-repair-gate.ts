/**
 * Phase 4.4 — Load_Master deterministic mapping repair gate (pure module).
 *
 * Scope: repair ONLY those FarmOps load columns whose Load_Master mapping audit
 * classification and row-level evidence prove a deterministic canonical →
 * FarmOps mapping, i.e.
 *
 *   SHIFTED_COLUMN_MAPPING   — the destination is provably fed by a different
 *                              physical column of the same worksheet, and
 *   WRONG_DESTINATION_FIELD  — the importer binds a canonical column to a
 *                              column that is not that field's home.
 *
 * Never repaired here:
 *  - UNMAPPED_CANONICAL_FIELD with no FarmOps destination at all. Those are
 *    schema gaps (generator_start_class, generator_start_amps) and are reported
 *    separately as SCHEMA_EXTENSION_REQUIRED. They are NEVER forced into a
 *    neighbouring column.
 *  - DUPLICATE_HEADER_AMBIGUITY / REQUIRES_REVIEW: identity is not deterministic.
 *  - Anything whose meaning would have to be inferred from FarmOps contents.
 *    Physical ODS column + exact header + established semantic mapping is the
 *    only authority for what a value means.
 *
 * The canonical ODS itself is never modified, and engineering values are never
 * changed merely because they look questionable — only because the audit proved
 * the stored value came from the wrong column.
 */
import type {
  AuditPhysicalColumn,
  LoadMappingAudit,
  MappingConfidence,
  MappingStatus,
} from "@/lib/electrical-load-mapping-audit";
import { comparable } from "@/lib/electrical-load-mapping-audit";
import {
  logicalCircuits,
  physicalLoad,
  type GeneratorTier,
  type LoadRow,
} from "@/lib/electrical-load-business-rules";

export const MAPPING_REPAIR_GATE_VERSION = "4.4-load-master-mapping-repair-gate-1";

export const REPAIR_TABLE = "electrical_loads";

/** Audit classifications that may ever authorize a write. */
export const ELIGIBLE_DEFECTS: MappingStatus[] = [
  "SHIFTED_COLUMN_MAPPING",
  "WRONG_DESTINATION_FIELD",
];

/** Confidence floor: a MEDIUM/LOW/NONE column never authorizes a write. */
export const REQUIRED_CONFIDENCE: MappingConfidence[] = ["HIGH"];

export type RepairStatus =
  | "would_change"
  | "already_correct"
  | "drifted"
  | "newer_evidence"
  | "schema_missing"
  | "not_approved"
  | "baseline_blocked"
  | "failed"
  | "applied";

/** Fields the gate must always show an explicit resulting mapping for. */
export const CRITICAL_VERIFIED_FIELDS = [
  "critical",
  "dedicated_shared",
  "circuit_group_id",
  "suggested_panel",
  "backup_priority",
  "backup_eligible",
  "backup_panel",
  "load_shed_group",
  "continuous_load",
  "demand_va",
  "phase",
] as const;

export interface RepairProposal {
  table: string;
  stable_id: string;
  row_uuid: string | null;
  /** 1-based physical worksheet column the canonical value comes from. */
  ods_physical_column: number;
  ods_header: string;
  semantic_field: string;
  /** The only FarmOps column this proposal may write. */
  destination: string;
  /** Raw canonical cell text, verbatim. */
  canonical_raw: string;
  /** Typed value that will be written to the destination column. */
  proposed_value: string | number | boolean | null;
  current_farmops_value: string;
  defect: MappingStatus;
  confidence: MappingConfidence;
  baseline_sha256: string;
  status: RepairStatus;
  applied_at: string | null;
  detail?: string;
}

export interface SchemaGap {
  semantic_field: string;
  ods_physical_column: number | null;
  ods_header: string;
  populated_cells: number;
  status: "SCHEMA_EXTENSION_REQUIRED";
  finding: string;
}

export interface RepairFieldSummary {
  semantic_field: string;
  destination: string | null;
  ods_physical_column: number | null;
  ods_header: string;
  audit_status: MappingStatus;
  eligible: boolean;
  proposals: number;
  finding: string;
}

/* -------------------------------------------------------------- value typing */

const BOOLEAN_COLUMNS = new Set([
  "critical",
  "future",
  "continuous_load",
  "backup_eligible",
  "dedicated",
]);
const NUMERIC_COLUMNS = new Set([
  "count",
  "volts",
  "amps",
  "connected_va",
  "demand_va",
  "completion_percent",
  "installed_ocp_rating",
  "design_circuit_ampacity",
]);

const TRUE = new Set(["y", "yes", "true", "t", "1", "x"]);
const FALSE = new Set(["n", "no", "false", "f", "0"]);

/**
 * Type the canonical cell for its destination column. Blank stays NULL; an
 * unparseable value returns `undefined`, which the gate treats as
 * non-deterministic and refuses to write.
 */
export function typedForColumn(
  destination: string,
  raw: string,
): string | number | boolean | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if (BOOLEAN_COLUMNS.has(destination)) {
    const low = s.toLowerCase();
    if (TRUE.has(low)) return true;
    if (FALSE.has(low)) return false;
    return undefined;
  }
  if (NUMERIC_COLUMNS.has(destination)) {
    const n = Number(s.replace(/[,$%\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return s;
}

/** Comparable form of the value currently stored, for drift detection. */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return comparable(a) === comparable(b);
}

export function repairKey(r: { stable_id: string; destination: string }): string {
  return `${REPAIR_TABLE}|${r.stable_id}|${r.destination}`;
}

/* ------------------------------------------------------------ eligibility */

export function columnIsEligible(col: AuditPhysicalColumn): boolean {
  return (
    ELIGIBLE_DEFECTS.includes(col.status) &&
    REQUIRED_CONFIDENCE.includes(col.confidence) &&
    Boolean(col.expected_destination) &&
    Boolean(col.semantic_field)
  );
}

/** Columns of the audit that may authorize writes, with their destination. */
export function eligibleColumns(audit: LoadMappingAudit): AuditPhysicalColumn[] {
  return audit.columns.filter(columnIsEligible);
}

/** Canonical fields FarmOps has no home for: schema gaps, never repaired. */
export function schemaGaps(audit: LoadMappingAudit): SchemaGap[] {
  return audit.columns
    .filter(
      (c) =>
        c.status === "UNMAPPED_CANONICAL_FIELD" &&
        c.semantic_field !== null &&
        c.expected_destination === null,
    )
    .map((c) => ({
      semantic_field: c.semantic_field as string,
      ods_physical_column: c.physical_column,
      ods_header: c.ods_header,
      populated_cells: c.populated_cells,
      status: "SCHEMA_EXTENSION_REQUIRED" as const,
      finding: `${c.semantic_field} exists in Load_Master (physical column ${c.physical_column}, "${c.ods_header}") with ${c.populated_cells} populated row(s) but electrical_loads has no destination column. A schema extension is required; the value is not written into any other field.`,
    }));
}

/** Per-field resulting mapping for the acceptance-listed critical fields. */
export function criticalFieldSummaries(
  audit: LoadMappingAudit,
  proposals: RepairProposal[],
): RepairFieldSummary[] {
  return CRITICAL_VERIFIED_FIELDS.map((semantic) => {
    const col = audit.columns.find((c) => c.semantic_field === semantic);
    const count = proposals.filter((p) => p.semantic_field === semantic).length;
    if (!col) {
      return {
        semantic_field: semantic,
        destination: null,
        ods_physical_column: null,
        ods_header: "",
        audit_status: "REQUIRES_REVIEW" as MappingStatus,
        eligible: false,
        proposals: 0,
        finding:
          "No physical column on this worksheet carries this canonical header; nothing is repairable for it.",
      };
    }
    return {
      semantic_field: semantic,
      destination: col.expected_destination,
      ods_physical_column: col.physical_column,
      ods_header: col.ods_header,
      audit_status: col.status,
      eligible: columnIsEligible(col),
      proposals: count,
      finding: col.finding,
    };
  });
}

/* ------------------------------------------------------- business-rule view */

export interface RuleEffect {
  criticalPhysicalRows: number;
  criticalLogicalCircuits: number;
  circuitsByTier: Record<GeneratorTier, number>;
  plannedCircuitsByPanel: { panel: string; circuits: number }[];
  unresolvedSharedCircuits: number;
  totalLogicalCircuits: number;
}

const EMPTY_TIERS = (): Record<GeneratorTier, number> => ({
  REQUIRED: 0,
  "OPTIONAL-1": 0,
  "OPTIONAL-2": 0,
  EXCLUDE: 0,
  REVIEW: 0,
});

export function ruleEffect(rows: LoadRow[]): RuleEffect {
  const physical = rows.map(physicalLoad);
  const circuits = logicalCircuits(rows);
  const circuitsByTier = EMPTY_TIERS();
  const byPanel = new Map<string, number>();
  let criticalLogical = 0;

  for (const c of circuits) {
    if (!c.countsAsCircuit) continue;
    circuitsByTier[c.tier] += 1;
    if (c.includesCritical) criticalLogical += 1;
    const panel = c.loads[0]?.suggestedPanel ?? "NOT IN RECORD";
    byPanel.set(panel, (byPanel.get(panel) ?? 0) + 1);
  }

  return {
    criticalPhysicalRows: physical.filter((l) => l.criticality === "CRITICAL").length,
    criticalLogicalCircuits: criticalLogical,
    circuitsByTier,
    plannedCircuitsByPanel: [...byPanel.entries()]
      .map(([panel, circuits]) => ({ panel, circuits }))
      .sort((a, b) => b.circuits - a.circuits || a.panel.localeCompare(b.panel)),
    unresolvedSharedCircuits: circuits.filter((c) => c.kind === "UNRESOLVED").length,
    totalLogicalCircuits: circuits.filter((c) => c.countsAsCircuit).length,
  };
}

/** Apply the proposals to an in-memory copy of the rows. Nothing is written. */
export function projectRows(rows: LoadRow[], proposals: RepairProposal[]): LoadRow[] {
  const byId = new Map<string, RepairProposal[]>();
  for (const p of proposals) {
    const list = byId.get(p.stable_id) ?? [];
    list.push(p);
    byId.set(p.stable_id, list);
  }
  return rows.map((row) => {
    const list = byId.get(String(row["load_id"] ?? "").trim());
    if (!list?.length) return row;
    const next: LoadRow = { ...row };
    for (const p of list) next[p.destination] = p.proposed_value;
    return next;
  });
}

export interface RuleReconciliation {
  before: RuleEffect;
  after: RuleEffect;
  canonical: RuleEffect;
  /** True when the post-repair view equals the canonical ODS-derived view. */
  reconciles: boolean;
  differences: string[];
}

function tierLine(e: RuleEffect): string {
  const t = e.circuitsByTier;
  return `REQUIRED=${t.REQUIRED} OPTIONAL-1=${t["OPTIONAL-1"]} OPTIONAL-2=${t["OPTIONAL-2"]} EXCLUDE=${t.EXCLUDE} REVIEW=${t.REVIEW}`;
}

export function reconcileRuleEffects(
  before: RuleEffect,
  after: RuleEffect,
  canonical: RuleEffect,
): RuleReconciliation {
  const differences: string[] = [];
  const cmp = (label: string, a: number, b: number) => {
    if (a !== b) differences.push(`${label}: post-repair ${a}, canonical ODS ${b}`);
  };
  cmp("critical physical rows", after.criticalPhysicalRows, canonical.criticalPhysicalRows);
  cmp("critical logical circuits", after.criticalLogicalCircuits, canonical.criticalLogicalCircuits);
  cmp("logical circuits", after.totalLogicalCircuits, canonical.totalLogicalCircuits);
  cmp(
    "unresolved shared circuits",
    after.unresolvedSharedCircuits,
    canonical.unresolvedSharedCircuits,
  );
  if (tierLine(after) !== tierLine(canonical)) {
    differences.push(`generator tiers: post-repair ${tierLine(after)}, canonical ${tierLine(canonical)}`);
  }
  const panels = (e: RuleEffect) =>
    e.plannedCircuitsByPanel.map((p) => `${p.panel}=${p.circuits}`).join(", ");
  if (panels(after) !== panels(canonical)) {
    differences.push(
      `planned circuits by Suggested Panel: post-repair [${panels(after)}], canonical [${panels(canonical)}]`,
    );
  }
  return { before, after, canonical, reconciles: differences.length === 0, differences };
}

/* --------------------------------------------------------------- write guard */

export interface WriteGuardInput {
  stable_id: string;
  destination: string;
  /** Freshest FarmOps value read back immediately before the write. */
  live_value: unknown;
  /** Value the preview recorded as the pre-repair FarmOps value. */
  previewed_current: unknown;
  /** Canonical cell re-read from the freshly re-hashed workbook. */
  canonical_raw_now: string;
  /** Canonical cell text the preview showed. */
  previewed_canonical_raw: string;
  /** Typed value to write. */
  proposed_value: string | number | boolean | null | undefined;
  /** Audit classification for this column at write time. */
  defect: MappingStatus;
  confidence: MappingConfidence;
  /** Canonical baseline still authorized for production writes? */
  baseline: { ok: true } | { ok: false; reason: string };
  /**
   * Field-level provenance/audit evidence recorded for this column AFTER the
   * import (a later manual field correction, nameplate write, provenance entry).
   * Any such evidence supersedes the import value and blocks the repair.
   */
  supersedingEvidence: string | null;
  approved: boolean;
}

export function stillSafeToRepair(
  input: WriteGuardInput,
):
  | { ok: true }
  | { ok: false; status: Exclude<RepairStatus, "would_change" | "applied">; reason: string } {
  if (!input.baseline.ok) {
    return { ok: false, status: "baseline_blocked", reason: input.baseline.reason };
  }
  if (!ELIGIBLE_DEFECTS.includes(input.defect) || !REQUIRED_CONFIDENCE.includes(input.confidence)) {
    return {
      ok: false,
      status: "not_approved",
      reason: `Mapping classification is ${input.defect} / ${input.confidence}; only ${ELIGIBLE_DEFECTS.join(" or ")} at HIGH confidence may be written.`,
    };
  }
  if (input.proposed_value === undefined) {
    return {
      ok: false,
      status: "failed",
      reason: `Canonical value "${input.canonical_raw_now}" cannot be represented in ${input.destination} without inference. Nothing was written.`,
    };
  }
  if (input.canonical_raw_now.trim() !== input.previewed_canonical_raw.trim()) {
    return {
      ok: false,
      status: "drifted",
      reason: `The canonical source cell now reads "${input.canonical_raw_now || "(blank)"}", the preview showed "${input.previewed_canonical_raw || "(blank)"}".`,
    };
  }
  if (!sameStoredValue(input.live_value, input.previewed_current)) {
    return {
      ok: false,
      status: "drifted",
      reason: `FarmOps ${input.destination} now holds "${String(input.live_value ?? "")}", the preview recorded "${String(input.previewed_current ?? "")}".`,
    };
  }
  if (sameStoredValue(input.live_value, input.proposed_value)) {
    return { ok: false, status: "already_correct", reason: "Already equals the canonical value." };
  }
  if (input.supersedingEvidence) {
    return {
      ok: false,
      status: "newer_evidence",
      reason: `Newer field-level evidence supersedes the imported value: ${input.supersedingEvidence}`,
    };
  }
  if (!input.approved) {
    return {
      ok: false,
      status: "not_approved",
      reason: "Not in the explicitly approved per-field mapping set.",
    };
  }
  return { ok: true };
}

/** Audit-history line recorded with every applied repair. */
export function repairAuditSummary(p: RepairProposal): string {
  return `Load_Master mapping repair (${p.defect}): ${p.stable_id}.${p.destination} corrected from "${p.current_farmops_value || "(blank)"}" to canonical "${p.canonical_raw || "(blank)"}" taken from physical column ${p.ods_physical_column} ("${p.ods_header}", semantic ${p.semantic_field}). The previous value resulted from a proven Load_Master mapping/import defect, not from field evidence. Canonical baseline SHA-256 ${p.baseline_sha256}.`;
}

/* ------------------------------------------------------------------ summary */

export interface RepairSummary {
  gate_version: string;
  proposals: number;
  would_change: number;
  already_correct: number;
  drifted: number;
  newer_evidence: number;
  schema_missing: number;
  not_approved: number;
  baseline_blocked: number;
  failed: number;
  applied: number;
  accounted: number;
  reconciles: boolean;
  schema_extensions_required: number;
  baseline_sha256: string;
  baseline_authorized: boolean;
}

export function summarizeRepair(
  rows: RepairProposal[],
  gaps: SchemaGap[],
  baseline: { sha256: string; authorized: boolean },
): RepairSummary {
  const c = (s: RepairStatus) => rows.filter((r) => r.status === s).length;
  const summary: RepairSummary = {
    gate_version: MAPPING_REPAIR_GATE_VERSION,
    proposals: rows.length,
    would_change: c("would_change"),
    already_correct: c("already_correct"),
    drifted: c("drifted"),
    newer_evidence: c("newer_evidence"),
    schema_missing: c("schema_missing"),
    not_approved: c("not_approved"),
    baseline_blocked: c("baseline_blocked"),
    failed: c("failed"),
    applied: c("applied"),
    accounted: 0,
    reconciles: false,
    schema_extensions_required: gaps.length,
    baseline_sha256: baseline.sha256,
    baseline_authorized: baseline.authorized,
  };
  summary.accounted =
    summary.would_change +
    summary.already_correct +
    summary.drifted +
    summary.newer_evidence +
    summary.schema_missing +
    summary.not_approved +
    summary.baseline_blocked +
    summary.failed +
    summary.applied;
  summary.reconciles = summary.accounted === rows.length;
  return summary;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function repairProposalsCsv(rows: RepairProposal[]): string {
  const lines = [
    "stable_id,ods_physical_column,ods_header,semantic_field,destination,canonical_raw_value,current_farmops_value,proposed_farmops_value,defect,confidence,baseline_sha256,status,detail",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.stable_id,
        String(r.ods_physical_column),
        r.ods_header,
        r.semantic_field,
        r.destination,
        r.canonical_raw,
        r.current_farmops_value,
        String(r.proposed_value ?? ""),
        r.defect,
        r.confidence,
        r.baseline_sha256,
        r.status,
        r.detail ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
