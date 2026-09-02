// Phase 4.4b — connected_va zero-artifact correction gate (pure module).
//
// Zero-origin provenance analysis established that a specific set of
// `electrical_loads.connected_va = 0` values are not engineering measurements and
// not explicit canonical values. For every row in scope:
//
//   - the canonical ODS cell is blank under the authorized Phase 4.4a SHA;
//   - FarmOps holds numeric 0;
//   - the row was created in the same bulk creation batch;
//   - there is no source_reference;
//   - there is no field-level audit evidence supporting the zero;
//   - there is no import snapshot establishing an explicit zero;
//   - the zero origin is DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT;
//   - the disposition is ZERO_DEFAULT_OR_COERCION_ARTIFACT.
//
// The only write this gate may ever perform is:
//
//   electrical_loads.connected_va  0 -> NULL
//
// That is the REMOVAL of an unsupported assertion, not the calculation of a load
// value. No VA is ever populated. Voltage, amps, demand VA, breaker data,
// equipment provenance, topology, notes, source references, stable IDs,
// relationships and the canonical ODS are never touched. The raw finding and its
// adjudication history are preserved; only the unsupported stored zero goes away.
import type {
  ZeroDisposition,
  ZeroOrigin,
} from "@/lib/electrical-zero-origin-provenance";

export const CONNECTED_VA_ZERO_GATE_VERSION = "4.4b-connected-va-zero-artifact-gate-1";

export const CONNECTED_VA_ZERO_TABLE = "electrical_loads";
export const CONNECTED_VA_ZERO_COLUMN = "connected_va";

/** The reviewed row count for this gate. Reported, never used to invent rows. */
export const EXPECTED_AUTHORIZED_ROWS = 11;

/** The only zero origin/disposition pair this gate accepts. */
export const AUTHORIZED_ZERO_ORIGIN: ZeroOrigin =
  "DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT";
export const AUTHORIZED_ZERO_DISPOSITION: ZeroDisposition =
  "ZERO_DEFAULT_OR_COERCION_ARTIFACT";

/** Loads that stay out of this gate no matter what their stored value is. */
export const EXCLUDED_LOAD_IDS = ["FS-084"] as const;

export type ConnectedVaZeroGateStatus =
  | "would_change"
  | "already_null"
  | "drifted"
  | "newer_evidence"
  | "not_found"
  | "not_approved"
  | "baseline_blocked"
  | "failed"
  | "applied";

export interface ConnectedVaZeroGateRow {
  table: string;
  stable_id: string;
  row_uuid: string | null;
  column: string;
  /** Live stored value read back during this run. */
  live_connected_va: number | null;
  /** Always null: the correction removes the assertion, it never sets a VA. */
  proposed_value: null;
  /** Canonical cell as parsed from the SHA-verified workbook (never coerced). */
  ods_state: "blank" | "value" | "text" | "unknown";
  ods_raw: string;
  ods_worksheet: string | null;
  ods_row: number | null;
  zero_origin: ZeroOrigin | null;
  disposition: ZeroDisposition | null;
  /** One-line account of the FarmOps creation/source/audit provenance. */
  provenance: string;
  /** Evidence lines behind the classification, preserved in the exports. */
  evidence: string[];
  status: ConnectedVaZeroGateStatus;
  applied_at: string | null;
  baseline_ods_file: string | null;
  baseline_sha256: string | null;
  detail?: string;
}

export interface ConnectedVaZeroGateSummary {
  gate_version: string;
  expected_authorized_rows: number;
  authorized_rows: number;
  would_change: number;
  already_null: number;
  drifted: number;
  newer_evidence: number;
  not_found: number;
  not_approved: number;
  baseline_blocked: number;
  failed: number;
  applied: number;
  accounted: number;
  reconciles: boolean;
  /** True when the live authorized set is exactly the reviewed 11-row set. */
  matches_reviewed_scope: boolean;
  baseline_ods_file: string | null;
  baseline_sha256: string | null;
  baseline_authorized: boolean;
}

export function connectedVaZeroGateKey(r: { table: string; stable_id: string }): string {
  return `${r.table}|${r.stable_id}|${CONNECTED_VA_ZERO_COLUMN}`;
}

/** Is the stored value exactly numeric zero (and not null/blank/NaN)? */
export function isExactNumericZero(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n === 0;
}

export interface ZeroRemovalCheckInput {
  stable_id: string;
  /** Stable IDs adjudicated as artifacts in THIS run, from live provenance. */
  authorized: Set<string>;
  live_connected_va: number | null;
  /** Canonical cell state for this stable ID under the verified workbook. */
  ods_state: ConnectedVaZeroGateRow["ods_state"];
  ods_raw: string;
  zero_origin: ZeroOrigin | null;
  disposition: ZeroDisposition | null;
  /** Newer evidence that would make the stored zero an assertion after all. */
  newer_evidence: string[];
  baseline: { ok: true } | { ok: false; reason: string };
}

/**
 * Is this row still safe to clear? Called during preview AND again immediately
 * before the write, against the freshest row read by UUID.
 */
export function stillSafeToRemoveConnectedVaZero(
  input: ZeroRemovalCheckInput,
):
  | { ok: true }
  | {
      ok: false;
      status: Exclude<ConnectedVaZeroGateStatus, "would_change" | "applied">;
      reason: string;
    } {
  if (!input.baseline.ok) {
    return { ok: false, status: "baseline_blocked", reason: input.baseline.reason };
  }
  if (
    EXCLUDED_LOAD_IDS.includes(input.stable_id as (typeof EXCLUDED_LOAD_IDS)[number])
  ) {
    return {
      ok: false,
      status: "not_approved",
      reason: `${input.stable_id} is held out of this gate (its connected VA depends on the unresolved canonical current semantics).`,
    };
  }
  if (!input.authorized.has(input.stable_id)) {
    return {
      ok: false,
      status: "not_approved",
      reason: `${input.stable_id} is not in the authorized zero-artifact set for this run.`,
    };
  }
  if (input.live_connected_va === null) {
    return {
      ok: false,
      status: "already_null",
      reason: "The unsupported zero is already gone: the field reads \u201Cnot stated\u201D.",
    };
  }
  if (!isExactNumericZero(input.live_connected_va)) {
    return {
      ok: false,
      status: "drifted",
      reason: `Live connected VA is ${input.live_connected_va}, not the reviewed numeric 0. Nothing was written.`,
    };
  }
  if (input.ods_state !== "blank") {
    return {
      ok: false,
      status: "drifted",
      reason: `The canonical cell is no longer blank for this stable ID (reads \u201C${input.ods_raw || input.ods_state}\u201D). The premise of the correction no longer holds.`,
    };
  }
  if (input.zero_origin !== AUTHORIZED_ZERO_ORIGIN) {
    return {
      ok: false,
      status: "newer_evidence",
      reason: `Live zero-origin adjudication is ${input.zero_origin ?? "unavailable"}, not ${AUTHORIZED_ZERO_ORIGIN}.`,
    };
  }
  if (input.disposition !== AUTHORIZED_ZERO_DISPOSITION) {
    return {
      ok: false,
      status: "newer_evidence",
      reason: `Live disposition is ${input.disposition ?? "unavailable"}, not ${AUTHORIZED_ZERO_DISPOSITION}.`,
    };
  }
  if (input.newer_evidence.length) {
    return {
      ok: false,
      status: "newer_evidence",
      reason: `Newer evidence has appeared for this value: ${input.newer_evidence.join("; ")}. The zero may now be an assertion — re-adjudicate before removing it.`,
    };
  }
  return { ok: true };
}

export function summarizeConnectedVaZeroGate(
  rows: ConnectedVaZeroGateRow[],
  meta: {
    authorized_rows: number;
    baseline_ods_file: string | null;
    baseline_sha256: string | null;
    baseline_authorized: boolean;
  },
): ConnectedVaZeroGateSummary {
  const count = (s: ConnectedVaZeroGateStatus) => rows.filter((r) => r.status === s).length;
  const summary: ConnectedVaZeroGateSummary = {
    gate_version: CONNECTED_VA_ZERO_GATE_VERSION,
    expected_authorized_rows: EXPECTED_AUTHORIZED_ROWS,
    authorized_rows: meta.authorized_rows,
    would_change: count("would_change"),
    already_null: count("already_null"),
    drifted: count("drifted"),
    newer_evidence: count("newer_evidence"),
    not_found: count("not_found"),
    not_approved: count("not_approved"),
    baseline_blocked: count("baseline_blocked"),
    failed: count("failed"),
    applied: count("applied"),
    accounted: 0,
    reconciles: false,
    matches_reviewed_scope: meta.authorized_rows === EXPECTED_AUTHORIZED_ROWS,
    baseline_ods_file: meta.baseline_ods_file,
    baseline_sha256: meta.baseline_sha256,
    baseline_authorized: meta.baseline_authorized,
  };
  summary.accounted =
    summary.would_change +
    summary.already_null +
    summary.drifted +
    summary.newer_evidence +
    summary.not_found +
    summary.not_approved +
    summary.baseline_blocked +
    summary.failed +
    summary.applied;
  summary.reconciles = summary.accounted === rows.length;
  return summary;
}

/* ------------------------------------------------------------------ exports */

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function connectedVaZeroGateCsv(rows: ConnectedVaZeroGateRow[]): string {
  const head = [
    "stable_id",
    "table",
    "column",
    "row_uuid",
    "baseline_ods_file",
    "baseline_sha256",
    "ods_state",
    "ods_raw",
    "ods_worksheet",
    "ods_row",
    "old_connected_va",
    "new_connected_va",
    "zero_origin",
    "disposition",
    "farmops_provenance",
    "evidence",
    "status",
    "applied_at",
    "detail",
  ];
  const body = rows.map((r) => [
    r.stable_id,
    r.table,
    r.column,
    r.row_uuid ?? "",
    r.baseline_ods_file ?? "",
    r.baseline_sha256 ?? "",
    r.ods_state,
    r.ods_raw,
    r.ods_worksheet ?? "",
    r.ods_row === null ? "" : String(r.ods_row),
    r.live_connected_va === null ? "" : String(r.live_connected_va),
    "NULL (not stated)",
    r.zero_origin ?? "",
    r.disposition ?? "",
    r.provenance,
    r.evidence.join(" | "),
    r.status,
    r.applied_at ?? "",
    r.detail ?? "",
  ]);
  return [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function connectedVaZeroGateMarkdown(
  rows: ConnectedVaZeroGateRow[],
  summary: ConnectedVaZeroGateSummary,
  opts: { applied: boolean; generated_at: string },
): string {
  return [
    `# Phase 4.4b — connected_va zero-artifact correction ${opts.applied ? "apply report" : "preview"}`,
    "",
    `- Gate version: \`${summary.gate_version}\``,
    `- Generated: ${opts.generated_at}`,
    `- Canonical baseline: ${summary.baseline_ods_file ?? "none attached"} (SHA-256 ${summary.baseline_sha256 ?? "n/a"}) — ${summary.baseline_authorized ? "authorized Phase 4.4a baseline" : "NOT authorized: nothing may be applied"}`,
    `- Authorized zero-artifact rows in this run: ${summary.authorized_rows} (reviewed scope ${summary.expected_authorized_rows}${summary.matches_reviewed_scope ? " — matches" : " — DOES NOT match, review before applying"})`,
    `- Rows: ${rows.length} (would change ${summary.would_change}, already null ${summary.already_null}, drifted ${summary.drifted}, newer evidence ${summary.newer_evidence}, not found ${summary.not_found}, not approved ${summary.not_approved}, baseline blocked ${summary.baseline_blocked}, failed ${summary.failed}, applied ${summary.applied})`,
    `- Reconciles: ${summary.reconciles ? "yes" : "NO"}`,
    "",
    `Exactly one column is written: \`${CONNECTED_VA_ZERO_TABLE}.${CONNECTED_VA_ZERO_COLUMN}\` numeric 0 → NULL. This removes an unsupported assertion; no VA value is calculated or populated. Voltage, amps, demand VA, breaker data, equipment provenance, topology, notes, source references, stable IDs, relationships and the canonical ODS are never modified. ${EXCLUDED_LOAD_IDS.join(", ")} stays out of scope (unresolved canonical current semantics), as do the PNL-H1 bus rating and spaces source-document cases. Every applied row keeps an audit record stating the removed zero was an unsupported import/default artifact, and the original raw finding plus adjudication history are retained.`,
    "",
    "| Stable ID | Canonical cell | FarmOps live connected_va | New value | Zero origin | Disposition | Status | Applied at | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.stable_id} | ${r.ods_state}${r.ods_raw ? ` (\`${r.ods_raw}\`)` : " (blank)"}${
          r.ods_worksheet ? ` — ${r.ods_worksheet} row ${r.ods_row ?? "?"}` : ""
        } | ${r.live_connected_va ?? "(null)"} | NULL (not stated) | ${r.zero_origin ?? "—"} | ${
          r.disposition ?? "—"
        } | ${r.status} | ${r.applied_at ?? "—"} | ${r.detail ?? ""} |`,
    ),
    "",
    "## Post-apply expectation",
    "",
    "Once applied, these comparisons read canonical blank ↔ FarmOps NULL. The SHA-bound comparison treats both-silent cells as an agreement, so they are no longer numeric disagreements or Category-D provenance blockers. Re-run Parallel Validation and the Category-D convergence accounting to confirm.",
  ].join("\n");
}
