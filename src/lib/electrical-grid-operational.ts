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
  effectiveLocationForRecord,
  type EffectiveLocation,
} from "@/lib/electrical-effective-location";
import {
  POST_GEOMETRY_CONFIRMED,
  postObservationFeet,
} from "@/lib/electrical-grid-post-geometry";
import { approvedDesignXy } from "@/lib/electrical-grid-plan-geometry";



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
  /** Applied field-observed grid cell (corrected A–F / 1–9), if any. */
  fieldGridReference?: string | null;
  /** Applied field-observed perimeter post callout, if any. */
  poleScheme?: string | null;
  poleLocationKind?: string | null;
  poleRefStart?: string | null;
  poleRefEnd?: string | null;
  /** A staged, not-yet-approved field observation for this record, if any. */
  pendingObservation?: PendingObservation | null;
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


/** Where a plotted position came from, in precedence order. */
export type PlacementSource =
  | "VERIFIED_FIELD_OBSERVATION_XY"
  | "OBSERVED_FIELD_GRID"
  | "OBSERVED_POST"
  | "APPROVED_DESIGN_XY"
  | "PENDING_FIELD_OBSERVATION"
  | "DERIVED_FROM_GRID_REFERENCE"
  | "DERIVED_FROM_CURRENT_GRID"
  | "DERIVED_FROM_LEGACY_GRID"
  | "PROVISIONAL_RECORDED_XY"
  | "NOT_PLOTTED";

export const PLACEMENT_SOURCE_LABEL: Record<PlacementSource, string> = {
  VERIFIED_FIELD_OBSERVATION_XY: "Verified field observation X/Y",
  OBSERVED_FIELD_GRID: "Applied field-observed grid cell",
  OBSERVED_POST: "Applied field-observed perimeter post",
  APPROVED_DESIGN_XY: "Approved design X/Y (not yet field verified)",
  PENDING_FIELD_OBSERVATION: "Field observation staged for approval (not applied)",
  DERIVED_FROM_GRID_REFERENCE: "Accepted corrected grid reference",
  DERIVED_FROM_CURRENT_GRID: "Accepted current FarmOps grid",
  DERIVED_FROM_LEGACY_GRID: "Canonical / recovery-derived legacy grid",
  PROVISIONAL_RECORDED_XY: "Provisional recorded X/Y (unverified)",
  NOT_PLOTTED: "Not plotted",
};

export const PLACEMENT_SOURCE_ORDER: PlacementSource[] = [
  "VERIFIED_FIELD_OBSERVATION_XY",
  "OBSERVED_FIELD_GRID",
  "OBSERVED_POST",
  "APPROVED_DESIGN_XY",
  "PENDING_FIELD_OBSERVATION",
  "DERIVED_FROM_GRID_REFERENCE",
  "DERIVED_FROM_CURRENT_GRID",
  "DERIVED_FROM_LEGACY_GRID",
  "PROVISIONAL_RECORDED_XY",
  "NOT_PLOTTED",
];



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
export function effectiveLocationForOperational(row: OperationalInput): EffectiveLocation {
  const legacyKind = row.kind === "load" || row.kind === "panel";
  const design = approvedDesignXy(row.stableId);
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
    designApprovalReference: design?.approval ?? null,
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

  // 1. Exact X/Y, but only from an approved/verified field observation that is
  //    marked as the current installed location.
  if (x != null && y != null && isCurrentVerifiedObservation(row)) {
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

  // 1a. Applied field-observed grid cell. This is an accepted as-built statement
  //     recorded by an applied audit, so it outranks design intent and every
  //     inherited grid assignment. It fixes the record to a grid cell, not to a
  //     measured point, so a verified X/Y still wins.
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
        basis: `Applied field observation: grid ${row.fieldGridReference}${
          row.verifiedAt ? `, verified ${row.verifiedAt}` : ""
        }. Fixes the record to that grid cell, not to a measured point.`,
        accepted: true,
      });
    }
  }

  // 1a2. Applied field-observed perimeter post. Only usable once the post
  //      geometry proposal has been confirmed by the owner.
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
        basis: `Applied field observation at post ${post.token}. ${post.basis}`,
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
    const dx = num(row.designXFt);
    const dy = num(row.designYFt);
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

export function buildOperationalAssets(rows: OperationalInput[]): OperationalAsset[] {
  const assets = rows.map((row) => {
    const place = classifyLocation(row);
    const effective = effectiveLocationForOperational(row);
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
  /** Records whose placement sources disagree and need owner review. */
  placementDisagreements: number;
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
  const kinds: Record<string, number> = {};
  let plotted = 0;
  let placementDisagreements = 0;
  for (const a of assets) {
    precision[a.precision] += 1;
    verification[verificationOf(a.verification)] += 1;
    placementSources[a.locationSource] += 1;
    if (a.placementDisagreement) placementDisagreements += 1;
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
    placementDisagreements,
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
