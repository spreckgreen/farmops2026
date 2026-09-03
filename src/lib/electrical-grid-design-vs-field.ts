// Design-versus-field comparison for the Farm Shop plan.
//
// Read-only and derived: it compares two positions the record ALREADY states —
// the approved design X/Y and the verified field-observation X/Y — and reports
// whether they agree. It never chooses a winner, never writes, and never infers
// a position from a grid reference (the grid stays a human-readable lookup).
import type { OperationalAsset, PlacementCandidate } from "./electrical-grid-operational";

/** Agreement window in feet. Anything larger is reported, never reconciled. */
export const DESIGN_FIELD_TOLERANCE_FT = 0.5;

export type DesignFieldStatus =
  /** Design and field observation agree within tolerance. */
  | "MATCH"
  /** Both stated, but they disagree beyond tolerance — highlighted on the map. */
  | "MISMATCH"
  /** Approved design position with no verified field observation yet. */
  | "DESIGN_ONLY"
  /** Field verified, but the record carries no approved design position. */
  | "FIELD_ONLY";

export interface DesignFieldPair {
  stableId: string;
  description: string | null;
  panel: string | null;
  status: DesignFieldStatus;
  designXFt: number | null;
  designYFt: number | null;
  fieldXFt: number | null;
  fieldYFt: number | null;
  /** Straight-line separation in feet, rounded to 0.1 ft. Null unless both exist. */
  deltaFt: number | null;
  /** Plain-language basis, suitable for a tooltip or an audit line. */
  basis: string;
}

const pick = (
  candidates: PlacementCandidate[],
  source: PlacementCandidate["source"],
): PlacementCandidate | null => candidates.find((c) => c.source === source) ?? null;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Compare one record's approved design position with its verified field observation. */
export function designFieldPair(asset: OperationalAsset): DesignFieldPair | null {
  const design = pick(asset.placementCandidates, "APPROVED_DESIGN_XY");
  const field = pick(asset.placementCandidates, "VERIFIED_FIELD_OBSERVATION_XY");
  if (!design && !field) return null;

  const base = {
    stableId: asset.stableId,
    description: asset.description ?? null,
    panel: asset.panel ?? null,
    designXFt: design ? design.xFt : null,
    designYFt: design ? design.yFt : null,
    fieldXFt: field ? field.xFt : null,
    fieldYFt: field ? field.yFt : null,
  };

  if (design && !field) {
    return {
      ...base,
      status: "DESIGN_ONLY",
      deltaFt: null,
      basis: `Approved design ${design.xFt} ft E / ${design.yFt} ft S — no verified field observation in the record.`,
    };
  }
  if (field && !design) {
    return {
      ...base,
      status: "FIELD_ONLY",
      deltaFt: null,
      basis: `Verified field observation ${field.xFt} ft E / ${field.yFt} ft S — no approved design position in the record.`,
    };
  }

  const d = design as PlacementCandidate;
  const f = field as PlacementCandidate;
  const deltaFt = round1(Math.hypot(f.xFt - d.xFt, f.yFt - d.yFt));
  const mismatch = deltaFt > DESIGN_FIELD_TOLERANCE_FT;
  return {
    ...base,
    status: mismatch ? "MISMATCH" : "MATCH",
    deltaFt,
    basis: mismatch
      ? `Field observation is ${deltaFt} ft from the approved design (${d.xFt}/${d.yFt} ft design vs ${f.xFt}/${f.yFt} ft as found). Disposition required — nothing was changed.`
      : `Field observation agrees with the approved design within ${DESIGN_FIELD_TOLERANCE_FT} ft (${deltaFt} ft apart).`,
  };
}

export interface DesignFieldOverlay {
  pairs: DesignFieldPair[];
  counts: Record<DesignFieldStatus, number>;
  mismatchIds: string[];
}

/** Build the overlay for the currently filtered assets. */
export function designFieldOverlay(assets: OperationalAsset[]): DesignFieldOverlay {
  const pairs: DesignFieldPair[] = [];
  for (const a of assets) {
    const p = designFieldPair(a);
    if (p) pairs.push(p);
  }
  pairs.sort(
    (a, b) =>
      (b.deltaFt ?? -1) - (a.deltaFt ?? -1) || a.stableId.localeCompare(b.stableId),
  );
  const counts: Record<DesignFieldStatus, number> = {
    MATCH: 0,
    MISMATCH: 0,
    DESIGN_ONLY: 0,
    FIELD_ONLY: 0,
  };
  for (const p of pairs) counts[p.status] += 1;
  return { pairs, counts, mismatchIds: pairs.filter((p) => p.status === "MISMATCH").map((p) => p.stableId) };
}

export const DESIGN_FIELD_STATUS_LABEL: Record<DesignFieldStatus, string> = {
  MATCH: "Design confirmed by field",
  MISMATCH: "Design / field mismatch",
  DESIGN_ONLY: "Design only — not yet field verified",
  FIELD_ONLY: "Field verified — no design position",
};

/** Overlay colours, shared by the SVG layer and the on-screen legend. */
export const DESIGN_FIELD_HEX: Record<DesignFieldStatus, string> = {
  MATCH: "#059669",
  MISMATCH: "#dc2626",
  DESIGN_ONLY: "#7c3aed",
  FIELD_ONLY: "#0284c7",
};
