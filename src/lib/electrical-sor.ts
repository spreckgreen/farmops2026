// Electrical System-of-Record (SOR) authority state — pure, testable logic.
//
// The whole point of this module is that nobody (human or AI) has to guess which
// system is authoritative for electrical engineering data. Until the explicit
// Phase 4.5 cutover is approved, the canonical workbook is the authority and
// FarmOps is a *candidate* SOR holding field / as-built truth.
import { SNAPSHOT_SCHEMA_VERSION, type SnapshotCollection } from "@/lib/electrical-snapshot";

export const CANONICAL_ODS_PATH =
  "BosteadFarmsBuildDocs/documents/VOL-01_Electrical/source/data/PremoFarmElectrical.ods";

/** Roadmap phases in order; the current phase is declared below. */
export const SOR_PHASES = ["4.2", "4.3", "4.4", "4.5", "5", "6"] as const;
export type SorPhase = (typeof SOR_PHASES)[number];

/**
 * Flip this to "farmops" only as part of the Phase 4.5 cutover event, together
 * with the archived pre-cutover ODS checksum and the cutover timestamp.
 */
export type SorAuthority = "canonical_ods" | "farmops";

export const SOR_AUTHORITY: SorAuthority = "canonical_ods";

export const SOR_PHASE: SorPhase = "4.2";

export const SOR_MODEL_VERSION = "1.1";

export interface SorStatus {
  /** Which system currently owns engineering truth. */
  authority: SorAuthority;
  authority_label: string;
  farmops_role: string;
  phase: SorPhase;
  /** Data-model version; bumped when electrical entities change shape. */
  model_version: string;
  snapshot_schema_version: string;
  canonical_ods_path: string;
  counts: Record<SnapshotCollection, number>;
  /** Most recent updated_at across every electrical record, or null. */
  last_record_change: string | null;
  /** Most recent reconciliation snapshot generation (this request). */
  last_reconciliation: string | null;
  qa: { errors: number; warnings: number };
  /**
   * Cutover blockers. Empty does NOT mean cutover happened — 4.5 requires
   * explicit owner approval regardless.
   */
  blockers: string[];
  cutover: { approved: false; date: null; ods_checksum: null };
}

export function authorityLabel(authority: SorAuthority): string {
  return authority === "farmops"
    ? "FarmOps Electrical Database"
    : "Canonical ODS (PremoFarmElectrical.ods)";
}

export function farmopsRole(authority: SorAuthority): string {
  return authority === "farmops"
    ? "System of Record"
    : "Candidate SOR / field authority";
}

export interface SorStatusInput {
  counts: Record<SnapshotCollection, number>;
  lastRecordChange: string | null;
  lastReconciliation: string | null;
  qa: { errors: number; warnings: number };
}

/**
 * Cutover gate. Only conditions FarmOps can actually observe are listed; the
 * Phase 4.3/4.4 mapping and round-trip evidence is added as those phases land.
 */
export function cutoverBlockers(input: SorStatusInput): string[] {
  const blockers: string[] = [];
  if ((SOR_AUTHORITY as SorAuthority) === "farmops") return blockers;
  if (input.qa.errors > 0) {
    blockers.push(
      `${input.qa.errors} unresolved electrical QA error${input.qa.errors === 1 ? "" : "s"} must be explained or fixed.`,
    );
  }
  if (!input.counts.panels || !input.counts.raceways) {
    blockers.push("The engineering dataset is not fully represented in FarmOps yet.");
  }
  blockers.push("Phase 4.3 field-mapping matrix is not complete.");
  blockers.push("Phase 4.4 lossless parallel validation has not been signed off.");
  blockers.push("Phase 4.5 cutover requires explicit owner approval.");
  return blockers;
}

export function buildSorStatus(input: SorStatusInput): SorStatus {
  return {
    authority: SOR_AUTHORITY,
    authority_label: authorityLabel(SOR_AUTHORITY),
    farmops_role: farmopsRole(SOR_AUTHORITY),
    phase: SOR_PHASE,
    model_version: SOR_MODEL_VERSION,
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    canonical_ods_path: CANONICAL_ODS_PATH,
    counts: input.counts,
    last_record_change: input.lastRecordChange,
    last_reconciliation: input.lastReconciliation,
    qa: input.qa,
    blockers: cutoverBlockers(input),
    cutover: { approved: false, date: null, ods_checksum: null },
  };
}

/** Latest `updated_at` seen in a snapshot, or null when there are no records. */
export function latestChange(
  rows: { updated_at?: unknown }[][],
): string | null {
  let latest = "";
  for (const set of rows) {
    for (const row of set) {
      const v = typeof row.updated_at === "string" ? row.updated_at : "";
      if (v > latest) latest = v;
    }
  }
  return latest || null;
}
