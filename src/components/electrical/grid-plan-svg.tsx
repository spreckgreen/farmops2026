// One coordinate system for the Farm Shop plan and every marker.
//
// The drawing and all markers live in a single SVG with a fixed viewBox in the
// drawing's own pixel space, so the whole thing scales as one unit: browser zoom,
// window size, device pixel ratio and responsive layout cannot move a marker
// relative to the plan. Positions come only from feetToPlanPx — never from
// viewport measurements, page coordinates or separately measured elements.
import { useState } from "react";
import { feetToPlanPx, PLAN_IMAGE, PLAN_VIEW_BOX } from "@/lib/electrical-grid-plan-geometry";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
import {
  PRECISION_META,
  VERIFICATION_LABEL,
  verificationOf,
  type LocationPrecision,
  type OperationalAsset,
} from "@/lib/electrical-grid-operational";
import planImage from "@/assets/farm-shop-grid-plan.png";

/** Marker colours, matched to the on-screen swatches and the PDF export. */
export const PRECISION_HEX: Record<LocationPrecision, string> = {
  EXACT: "#059669",
  NEAREST: "#0284c7",
  INTERVAL: "#f59e0b",
  GRIDLINE: "#6366f1",
  NON_FIXED: "#a855f7",
  UNRESOLVED: "#71717a",
};

export const PLAN_ALT =
  "Overhead grid plan of the 40 by 60 foot Farm Shop with lettered rows A to F north to south and numbered columns 1 to 9 west to east, showing the north wall openings and the north-east and south-west man doors";

/** Interval markers keep a visible span so they are never read as a point. */
const INTERVAL_SPAN_FT = 4;

export function GridPlanSvg({
  plotted,
  selectedId,
  onSelect,
  interactive = true,
  markerScale = 1,
  className,
}: {
  plotted: OperationalAsset[];
  selectedId?: string | null;
  onSelect?: (stableId: string) => void;
  interactive?: boolean;
  markerScale?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox={PLAN_VIEW_BOX}
      className={className ?? "block h-auto w-full select-none"}
      role="img"
      aria-label={PLAN_ALT}
      preserveAspectRatio="xMidYMid meet"
    >
      <image
        href={planImage}
        x={0}
        y={0}
        width={PLAN_IMAGE.width}
        height={PLAN_IMAGE.height}
        preserveAspectRatio="none"
      />
      {/* Envelope drawn from the same transform, so any drift is visible. */}
      <PlanEnvelope />
      {plotted.map((a) => {
        if (a.plottedXFt == null || a.plottedYFt == null) return null;
        const anchor = feetToPlanPx(a.plottedXFt, a.plottedYFt);
        const shown = feetToPlanPx(a.plottedXFt + a.fanDxFt, a.plottedYFt + a.fanDyFt);
        const offset = a.fanDxFt !== 0 || a.fanDyFt !== 0;
        const selected = selectedId === a.stableId;
        const r = (selected ? 13 : 9) * markerScale;
        const fill = PRECISION_HEX[a.precision];
        const label = `${a.stableId} ${a.description ?? ""}`.trim();
        return (
          <g
            key={`${a.kind}-${a.stableId}`}
            {...(interactive
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": label,
                  onClick: () => onSelect?.(a.stableId),
                  onFocus: () => onSelect?.(a.stableId),
                  style: { cursor: "pointer" },
                }
              : {})}
            data-stable-id={a.stableId}
            data-x-ft={a.plottedXFt}
            data-y-ft={a.plottedYFt}
            data-precision={a.precision}
          >
            {offset ? (
              <>
                <line
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={shown.x}
                  y2={shown.y}
                  stroke={fill}
                  strokeWidth={2}
                />
                <circle cx={anchor.x} cy={anchor.y} r={2.5} fill={fill} />
              </>
            ) : null}
            {a.spanned ? (
              // An interval is drawn as a segment, never as an exact point.
              <>
                <line
                  x1={feetToPlanPx(a.plottedXFt - INTERVAL_SPAN_FT, a.plottedYFt).x}
                  y1={shown.y}
                  x2={feetToPlanPx(a.plottedXFt + INTERVAL_SPAN_FT, a.plottedYFt).x}
                  y2={shown.y}
                  stroke={fill}
                  strokeWidth={4 * markerScale}
                  strokeDasharray="6 4"
                  opacity={0.85}
                />
                <circle
                  cx={shown.x}
                  cy={shown.y}
                  r={r * 0.7}
                  fill={fill}
                  fillOpacity={0.55}
                  stroke="#ffffff"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              </>
            ) : a.kind === "panel" ? (
              <rect
                x={shown.x - r}
                y={shown.y - r}
                width={r * 2}
                height={r * 2}
                rx={2}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ) : (
              <circle cx={shown.x} cy={shown.y} r={r} fill={fill} stroke="#ffffff" strokeWidth={2} />
            )}
            {interactive ? <title>{`${label} — ${a.precision}`}</title> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Accepted 60 ft x 40 ft envelope and gridline ticks, from the same transform. */
function PlanEnvelope() {
  const nw = feetToPlanPx(0, 0);
  const se = feetToPlanPx(60, 40);
  return (
    <g pointerEvents="none">
      <rect
        x={nw.x}
        y={nw.y}
        width={se.x - nw.x}
        height={se.y - nw.y}
        fill="none"
        stroke="#2563eb"
        strokeOpacity={0.25}
        strokeWidth={2}
      />
      {AXIS_COLS.map((c) =>
        AXIS_ROWS.map((row) => {
          const p = feetToPlanPx(c.xFt, row.yFt);
          return (
            <circle
              key={`${c.label}-${row.label}`}
              cx={p.x}
              cy={p.y}
              r={1.5}
              fill="#2563eb"
              fillOpacity={0.3}
            />
          );
        }),
      )}
    </g>
  );
}
