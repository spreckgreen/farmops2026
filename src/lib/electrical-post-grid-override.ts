// Manual grid-cell override for a perimeter post.
//
// The derived grid cell is a human-readable lookup of a post's frozen feet, never
// the position itself. When the geometric audit is uncertain about a post (an
// ambiguous, tied axis label, an off-outline distance, or any failed check) a
// person may state the real cell by hand. An override NEVER moves the post's
// coordinates and never edits the frozen geometry: it records the cell a person
// read in the field, plus the reconciliation note explaining the difference.
import { POST_GEOMETRY_AUDIT, POST_GEOMETRY_VERSION } from "@/lib/electrical-grid-post-geometry";
import type { PostGeometryCheck } from "@/lib/electrical-grid-post-geometry";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";

export const GRID_CELL_PATTERN = /^[A-F](-[A-F])?[1-9](-[1-9])?$/;
export const MIN_NOTE_LENGTH = 10;

/** Every single (untied) grid cell, in row-then-column order, for the picker. */
export const GRID_CELL_CHOICES: string[] = AXIS_ROWS.flatMap((r) =>
  AXIS_COLS.map((c) => `${r.label}${c.label}`),
);

export interface PostGridOverride {
  postRef: string;
  overrideGridCell: string;
  derivedGridCell: string | null;
  geometryVersion: string | null;
  reconciliationNote: string;
  updatedAt: string | null;
}

export interface PostGridUncertainty {
  uncertain: boolean;
  reasons: string[];
}

/**
 * Why the derived cell for one post may not be trusted. A tie ("A-B9") means the
 * post sits between two axis lines, so the printed cell is a judgement call.
 */
export function postGridUncertainty(check: PostGeometryCheck): PostGridUncertainty {
  const reasons: string[] = [];
  if (check.gridCell.includes("-")) {
    reasons.push(
      `Derived cell ${check.gridCell} is tied between adjoining grid lines, so the printed cell is ambiguous.`,
    );
  }
  if (check.offOutlineFt !== 0) {
    reasons.push(`Post sits ${check.offOutlineFt} ft off the frozen outline.`);
  }
  if (!check.ok) reasons.push(...check.issues);
  return { uncertain: reasons.length > 0, reasons };
}

export interface PostGridRow extends PostGeometryCheck {
  uncertainty: PostGridUncertainty;
  override: PostGridOverride | null;
  /** Cell to show: the manual override when present, otherwise the derived cell. */
  effectiveGridCell: string;
  effectiveBasis: "MANUAL_OVERRIDE" | "DERIVED_FROM_FROZEN_GEOMETRY";
}

/** Merge saved overrides onto the audit rows. Coordinates are never changed. */
export function postGridRows(overrides: PostGridOverride[] = []): PostGridRow[] {
  const byRef = new Map(overrides.map((o) => [o.postRef, o]));
  return POST_GEOMETRY_AUDIT.checks.map((check) => {
    const override = byRef.get(check.ref) ?? null;
    return {
      ...check,
      uncertainty: postGridUncertainty(check),
      override,
      effectiveGridCell: override?.overrideGridCell ?? check.gridCell,
      effectiveBasis: override ? "MANUAL_OVERRIDE" : "DERIVED_FROM_FROZEN_GEOMETRY",
    };
  });
}

export interface OverrideDraft {
  postRef: unknown;
  gridCell: unknown;
  note: unknown;
}

export type OverrideValidation =
  | { ok: true; postRef: string; gridCell: string; note: string; derivedGridCell: string; geometryVersion: string }
  | { ok: false; error: string };

/**
 * Validate a manual override before it is saved. Rejects unknown posts, malformed
 * cells, a missing reconciliation note, and a "correction" that just restates the
 * derived cell — an override must record an actual difference.
 */
export function validateOverrideDraft(draft: OverrideDraft): OverrideValidation {
  const postRef = typeof draft.postRef === "string" ? draft.postRef.trim().toUpperCase() : "";
  const check = POST_GEOMETRY_AUDIT.checks.find((c) => c.ref === postRef);
  if (!check) return { ok: false, error: "Unknown post reference." };

  const gridCell = typeof draft.gridCell === "string" ? draft.gridCell.trim().toUpperCase() : "";
  if (!GRID_CELL_PATTERN.test(gridCell)) {
    return { ok: false, error: "Grid cell must be a row A–F and a column 1–9, for example F8." };
  }
  if (gridCell === check.gridCell) {
    return {
      ok: false,
      error: `${postRef} already derives ${check.gridCell}; an override must record a different cell.`,
    };
  }

  const note = typeof draft.note === "string" ? draft.note.trim() : "";
  if (note.length < MIN_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Add a reconciliation note of at least ${MIN_NOTE_LENGTH} characters explaining the correction.`,
    };
  }

  return {
    ok: true,
    postRef,
    gridCell,
    note,
    derivedGridCell: check.gridCell,
    geometryVersion: POST_GEOMETRY_VERSION,
  };
}
