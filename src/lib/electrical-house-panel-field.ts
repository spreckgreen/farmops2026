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

/** Workbook panel name → existing Farm Shop panel identity. Never renames. */
export const FARM_SHOP_PANEL_ALIASES: Record<string, string> = {
  "FARM SHOP NE": "PNL-FS-NE",
  "FARM-SHOP-NE": "PNL-FS-NE",
  "SHOP NE": "PNL-FS-NE",
  "FS NE": "PNL-FS-NE",
  "FARM SHOP NW": "PNL-FS-NW",
  "FARM-SHOP-NW": "PNL-FS-NW",
  "SHOP NW": "PNL-FS-NW",
  "FS NW": "PNL-FS-NW",
  "FARM SHOP EQUIPMENT": "PNL-FS-EQ",
  "FARM-SHOP-EQUIPMENT": "PNL-FS-EQ",
  "SHOP EQUIPMENT": "PNL-FS-EQ",
  "FS EQ": "PNL-FS-EQ",
  "FARM SHOP CRITICAL": "PNL-FS-CRIT",
  "FARM-SHOP-CRITICAL": "PNL-FS-CRIT",
  "SHOP CRITICAL": "PNL-FS-CRIT",
  "FS CRIT": "PNL-FS-CRIT",
};

/**
 * A reconciliation scope is only naming + topology candidates: the evidence
 * model, comparison states, provenance and apply path are identical for every
 * scope so House and Farm Shop photos are reconciled the same way.
 */
export interface FieldReconciliationScope {
  id: "house" | "farm_shop";
  label: string;
  /** Building/area wording used in report and UI copy. */
  area: string;
  csv_name: string;
  markdown_name: string;
  aliases: Record<string, string>;
  /** Panel name inferred from a worksheet name when a sheet has no panel column. */
  sheet_panel_hints: { pattern: RegExp; panel_source_name: string }[];
  /**
   * Sub-panel feeder candidates. A labelled multi-pole breaker in `parent` is
   * evidence that one of `candidates` is fed from it — never an instruction, and
   * never resolved by guessing when more than one candidate matches.
   */
  subpanel_feeds: {
    parent: string;
    candidates: { child: string; pattern: RegExp }[];
  }[];
}

export const HOUSE_SCOPE: FieldReconciliationScope = {
  id: "house",
  label: "House panel",
  area: "House",
  csv_name: FIELD_RECONCILIATION_CSV,
  markdown_name: "phase-4.4b-house-panel-field-reconciliation.md",
  aliases: HOUSE_PANEL_ALIASES,
  sheet_panel_hints: [
    { pattern: /sub/i, panel_source_name: "HOUSE-SUBPANEL" },
    { pattern: /main/i, panel_source_name: "HOUSE-MAIN" },
  ],
  subpanel_feeds: [
    { parent: "PNL-H1", candidates: [{ child: "PNL-H2", pattern: /sub\s*-?\s*panel/i }] },
  ],
};

export const FARM_SHOP_SCOPE: FieldReconciliationScope = {
  id: "farm_shop",
  label: "Farm Shop panel",
  area: "Farm Shop",
  csv_name: "phase-4.4b-farm-shop-panel-field-reconciliation.csv",
  markdown_name: "phase-4.4b-farm-shop-panel-field-reconciliation.md",
  aliases: FARM_SHOP_PANEL_ALIASES,
  sheet_panel_hints: [
    { pattern: /crit/i, panel_source_name: "FARM SHOP CRITICAL" },
    { pattern: /\beq\b|equip/i, panel_source_name: "FARM SHOP EQUIPMENT" },
    { pattern: /\bne\b|north\s*east/i, panel_source_name: "FARM SHOP NE" },
    { pattern: /\bnw\b|north\s*west|west/i, panel_source_name: "FARM SHOP NW" },
  ],
  subpanel_feeds: [
    {
      parent: "PNL-FS-NW",
      candidates: [
        { child: "PNL-FS-CRIT", pattern: /crit|transfer|microgrid|backup/i },
        { child: "PNL-FS-EQ", pattern: /equip|machine|\beq\b/i },
      ],
    },
    {
      parent: "PNL-FS-NE",
      candidates: [
        { child: "PNL-FS-EQ", pattern: /equip|machine|\beq\b/i },
        { child: "PNL-FS-CRIT", pattern: /crit|transfer|microgrid|backup/i },
      ],
    },
  ],
};

export const FIELD_RECONCILIATION_SCOPES = {
  house: HOUSE_SCOPE,
  farm_shop: FARM_SHOP_SCOPE,
} as const satisfies Record<string, FieldReconciliationScope>;

export type FieldReconciliationScopeId = keyof typeof FIELD_RECONCILIATION_SCOPES;

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
  "SOURCE_EVIDENCE_CONFLICT",
  "TOPOLOGY_PROPOSAL",
  "TOPOLOGY_AMBIGUOUS",

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

/**
 * One reconcilable attribute observed on a panel-directory photograph.
 *
 * `ocp_amps`, `poles` and `label` are the only attributes FarmOps stores on a
 * breaker position. `notes`, `photo` and `other` are evidence-only: they are
 * emitted (never dropped) but they are never proposed as FarmOps updates.
 */
export type ObservedFieldKey = "ocp_amps" | "poles" | "label" | "notes" | "photo" | "other";

export const COMPARABLE_FIELDS: ObservedFieldKey[] = ["ocp_amps", "poles", "label"];

export const OBSERVED_FIELD_LABELS: Record<ObservedFieldKey, string> = {
  ocp_amps: "Breaker amps",
  poles: "Poles",
  label: "Directory description",
  notes: "Notes",
  photo: "Photo reference",
  other: "Other transcription field",
};

/** Why a comparison value is absent — these are NOT the same state. */
export type ComparisonState = "present" | "blank" | "record_absent" | "no_mapping";

export interface ObservedField {
  field: ObservedFieldKey;
  /** Header text as transcribed, used verbatim for evidence-only columns. */
  field_label?: string;
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
  /**
   * Other source representations of this same logical breaker (e.g. the same
   * schedule transcribed on both Bulk_Update and House_Main). Suppressed for
   * counting, never discarded: their provenance is kept here.
   */
  duplicate_sources: ObservationProvenance[];
  /** Positions merged in from continuation rows of a multi-pole breaker. */
  merged_positions_from: ObservationProvenance[];
}

/** Where two source representations of the same breaker disagree. */
export interface SourceEvidenceConflict {
  panel_id: string | null;
  panel_source_name: string;
  positions_text: string;
  field: ObservedFieldKey;
  field_label: string;
  kept_text: string;
  kept: ObservationProvenance;
  other_text: string;
  other: ObservationProvenance;
}

export interface ParseDiagnostics {
  sheets_seen: number;
  sheets_recognized: number;
  sheets_skipped: { worksheet: string; reason: string }[];
  /** Non-empty data rows read across all recognized sheets. */
  source_rows_read: number;
  /** Rows suppressed because another sheet held the same logical breaker. */
  duplicate_source_rows_suppressed: number;
  /** Rows folded into a preceding multi-pole breaker as continuation slots. */
  multipole_continuation_rows_merged: number;
  unique_logical_breakers: number;
  field_observations_emitted: number;
}

export interface ParseResult {
  workbook: string;
  rows_parsed: number;
  observations: BreakerObservation[];
  diagnostics: ParseDiagnostics;
  conflicts: SourceEvidenceConflict[];
  warnings: string[];
}


// --------------------------------------------------------------- header logic

const HEADER_SYNONYMS: Record<string, string[]> = {
  panel: ["panel", "panel name", "panel id", "panelboard", "source panel", "panel ref", "board"],
  circuit: [
    "circuit",
    "circuits",
    "circuit #",
    "circuit no",
    "circuit number",
    "ckt",
    "ckt #",
    "position",
    "positions",
    "slot",
    "slots",
    "breaker",
    "breaker #",
    "breaker no",
    "breaker number",
    "space",
    "spaces",
  ],
  poles: ["poles", "pole", "pole count", "no of poles", "number of poles", "pole qty"],
  amps: [
    "amps",
    "breaker amps",
    "amp",
    "amperage",
    "rating",
    "breaker size",
    "breaker rating",
    "size",
    "ocp",
    "ocp amps",
    "trip",
    "trip rating",
    "a",
  ],
  description: [
    "description",
    "load",
    "load description",
    "label",
    "circuit description",
    "directory",
    "directory text",
    "served",
    "serves",
    "load served",
    "device",
    "usage",
  ],
  notes: ["notes", "note", "comment", "comments", "remarks"],
  photo: ["photo", "source photo", "image", "file", "photo reference", "picture", "photo file"],
  confidence: ["confidence"],
  verification: ["verification", "verification status", "verified"],
};

/** Normalize a header cell: underscores, punctuation and case are irrelevant. */
const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_.]+/g, " ")
    .replace(/[()\[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function headerRole(cell: string): string | null {
  const n = norm(cell);
  if (!n) return null;
  for (const [role, list] of Object.entries(HEADER_SYNONYMS)) {
    if (list.includes(n)) return role;
  }
  for (const [role, list] of Object.entries(HEADER_SYNONYMS)) {
    if (list.some((h) => h.length > 2 && (n.startsWith(`${h} `) || n.endsWith(` ${h}`)))) return role;
  }
  return null;
}


interface HeaderMap {
  index: number;
  roles: Map<string, number>;
  headers: string[];
  /** Populated columns with a header that maps to no known role. */
  unmapped: number[];
}

/**
 * Find the header row of a transcription sheet.
 *
 * The BEST scoring row in the scanned window wins, not the first row that
 * happens to yield two roles: picking the first weak match is exactly how a
 * sheet ends up reconciling only `Poles`.
 */
export function findHeaderRow(sheet: Sheet): HeaderMap | null {
  const limit = Math.min(sheet.rows.length, 15);
  let best: HeaderMap | null = null;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const row = sheet.rows[i] ?? [];
    const roles = new Map<string, number>();
    const unmapped: number[] = [];
    row.forEach((cell, col) => {
      const role = headerRole(cell);
      if (role && !roles.has(role)) roles.set(role, col);
      else if (!role && String(cell ?? "").trim() !== "") unmapped.push(col);
    });
    if (!roles.has("circuit")) continue;
    if (!roles.has("amps") && !roles.has("description") && !roles.has("poles")) continue;
    const score = roles.size;
    if (score > bestScore) {
      bestScore = score;
      best = { index: i, roles, headers: row.map((c) => String(c ?? "").trim()), unmapped };
    }
  }
  return best;
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
  /** Worksheet-name → panel-name hints; defaults to the House scope hints. */
  sheetPanelHints?: { pattern: RegExp; panel_source_name: string }[];
}


interface RawRow {
  sheet: string;
  /** Higher wins when two sheets describe the same breaker. */
  precedence: number;
  source_row: number;
  panel_source_name: string;
  panel_id: string | null;
  positions: number[];
  positions_text: string;
  poles: number | null;
  poles_stated: number | null;
  amps_text: string;
  description_text: string;
  notes: string;
  fields: ObservedField[];
  provenance: ObservationProvenance;
  merged_positions_from: ObservationProvenance[];
  consumed: boolean;
}

/** Bulk sheets are treated as the lower-precedence representation. */
function sheetPrecedence(name: string): number {
  return /bulk/i.test(name) ? 0 : 1;
}

const eq = (a: string, b: string) => norm(a) === norm(b);

/** Parse transcription sheets into deduplicated logical breaker observations. */
export function parseHousePanelSheets(sheets: Sheet[], opts: ParseOptions): ParseResult {
  const warnings: string[] = [];
  const skipped: { worksheet: string; reason: string }[] = [];
  const raw: RawRow[] = [];
  let rowsRead = 0;
  let recognized = 0;

  for (const sheet of sheets) {
    const header = findHeaderRow(sheet);
    if (!header) {
      const reason = sheet.rows.length
        ? "no recognizable panel-directory header row"
        : "sheet is empty";
      skipped.push({ worksheet: sheet.name, reason });
      warnings.push(`Sheet "${sheet.name}" skipped: ${reason}.`);

      continue;
    }
    recognized++;
    const col = (role: string) => header.roles.get(role);
    const cell = (row: string[], role: string) => {
      const i = col(role);
      return i === undefined ? "" : String(row[i] ?? "").trim();
    };
    const headerName = (role: string) => {
      const i = col(role);
      return i === undefined ? "" : (header.headers[i] ?? "");
    };
    const hints = opts.sheetPanelHints ?? HOUSE_SCOPE.sheet_panel_hints;
    const sheetPanelName =
      hints.find((h) => h.pattern.test(sheet.name))?.panel_source_name ??
      (opts.defaultPanelName ?? "");


    for (let r = header.index + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      if (row.every((c) => String(c ?? "").trim() === "")) continue;
      rowsRead++;
      const sourceRow = r + 1;
      const panelSourceName = cell(row, "panel") || sheetPanelName;
      const panelId = resolvePanelIdentity(panelSourceName, opts.aliases, opts.knownPanelIds);
      const positionsText = cell(row, "circuit");
      const positions = parsePositions(positionsText);
      const polesText = cell(row, "poles");
      const polesStated = /^\d{1,2}$/.test(polesText) ? Number(polesText) : null;
      const photo = cell(row, "photo");
      const notes = cell(row, "notes");
      const ampsText = cell(row, "amps");
      const descriptionText = cell(row, "description");

      const prov = (column: string, observed: string): ObservationProvenance => ({
        workbook: opts.workbook,
        worksheet: sheet.name,
        source_row: sourceRow,
        source_column: column,
        source_photo: photo,
        observed_text: observed,
      });

      // Every populated transcription cell becomes its own observation, with the
      // real source column preserved. Poles is one field among several, never
      // the only reconciled field.
      const fields: ObservedField[] = [];
      if (ampsText !== "") {
        const parsed = interpretAmps(ampsText);
        fields.push({
          field: "ocp_amps",
          observed_text: ampsText,
          interpreted: parsed.interpreted,
          confidence: parsed.confidence,
          verification_required: parsed.verification_required,
          unknown_value: parsed.unknown_value,
          provenance: prov(headerName("amps") || "Breaker Amps", ampsText),
        });
      }
      if (descriptionText !== "") {
        const parsed = interpretDescription(descriptionText);
        fields.push({
          field: "label",
          observed_text: descriptionText,
          interpreted: parsed.interpreted,
          confidence: parsed.confidence,
          verification_required: parsed.verification_required,
          unknown_value: parsed.unknown_value,
          provenance: prov(headerName("description") || "Description", descriptionText),
        });
      }
      if (notes !== "") {
        const uncertain = isUncertainText(notes) || isUnknownText(notes);
        fields.push({
          field: "notes",
          observed_text: notes,
          interpreted: notes,
          confidence: uncertain ? "low" : "medium",
          verification_required: uncertain,
          unknown_value: false,
          provenance: prov(headerName("notes") || "Notes", notes),
        });
      }
      if (photo !== "") {
        fields.push({
          field: "photo",
          observed_text: photo,
          interpreted: photo,
          confidence: "high",
          verification_required: false,
          unknown_value: false,
          provenance: prov(headerName("photo") || "Photo", photo),
        });
      }
      for (const c of header.unmapped) {
        const text = String(row[c] ?? "").trim();
        if (text === "") continue;
        const columnName = header.headers[c] || `Column ${c + 1}`;
        fields.push({
          field: "other",
          field_label: columnName,
          observed_text: text,
          interpreted: text,
          confidence: "medium",
          verification_required: isUncertainText(text) || isUnknownText(text),
          unknown_value: false,
          provenance: prov(columnName, text),
        });
      }

      raw.push({
        sheet: sheet.name,
        precedence: sheetPrecedence(sheet.name),
        source_row: sourceRow,
        panel_source_name: panelSourceName,
        panel_id: panelId,
        positions,
        positions_text: positionsText,
        poles: polesStated ?? (positions.length > 1 ? positions.length : positions.length ? 1 : null),
        poles_stated: polesStated,
        amps_text: ampsText,
        description_text: descriptionText,
        notes,
        fields,
        provenance: prov(headerName("circuit") || "Circuit", positionsText),
        merged_positions_from: [],
        consumed: false,
      });
    }
  }

  // ------------------------------------------- multi-pole continuation merging
  //
  // `Poles = 2` on a row listing a single position does not describe a
  // two-pole breaker per position: the paired position is normally transcribed
  // on its own row. Fold that continuation row into ONE logical breaker so a
  // 2-pole 60 A feeder is never counted twice.
  let merged = 0;
  for (const r of raw) {
    if (r.consumed) continue;
    const poles = r.poles_stated ?? 0;
    if (poles < 2 || r.positions.length !== 1) continue;
    for (let k = 1; k < poles; k++) {
      const wanted = r.positions[0] + 2 * k;
      const cont = raw.find(
        (o) =>
          !o.consumed &&
          o !== r &&
          o.sheet === r.sheet &&
          eq(o.panel_source_name, r.panel_source_name) &&
          o.positions.length === 1 &&
          o.positions[0] === wanted &&
          (o.description_text === "" || eq(o.description_text, r.description_text)) &&
          (o.amps_text === "" || eq(o.amps_text, r.amps_text)),
      );
      if (!cont) break;
      cont.consumed = true;
      merged++;
      r.positions.push(wanted);
      r.merged_positions_from.push(cont.provenance);
    }
    if (r.positions.length > 1) r.positions_text = r.positions.join("/");
  }

  // ------------------------------------------------- cross-sheet deduplication
  const identity = (r: RawRow) =>
    `${(r.panel_id ?? r.panel_source_name).toUpperCase()}|${[...r.positions].sort((a, b) => a - b).join("-") || r.positions_text.toUpperCase()}`;

  const kept = new Map<string, RawRow>();
  const suppressed: { kept: RawRow; other: RawRow }[] = [];
  for (const r of raw) {
    if (r.consumed) continue;
    const id = identity(r);
    const existing = kept.get(id);
    if (!existing) {
      kept.set(id, r);
      continue;
    }
    // Deterministic precedence: panel-specific sheet wins over bulk; ties keep
    // the first representation read.
    if (r.precedence > existing.precedence) {
      kept.set(id, r);
      suppressed.push({ kept: r, other: existing });
    } else {
      suppressed.push({ kept: existing, other: r });
    }
  }

  const conflicts: SourceEvidenceConflict[] = [];
  for (const { kept: k, other } of suppressed) {
    for (const f of other.fields) {
      if (!COMPARABLE_FIELDS.includes(f.field)) continue;
      const mine = k.fields.find((x) => x.field === f.field);
      if (!mine) continue;
      if (eq(mine.observed_text, f.observed_text)) continue;
      conflicts.push({
        panel_id: k.panel_id,
        panel_source_name: k.panel_source_name,
        positions_text: k.positions_text,
        field: f.field,
        field_label: OBSERVED_FIELD_LABELS[f.field],
        kept_text: mine.observed_text,
        kept: mine.provenance,
        other_text: f.observed_text,
        other: f.provenance,
      });
    }
  }

  const observations: BreakerObservation[] = [];
  for (const r of kept.values()) {
    const dupes = suppressed.filter((s) => s.kept === r).map((s) => s.other.provenance);
    if (r.poles !== null) {
      r.fields.unshift({
        field: "poles",
        observed_text: r.poles_stated !== null ? String(r.poles_stated) : r.positions_text,
        interpreted: r.poles,
        confidence: r.poles_stated !== null || r.positions.length ? "high" : "low",
        verification_required: false,
        unknown_value: false,
        provenance: {
          ...r.provenance,
          source_column: r.poles_stated !== null ? "Poles" : r.provenance.source_column,
          observed_text: r.poles_stated !== null ? String(r.poles_stated) : r.positions_text,
        },
      });
    }
    observations.push({
      key: `${r.sheet}#${r.source_row}`,
      panel_source_name: r.panel_source_name,
      panel_id: r.panel_id,
      identity_status: r.panel_id ? "resolved" : "unresolved",
      positions: r.positions,
      positions_text: r.positions_text,
      poles: r.poles,
      slot: r.positions.length ? slotForBreakerNumber(r.positions[0]) : null,
      position_status: r.positions.length ? "resolved" : "unresolved",
      fields: r.fields,
      notes: r.notes,
      provenance: r.provenance,
      duplicate_sources: dupes,
      merged_positions_from: r.merged_positions_from,
    });
  }

  if (suppressed.length) {
    warnings.push(
      `${suppressed.length} duplicate source representation(s) suppressed: the same panel and positions appeared on more than one sheet. Provenance of every representation is retained.`,
    );
  }
  if (conflicts.length) {
    warnings.push(
      `${conflicts.length} source-evidence conflict(s): two sheets disagree about the same breaker. Neither value was silently chosen.`,
    );
  }

  const diagnostics: ParseDiagnostics = {
    sheets_seen: sheets.length,
    sheets_recognized: recognized,
    sheets_skipped: skipped,
    source_rows_read: rowsRead,
    duplicate_source_rows_suppressed: suppressed.length,
    multipole_continuation_rows_merged: merged,
    unique_logical_breakers: observations.length,
    field_observations_emitted: observations.reduce((n, o) => n + o.fields.length, 0),
  };

  return {
    workbook: opts.workbook,
    rows_parsed: rowsRead,
    observations,
    diagnostics,
    conflicts,
    warnings,
  };
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
  /**
   * Why canonical / FarmOps is absent. `(silent)` is not one state: a missing
   * mapping, a missing record and a blank stored value are different findings.
   */
  canonical_state: ComparisonState;
  farmops_state: ComparisonState;
  /** Provenance of any other source sheet describing the same breaker. */
  duplicate_sources?: ObservationProvenance[];

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
  /**
   * Panels for which the canonical capture contained ANY circuit-level
   * attribute. Lets a blank comparison be reported as "no canonical mapping for
   * this panel" instead of a bare `(silent)`.
   */
  canonicalPanels?: string[];
  /** Naming + topology candidates for the area being reconciled. */
  scope?: FieldReconciliationScope;
  /** Current-revision parent of PNL-H2 (House scope shorthand). */
  currentSubpanelParent?: string | null;
  /**
   * Current-revision parent of each candidate sub-panel, keyed by panel id
   * (e.g. `{ "PNL-FS-CRIT": "PNL-FS-NW" }`). Absent key = not represented.
   */
  currentParents?: Record<string, string | null>;
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
  const scope = input.scope ?? HOUSE_SCOPE;
  const currentParents: Record<string, string | null> = { ...(input.currentParents ?? {}) };
  if (input.currentSubpanelParent !== undefined && currentParents["PNL-H2"] === undefined) {
    currentParents["PNL-H2"] = input.currentSubpanelParent;
  }
  const canonical = input.canonical ?? {};
  const canonicalPanels = new Set(
    input.canonicalPanels ?? [...new Set(Object.keys(canonical).map((k) => k.split("|")[0]))],
  );

  const live = new Map<string, FarmOpsBreaker>();
  const farmopsPanels = new Set<string>();
  for (const b of input.farmops) {
    live.set(`${b.panel_id}|${b.side}|${b.position}`, b);
    farmopsPanels.add(b.panel_id);
  }

  const rows: ReconciliationRow[] = [];

  // Source-evidence conflicts are reported first, and never resolved silently.
  for (const c of input.parsed.conflicts) {
    rows.push({
      key: `conflict#${c.panel_id ?? c.panel_source_name}#${c.positions_text}#${c.field}`,
      panel_source_name: c.panel_source_name,
      panel_id: c.panel_id,
      positions_text: c.positions_text,
      positions: [],
      poles: null,
      side: "",
      position: null,
      field: c.field,
      field_label: `${c.field_label} (source conflict)`,
      canonical_value: null,
      farmops_value: null,
      field_observed_text: `${c.kept_text} (${c.kept.worksheet}) vs ${c.other_text} (${c.other.worksheet})`,
      field_interpreted: null,
      confidence: "low",
      verification_required: true,
      classification: "SOURCE_EVIDENCE_CONFLICT",
      proposed_action: "requires_review",
      detail: `Two source representations disagree about ${c.field_label}; neither was chosen.`,
      provenance: c.kept,
      canonical_state: "no_mapping",
      farmops_state: "no_mapping",
      duplicate_sources: [c.other],
    });
  }

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
      duplicate_sources: obs.duplicate_sources.length ? obs.duplicate_sources : undefined,
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
        canonical_state: "no_mapping",
        farmops_state: "no_mapping",
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
        canonical_state: "no_mapping",
        farmops_state: "no_mapping",
      });
      continue;
    }

    const slotKey = `${obs.panel_id}|${obs.slot.side}|${obs.slot.position}`;
    const liveRow = live.get(slotKey);
    const primaryBreaker = obs.positions[0];
    const panelHasFarmOpsRows = farmopsPanels.has(String(obs.panel_id));

    for (const f of obs.fields) {
      const comparable = COMPARABLE_FIELDS.includes(f.field);

      // ------------------------------------------------ canonical comparison
      const canonicalKey = `${obs.panel_id}|${primaryBreaker}|${f.field}`;
      const canonicalRaw = comparable ? (canonical[canonicalKey] ?? null) : null;
      const canonicalValue = str(canonicalRaw);
      const canonical_state: ComparisonState = !comparable
        ? "no_mapping"
        : canonicalValue !== null
          ? "present"
          : canonicalRaw !== null
            ? "blank"
            : canonicalPanels.has(String(obs.panel_id))
              ? "record_absent"
              : "no_mapping";

      // -------------------------------------------------- FarmOps comparison
      const farmopsRaw = !comparable
        ? null
        : liveRow == null
          ? null
          : f.field === "label"
            ? liveRow.label
            : f.field === "poles"
              ? liveRow.poles
              : liveRow.ocp_amps;
      const farmopsValue = str(farmopsRaw);
      const farmops_state: ComparisonState = !comparable
        ? "no_mapping"
        : liveRow == null
          ? "record_absent"
          : farmopsValue === null
            ? "blank"
            : "present";

      if (!comparable) {
        // Notes, photo references and other transcription columns are evidence
        // only: FarmOps stores no equivalent, so nothing may be proposed.
        rows.push({
          ...base,
          field: f.field,
          field_label: f.field_label || OBSERVED_FIELD_LABELS[f.field],
          canonical_value: null,
          farmops_value: null,
          field_observed_text: f.observed_text,
          field_interpreted: f.interpreted,
          confidence: f.confidence,
          verification_required: f.verification_required,
          classification: "FIELD_OBSERVATION_NEW",
          proposed_action: "preserve_observation_only",
          detail: "Evidence-only transcription field; FarmOps holds no equivalent attribute.",
          provenance: f.provenance,
          canonical_state,
          farmops_state,
        });
        continue;
      }

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
        canonical_state,
        farmops_state,
      };
      if (c.action === "propose_farmops_update" && f.interpreted !== null && liveRow) {
        row.target = {
          table: "electrical_breaker_positions",
          panel_id: String(obs.panel_id),
          side: obs.slot.side,
          position: obs.slot.position,
          column: f.field,
          expected_current: farmopsValue,
          proposed_value: f.interpreted,
        };
      } else if (c.action === "propose_farmops_update" && !liveRow) {
        row.proposed_action = "requires_review";
        row.detail = panelHasFarmOpsRows
          ? `FarmOps has breaker positions for ${obs.panel_id} but none at ${obs.slot.side} ${obs.slot.position}; creating one is a separate previewable proposal.`
          : `FarmOps holds no breaker-position records at all for ${obs.panel_id} — a dataset state, not a parse failure. Creating them is a separate previewable proposal.`;
      }
      rows.push(row);
    }

    // Topology evidence: a parent-panel breaker labelled as feeding another
    // panel is evidence, not an instruction to mutate topology. When more than
    // one candidate sub-panel matches, the ambiguity is reported, never guessed.
    const feed = scope.subpanel_feeds.find((f) => f.parent === obs.panel_id);
    const feederLabel = obs.fields.find(
      (f) =>
        f.field === "label" &&
        (SUBPANEL_LABEL.test(f.observed_text) ||
          (feed?.candidates ?? []).some((c) => c.pattern.test(f.observed_text))),
    );
    if (feed && feederLabel && (obs.poles ?? 1) >= 2) {
      const parent = feed.parent;
      const amps = obs.fields.find((f) => f.field === "ocp_amps")?.interpreted ?? "?";
      const evidence = `${parent} positions ${obs.positions_text} — ${feederLabel.observed_text} — ${obs.poles}-pole ${amps} A`;
      const named = feed.candidates.filter((c) => c.pattern.test(feederLabel.observed_text));
      const child =
        named.length === 1
          ? named[0].child
          : named.length === 0 && feed.candidates.length === 1
            ? feed.candidates[0].child
            : null;

      if (!child) {
        rows.push({
          ...base,
          field: "parent_panel",
          field_label: "Upstream parent panel",
          canonical_value: null,
          farmops_value: null,
          field_observed_text: feederLabel.observed_text,
          field_interpreted: parent,
          confidence: "low",
          verification_required: true,
          classification: "TOPOLOGY_AMBIGUOUS",
          proposed_action: "requires_review",
          detail: `Field evidence (${evidence}) shows a sub-panel feeder from ${parent}, but it matches more than one candidate sub-panel (${feed.candidates
            .map((c) => c.child)
            .join(", ")}). No topology change is proposed; identify the fed panel in the field.`,
          provenance: feederLabel.provenance,
          canonical_state: "no_mapping",
          farmops_state: "no_mapping",
        });
      } else {
        const currentParent = currentParents[child] ?? null;
        const already = currentParent === parent;
        rows.push({
          ...base,
          panel_id: child,
          field: "parent_panel",
          field_label: "Upstream parent panel",
          canonical_value: null,
          farmops_value: currentParent,
          field_observed_text: feederLabel.observed_text,
          field_interpreted: parent,
          confidence: "high",
          verification_required: false,
          classification: already ? "MATCH" : "TOPOLOGY_PROPOSAL",
          proposed_action: already ? "no_change" : "propose_topology_update",
          detail: already
            ? `No topology proposal is required: the current service revision already represents ${parent} → ${child}, and this evidence (${evidence}) confirms it.`
            : `Field evidence (${evidence}) supports ${parent} → ${child} in the current as-built revision.`,
          provenance: feederLabel.provenance,
          canonical_state: "no_mapping",
          farmops_state: currentParent === null ? "record_absent" : "present",
          topology: already
            ? undefined
            : { panel_id: child, current_parent: currentParent, proposed_parent: parent, evidence },
        });
      }
    }

  }

  return rows;
}


// ------------------------------------------------------------------ reporting

export interface ReconciliationTotals {
  /** Non-empty spreadsheet rows read. NOT the breaker count. */
  source_rows_read: number;
  duplicate_source_rows_suppressed: number;
  multipole_continuation_rows_merged: number;
  unique_logical_breakers: number;
  field_observations_emitted: number;
  sheets_recognized: number;
  sheets_skipped: number;
  single_pole: number;
  multi_pole: number;
  fields_compared_against_farmops: number;
  farmops_record_absent: number;
  canonical_no_mapping: number;
  canonical_record_absent: number;
  canonical_present: number;
  source_evidence_conflicts: number;
  unresolved_observations: number;
  exact_matches: number;
  conflicts: number;
  verification_required: number;
  topology_evidence_rows: number;
  topology_proposals: number;
  /** Sub-panel feeder evidence that matched more than one candidate panel. */
  topology_ambiguous: number;

  eligible_farmops_updates: number;
}

export function reconciliationTotals(parsed: ParseResult, rows: ReconciliationRow[]): ReconciliationTotals {
  const breakers = parsed.observations;
  const d = parsed.diagnostics;
  return {
    source_rows_read: d.source_rows_read,
    duplicate_source_rows_suppressed: d.duplicate_source_rows_suppressed,
    multipole_continuation_rows_merged: d.multipole_continuation_rows_merged,
    unique_logical_breakers: d.unique_logical_breakers,
    field_observations_emitted: d.field_observations_emitted,
    sheets_recognized: d.sheets_recognized,
    sheets_skipped: d.sheets_skipped.length,
    single_pole: breakers.filter((b) => (b.poles ?? 1) === 1).length,
    multi_pole: breakers.filter((b) => (b.poles ?? 1) > 1).length,
    fields_compared_against_farmops: rows.filter((r) => r.farmops_state === "present").length,
    farmops_record_absent: rows.filter((r) => r.farmops_state === "record_absent").length,
    canonical_no_mapping: rows.filter((r) => r.canonical_state === "no_mapping").length,
    canonical_record_absent: rows.filter((r) => r.canonical_state === "record_absent").length,
    canonical_present: rows.filter((r) => r.canonical_state === "present").length,
    source_evidence_conflicts: rows.filter((r) => r.classification === "SOURCE_EVIDENCE_CONFLICT").length,
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
    topology_evidence_rows: rows.filter((r) => r.field === "parent_panel").length,
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
    "canonical_state",
    "farmops_current",
    "farmops_state",
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
    "duplicate_source_worksheets",
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
      r.canonical_state,
      r.farmops_value ?? "",
      r.farmops_state,
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
      (r.duplicate_sources ?? []).map((d) => `${d.worksheet}:${d.source_row}`).join(" | "),
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
    "`source rows read` counts spreadsheet rows, not breakers: continuation rows",
    "of multi-pole breakers and duplicate representations of the same breaker on",
    "another sheet are collapsed into `unique logical breakers`.",
  );

  if (parsed.diagnostics.sheets_skipped.length) {
    out.push("", "### Sheets not parsed", "", "| Worksheet | Reason |", "| --- | --- |");
    for (const s of parsed.diagnostics.sheets_skipped) out.push(`| ${s.worksheet} | ${s.reason} |`);
  }

  out.push(
    "",
    "## Observations",
    "",
    "| Panel | Position(s) | Field | Engineering / canonical | FarmOps | Field observed | Confidence | Classification | Proposed action |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  const state = (value: string | null, s: ComparisonState) =>
    value !== null
      ? value
      : s === "blank"
        ? "(stored blank)"
        : s === "record_absent"
          ? "(no record)"
          : "(no mapping)";
  for (const r of rows) {
    out.push(
      `| ${r.panel_id ?? r.panel_source_name} | ${r.positions_text || "(none)"} | ${r.field_label} | ${state(
        r.canonical_value,
        r.canonical_state,
      )} | ${state(r.farmops_value, r.farmops_state)} | ${r.field_observed_text || "(blank)"} | ${r.confidence} | ${
        r.classification
      } | ${r.proposed_action} |`,
    );
  }

  const topology = rows.filter((r) => r.topology);
  const topologyEvidence = rows.filter((r) => r.field === "parent_panel");
  out.push("", "## Topology", "");
  if (!topologyEvidence.length) out.push("No sub-panel feeder evidence was observed.");
  for (const r of topologyEvidence) {
    if (r.topology) {
      out.push(
        `- PROPOSAL — ${r.topology.panel_id}: current parent ${r.topology.current_parent ?? "(not represented)"} → proposed parent ${
          r.topology.proposed_parent
        }; evidence: ${r.topology.evidence}`,
      );
    } else {
      out.push(`- ALREADY CORRECT — ${r.detail}`);
    }
  }
  if (topologyEvidence.length && !topology.length) {
    out.push(
      "",
      "Topology was evaluated and required no change; the absence of a proposal is a result, not a gap.",
    );
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
