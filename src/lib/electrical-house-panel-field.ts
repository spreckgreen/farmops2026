// Phase 4.4b — House panel photo reconciliation (pure layer).
//
// Photographs of the existing House panel directories are transcribed into a
// workbook (initially `house_panels_bulk_update.ods`). Everything in this file
// is deterministic and database-free: it parses that workbook into *field
// observations with provenance*, normalizes multi-pole breakers, and performs a
// three-way comparison between the canonical engineering value, the current
// FarmOps value and the photo-derived observation.
//
// Hard rules encoded here:
//  - field observation is evidence, never authority: SOR_AUTHORITY stays
//    `canonical_ods` and nothing here writes anything, including the ODS;
//  - the verbatim observed text is always retained next to any interpretation;
//  - uncertainty markers (VERIFY, ?, UNKNOWN, TBD) never become typed values;
//  - a 2-pole breaker is ONE logical breaker occupying two panel positions.
import type { Sheet } from "@/lib/electrical-ods";

export const FIELD_RECONCILIATION_PHASE = "4.4b";
export const FIELD_RECONCILIATION_CSV = "phase-4.4b-house-panel-field-reconciliation.csv";

/** Workbook panel name → existing FarmOps panel identity. Never renames. */
export const HOUSE_PANEL_ALIASES: Record<string, string> = {
  "HOUSE-MAIN": "PNL-H1",
  "HOUSE MAIN": "PNL-H1",
  "HOUSE-SUBPANEL": "PNL-H2",
  "HOUSE SUBPANEL": "PNL-H2",
  "HOUSE-SUB-PANEL": "PNL-H2",
};

export const RECONCILIATION_CLASSIFICATIONS = [
  "MATCH",
  "FIELD_OBSERVATION_NEW",
  "FIELD_CONFIRMS_CANONICAL",
  "FARMOPS_DIFFERS_FROM_FIELD",
  "CANONICAL_DIFFERS_FROM_FIELD",
  "THREE_WAY_CONFLICT",
  "FIELD_VERIFICATION_REQUIRED",
  "UNKNOWN_FIELD_VALUE",
  "UNRESOLVED_PANEL_IDENTITY",
  "UNRESOLVED_CIRCUIT_POSITION",
  "TOPOLOGY_PROPOSAL",
] as const;
export type ReconciliationClassification = (typeof RECONCILIATION_CLASSIFICATIONS)[number];

export const PROPOSED_ACTIONS = [
  "no_change",
  "propose_farmops_update",
  "preserve_observation_only",
  "requires_review",
  "propose_topology_update",
  "conflict_do_not_apply",
] as const;
export type ProposedAction = (typeof PROPOSED_ACTIONS)[number];

export const OBSERVATION_DISPOSITIONS = [
  "observed",
  "verified",
  "accepted",
  "rejected",
  "superseded",
  "needs_field_verification",
] as const;
export type ObservationDisposition = (typeof OBSERVATION_DISPOSITIONS)[number];

export type Confidence = "high" | "medium" | "low" | "unknown";

/** Where an observation came from. Never discarded, even after acceptance. */
export interface ObservationProvenance {
  workbook: string;
  worksheet: string;
  source_row: number;
  source_column: string;
  source_photo: string;
  observed_text: string;
}

/** One reconcilable attribute observed on a panel-directory photograph. */
export type ObservedFieldKey = "ocp_amps" | "poles" | "label";

export const OBSERVED_FIELD_LABELS: Record<ObservedFieldKey, string> = {
  ocp_amps: "Breaker amps",
  poles: "Poles",
  label: "Directory description",
};

export interface ObservedField {
  field: ObservedFieldKey;
  /** Verbatim cell text as transcribed from the photograph. */
  observed_text: string;
  /** Typed interpretation, or null when the source is uncertain/unknown. */
  interpreted: string | number | null;
  confidence: Confidence;
  verification_required: boolean;
  /** True when the source explicitly states the value is unknown. */
  unknown_value: boolean;
  provenance: ObservationProvenance;
}

/** One logical breaker (not one panel position). */
export interface BreakerObservation {
  key: string;
  panel_source_name: string;
  /** Resolved FarmOps panel identity, or null when unresolved. */
  panel_id: string | null;
  identity_status: "resolved" | "unresolved";
  /** Physical panel positions occupied, in workbook order (e.g. [26, 28]). */
  positions: number[];
  /** Verbatim position text, e.g. "26/28". */
  positions_text: string;
  poles: number | null;
  /** Physical slot of the first position (side + column position). */
  slot: { side: "Left" | "Right"; position: number } | null;
  position_status: "resolved" | "unresolved";
  fields: ObservedField[];
  notes: string;
  provenance: ObservationProvenance;
}

export interface ParseResult {
  workbook: string;
  rows_parsed: number;
  observations: BreakerObservation[];
  warnings: string[];
}

// --------------------------------------------------------------- header logic

const HEADER_SYNONYMS: Record<string, string[]> = {
  panel: ["panel", "panel name", "panel id", "panelboard", "source panel"],
  circuit: [
    "circuit",
    "circuits",
    "circuit #",
    "circuit no",
    "position",
    "positions",
    "breaker",
    "breaker #",
    "breaker number",
    "space",
    "spaces",
  ],
  poles: ["poles", "pole", "pole count", "no of poles"],
  amps: ["amps", "breaker amps", "amp", "amperage", "rating", "breaker size", "ocp", "ocp amps"],
  description: [
    "description",
    "load",
    "load description",
    "label",
    "circuit description",
    "directory",
    "directory text",
  ],
  notes: ["notes", "note", "comment", "comments"],
  photo: ["photo", "source photo", "image", "file", "photo reference", "picture"],
  confidence: ["confidence"],
  verification: ["verification", "verification status", "verified"],
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function headerRole(cell: string): string | null {
  const n = norm(cell);
  if (!n) return null;
  for (const [role, list] of Object.entries(HEADER_SYNONYMS)) {
    if (list.includes(n)) return role;
  }
  for (const [role, list] of Object.entries(HEADER_SYNONYMS)) {
    if (list.some((h) => n === h || n.startsWith(`${h} `) || n.endsWith(` ${h}`))) return role;
  }
  return null;
}

interface HeaderMap {
  index: number;
  roles: Map<string, number>;
  headers: string[];
}

/** Find the header row of a transcription sheet (scans the first rows only). */
export function findHeaderRow(sheet: Sheet): HeaderMap | null {
  const limit = Math.min(sheet.rows.length, 12);
  for (let i = 0; i < limit; i++) {
    const row = sheet.rows[i] ?? [];
    const roles = new Map<string, number>();
    row.forEach((cell, col) => {
      const role = headerRole(cell);
      if (role && !roles.has(role)) roles.set(role, col);
    });
    if (roles.has("circuit") && (roles.has("amps") || roles.has("description") || roles.has("poles"))) {
      return { index: i, roles, headers: row.map((c) => String(c ?? "").trim()) };
    }
  }
  return null;
}

// ------------------------------------------------------------ value semantics

// A question mark anywhere in the transcription is an uncertainty marker.
const UNCERTAIN = /\?|(^|\W)(verify|unverified|unsure|tbd|to be determined|assumed|maybe)/i;
const UNKNOWN_TEXT = /(^|\W)(unknown|unidentified|not known|no label)/i;

export function isUncertainText(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  return s !== "" && UNCERTAIN.test(s);
}

export function isUnknownText(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  return s !== "" && UNKNOWN_TEXT.test(s);
}

/**
 * Interpret an amperage cell.
 *
 * `"60"` / `"60A"` → 60. `"VERIFY"` stays unknown: never 0, never false, never
 * a guess, and never treated as a parse failure.
 */
export function interpretAmps(raw: unknown): {
  interpreted: number | null;
  confidence: Confidence;
  verification_required: boolean;
  unknown_value: boolean;
} {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { interpreted: null, confidence: "unknown", verification_required: true, unknown_value: true };
  }
  if (isUnknownText(text)) {
    return { interpreted: null, confidence: "unknown", verification_required: true, unknown_value: true };
  }
  if (isUncertainText(text)) {
    return { interpreted: null, confidence: "low", verification_required: true, unknown_value: false };
  }
  const m = /^(\d{1,4})(?:\s*a(?:mps?)?)?$/i.exec(text);
  if (!m) {
    return { interpreted: null, confidence: "low", verification_required: true, unknown_value: false };
  }
  return { interpreted: Number(m[1]), confidence: "high", verification_required: false, unknown_value: false };
}

/** Interpret a panel-directory description. Abbreviated text stays evidence. */
export function interpretDescription(raw: unknown): {
  interpreted: string | null;
  confidence: Confidence;
  verification_required: boolean;
  unknown_value: boolean;
} {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { interpreted: null, confidence: "unknown", verification_required: true, unknown_value: true };
  }
  if (isUnknownText(text)) {
    // "UNKNOWN LOAD" means the installed load is unknown; it authorizes no
    // invented load description.
    return { interpreted: null, confidence: "unknown", verification_required: true, unknown_value: true };
  }
  if (isUncertainText(text)) {
    // Preserved as an observation, but never promoted as confirmed.
    return { interpreted: text, confidence: "low", verification_required: true, unknown_value: false };
  }
  return { interpreted: text, confidence: "high", verification_required: false, unknown_value: false };
}

/** `"26/28"` → `[26, 28]`; `"26"` → `[26]`; `"26,28,30"` → `[26, 28, 30]`. */
export function parsePositions(raw: unknown): number[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const parts = text.split(/[/,&+\-\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return [];
    out.push(Number(p));
  }
  return out;
}

/**
 * Physical slot of a breaker number in a two-column panel: odd numbers run down
 * the left, even down the right (26 → Right 13).
 */
export function slotForBreakerNumber(n: number): { side: "Left" | "Right"; position: number } | null {
  if (!Number.isFinite(n) || n < 1) return null;
  return n % 2 === 1 ? { side: "Left", position: (n + 1) / 2 } : { side: "Right", position: n / 2 };
}

export function resolvePanelIdentity(
  sourceName: string,
  aliases: Record<string, string> = HOUSE_PANEL_ALIASES,
  knownPanelIds: string[] = [],
): string | null {
  const raw = String(sourceName ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (aliases[upper]) return aliases[upper];
  const known = knownPanelIds.map((k) => k.toUpperCase());
  if (known.includes(upper)) return knownPanelIds[known.indexOf(upper)];
  return null;
}

// ------------------------------------------------------------------- parsing

export interface ParseOptions {
  workbook: string;
  aliases?: Record<string, string>;
  knownPanelIds?: string[];
  /** Panel name for sheets that do not carry a panel column. */
  defaultPanelName?: string;
}

/** Parse transcription sheets into logical breaker observations. */
export function parseHousePanelSheets(sheets: Sheet[], opts: ParseOptions): ParseResult {
  const warnings: string[] = [];
  const observations: BreakerObservation[] = [];
  let rowsParsed = 0;

  for (const sheet of sheets) {
    const header = findHeaderRow(sheet);
    if (!header) {
      warnings.push(`Sheet "${sheet.name}" has no recognizable panel-directory header row; skipped.`);
      continue;
    }
    const col = (role: string) => header.roles.get(role);
    const cell = (row: string[], role: string) => {
      const i = col(role);
      return i === undefined ? "" : String(row[i] ?? "").trim();
    };
    const headerName = (role: string) => {
      const i = col(role);
      return i === undefined ? "" : header.headers[i] ?? "";
    };
    const sheetPanelName = /sub/i.test(sheet.name)
      ? "HOUSE-SUBPANEL"
      : /main/i.test(sheet.name)
        ? "HOUSE-MAIN"
        : (opts.defaultPanelName ?? "");

    for (let r = header.index + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      if (row.every((c) => String(c ?? "").trim() === "")) continue;
      rowsParsed++;
      const sourceRow = r + 1;
      const panelSourceName = cell(row, "panel") || sheetPanelName;
      const panelId = resolvePanelIdentity(panelSourceName, opts.aliases, opts.knownPanelIds);
      const positionsText = cell(row, "circuit");
      const positions = parsePositions(positionsText);
      const polesText = cell(row, "poles");
      const polesFromColumn = /^\d{1,2}$/.test(polesText) ? Number(polesText) : null;
      const poles = polesFromColumn ?? (positions.length ? positions.length : null);
      const photo = cell(row, "photo");
      const notes = cell(row, "notes");

      const prov = (column: string, observed: string): ObservationProvenance => ({
        workbook: opts.workbook,
        worksheet: sheet.name,
        source_row: sourceRow,
        source_column: column,
        source_photo: photo,
        observed_text: observed,
      });

      const fields: ObservedField[] = [];
      if (col("amps") !== undefined) {
        const observed = cell(row, "amps");
        const parsed = interpretAmps(observed);
        fields.push({
          field: "ocp_amps",
          observed_text: observed,
          interpreted: parsed.interpreted,
          confidence: parsed.confidence,
          verification_required: parsed.verification_required,
          unknown_value: parsed.unknown_value,
          provenance: prov(headerName("amps") || "Breaker Amps", observed),
        });
      }
      if (poles !== null) {
        fields.push({
          field: "poles",
          observed_text: polesText || positionsText,
          interpreted: poles,
          confidence: polesFromColumn !== null || positions.length ? "high" : "low",
          verification_required: false,
          unknown_value: false,
          provenance: prov(headerName("poles") || headerName("circuit") || "Poles", polesText || positionsText),
        });
      }
      if (col("description") !== undefined) {
        const observed = cell(row, "description");
        const parsed = interpretDescription(observed);
        fields.push({
          field: "label",
          observed_text: observed,
          interpreted: parsed.interpreted,
          confidence: parsed.confidence,
          verification_required: parsed.verification_required,
          unknown_value: parsed.unknown_value,
          provenance: prov(headerName("description") || "Description", observed),
        });
      }

      observations.push({
        key: `${sheet.name}#${sourceRow}`,
        panel_source_name: panelSourceName,
        panel_id: panelId,
        identity_status: panelId ? "resolved" : "unresolved",
        positions,
        positions_text: positionsText,
        poles,
        slot: positions.length ? slotForBreakerNumber(positions[0]) : null,
        position_status: positions.length ? "resolved" : "unresolved",
        fields,
        notes,
        provenance: prov(headerName("circuit") || "Circuit", positionsText),
      });
    }
  }

  return { workbook: opts.workbook, rows_parsed: rowsParsed, observations, warnings };
}

// ------------------------------------------------------------- reconciliation

export interface ReconciliationRow {
  key: string;
  panel_source_name: string;
  panel_id: string | null;
  positions_text: string;
  positions: number[];
  poles: number | null;
  side: string;
  position: number | null;
  field: ObservedFieldKey | "parent_panel";
  field_label: string;
  canonical_value: string | null;
  farmops_value: string | null;
  field_observed_text: string;
  field_interpreted: string | number | null;
  confidence: Confidence;
  verification_required: boolean;
  classification: ReconciliationClassification;
  proposed_action: ProposedAction;
  detail: string;
  provenance: ObservationProvenance;
  /** Present for rows that could become a FarmOps update. */
  target?: {
    table: "electrical_breaker_positions";
    panel_id: string;
    side: string;
    position: number;
    column: ObservedFieldKey;
    expected_current: string | number | null;
    proposed_value: string | number | null;
  };
  topology?: {
    panel_id: string;
    current_parent: string | null;
    proposed_parent: string;
    evidence: string;
  };
}

/** One live FarmOps breaker-position row, keyed by panel + slot. */
export interface FarmOpsBreaker {
  panel_id: string;
  side: string;
  position: number;
  breaker_number: number | null;
  poles: number | null;
  ocp_amps: number | null;
  label: string | null;
}

export interface ReconcileInput {
  parsed: ParseResult;
  /** Live FarmOps breaker positions. */
  farmops: FarmOpsBreaker[];
  /**
   * Canonical engineering values preserved from the canonical ODS, keyed
   * `PANEL|BREAKER|field` (e.g. `PNL-H1|26|ocp_amps`). Absent means the
   * canonical dataset says nothing about that attribute.
   */
  canonical?: Record<string, string>;
  /** Current-revision parent of PNL-H2, or null when not represented. */
  currentSubpanelParent?: string | null;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

function sameValue(a: string | number | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const an = typeof a === "number" ? a : Number(String(a).replace(/[^\d.-]/g, ""));
  const bn = Number(String(b).replace(/[^\d.-]/g, ""));
  if (Number.isFinite(an) && Number.isFinite(bn) && String(a).trim() !== "" && b.trim() !== "") {
    if (typeof a === "number" || /^\s*\d+(\.\d+)?\s*a?(mps?)?\s*$/i.test(String(a))) return an === bn;
  }
  return norm(a) === norm(b);
}

function classify(
  field: ObservedField,
  canonical: string | null,
  farmops: string | null,
): { classification: ReconciliationClassification; action: ProposedAction; detail: string } {
  if (field.unknown_value) {
    return {
      classification: "UNKNOWN_FIELD_VALUE",
      action: "preserve_observation_only",
      detail: "The photograph states the value is unknown; no engineering value may be derived from it.",
    };
  }
  if (field.verification_required) {
    return {
      classification: "FIELD_VERIFICATION_REQUIRED",
      action: "requires_review",
      detail: "The observed text carries an uncertainty marker and stays verification-required.",
    };
  }
  const value = field.interpreted;
  const matchesCanonical = canonical !== null && sameValue(value, canonical);
  const matchesFarmOps = farmops !== null && sameValue(value, farmops);

  if (canonical === null && farmops === null) {
    return {
      classification: "FIELD_OBSERVATION_NEW",
      action: field.confidence === "high" ? "propose_farmops_update" : "requires_review",
      detail: "Neither the canonical dataset nor FarmOps holds a value for this attribute.",
    };
  }
  if (matchesCanonical && matchesFarmOps) {
    return { classification: "MATCH", action: "no_change", detail: "All three sources agree." };
  }
  if (matchesCanonical && farmops === null) {
    return {
      classification: "FIELD_CONFIRMS_CANONICAL",
      action: "propose_farmops_update",
      detail: "Field observation confirms the canonical value; FarmOps holds nothing yet.",
    };
  }
  if (matchesCanonical && !matchesFarmOps) {
    return {
      classification: "FARMOPS_DIFFERS_FROM_FIELD",
      action: "propose_farmops_update",
      detail: "FarmOps disagrees with both the canonical value and the field observation.",
    };
  }
  if (matchesFarmOps && canonical !== null && !matchesCanonical) {
    return {
      classification: "CANONICAL_DIFFERS_FROM_FIELD",
      action: "requires_review",
      detail: "FarmOps matches the field, but the canonical engineering value differs — engineering reconciliation required.",
    };
  }
  if (matchesFarmOps) {
    return { classification: "MATCH", action: "no_change", detail: "FarmOps already matches the observation." };
  }
  if (canonical !== null && farmops !== null && !sameValue(canonical, farmops)) {
    return {
      classification: "THREE_WAY_CONFLICT",
      action: "conflict_do_not_apply",
      detail: "Canonical, FarmOps and field all disagree.",
    };
  }
  if (canonical !== null) {
    return {
      classification: "CANONICAL_DIFFERS_FROM_FIELD",
      action: "requires_review",
      detail: "The canonical engineering value differs from what the photograph shows.",
    };
  }
  return {
    classification: "FARMOPS_DIFFERS_FROM_FIELD",
    action: "propose_farmops_update",
    detail: "FarmOps differs from the field observation and the canonical dataset is silent.",
  };
}

const SUBPANEL_LABEL = /sub\s*-?\s*panel/i;

export function reconcileHousePanelObservations(input: ReconcileInput): ReconciliationRow[] {
  const canonical = input.canonical ?? {};
  const live = new Map<string, FarmOpsBreaker>();
  for (const b of input.farmops) live.set(`${b.panel_id}|${b.side}|${b.position}`, b);

  const rows: ReconciliationRow[] = [];

  for (const obs of input.parsed.observations) {
    const base = {
      key: obs.key,
      panel_source_name: obs.panel_source_name,
      panel_id: obs.panel_id,
      positions_text: obs.positions_text,
      positions: obs.positions,
      poles: obs.poles,
      side: obs.slot?.side ?? "",
      position: obs.slot?.position ?? null,
    };

    if (obs.identity_status === "unresolved") {
      rows.push({
        ...base,
        field: "label",
        field_label: "Panel identity",
        canonical_value: null,
        farmops_value: null,
        field_observed_text: obs.panel_source_name,
        field_interpreted: null,
        confidence: "unknown",
        verification_required: true,
        classification: "UNRESOLVED_PANEL_IDENTITY",
        proposed_action: "requires_review",
        detail: `"${obs.panel_source_name}" does not resolve to exactly one existing panel identity.`,
        provenance: obs.provenance,
      });
      continue;
    }
    if (obs.position_status === "unresolved" || !obs.slot) {
      rows.push({
        ...base,
        field: "label",
        field_label: "Circuit position",
        canonical_value: null,
        farmops_value: null,
        field_observed_text: obs.positions_text,
        field_interpreted: null,
        confidence: "unknown",
        verification_required: true,
        classification: "UNRESOLVED_CIRCUIT_POSITION",
        proposed_action: "requires_review",
        detail: `Positions "${obs.positions_text}" could not be resolved to physical panel slots.`,
        provenance: obs.provenance,
      });
      continue;
    }

    const slotKey = `${obs.panel_id}|${obs.slot.side}|${obs.slot.position}`;
    const liveRow = live.get(slotKey);
    const primaryBreaker = obs.positions[0];

    for (const f of obs.fields) {
      const canonicalValue = str(canonical[`${obs.panel_id}|${primaryBreaker}|${f.field}`] ?? null);
      const farmopsValue =
        liveRow == null
          ? null
          : f.field === "label"
            ? str(liveRow.label)
            : f.field === "poles"
              ? str(liveRow.poles)
              : str(liveRow.ocp_amps);
      const c = classify(f, canonicalValue, farmopsValue);
      const row: ReconciliationRow = {
        ...base,
        field: f.field,
        field_label: OBSERVED_FIELD_LABELS[f.field],
        canonical_value: canonicalValue,
        farmops_value: farmopsValue,
        field_observed_text: f.observed_text,
        field_interpreted: f.interpreted,
        confidence: f.confidence,
        verification_required: f.verification_required,
        classification: c.classification,
        proposed_action: c.action,
        detail: c.detail,
        provenance: f.provenance,
      };
      if (c.action === "propose_farmops_update" && f.interpreted !== null && liveRow) {
        row.target = {
          table: "electrical_breaker_positions",
          panel_id: obs.panel_id,
          side: obs.slot.side,
          position: obs.slot.position,
          column: f.field,
          expected_current: farmopsValue,
          proposed_value: f.interpreted,
        };
      } else if (c.action === "propose_farmops_update" && !liveRow) {
        row.proposed_action = "requires_review";
        row.detail = "No FarmOps breaker-position record exists for that slot yet; review before creating one.";
      }
      rows.push(row);
    }

    // Topology evidence: a main-panel breaker labelled SUB PANEL feeding a
    // second panel is evidence, not an instruction to mutate topology.
    const feederLabel = obs.fields.find((f) => f.field === "label" && SUBPANEL_LABEL.test(f.observed_text));
    if (feederLabel && obs.panel_id === "PNL-H1" && (obs.poles ?? 1) >= 2) {
      const currentParent = input.currentSubpanelParent ?? null;
      const evidence = `PNL-H1 positions ${obs.positions_text} — ${feederLabel.observed_text} — ${obs.poles}-pole ${
        obs.fields.find((f) => f.field === "ocp_amps")?.interpreted ?? "?"
      } A`;
      const already = currentParent === "PNL-H1";
      rows.push({
        ...base,
        panel_id: "PNL-H2",
        field: "parent_panel",
        field_label: "Upstream parent panel",
        canonical_value: null,
        farmops_value: currentParent,
        field_observed_text: feederLabel.observed_text,
        field_interpreted: "PNL-H1",
        confidence: "high",
        verification_required: false,
        classification: already ? "MATCH" : "TOPOLOGY_PROPOSAL",
        proposed_action: already ? "no_change" : "propose_topology_update",
        detail: already
          ? "The current service revision already represents SVC-HOUSE → PNL-H1 → PNL-H2."
          : "Field evidence supports PNL-H1 → 60 A feeder → PNL-H2 in the current as-built revision.",
        provenance: feederLabel.provenance,
        topology: already
          ? undefined
          : { panel_id: "PNL-H2", current_parent: currentParent, proposed_parent: "PNL-H1", evidence },
      });
    }
  }

  return rows;
}

// ------------------------------------------------------------------ reporting

export interface ReconciliationTotals {
  source_rows_parsed: number;
  logical_breakers: number;
  single_pole: number;
  multi_pole: number;
  matched_circuits: number;
  unresolved_observations: number;
  exact_matches: number;
  conflicts: number;
  verification_required: number;
  topology_proposals: number;
  eligible_farmops_updates: number;
}

export function reconciliationTotals(parsed: ParseResult, rows: ReconciliationRow[]): ReconciliationTotals {
  const breakers = parsed.observations;
  return {
    source_rows_parsed: parsed.rows_parsed,
    logical_breakers: breakers.length,
    single_pole: breakers.filter((b) => (b.poles ?? 1) === 1).length,
    multi_pole: breakers.filter((b) => (b.poles ?? 1) > 1).length,
    matched_circuits: rows.filter((r) => r.farmops_value !== null && r.field !== "parent_panel").length,
    unresolved_observations: rows.filter(
      (r) =>
        r.classification === "UNRESOLVED_PANEL_IDENTITY" ||
        r.classification === "UNRESOLVED_CIRCUIT_POSITION" ||
        r.classification === "FIELD_OBSERVATION_NEW" ||
        r.classification === "UNKNOWN_FIELD_VALUE",
    ).length,
    exact_matches: rows.filter((r) => r.classification === "MATCH").length,
    conflicts: rows.filter(
      (r) => r.classification === "THREE_WAY_CONFLICT" || r.classification === "CANONICAL_DIFFERS_FROM_FIELD",
    ).length,
    verification_required: rows.filter((r) => r.verification_required).length,
    topology_proposals: rows.filter((r) => r.classification === "TOPOLOGY_PROPOSAL").length,
    eligible_farmops_updates: rows.filter((r) => r.proposed_action === "propose_farmops_update" && r.target).length,
  };
}

const csvCell = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function fieldReconciliationCsv(rows: ReconciliationRow[]): string {
  const header = [
    "panel_source_name",
    "panel_id",
    "positions",
    "side",
    "position",
    "poles",
    "field",
    "canonical_engineering",
    "farmops_current",
    "field_observed_text",
    "field_interpreted",
    "confidence",
    "verification_required",
    "classification",
    "proposed_action",
    "detail",
    "workbook",
    "worksheet",
    "source_row",
    "source_column",
    "source_photo",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.panel_source_name,
      r.panel_id ?? "",
      r.positions_text,
      r.side,
      r.position ?? "",
      r.poles ?? "",
      r.field_label,
      r.canonical_value ?? "",
      r.farmops_value ?? "",
      r.field_observed_text,
      r.field_interpreted ?? "",
      r.confidence,
      r.verification_required,
      r.classification,
      r.proposed_action,
      r.detail,
      r.provenance.workbook,
      r.provenance.worksheet,
      r.provenance.source_row,
      r.provenance.source_column,
      r.provenance.source_photo,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function fieldReconciliationMarkdown(
  parsed: ParseResult,
  rows: ReconciliationRow[],
  generatedAt: string,
): string {
  const totals = reconciliationTotals(parsed, rows);
  const out: string[] = [
    "# Phase 4.4b — House Panel Field-Observation Reconciliation",
    "",
    "Photo-derived panel-directory evidence compared against the canonical",
    "engineering dataset and current FarmOps values. Field observation is",
    "evidence of the installed system, not authority: `SOR_AUTHORITY` remains",
    "`canonical_ods` and this report writes nothing.",
    "",
    `- Source workbook: ${parsed.workbook}`,
    `- Generated: ${generatedAt}`,
    "",
    "## Diagnostics",
    "",
    "| Metric | Count |",
    "| --- | --- |",
  ];
  for (const [k, v] of Object.entries(totals)) out.push(`| ${k.replace(/_/g, " ")} | ${v} |`);

  out.push(
    "",
    "## Observations",
    "",
    "| Panel | Position(s) | Field | Engineering / canonical | FarmOps | Field observed | Confidence | Classification | Proposed action |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of rows) {
    out.push(
      `| ${r.panel_id ?? r.panel_source_name} | ${r.positions_text || "(none)"} | ${r.field_label} | ${
        r.canonical_value ?? "(silent)"
      } | ${r.farmops_value ?? "(none)"} | ${r.field_observed_text || "(blank)"} | ${r.confidence} | ${
        r.classification
      } | ${r.proposed_action} |`,
    );
  }

  const topology = rows.filter((r) => r.topology);
  out.push("", "## Topology proposals", "");
  if (!topology.length) out.push("None.");
  else {
    for (const r of topology) {
      out.push(
        `- ${r.topology!.panel_id}: current parent ${r.topology!.current_parent ?? "(not represented)"} → proposed parent ${
          r.topology!.proposed_parent
        }; evidence: ${r.topology!.evidence}`,
      );
    }
  }

  if (parsed.warnings.length) {
    out.push("", "## Parser warnings", "");
    for (const w of parsed.warnings) out.push(`- ${w}`);
  }

  out.push(
    "",
    "## Guarantees",
    "",
    "- Preview performed no database writes.",
    "- The canonical ODS was not written.",
    "- The proposed future 400 A House revision was not modified.",
    "- Phase 4.4a semantic-loss protections (LOSS = 0) are untouched: no `ods_extras` value was changed.",
    "- Verbatim observed text is retained beside every interpretation.",
  );
  return out.join("\n");
}
