// Phase 4.4b — apply gate for the system-voltage semantic migration.
//
// Pure module: row/summary shapes, the guard that proves a row is still safe to
// write, and the CSV/Markdown audit exports. Nothing here performs I/O.
//
// The gate writes ONE new representation column (`system_voltage`) on ONE panel
// row per approved entry. The legacy scalar `voltage` is preserved untouched for
// backwards compatibility, so every current consumer keeps reading the value it
// reads today. Panel IDs, service identities/revisions, feeder and branch
// topology, breaker positions, loads, Boolean reconciliation, House field
// observations, the canonical ODS and every unrelated numeric field are out of
// scope and are never modified.
import {
  SYSTEM_VOLTAGE_COLUMN,
  SYSTEM_VOLTAGE_MODEL_VERSION,
  resolveSystemVoltage,
  sameSystemVoltage,
  type SystemVoltageRepresentation,
} from "@/lib/electrical-system-voltage";

export const SYSTEM_VOLTAGE_GATE_VERSION = "4.4b-system-voltage-apply-gate-1";

/** Panels authorized for this apply gate. Nothing outside this list is written. */
export const AUTHORIZED_PANELS = [
  "PNL-BLR",
  "PNL-FS-CRIT",
  "PNL-FS-EQ",
  "PNL-FS-NE",
  "PNL-FS-NW",
  "PNL-H1",
  "PNL-PH",
] as const;

export const AUTHORIZED_PANEL_SET = new Set<string>(AUTHORIZED_PANELS);

export type SystemVoltageGateStatus =
  | "would_change"
  | "already_correct"
  | "drifted"
  | "conflict"
  | "not_found"
  | "not_approved"
  | "failed"
  | "applied";

export interface SystemVoltageGateRow {
  table: string;
  stable_id: string;
  row_uuid: string | null;
  column: string;
  /** Canonical ODS cell text the entry was built from. */
  ods_value: string;
  /** Scalar voltage the reconciliation finding was based on. */
  expected_scalar: number | null;
  /** Scalar voltage read back from production during this run (never written). */
  live_scalar: number | null;
  /** Designation stored in production right now, if any. */
  live_representation: string;
  /** Designation this gate proposes / wrote. */
  proposed: SystemVoltageRepresentation;
  status: SystemVoltageGateStatus;
  applied_at: string | null;
  detail?: string;
}

export interface SystemVoltageGateSummary {
  gate_version: string;
  model_version: string;
  authorized_panels: number;
  would_change: number;
  already_correct: number;
  drifted: number;
  conflict: number;
  not_found: number;
  not_approved: number;
  failed: number;
  applied: number;
  accounted: number;
  reconciles: boolean;
}

export function systemVoltageGateKey(r: { table: string; stable_id: string }): string {
  return `${r.table}|${r.stable_id}|${SYSTEM_VOLTAGE_COLUMN}`;
}

/**
 * Is this entry still safe to write given the live row? Called twice per write:
 * once during the preview read and again immediately before the update.
 *
 * Safe only when the panel is authorized, the canonical ODS still states the
 * proposed designation, the live scalar still matches the reviewed value, and no
 * conflicting designation already exists.
 */
export function stillSafeToApply(input: {
  stable_id: string;
  ods_value: string;
  expected_scalar: number | null;
  live_scalar: number | null;
  live_representation: unknown;
  proposed: SystemVoltageRepresentation;
}):
  | { ok: true }
  | { ok: false; status: Exclude<SystemVoltageGateStatus, "would_change" | "applied">; reason: string } {
  if (!AUTHORIZED_PANEL_SET.has(input.stable_id)) {
    return {
      ok: false,
      status: "not_approved",
      reason: `${input.stable_id} is not one of the seven panels authorized for this migration.`,
    };
  }
  const odsRep = resolveSystemVoltage(input.ods_value);
  if (!odsRep || !sameSystemVoltage(odsRep, input.proposed)) {
    return {
      ok: false,
      status: "drifted",
      reason: `The canonical workbook no longer states ${input.proposed.designation} for this panel (it states "${input.ods_value || "(not stated)"}"). Re-run validation.`,
    };
  }
  if (input.live_scalar !== input.expected_scalar) {
    return {
      ok: false,
      status: "drifted",
      reason: `Live scalar voltage is ${input.live_scalar ?? "not stated"}, the reviewed value was ${input.expected_scalar ?? "not stated"}. Nothing was written.`,
    };
  }
  if (
    input.live_scalar !== null &&
    input.live_scalar !== input.proposed.line_line_volts &&
    input.live_scalar !== input.proposed.line_neutral_volts
  ) {
    return {
      ok: false,
      status: "conflict",
      reason: `Live scalar ${input.live_scalar} V is neither component of ${input.proposed.designation}: an engineering question, not a representation migration.`,
    };
  }
  const existing = resolveSystemVoltage(input.live_representation);
  if (existing && !sameSystemVoltage(existing, input.proposed)) {
    return {
      ok: false,
      status: "conflict",
      reason: `A different system-voltage designation (${existing.designation}) is already stored; it is never overwritten.`,
    };
  }
  return { ok: true };
}

/** Value written to the `system_voltage` column: the full designation, verbatim. */
export function systemVoltagePayload(rep: SystemVoltageRepresentation) {
  return {
    code: rep.code,
    designation: rep.designation,
    line_neutral_volts: rep.line_neutral_volts,
    line_line_volts: rep.line_line_volts,
    phases: rep.phases,
    wires: rep.wires,
    note: rep.note,
    model_version: SYSTEM_VOLTAGE_MODEL_VERSION,
  };
}

export function summarizeSystemVoltageGate(rows: SystemVoltageGateRow[]): SystemVoltageGateSummary {
  const count = (s: SystemVoltageGateStatus) => rows.filter((r) => r.status === s).length;
  const summary: SystemVoltageGateSummary = {
    gate_version: SYSTEM_VOLTAGE_GATE_VERSION,
    model_version: SYSTEM_VOLTAGE_MODEL_VERSION,
    authorized_panels: AUTHORIZED_PANELS.length,
    would_change: count("would_change"),
    already_correct: count("already_correct"),
    drifted: count("drifted"),
    conflict: count("conflict"),
    not_found: count("not_found"),
    not_approved: count("not_approved"),
    failed: count("failed"),
    applied: count("applied"),
    accounted: 0,
    reconciles: false,
  };
  summary.accounted =
    summary.would_change +
    summary.already_correct +
    summary.drifted +
    summary.conflict +
    summary.not_found +
    summary.not_approved +
    summary.failed +
    summary.applied;
  summary.reconciles = summary.accounted === rows.length;
  return summary;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function systemVoltageGateCsv(rows: SystemVoltageGateRow[]): string {
  const head = [
    "stable_id",
    "farmops_entity",
    "column",
    "row_uuid",
    "ods_value",
    "old_representation",
    "old_scalar",
    "new_system_voltage",
    "new_code",
    "new_line_neutral_volts",
    "new_line_line_volts",
    "new_phases",
    "new_wires",
    "status",
    "applied_at",
    "detail",
  ];
  const body = rows.map((r) => [
    r.stable_id,
    r.table,
    r.column,
    r.row_uuid ?? "",
    r.ods_value,
    r.live_representation || `scalar ${r.live_scalar ?? "not stated"}`,
    r.live_scalar === null ? "" : String(r.live_scalar),
    r.proposed.designation,
    r.proposed.code,
    String(r.proposed.line_neutral_volts),
    String(r.proposed.line_line_volts),
    r.proposed.phases === null ? "" : String(r.proposed.phases),
    r.proposed.wires === null ? "" : String(r.proposed.wires),
    r.status,
    r.applied_at ?? "",
    r.detail ?? "",
  ]);
  return [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function systemVoltageGateMarkdown(
  rows: SystemVoltageGateRow[],
  summary: SystemVoltageGateSummary,
  opts: { applied: boolean; generated_at: string },
): string {
  const lines: string[] = [
    `# Phase 4.4b — system-voltage migration ${opts.applied ? "apply report" : "preview"}`,
    "",
    `- Gate version: \`${summary.gate_version}\``,
    `- Model version: \`${summary.model_version}\``,
    `- Generated: ${opts.generated_at}`,
    `- Authorized panels: ${AUTHORIZED_PANELS.join(", ")}`,
    `- Rows: ${rows.length} (would change ${summary.would_change}, already correct ${summary.already_correct}, drifted ${summary.drifted}, conflict ${summary.conflict}, not found ${summary.not_found}, not approved ${summary.not_approved}, failed ${summary.failed}, applied ${summary.applied})`,
    `- Reconciles: ${summary.reconciles ? "yes" : "NO"}`,
    "",
    "The legacy scalar `voltage` column is preserved on every row; only the",
    "`system_voltage` designation is written. Drifted and conflicting rows are",
    "never written.",
    "",
    "| Stable ID | Old representation | New system_voltage | Status | Applied at |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.stable_id} | ${r.live_representation || `scalar ${r.live_scalar ?? "not stated"}`} | ${r.proposed.designation} (L-N ${r.proposed.line_neutral_volts}, L-L ${r.proposed.line_line_volts}, ${r.proposed.phases ?? "?"}φ, ${r.proposed.wires ?? "?"}-wire) | ${r.status} | ${r.applied_at ?? "—"} |`,
    ),
  ];
  return lines.join("\n");
}
