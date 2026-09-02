// Farm Shop grid-reference migration — pure, preview-only logic.
//
// Authority split, applied literally:
//   * canonical Load_Master stable IDs + Grid values = the population to migrate;
//   * the PREVIOUS Farm Shop grid drawing = how an old label is interpreted
//     (documented convention: A6 is the NE corner, letters A–G run north→south
//     across the 40' depth, numbers 1–6 run west→east across the 60' length);
//   * the CORRECTED Farm Shop drawing = the authority for the new grid
//     (rows A–F at 0/8/16/24/32/40 ft from the north wall, columns 1–9 at
//     0/8/16/24/32/40/48/56/60 ft from the west wall, north up).
//
// Physical positions are remapped, never label strings: an old label is decoded
// to feet inside the 40' x 60' envelope and the nearest corrected gridline is
// taken. Nothing here writes, and nothing infers a location from FarmOps
// contents, amps, VA, or panel names.

export const GRID_MIGRATION_VERSION = "farm-shop-grid-migration-preview-1";

/** Corrected drawing envelope, in feet. */
export const SHOP_WIDTH_FT = 60; // west → east
export const SHOP_DEPTH_FT = 40; // north → south

/* ------------------------------------------------------- grid definitions */

/** Previous drawing: 7 letter lines north→south, 6 number lines west→east. */
export const OLD_ROW_LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export const OLD_COL_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

/** Corrected drawing: 6 letter lines north→south, 9 number lines west→east. */
export const NEW_ROWS: { label: string; yFt: number }[] = [
  { label: "A", yFt: 0 },
  { label: "B", yFt: 8 },
  { label: "C", yFt: 16 },
  { label: "D", yFt: 24 },
  { label: "E", yFt: 32 },
  { label: "F", yFt: 40 },
];

export const NEW_COLS: { label: string; xFt: number }[] = [
  { label: "1", xFt: 0 },
  { label: "2", xFt: 8 },
  { label: "3", xFt: 16 },
  { label: "4", xFt: 24 },
  { label: "5", xFt: 32 },
  { label: "6", xFt: 40 },
  { label: "7", xFt: 48 },
  { label: "8", xFt: 56 },
  { label: "9", xFt: 60 },
];

/** Old letter line → feet south of the north wall (A = 0, G = 40). */
export function oldLetterToFeet(letter: string): number | null {
  const i = OLD_ROW_LETTERS.indexOf(letter.toUpperCase() as (typeof OLD_ROW_LETTERS)[number]);
  if (i < 0) return null;
  return (i / (OLD_ROW_LETTERS.length - 1)) * SHOP_DEPTH_FT;
}

/** Old number line → feet east of the west wall (1 = 0, 6 = 60). Half steps interpolate. */
export function oldNumberToFeet(n: number): number | null {
  if (!Number.isFinite(n) || n < 1 || n > OLD_COL_NUMBERS.length) return null;
  return ((n - 1) / (OLD_COL_NUMBERS.length - 1)) * SHOP_WIDTH_FT;
}

/* ------------------------------------------------------------ label parsing */

export interface ParsedOldGrid {
  raw: string;
  letter: string | null;
  number: number | null;
  /** Trailing note kept verbatim, e.g. "(via FS46)". */
  note: string | null;
  /** True when the cell text carries no interpretable grid reference at all. */
  uninterpretable: boolean;
}

const GRID_RE = /^([A-G])\s*([0-9]+(?:\.5)?)/i;

export function parseOldGrid(raw: string): ParsedOldGrid {
  const text = (raw ?? "").trim();
  const m = GRID_RE.exec(text);
  const noteMatch = /\((.+)\)\s*$/.exec(text);
  const note = noteMatch ? noteMatch[0] : null;
  if (!m) {
    return { raw: text, letter: null, number: null, note, uninterpretable: true };
  }
  return {
    raw: text,
    letter: m[1].toUpperCase(),
    number: Number(m[2]),
    note,
    uninterpretable: false,
  };
}

/* --------------------------------------------------- nearest corrected line */

export interface LineMatch {
  label: string;
  ft: number;
  distanceFt: number;
  /** Second-nearest line, when the position sits between two lines. */
  runnerUp: { label: string; ft: number; distanceFt: number } | null;
  /** True when the two nearest lines are effectively equidistant. */
  tie: boolean;
}

const TIE_TOLERANCE_FT = 0.5;

function nearest(lines: { label: string; ft: number }[], positionFt: number): LineMatch {
  const ranked = lines
    .map((l) => ({ ...l, distanceFt: Math.abs(l.ft - positionFt) }))
    .sort((a, b) => a.distanceFt - b.distanceFt || a.ft - b.ft);
  const best = ranked[0];
  const second = ranked[1] ?? null;
  return {
    label: best.label,
    ft: best.ft,
    distanceFt: best.distanceFt,
    runnerUp: second,
    tie: Boolean(second && Math.abs(second.distanceFt - best.distanceFt) <= TIE_TOLERANCE_FT),
  };
}

export function nearestNewRow(yFt: number): LineMatch {
  return nearest(
    NEW_ROWS.map((r) => ({ label: r.label, ft: r.yFt })),
    yFt,
  );
}

export function nearestNewCol(xFt: number): LineMatch {
  return nearest(
    NEW_COLS.map((c) => ({ label: c.label, ft: c.xFt })),
    xFt,
  );
}

/* ---------------------------------------------- corrected-drawing anchors */

/**
 * Physical features that exist on the corrected drawing itself. When a load is
 * one of these features the drawing is the direct authority, so the proposal
 * comes from the drawn dimension rather than from the old-grid transform.
 */
export interface DrawingAnchor {
  match: RegExp;
  newGrid: string;
  evidence: string;
}

export const DRAWING_ANCHORS: DrawingAnchor[] = [
  {
    // GD2 spans 3'-10 1/2" to 15'-10 1/2" on the north wall.
    match: /garage\s*door\s*w\b|garage\s*doors?\s*west\b/i,
    newGrid: "A2",
    evidence:
      "Corrected drawing: GD2 (12'x12' overhead door) spans 3'-10 1/2\" to 15'-10 1/2\" on the north wall; its centreline 9.9 ft east of the west wall is nearest new column 2 (8 ft), on row A (north wall).",
  },
  {
    // GD1 spans 24'-1 1/2" to 36'-1 1/2" on the north wall.
    match: /garage\s*doors?\s*e\b|garage\s*doors?\s*east\b/i,
    newGrid: "A5",
    evidence:
      "Corrected drawing: GD1 (12'x12' overhead door) spans 24'-1 1/2\" to 36'-1 1/2\" on the north wall; its centreline 30.1 ft east of the west wall is nearest new column 5 (32 ft), on row A (north wall).",
  },
  {
    match: /\bne\b[^a-z]*man\s*door|man\s*door[^a-z]*\bne\b/i,
    newGrid: "A8",
    evidence:
      "Corrected drawing: MAN DOOR (NE), 3'-0\" wide, sits between 55'-6\" and 58'-6\" on the north wall; its centreline 57 ft east of the west wall is nearest new column 8 (56 ft), on row A.",
  },
  {
    match: /\bsw\b[^a-z]*man\s*door|man\s*door[^a-z]*\bsw\b/i,
    newGrid: "E1",
    evidence:
      "Corrected drawing: MAN DOOR (SW) is on the west wall at about 32 ft south of the north wall — new row E (32 ft), column 1 (west wall).",
  },
];

/** Man-door rows that name no corner: the drawing carries two man doors. */
const MAN_DOOR_RE = /man\s*door/i;
const MAN_DOOR_CANDIDATES = "A8 (MAN DOOR NE) or E1 (MAN DOOR SW)";

/* --------------------------------------------------------------- proposals */

export type GridConfidence = "HIGH" | "MEDIUM" | "REVIEW";

export interface GridMigrationRow {
  kind: "load" | "panel";
  stable_id: string;
  description: string;
  old_grid: string;
  /** Old physical position, expressed in the previous drawing's own geometry. */
  old_physical_position: string;
  proposed_new_grid: string | null;
  confidence: GridConfidence;
  mapping_basis: string;
  /** Only set when the owner must decide. */
  review_reason: string | null;
}

export interface MigrationInputRow {
  kind: "load" | "panel";
  stable_id: string;
  description: string;
  grid: string;
  location?: string;
  area?: string;
}

/**
 * Panels named for a building corner. The corrected drawing fixes the corner
 * gridlines; the panel ID is permanent and is not renamed by this migration.
 */
const PANEL_CORNERS: { suffix: string; newGrid: string; corner: string }[] = [
  { suffix: "NW", newGrid: "A1", corner: "north-west corner (row A, column 1)" },
  { suffix: "NE", newGrid: "A9", corner: "north-east corner (row A, column 9)" },
  { suffix: "SW", newGrid: "F1", corner: "south-west corner (row F, column 1)" },
  { suffix: "SE", newGrid: "F9", corner: "south-east corner (row F, column 9)" },
];

function ft(n: number): string {
  return `${Math.round(n * 10) / 10} ft`;
}

function anchorFor(text: string): DrawingAnchor | null {
  return DRAWING_ANCHORS.find((a) => a.match.test(text)) ?? null;
}

export function migrateRow(row: MigrationInputRow): GridMigrationRow {
  const text = `${row.description} ${row.location ?? ""}`;
  const parsed = parseOldGrid(row.grid);
  const base: GridMigrationRow = {
    kind: row.kind,
    stable_id: row.stable_id,
    description: row.description,
    old_grid: parsed.raw || "NOT IN RECORD",
    old_physical_position: "NOT IN RECORD",
    proposed_new_grid: null,
    confidence: "REVIEW",
    mapping_basis: "",
    review_reason: null,
  };

  // Panels: corner-named enclosures on the corrected drawing.
  if (row.kind === "panel") {
    const corner = PANEL_CORNERS.find((c) => row.stable_id.toUpperCase().endsWith(`-${c.suffix}`));
    if (!corner) {
      return {
        ...base,
        mapping_basis: `${row.stable_id} names no building corner and FarmOps holds no Grid value for it, so no physical position can be derived from either drawing.`,
        review_reason: "No old grid on record and no corner in the panel ID.",
      };
    }
    const hasOld = !parsed.uninterpretable;
    return {
      ...base,
      old_physical_position: hasOld
        ? oldPositionText(parsed)
        : "NOT IN RECORD (FarmOps holds no Grid value for this panel)",
      proposed_new_grid: corner.newGrid,
      confidence: hasOld ? "HIGH" : "MEDIUM",
      mapping_basis: `Corrected drawing: the ${corner.corner} of the 40' x 60' envelope is ${corner.newGrid}. The panel ID's ${corner.suffix} corner is the only physical placement evidence on record; the permanent panel ID is unchanged.${hasOld ? "" : " No previous Grid value exists in FarmOps to cross-check."}`,
      review_reason: hasOld
        ? null
        : "Placement derives from the panel's corner designation only — confirm the enclosure's mounted corner in the field.",
    };
  }

  // Loads whose physical feature is drawn on the corrected drawing.
  const anchor = anchorFor(text);
  if (anchor) {
    const oldText = parsed.uninterpretable ? "NOT INTERPRETABLE" : oldPositionText(parsed);
    return {
      ...base,
      old_physical_position: oldText,
      proposed_new_grid: anchor.newGrid,
      confidence: "HIGH",
      mapping_basis: `${anchor.evidence} The corrected drawing is the authority for this feature, so the old label was not transformed.`,
    };
  }

  if (MAN_DOOR_RE.test(text)) {
    return {
      ...base,
      old_physical_position: parsed.uninterpretable ? "NOT INTERPRETABLE" : oldPositionText(parsed),
      confidence: "REVIEW",
      mapping_basis: `The corrected drawing shows two man doors (NE on the north wall, SW on the west wall) and this row names neither. Candidates: ${MAN_DOOR_CANDIDATES}.`,
      review_reason: "Man door with no corner designation — two drawn candidates.",
    };
  }

  if (parsed.uninterpretable) {
    return {
      ...base,
      mapping_basis: `Grid cell reads "${parsed.raw || "(blank)"}", which is not a previous-drawing grid reference, so no physical position exists to remap.`,
      review_reason: "Old Grid value is not an interpretable grid reference.",
    };
  }

  const y = oldLetterToFeet(parsed.letter!);
  const x = oldNumberToFeet(parsed.number!);
  if (y === null || x === null) {
    return {
      ...base,
      old_physical_position: parsed.raw,
      mapping_basis: `"${parsed.raw}" falls outside the previous drawing's A–G / 1–6 grid, so it cannot be placed physically.`,
      review_reason: "Old grid reference is outside the previous drawing's extent.",
    };
  }

  const row_ = nearestNewRow(y);
  const col = nearestNewCol(x);
  const oldText = oldPositionText(parsed);
  const half = parsed.number! % 1 !== 0;

  const ambiguous = row_.tie || col.tie;
  const worstDistance = Math.max(row_.distanceFt, col.distanceFt);
  const confidence: GridConfidence = ambiguous
    ? "REVIEW"
    : worstDistance <= 2
      ? "HIGH"
      : worstDistance <= 4.5
        ? "MEDIUM"
        : "REVIEW";

  const parts = [
    `Previous drawing: ${parsed.letter}${parsed.number} = ${ft(y)} south of the north wall, ${ft(x)} east of the west wall (letters A–G over 40 ft, numbers 1–6 over 60 ft, A6 = NE corner).`,
    `Corrected drawing: that point is ${ft(row_.distanceFt)} from row ${row_.label} (${ft(row_.ft)}) and ${ft(col.distanceFt)} from column ${col.label} (${ft(col.ft)}).`,
    half
      ? `The half-step ${parsed.number} was taken as the physical midpoint between numbers ${Math.floor(parsed.number!)} and ${Math.ceil(parsed.number!)}, not as a label.`
      : "",
    parsed.note ? `Old cell note ${parsed.note} preserved verbatim; it is not a location.` : "",
  ].filter(Boolean);

  let review: string | null = null;
  if (row_.tie && row_.runnerUp) {
    review = `Old letter ${parsed.letter} lands midway between corrected rows ${row_.label} (${ft(row_.ft)}) and ${row_.runnerUp.label} (${ft(row_.runnerUp.ft)}).`;
  }
  if (col.tie && col.runnerUp) {
    const c = `Old number ${parsed.number} lands midway between corrected columns ${col.label} (${ft(col.ft)}) and ${col.runnerUp.label} (${ft(col.runnerUp.ft)}).`;
    review = review ? `${review} ${c}` : c;
  }
  if (!ambiguous && confidence === "REVIEW") {
    review = `Nearest corrected gridline is ${ft(worstDistance)} away — further than a single 8 ft bay allows without field confirmation.`;
  }

  return {
    ...base,
    old_physical_position: oldText,
    proposed_new_grid: ambiguous ? null : `${row_.label}${col.label}`,
    confidence,
    mapping_basis: parts.join(" "),
    review_reason: review,
  };
}

function oldPositionText(p: ParsedOldGrid): string {
  if (p.uninterpretable || p.letter === null || p.number === null) return "NOT INTERPRETABLE";
  const y = oldLetterToFeet(p.letter);
  const x = oldNumberToFeet(p.number);
  if (y === null || x === null) return p.raw;
  return `${p.letter}${p.number} → ${ft(x)} E of west wall, ${ft(y)} S of north wall`;
}

/* ---------------------------------------------------------------- rollups */

export interface MigrationSummary {
  version: string;
  rows: number;
  high: number;
  medium: number;
  review: number;
  unchanged_label: number;
  anchored: number;
}

export function summarizeMigration(rows: GridMigrationRow[]): MigrationSummary {
  return {
    version: GRID_MIGRATION_VERSION,
    rows: rows.length,
    high: rows.filter((r) => r.confidence === "HIGH").length,
    medium: rows.filter((r) => r.confidence === "MEDIUM").length,
    review: rows.filter((r) => r.confidence === "REVIEW").length,
    unchanged_label: rows.filter(
      (r) => r.proposed_new_grid && r.proposed_new_grid === r.old_grid.replace(/\s+/g, ""),
    ).length,
    anchored: rows.filter((r) => /Corrected drawing:/.test(r.mapping_basis) && r.confidence === "HIGH")
      .length,
  };
}

export function migrateAll(rows: MigrationInputRow[]): GridMigrationRow[] {
  return rows
    .map(migrateRow)
    .sort((a, b) =>
      a.kind === b.kind ? a.stable_id.localeCompare(b.stable_id) : a.kind === "panel" ? -1 : 1,
    );
}

/* -------------------------------------------------------------------- CSV */

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function migrationCsv(rows: GridMigrationRow[]): string {
  const head = [
    "stable_id",
    "description",
    "old_grid",
    "old_physical_position",
    "proposed_new_grid",
    "confidence",
    "mapping_basis",
    "review_reason",
  ];
  const body = rows.map((r) =>
    [
      r.stable_id,
      r.description,
      r.old_grid,
      r.old_physical_position,
      r.proposed_new_grid ?? "OWNER REVIEW",
      r.confidence,
      r.mapping_basis,
      r.review_reason ?? "",
    ]
      .map((v) => cell(String(v)))
      .join(","),
  );
  return [head.join(","), ...body].join("\n");
}
