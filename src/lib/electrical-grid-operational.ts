// Farm Shop operational install-location model — pure, read-only helpers.
//
// This module holds the *presentation and classification* logic for the normal
// Grid Map page and for the Data Quality status/field-verification tabs. It
// never writes, never snaps an unresolved or mobile asset to an invented
// coordinate, and never derives an engineering value. The corrected 40' x 60'
// A–F / 1–9 geometry is imported from the frozen migration dictionaries and is
// not redefined here.
import { NEW_COLS, NEW_ROWS, SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";

export const OPERATIONAL_MODEL_VERSION = "farm-shop-operational-location-1";

/** Record kinds that carry a Farm Shop install location today. */
export type AssetKind =
  | "load"
  | "panel"
  | "junction_box"
  | "device"
  | "power_asset"
  | "rack"
  | "raceway";

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  load: "Load / equipment",
  panel: "Panel",
  junction_box: "Junction box",
  device: "Device",
  power_asset: "Power asset",
  rack: "Rack",
  raceway: "Raceway / conduit",
};

/**
 * How well the record pins the asset down. GRIDLINE is used for the asset
 * tables that only carry a grid string (no X/Y and no stored precision), so
 * they stay identifiable as gridline-precision rather than being presented as
 * surveyed coordinates.
 */
export type LocationPrecision =
  | "EXACT"
  | "NEAREST"
  | "INTERVAL"
  | "GRIDLINE"
  | "NON_FIXED"
  | "UNRESOLVED";

export const PRECISION_META: Record<
  LocationPrecision,
  { label: string; dot: string; swatch: string; plottable: boolean }
> = {
  EXACT: {
    label: "Exact intersection",
    dot: "bg-emerald-600",
    swatch: "bg-emerald-600",
    plottable: true,
  },
  NEAREST: {
    label: "Nearest gridline",
    dot: "bg-sky-600",
    swatch: "bg-sky-600",
    plottable: true,
  },
  INTERVAL: {
    label: "Interval preserved",
    dot: "bg-amber-500",
    swatch: "bg-amber-500",
    plottable: true,
  },
  GRIDLINE: {
    label: "Gridline only",
    dot: "bg-indigo-500",
    swatch: "bg-indigo-500",
    plottable: true,
  },
  NON_FIXED: {
    label: "Mobile / non-fixed",
    dot: "bg-purple-500",
    swatch: "bg-purple-500",
    plottable: false,
  },
  UNRESOLVED: {
    label: "Unresolved",
    dot: "bg-muted-foreground",
    swatch: "bg-muted-foreground",
    plottable: false,
  },
};

export const PRECISION_ORDER: LocationPrecision[] = [
  "EXACT",
  "NEAREST",
  "INTERVAL",
  "GRIDLINE",
  "NON_FIXED",
  "UNRESOLVED",
];

/** Walkaround verification lifecycle. Mirrors the database domain exactly. */
export type VerificationStatus =
  | "NOT_REVIEWED"
  | "FIELD_CONFIRMATION_REQUIRED"
  | "VERIFIED_AS_INSTALLED"
  | "UPDATED_FROM_FIELD_OBSERVATION"
  | "INTENTIONALLY_MOBILE"
  | "NOT_YET_INSTALLED";

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "NOT_REVIEWED",
  "FIELD_CONFIRMATION_REQUIRED",
  "VERIFIED_AS_INSTALLED",
  "UPDATED_FROM_FIELD_OBSERVATION",
  "INTENTIONALLY_MOBILE",
  "NOT_YET_INSTALLED",
];

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  NOT_REVIEWED: "Not Reviewed",
  FIELD_CONFIRMATION_REQUIRED: "Field Confirmation Required",
  VERIFIED_AS_INSTALLED: "Verified As Installed",
  UPDATED_FROM_FIELD_OBSERVATION: "Updated From Field Observation",
  INTENTIONALLY_MOBILE: "Intentionally Mobile",
  NOT_YET_INSTALLED: "Not Yet Installed",
};

export function verificationOf(raw: unknown): VerificationStatus {
  const v = (raw == null ? "" : String(raw)).trim().toUpperCase();
  return (VERIFICATION_STATUSES as string[]).includes(v)
    ? (v as VerificationStatus)
    : "NOT_REVIEWED";
}

/* --------------------------------------------------- corrected-grid parsing */

const MOBILE = /^mobile$/i;
const ARTIFACT = /^(\?+|na|n\/a|none|tbd|0(\.0+)?%?|0\.00%)$/i;

export interface ParsedNewGrid {
  /** Row letters the reference covers (1 letter, or 2 for a preserved interval). */
  rows: string[];
  /** Column numbers the reference covers. */
  cols: number[];
  interval: boolean;
  mobile: boolean;
  artifact: boolean;
  ok: boolean;
}

/**
 * Parses a corrected-grid reference such as `A1`, `C3`, `C-D3`, `E2-3` or
 * `C-D2-3`. Intervals stay intervals: both endpoints are returned and no
 * single cell is chosen.
 */
export function parseNewGrid(raw: string): ParsedNewGrid {
  const text = (raw ?? "").trim();
  const empty: ParsedNewGrid = {
    rows: [],
    cols: [],
    interval: false,
    mobile: false,
    artifact: false,
    ok: false,
  };
  if (!text) return empty;
  if (MOBILE.test(text)) return { ...empty, mobile: true };
  if (ARTIFACT.test(text)) return { ...empty, artifact: true };

  const m = /^([A-Fa-f])(?:\s*-\s*([A-Fa-f]))?\s*(\d)(?:\s*-\s*(\d))?$/.exec(text);
  if (!m) return empty;
  const rows = [m[1]!.toUpperCase(), ...(m[2] ? [m[2].toUpperCase()] : [])];
  const cols = [Number(m[3]), ...(m[4] ? [Number(m[4])] : [])];
  const validRows = rows.every((r) => NEW_ROWS.some((row) => row.label === r));
  const validCols = cols.every((c) => NEW_COLS.some((col) => col.label === String(c)));
  if (!validRows || !validCols) return empty;
  return {
    rows,
    cols,
    interval: rows.length > 1 || cols.length > 1,
    mobile: false,
    artifact: false,
    ok: true,
  };
}

const rowFt = (label: string): number | null =>
  NEW_ROWS.find((r) => r.label === label)?.yFt ?? null;
const colFt = (label: number): number | null =>
  NEW_COLS.find((c) => c.label === String(label))?.xFt ?? null;

/** Display-only centre of a parsed reference; an interval keeps its span. */
export function newGridFeet(
  parsed: ParsedNewGrid,
): { xFt: number; yFt: number; span: boolean } | null {
  if (!parsed.ok) return null;
  const ys = parsed.rows.map(rowFt).filter((v): v is number => v != null);
  const xs = parsed.cols.map(colFt).filter((v): v is number => v != null);
  if (!ys.length || !xs.length) return null;
  return {
    xFt: xs.reduce((a, b) => a + b, 0) / xs.length,
    yFt: ys.reduce((a, b) => a + b, 0) / ys.length,
    span: parsed.interval,
  };
}

/* ------------------------------------------------------------ asset records */

export interface OperationalInput {
  kind: AssetKind;
  stableId: string;
  description: string | null;
  /** Current FarmOps grid / install location string. */
  grid: string | null;
  designGrid: string | null;
  legacyGrid: string | null;
  gridReference: string | null;
  storedPrecision: string | null;
  xFt: number | null;
  yFt: number | null;
  designXFt: number | null;
  designYFt: number | null;
  installStatus: string | null;
  verification: string | null;
  verificationNotes: string | null;
  locationEvidence: string | null;
  verifiedAt: string | null;
  updatedAt: string | null;
  location: string | null;
  panel: string | null;
  panelBasis: string | null;
  /** Only loads carry a circuit class; other kinds leave this null. */
  circuitClass: string | null;
  circuitClassBasis: string | null;
}

export interface OperationalAsset extends Omit<OperationalInput, "storedPrecision"> {
  precision: LocationPrecision;
  precisionBasis: string;
  /** Percent inside the plan envelope. Null when the asset must not be plotted. */
  xPct: number | null;
  yPct: number | null;
  plottedXFt: number | null;
  plottedYFt: number | null;
  /** True when the plotted point represents a span rather than a point. */
  spanned: boolean;
  locationSource:
    | "RECORDED_XY"
    | "DERIVED_FROM_CURRENT_GRID"
    | "NOT_PLOTTED";
  stackIndex: number;
  stackSize: number;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function precisionFromStored(raw: string | null): LocationPrecision | null {
  const v = (raw ?? "").trim().toUpperCase();
  return (PRECISION_ORDER as string[]).includes(v) ? (v as LocationPrecision) : null;
}

/** Classifies one record without ever inventing a location. */
export function classifyLocation(row: OperationalInput): {
  precision: LocationPrecision;
  basis: string;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  source: OperationalAsset["locationSource"];
} {
  const stored = precisionFromStored(row.storedPrecision);
  const x = num(row.xFt);
  const y = num(row.yFt);
  const verification = verificationOf(row.verification);
  const parsed = parseNewGrid(row.grid ?? "");

  if (verification === "INTENTIONALLY_MOBILE" || parsed.mobile || stored === "NON_FIXED") {
    return {
      precision: "NON_FIXED",
      basis: "Mobile / non-fixed equipment: no fixed install point is recorded, by design.",
      xFt: null,
      yFt: null,
      spanned: false,
      source: "NOT_PLOTTED",
    };
  }

  if (x != null && y != null) {
    const precision = stored && stored !== "UNRESOLVED" ? stored : "EXACT";
    return {
      precision,
      basis:
        stored != null
          ? `Recorded physical position (${x} ft E, ${y} ft S), precision ${stored} in the record.`
          : `Recorded physical position (${x} ft E, ${y} ft S).`,
      xFt: x,
      yFt: y,
      spanned: precision === "INTERVAL",
      source: "RECORDED_XY",
    };
  }

  if (parsed.ok) {
    const feet = newGridFeet(parsed);
    if (feet) {
      const precision: LocationPrecision = parsed.interval
        ? "INTERVAL"
        : stored === "NEAREST"
          ? "NEAREST"
          : row.kind === "load" || row.kind === "panel"
            ? (stored ?? "GRIDLINE")
            : "GRIDLINE";
      return {
        precision,
        basis: parsed.interval
          ? `Interval reference ${row.grid} — the record does not name a single cell, so the span is preserved.`
          : `Corrected-grid reference ${row.grid} on the gridline intersection; no surveyed X/Y is recorded.`,
        xFt: feet.xFt,
        yFt: feet.yFt,
        spanned: feet.span,
        source: "DERIVED_FROM_CURRENT_GRID",
      };
    }
  }

  return {
    precision: "UNRESOLVED",
    basis: parsed.artifact
      ? `Grid value "${row.grid}" is a non-location artifact, so no position can be stated.`
      : row.grid
        ? `Grid value "${row.grid}" is not a corrected-grid reference and no physical X/Y is recorded.`
        : "No grid reference and no physical X/Y in the record.",
    xFt: null,
    yFt: null,
    spanned: false,
    source: "NOT_PLOTTED",
  };
}

/** Fans co-located dots apart so each stays hoverable. Display only. */
function fan(assets: OperationalAsset[]): OperationalAsset[] {
  const groups = new Map<string, OperationalAsset[]>();
  for (const a of assets) {
    if (a.plottedXFt == null) continue;
    const key = `${a.plottedXFt}|${a.plottedYFt}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.forEach((a, i) => {
      a.stackIndex = i;
      a.stackSize = list.length;
      if (list.length > 1 && a.xPct != null && a.yPct != null) {
        const angle = (i / list.length) * Math.PI * 2;
        a.xPct = Math.min(100, Math.max(0, a.xPct + Math.cos(angle) * 1.4));
        a.yPct = Math.min(100, Math.max(0, a.yPct + Math.sin(angle) * 2.0));
      }
    });
  }
  return assets;
}

export function buildOperationalAssets(rows: OperationalInput[]): OperationalAsset[] {
  const assets = rows.map((row) => {
    const place = classifyLocation(row);
    const plottable = PRECISION_META[place.precision].plottable && place.xFt != null;
    const asset: OperationalAsset = {
      ...row,
      precision: place.precision,
      precisionBasis: place.basis,
      plottedXFt: plottable ? place.xFt : null,
      plottedYFt: plottable ? place.yFt : null,
      xPct: plottable ? ((place.xFt as number) / SHOP_WIDTH_FT) * 100 : null,
      yPct: plottable ? ((place.yFt as number) / SHOP_DEPTH_FT) * 100 : null,
      spanned: place.spanned,
      locationSource: plottable ? place.source : "NOT_PLOTTED",
      stackIndex: 0,
      stackSize: 1,
    };
    return asset;
  });
  return fan(assets);
}

/* ---------------------------------------------------------------- summaries */

export interface OperationalSummary {
  total: number;
  plotted: number;
  unplotted: number;
  precision: Record<LocationPrecision, number>;
  verification: Record<VerificationStatus, number>;
  kinds: Record<string, number>;
}

export function summarizeOperational(assets: OperationalAsset[]): OperationalSummary {
  const precision = Object.fromEntries(PRECISION_ORDER.map((p) => [p, 0])) as Record<
    LocationPrecision,
    number
  >;
  const verification = Object.fromEntries(VERIFICATION_STATUSES.map((v) => [v, 0])) as Record<
    VerificationStatus,
    number
  >;
  const kinds: Record<string, number> = {};
  let plotted = 0;
  for (const a of assets) {
    precision[a.precision] += 1;
    verification[verificationOf(a.verification)] += 1;
    kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
    if (a.xPct != null) plotted += 1;
  }
  return {
    total: assets.length,
    plotted,
    unplotted: assets.length - plotted,
    precision,
    verification,
    kinds,
  };
}

/** Walkaround queue groups, in the order the field verification tab shows them. */
export type QueueGroup =
  | "UNRESOLVED"
  | "NEAREST_GRIDLINE"
  | "INTERVAL_PRESERVED"
  | "MOBILE_CONFIRMATION"
  | "CHANGED_AFTER_INSTALL";

export const QUEUE_LABEL: Record<QueueGroup, string> = {
  UNRESOLVED: "Unresolved",
  NEAREST_GRIDLINE: "Nearest gridline",
  INTERVAL_PRESERVED: "Interval preserved",
  MOBILE_CONFIRMATION: "Mobile / non-fixed requiring confirmation",
  CHANGED_AFTER_INSTALL: "Location changed after installation",
};

export const QUEUE_ORDER: QueueGroup[] = [
  "UNRESOLVED",
  "NEAREST_GRIDLINE",
  "INTERVAL_PRESERVED",
  "MOBILE_CONFIRMATION",
  "CHANGED_AFTER_INSTALL",
];

const INSTALLED = new Set([
  "device_side_connected",
  "source_side_connected",
  "tested",
  "complete",
  "as_built_verified",
]);

export function queueGroupsFor(a: OperationalAsset): QueueGroup[] {
  const out: QueueGroup[] = [];
  const v = verificationOf(a.verification);
  if (a.precision === "UNRESOLVED") out.push("UNRESOLVED");
  if (a.precision === "NEAREST" || a.precision === "GRIDLINE") out.push("NEAREST_GRIDLINE");
  if (a.precision === "INTERVAL") out.push("INTERVAL_PRESERVED");
  if (a.precision === "NON_FIXED" && v !== "INTENTIONALLY_MOBILE") out.push("MOBILE_CONFIRMATION");
  const designGrid = (a.designGrid ?? "").trim();
  const currentGrid = (a.grid ?? "").trim();
  if (
    designGrid &&
    currentGrid &&
    designGrid.toUpperCase() !== currentGrid.toUpperCase() &&
    INSTALLED.has((a.installStatus ?? "").trim())
  ) {
    out.push("CHANGED_AFTER_INSTALL");
  }
  return out;
}

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function operationalCsv(assets: OperationalAsset[]): string {
  const head = [
    "stable_id",
    "kind",
    "description",
    "design_grid",
    "farmops_grid_current",
    "x_ft",
    "y_ft",
    "precision",
    "install_status",
    "field_verification_status",
    "location_evidence",
    "verification_notes",
    "verified_at",
    "updated_at",
    "panel",
    "precision_basis",
  ];
  const lines = assets.map((a) =>
    [
      a.stableId,
      a.kind,
      a.description ?? "",
      a.designGrid ?? "",
      a.grid ?? "",
      a.plottedXFt ?? "",
      a.plottedYFt ?? "",
      a.precision,
      a.installStatus ?? "",
      verificationOf(a.verification),
      a.locationEvidence ?? "",
      a.verificationNotes ?? "",
      a.verifiedAt ?? "",
      a.updatedAt ?? "",
      a.panel ?? "",
      a.precisionBasis,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
