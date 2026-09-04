// Farm Shop grid map overlays: base reference selection, per-cell object counts,
// most-recent-observed highlighting and planned / remaining / current progress
// modes.
//
// Pure and derivation-only. Nothing here writes a record, invents a location or
// promotes a staged observation into an accepted statement — every count and
// every membership test reads only what the operational feed already states.
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
import { PROPOSED_POST_POSITIONS, type PostPosition } from "@/lib/electrical-grid-post-geometry";
import { verificationOf, type OperationalAsset } from "@/lib/electrical-grid-operational";

/* ------------------------------------------------------------------ *
 * Base reference overlay
 * ------------------------------------------------------------------ */

/**
 * Which base reference the plan is read against:
 * - `POLE_AND_GRID` — perimeter posts plus the A1–F9 grid (pole-based grid).
 * - `GRID_ONLY` — the A1–F9 lettered/numbered grid alone.
 * - `POLE_ONLY` — the perimeter post callouts alone.
 */
export type GridBaseOverlay = "POLE_AND_GRID" | "GRID_ONLY" | "POLE_ONLY";

export const GRID_BASE_OVERLAY_ORDER: GridBaseOverlay[] = [
  "POLE_AND_GRID",
  "GRID_ONLY",
  "POLE_ONLY",
];

export const GRID_BASE_OVERLAY_LABEL: Record<GridBaseOverlay, string> = {
  POLE_AND_GRID: "Pole-based grid (posts + A1–F9)",
  GRID_ONLY: "A1–F9 grid only",
  POLE_ONLY: "Posts only",
};

export const GRID_BASE_OVERLAY_NOTE: Record<GridBaseOverlay, string> = {
  POLE_AND_GRID:
    "Perimeter post callouts drawn with the corrected A–F / 1–9 grid lines. Post positions are the proposed geometry derived from the frozen outline and are not field confirmed.",
  GRID_ONLY: "Corrected A–F / 1–9 grid lines only, as frozen from the corrected Farm Shop drawing.",
  POLE_ONLY:
    "Perimeter post callouts only. Post positions are the proposed geometry derived from the frozen outline and are not field confirmed.",
};

export function overlayShowsGrid(o: GridBaseOverlay): boolean {
  return o === "POLE_AND_GRID" || o === "GRID_ONLY";
}

export function overlayShowsPosts(o: GridBaseOverlay): boolean {
  return o === "POLE_AND_GRID" || o === "POLE_ONLY";
}

export function overlayPosts(o: GridBaseOverlay): PostPosition[] {
  return overlayShowsPosts(o) ? PROPOSED_POST_POSITIONS : [];
}

export function isGridBaseOverlay(v: unknown): v is GridBaseOverlay {
  return typeof v === "string" && (GRID_BASE_OVERLAY_ORDER as string[]).includes(v);
}

/* ------------------------------------------------------------------ *
 * Progress mode
 * ------------------------------------------------------------------ */

/**
 * - `PLANNED` — the full designed scope: every record in the feed.
 * - `REMAINING` — planned work not yet recorded as installed.
 * - `CURRENT` — what stands today, including recent field audits that are
 *   staged but not yet approved (clearly labelled as such).
 */
export type ProgressMode = "PLANNED" | "REMAINING" | "CURRENT";

export const PROGRESS_MODE_ORDER: ProgressMode[] = ["PLANNED", "REMAINING", "CURRENT"];

export const PROGRESS_MODE_LABEL: Record<ProgressMode, string> = {
  PLANNED: "Planned (full scope)",
  REMAINING: "Remaining plan",
  CURRENT: "Current (incl. recent audits)",
};

export const PROGRESS_MODE_NOTE: Record<ProgressMode, string> = {
  PLANNED: "Every record in scope, installed or not.",
  REMAINING: "Records with no installed status recorded yet — the work still outstanding.",
  CURRENT:
    "Records recorded as installed, plus records with a staged field observation from a recent audit that has not been approved or applied.",
};

/** Install statuses that mean the record is in place, per the install records. */
export const INSTALLED_STATUSES = [
  "device_side_connected",
  "source_side_connected",
  "tested",
  "complete",
  "as_built_verified",
] as const;

const INSTALLED = new Set<string>(INSTALLED_STATUSES);

export function isInstalledAsset(a: OperationalAsset): boolean {
  return INSTALLED.has((a.installStatus ?? "").trim());
}

/** True when a staged, unapproved field observation exists for this record. */
export function hasStagedObservation(a: OperationalAsset): boolean {
  return Boolean(a.pendingObservation);
}

export function progressModeMatches(a: OperationalAsset, mode: ProgressMode): boolean {
  switch (mode) {
    case "PLANNED":
      return true;
    case "REMAINING":
      return !isInstalledAsset(a);
    case "CURRENT":
      return isInstalledAsset(a) || hasStagedObservation(a);
    default:
      return true;
  }
}

export interface ProgressCounts {
  PLANNED: number;
  REMAINING: number;
  CURRENT: number;
  /** Records inside CURRENT only because of a staged, unapproved observation. */
  stagedOnly: number;
  /** Share of the planned scope recorded as installed, 0–100 (one decimal). */
  installedPct: number;
}

export function progressCounts(assets: OperationalAsset[]): ProgressCounts {
  let installed = 0;
  let stagedOnly = 0;
  for (const a of assets) {
    const inPlace = isInstalledAsset(a);
    if (inPlace) installed += 1;
    else if (hasStagedObservation(a)) stagedOnly += 1;
  }
  const total = assets.length;
  return {
    PLANNED: total,
    REMAINING: total - installed,
    CURRENT: installed + stagedOnly,
    stagedOnly,
    installedPct: total ? Math.round((installed / total) * 1000) / 10 : 0,
  };
}

export function isProgressMode(v: unknown): v is ProgressMode {
  return typeof v === "string" && (PROGRESS_MODE_ORDER as string[]).includes(v);
}

/* ------------------------------------------------------------------ *
 * Per-grid object counts (shown before any marker is selected)
 * ------------------------------------------------------------------ */

export interface GridCellCount {
  /** Cell label such as `C4`, derived from the frozen corrected axes. */
  cell: string;
  row: string;
  col: string;
  /** Cell centre, in feet, for drawing the count. */
  xFt: number;
  yFt: number;
  count: number;
  stableIds: string[];
}

function nearest<T extends { label: string }>(
  lines: readonly (T & { xFt?: number; yFt?: number })[],
  value: number,
  axis: "xFt" | "yFt",
): T {
  let best = lines[0] as T;
  let bestD = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const at = line[axis] as number;
    const d = Math.abs(at - value);
    if (d < bestD) {
      bestD = d;
      best = line as T;
    }
  }
  return best;
}

/**
 * Counts plotted records per grid cell. Only records that already carry a
 * plotted position are counted — unplotted records are never snapped into a
 * cell just to be counted.
 */
export function gridCellCounts(assets: OperationalAsset[]): GridCellCount[] {
  const byCell = new Map<string, GridCellCount>();
  for (const a of assets) {
    if (a.plottedXFt == null || a.plottedYFt == null) continue;
    const row = nearest(AXIS_ROWS, a.plottedYFt, "yFt");
    const col = nearest(AXIS_COLS, a.plottedXFt, "xFt");
    const cell = `${row.label}${col.label}`;
    const existing = byCell.get(cell);
    if (existing) {
      existing.count += 1;
      existing.stableIds.push(a.stableId);
      continue;
    }
    byCell.set(cell, {
      cell,
      row: row.label,
      col: col.label,
      xFt: col.xFt,
      yFt: row.yFt,
      count: 1,
      stableIds: [a.stableId],
    });
  }
  return [...byCell.values()].sort((a, b) => a.cell.localeCompare(b.cell));
}

/* ------------------------------------------------------------------ *
 * Most recent observed overlay
 * ------------------------------------------------------------------ */

export type ObservedSource = "VERIFIED_FIELD" | "STAGED_AUDIT" | "RECORD_UPDATE";

export const OBSERVED_SOURCE_LABEL: Record<ObservedSource, string> = {
  VERIFIED_FIELD: "Verified field observation",
  STAGED_AUDIT: "Staged audit observation (not approved)",
  RECORD_UPDATE: "Record last updated",
};

export interface ObservedEntry {
  stableId: string;
  observedAt: string;
  source: ObservedSource;
  /** Batch the staged observation came from, when the source is a staged audit. */
  batchId: string | null;
  note: string;
}

function iso(v: unknown): string | null {
  const s = (v == null ? "" : String(v)).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : s;
}

/**
 * Ranks records by the most recent observation each one actually states:
 * a verified field observation first, then a staged (unapproved) audit
 * observation, then the record's own last-updated stamp.
 */
export function recentObserved(assets: OperationalAsset[], limit = 12): ObservedEntry[] {
  const out: ObservedEntry[] = [];
  for (const a of assets) {
    const verified = iso(a.verifiedAt);
    const staged = iso(a.pendingObservation?.observedAt);
    const updated = iso(a.updatedAt);
    if (verified && verificationOf(a.verification) === "FIELD_VERIFIED") {
      out.push({
        stableId: a.stableId,
        observedAt: verified,
        source: "VERIFIED_FIELD",
        batchId: null,
        note: a.locationEvidence ?? "Field verified",
      });
      continue;
    }
    if (staged) {
      out.push({
        stableId: a.stableId,
        observedAt: staged,
        source: "STAGED_AUDIT",
        batchId: a.pendingObservation?.batchId ?? null,
        note:
          a.pendingObservation?.evidence ??
          "Observed in a staged audit batch — not approved, not applied",
      });
      continue;
    }
    if (verified) {
      out.push({
        stableId: a.stableId,
        observedAt: verified,
        source: "VERIFIED_FIELD",
        batchId: null,
        note: a.locationEvidence ?? "Verification stamp in record",
      });
      continue;
    }
    if (updated) {
      out.push({
        stableId: a.stableId,
        observedAt: updated,
        source: "RECORD_UPDATE",
        batchId: null,
        note: "No field observation in record; record update time only",
      });
    }
  }
  out.sort(
    (a, b) =>
      Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.stableId.localeCompare(b.stableId),
  );
  return out.slice(0, Math.max(0, limit));
}

export function recentObservedIds(assets: OperationalAsset[], limit = 12): string[] {
  return recentObserved(assets, limit).map((e) => e.stableId);
}
