/**
 * Load_Master Contract v3 — controlled reconciliation gate (PREVIEW ONLY).
 *
 * Contract v3 and its acceptance baseline are frozen here. This module compares
 * the Contract-v3 canonical projection against the current FarmOps
 * electrical_loads records, stable ID by stable ID and v3 semantic field by v3
 * semantic field, and classifies every cell under the authority model:
 *
 *   * canonical ODS owns engineering / design intent;
 *   * FarmOps owns verified as-built and field state;
 *   * newer field evidence is never overwritten by an older workbook value;
 *   * derived representations are never independently imported;
 *   * legacy duplicate columns are preserved but never overwrite their
 *     authoritative semantic;
 *   * the four unresolved current-semantic findings stay withheld;
 *   * FS-082 / FS-083 voltage follows the controlled canonical-revision lineage,
 *     so the superseded 120 V workbook value is never reintroduced.
 *
 * Nothing here writes a FarmOps record, edits the canonical workbook, emits a
 * schema migration, or authorizes an apply gate or a Phase 4.5 cutover.
 */
import {
  coerceCell,
  type BoundColumn,
  type ContractBinding,
  type ContractAuthority,
} from "@/lib/electrical-load-import-contract";
import { FARMOPS_OWNED_LOAD_FIELDS } from "@/lib/electrical-load-compare";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import { IMPORT_CONTRACT_V3_VERSION } from "@/lib/electrical-load-contract-v3";

export const RECONCILIATION_VERSION = "load_master.contract.v3.reconciliation-1";

/**
 * Frozen acceptance baseline for Contract v3 against the authorized canonical
 * SHA. Reconciliation only runs when the live simulation still reproduces it.
 */
export const CONTRACT_V3_FROZEN = {
  contract_version: IMPORT_CONTRACT_V3_VERSION,
  authorized_sha256: PHASE_44A_BASELINE_SHA256,
  observed_columns: 41,
  bound_columns: 40,
  canonical_rows: 138,
  semantic_loss: 0,
  remaining_unresolved_semantic_loss: 0,
  genuinely_unknown_populated_columns: 0,
  critical_rule_reconciliation: "PASS" as const,
  /** Unbound and intentionally zero-content in the authorized workbook. */
  intentionally_empty_unbound_columns: [
    { physical_column: 31, header: "Analysis Notes" },
  ],
} as const;

export type ReconClassification =
  | "MATCH"
  | "NORMALIZATION_EQUIVALENT"
  | "CANONICAL_VALUE_MISSING_IN_FARMOPS"
  | "FARMOPS_VALUE_DIFFERS"
  | "FARMOPS_AS_BUILT_AUTHORITY"
  | "LEGACY_PRESERVED"
  | "DERIVED_DO_NOT_IMPORT"
  | "CURRENT_SEMANTICS_WITHHELD"
  | "CANONICAL_CORRECTION_PENDING"
  | "NEWER_FARMOPS_EVIDENCE"
  | "NOT_REPRESENTABLE";

export interface ReconRecord {
  stable_id: string;
  physical_column: number;
  header: string;
  semantic: string;
  canonical_raw: string;
  canonical_normalized: string;
  farmops_current: string;
  authority: ContractAuthority | "canonical_ods" | "farmops_as_built";
  classification: ReconClassification;
  proposed_action: string;
  evidence: string;
}

export interface ReconAcceptance {
  columns_match: boolean;
  bound_match: boolean;
  rows_match: boolean;
  semantic_loss_zero: boolean;
  unknown_columns_zero: boolean;
  critical_rules_pass: boolean;
  sha_authorized: boolean;
  frozen_baseline_reproduced: boolean;
}

export interface ReconReport {
  version: string;
  contract_version: string;
  frozen: typeof CONTRACT_V3_FROZEN;
  acceptance: ReconAcceptance;
  records: ReconRecord[];
  counts: Record<ReconClassification, number>;
  headline: {
    total_compared: number;
    matches: number;
    normalization_equivalent: number;
    canonical_repair_candidates: number;
    farmops_as_built_retained: number;
    withheld: number;
    newer_evidence: number;
    not_representable: number;
    semantic_loss: number;
  };
  /** Stable IDs in the canonical projection with no FarmOps record. */
  missing_in_farmops: string[];
  /** FarmOps loads absent from the canonical projection. */
  farmops_only_ids: string[];
  /** True only when every acceptance condition for proceeding is satisfied. */
  ready_to_proceed: boolean;
  read_only: true;
  farmops_written: false;
  apply_gate_authorized: false;
  phase_45_authorized: false;
}

/* ------------------------------------------------ controlled-lineage rules */

/** The four unresolved current-semantic findings: withheld, never released. */
export const WITHHELD_CURRENT_SEMANTICS: { stable_id: string; semantic: string; reason: string }[] =
  [
    {
      stable_id: "FS-082",
      semantic: "amps",
      reason:
        "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD — canonical 0 A has no established semantic; no replacement and no blanking is proposed.",
    },
    {
      stable_id: "FS-083",
      semantic: "amps",
      reason:
        "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD — canonical 0 A has no established semantic; no replacement and no blanking is proposed.",
    },
    {
      stable_id: "FS-084",
      semantic: "amps",
      reason:
        "LEGACY_VALUE_SOURCE_UNKNOWN vs NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS — neither the canonical 60 A nor the FarmOps figure is established.",
    },
    {
      stable_id: "FS-084",
      semantic: "connected_va",
      reason:
        "Connected VA semantics unresolved for this load; no canonical release and no FarmOps overwrite is proposed.",
    },
  ];

/**
 * Canonical values already superseded by an approved canonical-revision
 * candidate. FarmOps already carries the corrected figure, so the workbook value
 * must never be pushed back over it.
 */
export const SUPERSEDED_CANONICAL_VALUES: {
  stable_id: string;
  semantic: string;
  superseded_value: number;
  approved_value: number;
  reason: string;
}[] = [
  {
    stable_id: "FS-082",
    semantic: "volts",
    superseded_value: 120,
    approved_value: 240,
    reason:
      "Canonical 120 V is superseded by the approved 240 V canonical-revision candidate (Bryant 37MARAQ24AA3, 208/230 VAC 1Ø).",
  },
  {
    stable_id: "FS-083",
    semantic: "volts",
    superseded_value: 120,
    approved_value: 240,
    reason:
      "Canonical 120 V is superseded by the approved 240 V canonical-revision candidate (Bryant 37MARAQ24AA3, 208/230 VAC 1Ø).",
  },
];

const withheldFor = (id: string, semantic: string) =>
  WITHHELD_CURRENT_SEMANTICS.find((w) => w.stable_id === id && w.semantic === semantic);

const supersededFor = (id: string, semantic: string) =>
  SUPERSEDED_CANONICAL_VALUES.find((s) => s.stable_id === id && s.semantic === semantic);

/* ------------------------------------------------------------- comparison */

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v).trim();
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").replace(/[^0-9.\-eE]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Same value under the destination's own type rules. */
function sameValue(col: BoundColumn, canonical: unknown, farmops: unknown): boolean {
  if (col.data_type === "numeric" || col.data_type === "integer" || col.data_type === "percent") {
    const a = num(canonical);
    const b = num(farmops);
    if (a === null || b === null) return a === b;
    return Math.abs(a - b) < 0.005;
  }
  if (col.data_type === "tri_state" && typeof canonical === "boolean") {
    return Boolean(canonical) === Boolean(farmops);
  }
  return show(canonical).toLowerCase() === show(farmops).toLowerCase();
}

export interface CanonicalProjectedRow {
  stable_id: string;
  /** Raw canonical cell text keyed by physical column. */
  raw: Record<number, string>;
}

export interface ReconInput {
  binding: ContractBinding;
  canonicalRows: CanonicalProjectedRow[];
  /** Current FarmOps electrical_loads rows. */
  farmOpsRows: Record<string, unknown>[];
  /** Live simulation facts, checked against the frozen acceptance baseline. */
  live: {
    ods_sha256: string;
    observed_columns: number;
    bound_columns: number;
    row_count: number;
    semantic_loss: number;
    unknown_populated_columns: number;
    critical_rules_pass: boolean;
  };
}

/** Build the preview-only Contract-v3 ↔ FarmOps reconciliation. */
export function buildV3Reconciliation(input: ReconInput): ReconReport {
  const { binding, canonicalRows, farmOpsRows, live } = input;

  const byId = new Map<string, Record<string, unknown>>();
  for (const r of farmOpsRows) {
    const id = String(r["load_id"] ?? "").trim();
    if (id) byId.set(id, r);
  }

  const records: ReconRecord[] = [];
  const missing_in_farmops: string[] = [];

  for (const row of canonicalRows) {
    const current = byId.get(row.stable_id);
    if (!current) missing_in_farmops.push(row.stable_id);

    for (const col of binding.columns) {
      const raw = String(row.raw[col.physical_column] ?? "").trim();
      const legacy = col.canonical_semantic.endsWith("_legacy");
      const dest = col.farmops_destination;
      const farmValue = dest && current ? current[dest] : undefined;
      const farmops_current = current ? show(farmValue) : "(no FarmOps record)";
      const coerced = raw ? coerceCell(col, raw) : null;
      const canonical_normalized = coerced ? show(coerced.value) : "";

      const authority: ReconRecord["authority"] =
        col.authority === "field_observation"
          ? "farmops_as_built"
          : col.authority === "engineering_design"
            ? "canonical_ods"
            : col.authority;

      const push = (
        classification: ReconClassification,
        proposed_action: string,
        evidence: string,
      ) =>
        records.push({
          stable_id: row.stable_id,
          physical_column: col.physical_column,
          header: col.observed_header || col.exact_header,
          semantic: col.canonical_semantic,
          canonical_raw: raw,
          canonical_normalized,
          farmops_current,
          authority,
          classification,
          proposed_action,
          evidence,
        });

      // --- structural dispositions, decided by the contract, not by values ---
      if (col.effective_action === "UNRESOLVED") {
        if (!raw) continue; // intentionally zero-content unbound column
        push(
          "NOT_REPRESENTABLE",
          "HOLD — no canonical semantic bound at this physical column; owner review required before any representation is chosen.",
          `Physical column ${col.physical_column} ("${col.observed_header || "(blank)"}") is unbound in ${IMPORT_CONTRACT_V3_VERSION}.`,
        );
        continue;
      }
      if (col.effective_action === "DERIVED_REPRESENTATION_DO_NOT_IMPORT") {
        push(
          "DERIVED_DO_NOT_IMPORT",
          "DO NOT IMPORT — recompute for display from its authoritative source column.",
          col.transformation,
        );
        continue;
      }
      if (legacy || col.effective_action === "LEGACY_PRESERVE") {
        push(
          "LEGACY_PRESERVED",
          "PRESERVE VERBATIM — never written over its authoritative semantic.",
          col.transformation,
        );
        continue;
      }
      if (col.effective_action === "AS_BUILT_FIELD") {
        push(
          "FARMOPS_AS_BUILT_AUTHORITY",
          "PRESERVE canonical token as as-built evidence; FarmOps field state stays authoritative.",
          "As-built / installation column: field observation authority, never an engineering value.",
        );
        continue;
      }
      if (col.effective_action === "SCHEMA_EXTENSION_REQUIRED") {
        if (!raw) continue;
        push(
          "CANONICAL_VALUE_MISSING_IN_FARMOPS",
          "SCHEMA EXTENSION REQUIRED before repair — value preserved verbatim, never written into a neighbouring numeric field.",
          col.reason ?? col.transformation,
        );
        continue;
      }

      // --- value-level dispositions on bound, importable semantics ---
      const withheld = withheldFor(row.stable_id, col.canonical_semantic);
      if (withheld) {
        push("CURRENT_SEMANTICS_WITHHELD", "WITHHELD — no release, no overwrite, no blanking.", withheld.reason);
        continue;
      }

      const superseded = supersededFor(row.stable_id, col.canonical_semantic);
      if (superseded && num(coerced?.value) === superseded.superseded_value) {
        push(
          "CANONICAL_CORRECTION_PENDING",
          `DO NOT IMPORT — the canonical value is superseded; the corrected ${superseded.approved_value} figure is released only through the controlled canonical revision.`,
          superseded.reason,
        );
        continue;
      }

      const farmopsOwned = dest ? FARMOPS_OWNED_LOAD_FIELDS.has(dest) : false;
      const farmopsBlank = show(farmValue) === "";

      if (!raw) {
        if (!current || farmopsBlank) continue; // nothing to compare
        if (farmopsOwned) {
          push(
            "FARMOPS_AS_BUILT_AUTHORITY",
            "RETAIN FarmOps value — field-work column, not canonical-owned.",
            `${dest} is FarmOps field state; the canonical workbook carries no value here.`,
          );
        } else {
          push(
            "NEWER_FARMOPS_EVIDENCE",
            "RETAIN FarmOps value — an older blank workbook cell never blanks recorded evidence.",
            `Canonical cell is blank; FarmOps records "${farmops_current}".`,
          );
        }
        continue;
      }

      if (!current) {
        push(
          "CANONICAL_VALUE_MISSING_IN_FARMOPS",
          "IMPORT CANDIDATE — no FarmOps record exists for this stable ID.",
          "Stable ID present in the canonical projection only.",
        );
        continue;
      }

      if (farmopsBlank) {
        push(
          "CANONICAL_VALUE_MISSING_IN_FARMOPS",
          farmopsOwned
            ? "HOLD — field-work column; canonical value is evidence only, not a write."
            : "CANONICAL REPAIR CANDIDATE — canonical engineering value absent from FarmOps.",
          `${dest ?? "(no destination)"} is blank in FarmOps.`,
        );
        continue;
      }

      if (sameValue(col, coerced?.value ?? null, farmValue)) {
        const identical = canonical_normalized.toLowerCase() === farmops_current.toLowerCase();
        const rawIdentical = raw.toLowerCase() === farmops_current.toLowerCase();
        if (identical && rawIdentical) {
          push("MATCH", "NO ACTION — values agree.", "Canonical and FarmOps values are identical.");
        } else {
          push(
            "NORMALIZATION_EQUIVALENT",
            "NO ACTION — same meaning after the contract's declared normalization.",
            `Canonical "${raw}" normalizes to "${canonical_normalized}"; FarmOps holds "${farmops_current}".`,
          );
        }
        continue;
      }

      if (farmopsOwned) {
        push(
          "FARMOPS_AS_BUILT_AUTHORITY",
          "RETAIN FarmOps value — verified as-built / field state outranks the workbook here.",
          `${dest} is a FarmOps field-work column.`,
        );
        continue;
      }

      push(
        "FARMOPS_VALUE_DIFFERS",
        "CANONICAL REPAIR CANDIDATE — owner disposition required; no automatic overwrite.",
        `Canonical "${raw}" (${canonical_normalized || "null"}) vs FarmOps "${farmops_current}". Canonical ODS holds engineering authority, but the difference is reported, not applied.`,
      );
    }
  }

  const canonicalIds = new Set(canonicalRows.map((r) => r.stable_id));
  const farmops_only_ids = [...byId.keys()].filter((id) => !canonicalIds.has(id)).sort();

  const counts = {
    MATCH: 0,
    NORMALIZATION_EQUIVALENT: 0,
    CANONICAL_VALUE_MISSING_IN_FARMOPS: 0,
    FARMOPS_VALUE_DIFFERS: 0,
    FARMOPS_AS_BUILT_AUTHORITY: 0,
    LEGACY_PRESERVED: 0,
    DERIVED_DO_NOT_IMPORT: 0,
    CURRENT_SEMANTICS_WITHHELD: 0,
    CANONICAL_CORRECTION_PENDING: 0,
    NEWER_FARMOPS_EVIDENCE: 0,
    NOT_REPRESENTABLE: 0,
  } as Record<ReconClassification, number>;
  for (const r of records) counts[r.classification] += 1;

  const acceptance: ReconAcceptance = {
    columns_match: live.observed_columns === CONTRACT_V3_FROZEN.observed_columns,
    bound_match: live.bound_columns === CONTRACT_V3_FROZEN.bound_columns,
    rows_match: live.row_count === CONTRACT_V3_FROZEN.canonical_rows,
    semantic_loss_zero: live.semantic_loss === 0,
    unknown_columns_zero: live.unknown_populated_columns === 0,
    critical_rules_pass: live.critical_rules_pass,
    sha_authorized: live.ods_sha256.toLowerCase() === CONTRACT_V3_FROZEN.authorized_sha256,
    frozen_baseline_reproduced: false,
  };
  acceptance.frozen_baseline_reproduced =
    acceptance.columns_match &&
    acceptance.bound_match &&
    acceptance.rows_match &&
    acceptance.semantic_loss_zero &&
    acceptance.unknown_columns_zero &&
    acceptance.critical_rules_pass &&
    acceptance.sha_authorized;

  const headline = {
    total_compared: records.length,
    matches: counts.MATCH,
    normalization_equivalent: counts.NORMALIZATION_EQUIVALENT,
    canonical_repair_candidates:
      counts.FARMOPS_VALUE_DIFFERS + counts.CANONICAL_VALUE_MISSING_IN_FARMOPS,
    farmops_as_built_retained: counts.FARMOPS_AS_BUILT_AUTHORITY,
    withheld: counts.CURRENT_SEMANTICS_WITHHELD + counts.CANONICAL_CORRECTION_PENDING,
    newer_evidence: counts.NEWER_FARMOPS_EVIDENCE,
    not_representable: counts.NOT_REPRESENTABLE,
    semantic_loss: live.semantic_loss,
  };

  const everyNonMatchDisposed = records.every(
    (r) =>
      r.classification === "MATCH" ||
      (r.proposed_action.trim().length > 0 && r.evidence.trim().length > 0 && r.authority.length > 0),
  );

  return {
    version: RECONCILIATION_VERSION,
    contract_version: IMPORT_CONTRACT_V3_VERSION,
    frozen: CONTRACT_V3_FROZEN,
    acceptance,
    records,
    counts,
    headline,
    missing_in_farmops,
    farmops_only_ids,
    ready_to_proceed:
      acceptance.frozen_baseline_reproduced &&
      headline.not_representable === 0 &&
      headline.semantic_loss === 0 &&
      everyNonMatchDisposed,
    read_only: true,
    farmops_written: false,
    apply_gate_authorized: false,
    phase_45_authorized: false,
  };
}

/* ------------------------------------------------------------------- CSV */

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function reconciliationCsv(report: Pick<ReconReport, "records">): string {
  const lines = [
    "stable_id,physical_column,header,semantic,canonical_raw,canonical_normalized,farmops_current,authority,classification,proposed_action,evidence",
  ];
  for (const r of report.records) {
    lines.push(
      [
        r.stable_id,
        String(r.physical_column),
        r.header,
        r.semantic,
        r.canonical_raw,
        r.canonical_normalized,
        r.farmops_current,
        r.authority,
        r.classification,
        r.proposed_action,
        r.evidence,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
