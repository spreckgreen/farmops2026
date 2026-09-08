// Farm Shop operational install-location model — pure, read-only helpers.
//
// This module holds the *presentation and classification* logic for the normal
// Grid Map page and for the Data Quality status/field-verification tabs. It
// never writes, never snaps an unresolved or mobile asset to an invented
// coordinate, and never derives an engineering value. The corrected 40' x 60'
// A–F / 1–9 geometry is imported from the frozen migration dictionaries and is
// not redefined here.
import {
  NEW_COLS,
  NEW_ROWS,
  SHOP_DEPTH_FT,
  SHOP_WIDTH_FT,
  oldLetterToFeet,
  oldNumberToFeet,
  parseOldGrid,
} from "@/lib/electrical-grid-migration";
import {
  activeGridGeometry,
  intervalMidpoint,
  lineFeet,
} from "@/lib/electrical-grid-definition";
import {
  effectiveLocationForRecord,
  type EffectiveLocation,
} from "@/lib/electrical-effective-location";
import {
  POST_GEOMETRY_CONFIRMED,
  postObservationFeet,
} from "@/lib/electrical-grid-post-geometry";
import { approvedDesignXy } from "@/lib/electrical-grid-plan-geometry";
import {
  MEASURED_XY_METHODS,
  MEASURED_XY_METHOD_LABEL,
  measuredXyMethodOf,
  type MeasuredXyMethod,
} from "@/lib/electrical-measured-xy";

export {
  MEASURED_XY_METHODS,
  MEASURED_XY_METHOD_LABEL,
  measuredXyMethodOf,
  type MeasuredXyMethod,
};



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
  /** Row line labels the reference covers (1, or 2 for a preserved interval). */
  rows: string[];
  /** Column labels as numbers, for callers that read the historic numeric form. */
  cols: number[];
  /** Column labels exactly as defined — the authoritative form. */
  colLabels: string[];
  /** Set when the whole reference names a site-defined interval (e.g. `RUN-N-01`). */
  intervalRef: string | null;
  interval: boolean;
  mobile: boolean;
  artifact: boolean;
  ok: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/**
 * Parses a grid reference such as `A1`, `C3`, `C-D3`, `E2-3` or `C-D2-3`, plus
 * any interval the site has named in its own grid definition. Row and column
 * labels come from the ACTIVE grid definition, so redefining the grid changes
 * what parses. Intervals stay intervals: both endpoints are returned and no
 * single cell is chosen.
 */
export function parseNewGrid(raw: string): ParsedNewGrid {
  const text = (raw ?? "").trim();
  const empty: ParsedNewGrid = {
    rows: [],
    cols: [],
    colLabels: [],
    intervalRef: null,
    interval: false,
    mobile: false,
    artifact: false,
    ok: false,
  };
  if (!text) return empty;
  if (MOBILE.test(text)) return { ...empty, mobile: true };
  if (ARTIFACT.test(text)) return { ...empty, artifact: true };

  const geometry = activeGridGeometry();

  const named = geometry.intervals.find((i) => i.ref === text.toUpperCase());
  if (named) return { ...empty, intervalRef: named.ref, interval: true, ok: true };

  const rowAlt = geometry.rows.map((r) => escapeRe(r.label)).join("|");
  const colAlt = geometry.cols.map((c) => escapeRe(c.label)).join("|");
  if (!rowAlt || !colAlt) return empty;

  const re = new RegExp(
    `^(${rowAlt})(?:\\s*-\\s*(${rowAlt}))?\\s*(${colAlt})(?:\\s*-\\s*(${colAlt}))?$`,
    "i",
  );
  const m = re.exec(text);
  if (!m) return empty;
  const rows = [m[1]!.toUpperCase(), ...(m[2] ? [m[2].toUpperCase()] : [])];
  const colLabels = [m[3]!.toUpperCase(), ...(m[4] ? [m[4].toUpperCase()] : [])];
  return {
    rows,
    cols: colLabels.map((c) => Number(c)),
    colLabels,
    intervalRef: null,
    interval: rows.length > 1 || colLabels.length > 1,
    mobile: false,
    artifact: false,
    ok: true,
  };
}

const rowFt = (label: string): number | null => lineFeet(activeGridGeometry(), "ROW", label);
const colFt = (label: string): number | null => lineFeet(activeGridGeometry(), "COLUMN", label);

/** Display-only centre of a parsed reference; an interval keeps its span. */
export function newGridFeet(
  parsed: ParsedNewGrid,
): { xFt: number; yFt: number; span: boolean } | null {
  if (!parsed.ok) return null;
  if (parsed.intervalRef) {
    const mid = intervalMidpoint(activeGridGeometry(), parsed.intervalRef);
    return mid ? { xFt: mid.xFt, yFt: mid.yFt, span: true } : null;
  }
  const ys = parsed.rows.map(rowFt).filter((v): v is number => v != null);
  const xs = (parsed.colLabels.length ? parsed.colLabels : parsed.cols.map(String))
    .map(colFt)
    .filter((v): v is number => v != null);
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
  /** Applied field-observed grid cell (corrected A–F / 1–9), if any. */
  fieldGridReference?: string | null;
  /** Applied field-observed perimeter post callout, if any. */
  poleScheme?: string | null;
  poleLocationKind?: string | null;
  poleRefStart?: string | null;
  poleRefEnd?: string | null;
  /** A staged, not-yet-approved field observation for this record, if any. */
  pendingObservation?: PendingObservation | null;
  /**
   * Measured field X/Y record: an actual instrument measurement taken on site
   * (tape, laser, GPS, total station). Its presence makes `xFt`/`yFt` a measured
   * point, which outranks every post, interval, grid or design reference.
   */
  measuredMethod?: string | null;
  measuredAccuracyFt?: number | null;
  measuredDatum?: string | null;
  measuredAt?: string | null;
  measuredBy?: string | null;
}

/** True when the record carries a measured field X/Y coordinate record. */
export function hasMeasuredFieldXy(row: {
  xFt: number | null;
  yFt: number | null;
  measuredMethod?: string | null;
}): boolean {
  return row.xFt != null && row.yFt != null && measuredXyMethodOf(row.measuredMethod) != null;
}

/**
 * One field observation that exists only inside a staged audit batch. It has not
 * been approved or applied, so it is a distinct, clearly labelled layer — never
 * written to the record and never treated as an accepted statement.
 */
export interface PendingObservation {
  batchId: string;
  itemKey: string;
  fieldGridReference: string | null;
  poleScheme: string | null;
  poleLocationKind: string | null;
  poleRefStart: string | null;
  poleRefEnd: string | null;
  observedAt: string | null;
  evidence: string | null;
}


/**
 * Where a plotted position came from, in precedence order.
 *
 * An applied field audit is the highest authority for everything it verified.
 * A missing measured X/Y never demotes an audit-verified post or grid cell back
 * to an older design assignment: measured X/Y, then a mapped physical anchor
 * (post / pole / wall interval), then the verified grid cell, and only then
 * accepted design coordinates and accepted design grid labels.
 */
export type PlacementSource =
  | "VERIFIED_FIELD_OBSERVATION_XY"
  | "OBSERVED_POST"
  | "OBSERVED_FIELD_GRID"
  | "APPROVED_DESIGN_XY"
  | "PENDING_FIELD_OBSERVATION"
  | "DERIVED_FROM_GRID_REFERENCE"
  | "DERIVED_FROM_CURRENT_GRID"
  | "DERIVED_FROM_LEGACY_GRID"
  | "PROVISIONAL_RECORDED_XY"
  | "NOT_PLOTTED";

export const PLACEMENT_SOURCE_LABEL: Record<PlacementSource, string> = {
  VERIFIED_FIELD_OBSERVATION_XY: "Field-verified measured X/Y",
  OBSERVED_POST: "Field-verified post / pole anchor",
  OBSERVED_FIELD_GRID: "Field-verified grid cell",
  APPROVED_DESIGN_XY: "Accepted design X/Y (not field verified)",
  PENDING_FIELD_OBSERVATION: "Field observation staged for approval (not applied)",
  DERIVED_FROM_GRID_REFERENCE: "Accepted design grid reference",
  DERIVED_FROM_CURRENT_GRID: "Accepted current FarmOps grid",
  DERIVED_FROM_LEGACY_GRID: "Canonical / recovery-derived legacy grid",
  PROVISIONAL_RECORDED_XY: "Provisional recorded X/Y (unverified)",
  NOT_PLOTTED: "Not plotted",
};

export const PLACEMENT_SOURCE_ORDER: PlacementSource[] = [
  "VERIFIED_FIELD_OBSERVATION_XY",
  "OBSERVED_POST",
  "OBSERVED_FIELD_GRID",
  "APPROVED_DESIGN_XY",
  "PENDING_FIELD_OBSERVATION",
  "DERIVED_FROM_GRID_REFERENCE",
  "DERIVED_FROM_CURRENT_GRID",
  "DERIVED_FROM_LEGACY_GRID",
  "PROVISIONAL_RECORDED_XY",
  "NOT_PLOTTED",
];

/**
 * Explicit plot provenance for the point actually drawn. A derived centroid,
 * post anchor or interval midpoint is never presented as a measured field X/Y.
 */
export type PlotProvenance =
  | "FIELD_VERIFIED_XY"
  | "FIELD_VERIFIED_POST"
  | "FIELD_VERIFIED_INTERVAL"
  | "FIELD_VERIFIED_GRID_CENTROID"
  | "DESIGN_XY"
  | "DESIGN_GRID_CENTROID"
  | "UNRESOLVED";

export const PLOT_PROVENANCE_ORDER: PlotProvenance[] = [
  "FIELD_VERIFIED_XY",
  "FIELD_VERIFIED_POST",
  "FIELD_VERIFIED_INTERVAL",
  "FIELD_VERIFIED_GRID_CENTROID",
  "DESIGN_XY",
  "DESIGN_GRID_CENTROID",
  "UNRESOLVED",
];

export const PLOT_PROVENANCE_LABEL: Record<PlotProvenance, string> = {
  FIELD_VERIFIED_XY: "Field-verified measured X/Y",
  FIELD_VERIFIED_POST: "Field-verified post anchor (canonical post coordinate)",
  FIELD_VERIFIED_INTERVAL: "Field-verified interval (midpoint drawn, span preserved)",
  FIELD_VERIFIED_GRID_CENTROID: "Field-verified grid cell (centroid drawn)",
  DESIGN_XY: "Design X/Y (not field verified)",
  DESIGN_GRID_CENTROID: "Design grid cell (centroid drawn, not field verified)",
  UNRESOLVED: "Unresolved — no usable location",
};

/** How the drawn point was obtained from the verified or design reference. */
export const PLOT_DERIVATION: Record<PlotProvenance, string> = {
  FIELD_VERIFIED_XY: "Measured coordinate recorded in the field; used as recorded.",
  FIELD_VERIFIED_POST: "Canonical coordinate of the verified post / pole callout.",
  FIELD_VERIFIED_INTERVAL:
    "Midpoint of the verified interval; interval precision is preserved and the span is kept.",
  FIELD_VERIFIED_GRID_CENTROID: "Centroid of the verified grid cell.",
  DESIGN_XY: "Accepted design coordinate; design intent only.",
  DESIGN_GRID_CENTROID: "Centroid of the accepted design grid cell.",
  UNRESOLVED: "No derivation — nothing is plotted.",
};

/**
 * Explicit plot provenance for a chosen placement. Field-verified sources stay
 * field-verified; derived points are never labelled as measured coordinates.
 */
export function plotProvenanceFor(source: PlacementSource, spanned: boolean): PlotProvenance {
  switch (source) {
    case "VERIFIED_FIELD_OBSERVATION_XY":
      return spanned ? "FIELD_VERIFIED_INTERVAL" : "FIELD_VERIFIED_XY";
    case "OBSERVED_POST":
      return spanned ? "FIELD_VERIFIED_INTERVAL" : "FIELD_VERIFIED_POST";
    case "OBSERVED_FIELD_GRID":
    case "PENDING_FIELD_OBSERVATION":
      return spanned ? "FIELD_VERIFIED_INTERVAL" : "FIELD_VERIFIED_GRID_CENTROID";
    case "APPROVED_DESIGN_XY":
    case "PROVISIONAL_RECORDED_XY":
      return "DESIGN_XY";
    case "DERIVED_FROM_GRID_REFERENCE":
    case "DERIVED_FROM_CURRENT_GRID":
    case "DERIVED_FROM_LEGACY_GRID":
      return "DESIGN_GRID_CENTROID";
    default:
      return "UNRESOLVED";
  }
}

export const FIELD_VERIFIED_SOURCES: PlacementSource[] = [
  "VERIFIED_FIELD_OBSERVATION_XY",
  "OBSERVED_POST",
  "OBSERVED_FIELD_GRID",
];

/** Deployment scope of field audit evidence, explained separately from plotting. */
export const DEPLOYMENT_SCOPE_NOTICE =
  "Field audits are deployment-local until synchronized. If an audit was applied in another FarmOps deployment, this instance cannot use that evidence until the audit batch or resulting canonical records are imported and verified.";

/**
 * The location-authority notice for this instance, stated from the records
 * actually present here — never from an audit that lives in another deployment.
 */
export function fieldVerifiedLocationNotice(counts: {
  verified: number;
  measuredXy: number;
}): string {
  const { verified, measuredXy } = counts;
  if (verified === 0)
    return `No records in this FarmOps instance contain field-verified location references. ${DEPLOYMENT_SCOPE_NOTICE}`;
  if (measuredXy === 0)
    return `${verified} records in this FarmOps instance contain field-verified location references. None contains a measured field X/Y coordinate. FarmOps therefore plots each record from its verified grid, post, or interval using a deterministic derived rendering point. These points are field-authoritative at the recorded precision, but they are not measured coordinates.`;
  return `${verified} records in this FarmOps instance contain field-verified location references. ${measuredXy} of them carry a measured field X/Y coordinate record and are plotted at that measured point, which outranks every grid, post or interval reference. The remaining ${verified - measuredXy} are plotted from their verified grid, post, or interval using a deterministic derived rendering point: field-authoritative at the recorded precision, but not measured coordinates.`;
}


/** One candidate position the record could support, evaluated but not chosen. */
export interface PlacementCandidate {
  source: PlacementSource;
  xFt: number;
  yFt: number;
  precision: LocationPrecision;
  spanned: boolean;
  basis: string;
  /** True when this candidate is an accepted (not provisional) statement. */
  accepted: boolean;
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
  locationSource: PlacementSource;
  /** Explicit provenance of the point drawn (never claims a measured X/Y). */
  plotProvenance: PlotProvenance;
  /** How the drawn point was derived from the verified or design reference. */
  plotDerivation: string;
  /** The verified reference the plot came from, preserved verbatim. */
  verifiedReference: string | null;
  /** Audit batch / evidence identifier behind the verified reference, if stated. */
  auditId: string | null;
  /** Every position the record could support, including the rejected ones. */
  placementCandidates: PlacementCandidate[];
  /** Set when candidates disagree; a Data Quality finding, never silently resolved. */
  placementDisagreement: string | null;
  /**
   * Derived, read-only effective location from the ONE shared resolver. Every
   * consumer (maps, diagrams, lists, previews, exports, AI, completeness) must
   * display this rather than re-deriving precedence.
   */
  effectiveLocation: EffectiveLocation;
  /** "A8 · observed A1–F9 grid · field verified" */
  locationProvenance: string;
  stackIndex: number;
  stackSize: number;
  /** Display-only separation for co-located markers. The anchor stays true. */
  fanDxFt: number;
  fanDyFt: number;
}

/**
 * Maps one operational record onto the shared effective-location resolver.
 * Precedence lives in electrical-effective-location.ts and nowhere else.
 */
/**
 * Approved design coordinates for a row: recorded design X/Y wins; otherwise the
 * frozen approved-design registry supplies them for pattern-generated planned
 * objects (the 2 x 5 overhead LED layout, FS-056..FS-065). Exact feet only —
 * never rebuilt from a grid label.
 */
export function designCoordsFor(row: OperationalInput): {
  xFt: number;
  yFt: number;
  approval: string | null;
} | null {
  const dx = num(row.designXFt);
  const dy = num(row.designYFt);
  if (dx != null && dy != null) return { xFt: dx, yFt: dy, approval: null };
  const approved = approvedDesignXy(row.stableId);
  return approved ? { xFt: approved.xFt, yFt: approved.yFt, approval: approved.approval } : null;
}

export function effectiveLocationForOperational(row: OperationalInput): EffectiveLocation {
  const legacyKind = row.kind === "load" || row.kind === "panel";
  const design = designCoordsFor(row);
  return effectiveLocationForRecord({
    stableId: row.stableId,
    poleScheme: row.poleScheme ?? null,
    poleLocationKind: row.poleLocationKind ?? null,
    poleRefStart: row.poleRefStart ?? null,
    poleRefEnd: row.poleRefEnd ?? null,
    poleEvidence: row.locationEvidence ?? null,
    poleObservedAt: row.verifiedAt ?? null,
    fieldGridReference: row.fieldGridReference ?? null,
    fieldGridEvidence: row.locationEvidence ?? null,
    fieldGridObservedAt: row.verifiedAt ?? null,
    designXFt: design?.xFt ?? null,
    designYFt: design?.yFt ?? null,
    designApprovalReference: design?.approval ?? row.designGrid ?? null,
    remappedGridReference: row.gridReference ?? (legacyKind ? null : row.grid),
    originalGrid: legacyKind ? (row.grid ?? row.legacyGrid) : row.legacyGrid,
  });
}


const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function precisionFromStored(raw: string | null): LocationPrecision | null {
  const v = (raw ?? "").trim().toUpperCase();
  return (PRECISION_ORDER as string[]).includes(v) ? (v as LocationPrecision) : null;
}

/** Verifications that make a recorded X/Y an approved field observation. */
const VERIFIED_OBSERVATION: VerificationStatus[] = [
  "VERIFIED_AS_INSTALLED",
  "UPDATED_FROM_FIELD_OBSERVATION",
];

/** Install statuses that mean the record is not the current installed location. */
const NOT_CURRENT_INSTALL = new Set([
  "planned",
  "proposed",
  "design",
  "not_installed",
  "not_yet_installed",
  "removed",
  "abandoned",
]);

/** True when the record states an X/Y that is verified and currently installed. */
function isCurrentVerifiedObservation(row: OperationalInput): boolean {
  const v = verificationOf(row.verification);
  if (!VERIFIED_OBSERVATION.includes(v)) return false;
  return !NOT_CURRENT_INSTALL.has((row.installStatus ?? "").trim().toLowerCase());
}

/**
 * Builds every position the record could support, in precedence order. Nothing
 * is invented: a candidate exists only when the record states its inputs.
 */
export function placementCandidatesFor(row: OperationalInput): PlacementCandidate[] {
  const out: PlacementCandidate[] = [];
  const stored = precisionFromStored(row.storedPrecision);
  const usableStored = stored && stored !== "UNRESOLVED" && stored !== "NON_FIXED" ? stored : null;
  const x = num(row.xFt);
  const y = num(row.yFt);
  const correctedReference = parseNewGrid(row.gridReference ?? "");
  const currentGrid = parseNewGrid(row.grid ?? "");

  // 0. Measured field X/Y record: an instrument measurement taken on site. It is
  //    the highest authority there is — it outranks posts, intervals, verified
  //    grid cells and every design assignment — and it is the only source that
  //    may be presented as a measured coordinate.
  const measuredMethod = measuredXyMethodOf(row.measuredMethod);
  if (x != null && y != null && measuredMethod) {
    out.push({
      source: "VERIFIED_FIELD_OBSERVATION_XY",
      xFt: x,
      yFt: y,
      precision: "EXACT",
      spanned: false,
      basis: `Measured field coordinate: ${x} ft E, ${y} ft S by ${
        MEASURED_XY_METHOD_LABEL[measuredMethod]
      }${row.measuredAccuracyFt != null ? ` (±${row.measuredAccuracyFt} ft)` : ""}${
        row.measuredDatum ? `, datum ${row.measuredDatum}` : ""
      }${row.measuredAt ? `, measured ${row.measuredAt}` : ""}${
        row.measuredBy ? ` by ${row.measuredBy}` : ""
      }. Used as recorded.`,
      accepted: true,
    });
  }

  // 1. Exact X/Y, but only from an approved/verified field observation that is
  //    marked as the current installed location.
  else if (x != null && y != null && isCurrentVerifiedObservation(row)) {
    out.push({
      source: "VERIFIED_FIELD_OBSERVATION_XY",
      xFt: x,
      yFt: y,
      precision: usableStored ?? "EXACT",
      spanned: usableStored === "INTERVAL",
      basis: `Verified field observation: recorded ${x} ft E, ${y} ft S, verification ${VERIFICATION_LABEL[verificationOf(row.verification)]}${
        row.verifiedAt ? ` on ${row.verifiedAt}` : ""
      }.`,
      accepted: true,
    });
  }

  // 1a. Field-verified physical anchor: a post, pole or wall interval recorded
  //     by an applied audit. It is a mapped physical reference, so it outranks
  //     the verified grid cell and every design assignment. Only usable once the
  //     post geometry proposal has been confirmed by the owner.
  if (POST_GEOMETRY_CONFIRMED && row.poleLocationKind) {
    const post = postObservationFeet({
      pole_scheme: row.poleScheme ?? null,
      pole_location_kind: row.poleLocationKind as never,
      pole_ref_start: row.poleRefStart ?? null,
      pole_ref_end: row.poleRefEnd ?? null,
    });
    if (post) {
      out.push({
        source: "OBSERVED_POST",
        xFt: post.xFt,
        yFt: post.yFt,
        precision: post.spanned ? "INTERVAL" : "NEAREST",
        spanned: post.spanned,
        basis: `Field-verified post ${post.token}: plotted at the canonical coordinate for that post${
          post.spanned ? " (interval midpoint, span preserved)" : ""
        } — not a measured field X/Y. ${post.basis}`,
        accepted: true,
      });
    }
  }

  // 1a2. Field-verified grid cell recorded by an applied audit. It outranks
  //      design intent and every inherited grid assignment. It fixes the record
  //      to a grid cell, so the plotted point is that cell's centroid, never a
  //      measured point; a verified measured X/Y still wins.
  {
    const observedGrid = parseNewGrid(row.fieldGridReference ?? "");
    const feet = observedGrid.ok ? newGridFeet(observedGrid) : null;
    if (feet) {
      out.push({
        source: "OBSERVED_FIELD_GRID",
        xFt: feet.xFt,
        yFt: feet.yFt,
        precision: observedGrid.interval ? "INTERVAL" : "GRIDLINE",
        spanned: feet.span,
        basis: `Field-verified grid ${row.fieldGridReference}${
          row.verifiedAt ? `, verified ${row.verifiedAt}` : ""
        }. Plotted from the ${
          observedGrid.interval ? "verified interval midpoint" : "verified cell centroid"
        } — a derived rendering point, not a measured field X/Y.`,
        accepted: true,
      });
    }
  }



  // 1b. Approved design X/Y. The design coordinates are the authoritative
  //     statement of the intended position; any grid label on the record is a
  //     human-readable lookup of that position, never the position itself. This
  //     is design intent only — it never claims the fixture is installed, and a
  //     verified field observation still outranks it.
  {
    const design = designCoordsFor(row);
    const dx = design?.xFt ?? null;
    const dy = design?.yFt ?? null;
    if (dx != null && dy != null) {
      out.push({
        source: "APPROVED_DESIGN_XY",
        xFt: dx,
        yFt: dy,
        precision: "EXACT",
        spanned: false,
        basis: `Approved design position: ${dx} ft E, ${dy} ft S${
          row.designGrid ? ` (design grid ${row.designGrid}, lookup only)` : ""
        }. Design intent — not a field observation.`,
        accepted: true,
      });
    }
  }

  // 1c. Staged field observation: it lives in an audit batch that has not been
  //     approved or applied, so it is never an accepted statement. It is still
  //     the most recent thing anyone actually saw in the field, so it outranks
  //     inherited grid assignments while staying visibly provisional.
  {
    const p = row.pendingObservation ?? null;
    if (p) {
      const pendingGrid = parseNewGrid(p.fieldGridReference ?? "");
      const feet = pendingGrid.ok ? newGridFeet(pendingGrid) : null;
      const post =
        POST_GEOMETRY_CONFIRMED && p.poleLocationKind
          ? postObservationFeet({
              pole_scheme: p.poleScheme,
              pole_location_kind: p.poleLocationKind as never,
              pole_ref_start: p.poleRefStart,
              pole_ref_end: p.poleRefEnd,
            })
          : null;
      const chosen = feet
        ? {
            xFt: feet.xFt,
            yFt: feet.yFt,
            spanned: feet.span,
            interval: pendingGrid.interval,
            what: `grid ${p.fieldGridReference}`,
          }
        : post
          ? {
              xFt: post.xFt,
              yFt: post.yFt,
              spanned: post.spanned,
              interval: post.spanned,
              what: `post ${post.token}`,
            }
          : null;
      if (chosen) {
        out.push({
          source: "PENDING_FIELD_OBSERVATION",
          xFt: chosen.xFt,
          yFt: chosen.yFt,
          precision: chosen.interval ? "INTERVAL" : "GRIDLINE",
          spanned: chosen.spanned,
          basis: `Staged field observation (${chosen.what}) from audit batch ${p.batchId}, item ${p.itemKey}${
            p.observedAt ? `, observed ${p.observedAt}` : ""
          }. Not approved and not applied — shown for review only.`,
          accepted: false,
        });
      }
    }
  }


  // 2. The accepted current FarmOps corrected grid reference. grid_reference is
  //    always a corrected A–F / 1–9 reference, never read through the old drawing.
  if (correctedReference.ok) {
    const feet = newGridFeet(correctedReference);
    if (feet) {
      out.push({
        source: "DERIVED_FROM_GRID_REFERENCE",
        xFt: feet.xFt,
        yFt: feet.yFt,
        precision: correctedReference.interval ? "INTERVAL" : (usableStored ?? "GRIDLINE"),
        spanned: feet.span,
        basis: correctedReference.interval
          ? `Accepted corrected interval reference ${row.gridReference} — the record does not name a single point, so the span is preserved.`
          : `Accepted corrected grid reference ${row.gridReference}.`,
        accepted: true,
      });
    }
  }

  // 3. Infrastructure tables were introduced with corrected-grid semantics, so a
  //    corrected-looking `grid` on those kinds is an accepted current reference.
  if (currentGrid.ok && row.kind !== "load" && row.kind !== "panel") {
    const feet = newGridFeet(currentGrid);
    if (feet) {
      out.push({
        source: "DERIVED_FROM_CURRENT_GRID",
        xFt: feet.xFt,
        yFt: feet.yFt,
        precision: currentGrid.interval ? "INTERVAL" : "GRIDLINE",
        spanned: feet.span,
        basis: currentGrid.interval
          ? `Interval reference ${row.grid} — the record does not name a single point, so the span is preserved.`
          : `Corrected-grid reference ${row.grid}.`,
        accepted: true,
      });
    }
  }

  // 4. Canonical / recovery-derived placement: load and panel `grid` values stay
  //    in the previous A–G / 1–6 system until an accepted corrected reference
  //    exists, so they are decoded through the frozen legacy transformation.
  if (row.kind === "load" || row.kind === "panel") {
    const legacy = parseOldGrid(row.grid ?? row.legacyGrid ?? "");
    if (!legacy.uninterpretable && legacy.letter != null && legacy.number != null) {
      const xFt = oldNumberToFeet(legacy.number);
      const yFt = oldLetterToFeet(legacy.letter);
      if (xFt != null && yFt != null) {
        out.push({
          source: "DERIVED_FROM_LEGACY_GRID",
          xFt,
          yFt,
          precision: usableStored === "EXACT" ? "EXACT" : "NEAREST",
          spanned: false,
          basis: `Canonical / recovery-derived: legacy grid ${row.grid ?? row.legacyGrid} decoded through the frozen previous A–G / 1–6 drawing.`,
          accepted: true,
        });
      }
    }
  }

  // 5. Recorded X/Y that is legacy, provisional or unverified. Never allowed to
  //    outrank an accepted grid assignment merely because the columns are filled.
  if (x != null && y != null && !isCurrentVerifiedObservation(row)) {
    out.push({
      source: "PROVISIONAL_RECORDED_XY",
      xFt: x,
      yFt: y,
      precision: usableStored && usableStored !== "EXACT" ? usableStored : "NEAREST",
      spanned: usableStored === "INTERVAL",
      basis: `Provisional recorded X/Y (${x} ft E, ${y} ft S): field verification is ${VERIFICATION_LABEL[verificationOf(row.verification)]}, so it is not treated as an approved installed position.`,
      accepted: false,
    });
  }

  return out;
}

const DISAGREE_TOLERANCE_FT = 0.5;

/**
 * Resolves one record to a single auditable placement. Precedence is explicit,
 * candidates that disagree are reported instead of being silently chosen, and no
 * position is ever fabricated.
 */
export function classifyLocation(row: OperationalInput): {
  precision: LocationPrecision;
  basis: string;
  xFt: number | null;
  yFt: number | null;
  spanned: boolean;
  source: PlacementSource;
  candidates: PlacementCandidate[];
  disagreement: string | null;
} {
  const stored = precisionFromStored(row.storedPrecision);
  const verification = verificationOf(row.verification);
  const correctedReference = parseNewGrid(row.gridReference ?? "");
  const currentGrid = parseNewGrid(row.grid ?? "");

  if (
    verification === "INTENTIONALLY_MOBILE" ||
    currentGrid.mobile ||
    correctedReference.mobile ||
    stored === "NON_FIXED"
  ) {
    return {
      precision: "NON_FIXED",
      basis: "Mobile / non-fixed equipment: no permanent installed location is implied, by design.",
      xFt: null,
      yFt: null,
      spanned: false,
      source: "NOT_PLOTTED",
      candidates: [],
      disagreement: null,
    };
  }

  const candidates = placementCandidatesFor(row);
  const chosen = candidates[0];

  if (!chosen) {
    return {
      precision: "UNRESOLVED",
      basis: currentGrid.artifact
        ? `Grid value "${row.grid}" is a non-location artifact, so no position can be stated.`
        : row.grid
          ? `Grid value "${row.grid}" is not a usable reference and no accepted physical X/Y is recorded.`
          : "No grid reference and no accepted physical X/Y in the record.",
      xFt: null,
      yFt: null,
      spanned: false,
      source: "NOT_PLOTTED",
      candidates,
      disagreement: null,
    };
  }

  const conflicting = candidates.filter(
    (c) =>
      c !== chosen &&
      (Math.abs(c.xFt - chosen.xFt) > DISAGREE_TOLERANCE_FT ||
        Math.abs(c.yFt - chosen.yFt) > DISAGREE_TOLERANCE_FT),
  );
  const disagreement = conflicting.length
    ? `Placement sources disagree. Selected ${PLACEMENT_SOURCE_LABEL[chosen.source]} at ${chosen.xFt} ft E / ${chosen.yFt} ft S. Also available: ${conflicting
        .map(
          (c) => `${PLACEMENT_SOURCE_LABEL[c.source]} at ${c.xFt} ft E / ${c.yFt} ft S`,
        )
        .join("; ")}. No value was overwritten — owner review required.`
    : null;

  return {
    precision: chosen.precision,
    basis: chosen.basis,
    xFt: chosen.xFt,
    yFt: chosen.yFt,
    spanned: chosen.spanned,
    source: chosen.source,
    candidates,
    disagreement,
  };
}

/**
 * Marks co-located records so the map can report a cluster. The true anchor
 * (plottedXFt/plottedYFt, xPct/yPct) is never moved and no default offset is
 * applied; the map expands a cluster only when one of its records is selected.
 */
function cluster(assets: OperationalAsset[]): OperationalAsset[] {
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
      // No default displacement: co-located records keep their exact anchor and
      // the map collapses them into a cluster badge, spidering apart only when
      // one of them is selected. Separation is a view concern, never data.
      a.fanDxFt = 0;
      a.fanDyFt = 0;
    });
  }
  return assets;
}

/** The verified reference the plot came from, preserved exactly as recorded. */
function verifiedReferenceOf(row: OperationalInput, source: PlacementSource): string | null {
  const post = [row.poleRefStart, row.poleRefEnd].filter(Boolean).join(" – ") || null;
  switch (source) {
    case "OBSERVED_POST":
      return post;
    case "OBSERVED_FIELD_GRID":
      return row.fieldGridReference ?? null;
    case "PENDING_FIELD_OBSERVATION":
      return row.pendingObservation?.fieldGridReference ?? null;
    case "VERIFIED_FIELD_OBSERVATION_XY": {
      if (row.xFt == null || row.yFt == null) return null;
      const method = measuredXyMethodOf(row.measuredMethod);
      return `${row.xFt} ft E / ${row.yFt} ft S${
        method ? ` (measured, ${MEASURED_XY_METHOD_LABEL[method]})` : ""
      }`;
    }
    case "APPROVED_DESIGN_XY":
    case "DERIVED_FROM_GRID_REFERENCE":
      return row.gridReference ?? row.designGrid ?? null;
    default:
      return row.grid ?? null;
  }
}

/** Audit batch identifier behind the verified reference, when the record states one. */
function auditIdOf(row: OperationalInput): string | null {
  const staged = row.pendingObservation?.batchId ?? null;
  if (staged) return staged;
  for (const text of [row.locationEvidence, row.verificationNotes]) {
    const m = /\b(FA-[A-Z0-9-]+)\b/i.exec(text ?? "");
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

export function buildOperationalAssets(rows: OperationalInput[]): OperationalAsset[] {
  const assets = rows.map((row) => {
    const place = classifyLocation(row);
    const effective = effectiveLocationForOperational(row);
    const plottable = PRECISION_META[place.precision].plottable && place.xFt != null;
    const source: PlacementSource = plottable ? place.source : "NOT_PLOTTED";
    const provenance = plotProvenanceFor(source, place.spanned);

    const asset: OperationalAsset = {
      ...row,
      precision: place.precision,
      precisionBasis: place.basis,
      plottedXFt: plottable ? place.xFt : null,
      plottedYFt: plottable ? place.yFt : null,
      xPct: plottable ? ((place.xFt as number) / activeGridGeometry().widthFt) * 100 : null,
      yPct: plottable ? ((place.yFt as number) / activeGridGeometry().depthFt) * 100 : null,
      spanned: place.spanned,
      locationSource: source,
      plotProvenance: provenance,
      plotDerivation: PLOT_DERIVATION[provenance],
      verifiedReference: verifiedReferenceOf(row, source),
      auditId: auditIdOf(row),
      placementCandidates: place.candidates,
      placementDisagreement: place.disagreement,
      effectiveLocation: effective,
      locationProvenance: effective.provenance,


      stackIndex: 0,
      stackSize: 1,
      fanDxFt: 0,
      fanDyFt: 0,
    };
    return asset;
  });
  return cluster(assets);
}


/* ---------------------------------------------------------------- summaries */

export interface OperationalSummary {
  total: number;
  plotted: number;
  unplotted: number;
  precision: Record<LocationPrecision, number>;
  verification: Record<VerificationStatus, number>;
  kinds: Record<string, number>;
  /** Count of records by the placement source actually used. */
  placementSources: Record<PlacementSource, number>;
  /** Count of records by the provenance of the point actually drawn. */
  plotProvenance: Record<PlotProvenance, number>;
  /** Records carrying a field-verified location reference in this instance. */
  fieldVerified: number;
  /** Records carrying a measured field X/Y coordinate in this instance. */
  measuredFieldXy: number;
  /** Records whose placement sources disagree and need owner review. */
  placementDisagreements: number;
  /** The location-authority notice for this instance, stated from these records. */
  locationAuthorityNotice: string;
  /** Deployment scope of field-audit evidence, explained separately. */
  deploymentScopeNotice: string;
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
  const placementSources = Object.fromEntries(
    PLACEMENT_SOURCE_ORDER.map((p) => [p, 0]),
  ) as Record<PlacementSource, number>;
  const plotProvenance = Object.fromEntries(
    PLOT_PROVENANCE_ORDER.map((p) => [p, 0]),
  ) as Record<PlotProvenance, number>;
  const kinds: Record<string, number> = {};
  let plotted = 0;
  let placementDisagreements = 0;
  let fieldVerified = 0;
  let measuredFieldXy = 0;
  for (const a of assets) {
    precision[a.precision] += 1;
    verification[verificationOf(a.verification)] += 1;
    placementSources[a.locationSource] += 1;
    plotProvenance[a.plotProvenance] += 1;
    if (a.placementDisagreement) placementDisagreements += 1;
    if (
      a.fieldGridReference ||
      a.poleLocationKind ||
      FIELD_VERIFIED_SOURCES.includes(a.locationSource)
    )
      fieldVerified += 1;
    if (a.locationSource === "VERIFIED_FIELD_OBSERVATION_XY") measuredFieldXy += 1;
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
    placementSources,
    plotProvenance,
    fieldVerified,
    measuredFieldXy,
    placementDisagreements,
    locationAuthorityNotice: fieldVerifiedLocationNotice({
      verified: fieldVerified,
      measuredXy: measuredFieldXy,
    }),
    deploymentScopeNotice: DEPLOYMENT_SCOPE_NOTICE,
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
    "placement_source",
    "placement_disagreement",
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
      PLACEMENT_SOURCE_LABEL[a.locationSource],
      a.placementDisagreement ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
