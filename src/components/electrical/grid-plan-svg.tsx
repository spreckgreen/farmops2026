// One coordinate system for the Farm Shop plan and every marker.
//
// The drawing and all markers live in a single SVG with a fixed viewBox in the
// drawing's own pixel space, so the whole thing scales as one unit: browser zoom,
// window size, device pixel ratio and responsive layout cannot move a marker
// relative to the plan. Positions come only from feetToPlanPx — never from
// viewport measurements, page coordinates or separately measured elements.
import { useCallback, useMemo, useRef, useState } from "react";
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
  // Helper text follows, in order: the marker under the pointer/keyboard focus,
  // then the selected marker — so after a click the same helper stays visible
  // once the mouse moves away. Escape dismisses the pinned (selected) one.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pinned = selectedId && selectedId !== dismissed ? selectedId : null;
  const hintId = hovered ?? pinned;
  const hint = interactive ? (plotted.find((a) => a.stableId === hintId) ?? null) : null;

  // Keyboard order: north-to-south, then west-to-east, so arrow keys walk the
  // plan the same way a reader scans it.
  const order = useMemo(
    () =>
      plotted
        .filter((a) => a.plottedXFt != null && a.plottedYFt != null)
        .slice()
        .sort(
          (a, b) => (a.plottedYFt ?? 0) - (b.plottedYFt ?? 0) || (a.plottedXFt ?? 0) - (b.plottedXFt ?? 0),
        )
        .map((a) => a.stableId),
    [plotted],
  );
  const nodes = useRef(new Map<string, SVGGElement | null>());

  const moveFocus = useCallback(
    (from: string, delta: number | "first" | "last") => {
      if (order.length === 0) return;
      const i = order.indexOf(from);
      const next =
        delta === "first"
          ? 0
          : delta === "last"
            ? order.length - 1
            : (((i === -1 ? 0 : i) + delta + order.length) % order.length);
      const id = order[next];
      if (!id) return;
      nodes.current.get(id)?.focus();
    },
    [order],
  );

  const onMarkerKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGGElement>, stableId: string) => {
      switch (e.key) {
        case "Enter":
        case " ":
        case "Spacebar":
          e.preventDefault();
          setDismissed(null);
          onSelect?.(stableId);
          setHovered(stableId);
          return;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          moveFocus(stableId, 1);
          return;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          moveFocus(stableId, -1);
          return;
        case "Home":
          e.preventDefault();
          moveFocus(stableId, "first");
          return;
        case "End":
          e.preventDefault();
          moveFocus(stableId, "last");
          return;
        case "Escape":
          // Dismiss the helper text — including the pinned selection — but keep
          // focus where it is.
          setHovered(null);
          setDismissed(selectedId ?? null);
          return;
        default:
      }
    },
    [moveFocus, onSelect, selectedId],
  );

  return (
    <svg
      viewBox={PLAN_VIEW_BOX}
      className={className ?? "block h-auto w-full select-none"}
      // Interactive maps must expose their markers, so the plan is a labelled
      // group; the static (print/PDF) render stays a single image.
      role={interactive ? "group" : "img"}
      aria-label={interactive ? `${PLAN_ALT}. ${order.length} markers.` : PLAN_ALT}
      aria-describedby={interactive ? "grid-plan-keyboard-help" : undefined}
      preserveAspectRatio="xMidYMid meet"
    >
      {interactive ? (
        <desc id="grid-plan-keyboard-help">
          Use Tab to enter the markers, arrow keys or Home and End to move between them, Enter or
          Space to open the full record, and Escape to dismiss the helper text.
        </desc>
      ) : null}
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
        // Screen readers get the same facts the sighted hover card shows.
        const label = hintLines(a).join(". ");
        const focused = focusedId === a.stableId;
        return (
          <g
            key={`${a.kind}-${a.stableId}`}
            {...(interactive
              ? {
                  ref: (el: SVGGElement | null) => {
                    nodes.current.set(a.stableId, el);
                  },
                  role: "button",
                  tabIndex: 0,
                  "aria-label": label,
                  "aria-pressed": selected,
                  onClick: () => {
                    // Clicking re-pins the helper text to this marker.
                    setDismissed(null);
                    onSelect?.(a.stableId);
                  },
                  onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => onMarkerKeyDown(e, a.stableId),
                  onFocus: () => {
                    setFocusedId(a.stableId);
                    setHovered(a.stableId);
                  },
                  onBlur: () => {
                    setFocusedId((f) => (f === a.stableId ? null : f));
                    setHovered((h) => (h === a.stableId ? null : h));
                  },
                  onMouseEnter: () => setHovered(a.stableId),
                  onMouseLeave: () => setHovered((h) => (h === a.stableId ? null : h)),
                  style: { cursor: "pointer", outline: "none" },
                }
              : {})}
            data-stable-id={a.stableId}
            data-x-ft={a.plottedXFt}
            data-y-ft={a.plottedYFt}
            data-precision={a.precision}
          >
            {focused ? (
              // Visible focus ring, drawn in plan space so it scales with the map.
              <circle
                cx={shown.x}
                cy={shown.y}
                r={r + 7}
                fill="none"
                stroke="#111827"
                strokeWidth={5}
                pointerEvents="none"
              />
            ) : null}
            {focused ? (
              <circle
                cx={shown.x}
                cy={shown.y}
                r={r + 7}
                fill="none"
                stroke="#facc15"
                strokeWidth={3}
                pointerEvents="none"
              />
            ) : null}
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
            {/* Helper text is drawn in-SVG (HoverHint); aria-label carries it for AT. */}
          </g>
        );
      })}
      {hint ? <HoverHint asset={hint} /> : null}
    </svg>
  );
}

/** The helper-text facts, shared by the drawn hover card and the marker's
 * aria-label, so keyboard and screen-reader users get exactly what a mouse
 * user sees. */
export function hintLines(asset: OperationalAsset): string[] {
  return [
    asset.stableId,
    asset.description ?? "No description in record",
    `${PRECISION_META[asset.precision].label} · ${asset.plottedXFt ?? "?"} ft E, ${asset.plottedYFt ?? "?"} ft S`,
    `Panel: ${asset.panel ?? "NOT IN RECORD"} · Install: ${asset.installStatus ?? "NOT IN RECORD"}`,
    `Verification: ${VERIFICATION_LABEL[verificationOf(asset.verification)]}`,
    ...(asset.spanned ? ["Interval — a preserved span, not a final point"] : []),
    ...(asset.placementDisagreement ? ["Placement conflict — see Data quality"] : []),
  ];
}

/** Hover/focus helper text, drawn inside the same viewBox so it scales with the
 * plan and never drifts at a different browser zoom. */
function HoverHint({ asset }: { asset: OperationalAsset }) {
  if (asset.plottedXFt == null || asset.plottedYFt == null) return null;
  const at = feetToPlanPx(asset.plottedXFt + asset.fanDxFt, asset.plottedYFt + asset.fanDyFt);
  const lines = hintLines(asset);
  const fontSize = 22;
  const pad = 12;
  const lineH = fontSize * 1.35;
  const width = Math.min(
    620,
    Math.max(240, Math.max(...lines.map((l) => l.length)) * fontSize * 0.55 + pad * 2),
  );
  const height = lines.length * lineH + pad * 2;
  // Flip the card so it stays inside the drawing near the edges.
  const x = Math.min(Math.max(8, at.x + 18), PLAN_IMAGE.width - width - 8);
  const y = at.y + 18 + height > PLAN_IMAGE.height ? at.y - height - 18 : at.y + 18;
  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={Math.max(8, y)}
        width={width}
        height={height}
        rx={8}
        fill="#0f172a"
        fillOpacity={0.92}
        stroke="#ffffff"
        strokeOpacity={0.5}
      />
      {lines.map((line, i) => (
        <text
          key={line + i}
          x={x + pad}
          y={Math.max(8, y) + pad + fontSize + i * lineH - 4}
          fill="#ffffff"
          fontSize={i === 0 ? fontSize + 2 : fontSize}
          fontWeight={i === 0 ? 700 : 400}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {line}
        </text>
      ))}
    </g>
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
