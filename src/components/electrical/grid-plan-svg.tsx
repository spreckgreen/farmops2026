// One coordinate system for the Farm Shop plan and every marker: physical feet.
//
// The SVG viewBox IS the building (0 0 60 40), so one drawing unit is one foot.
// The walls, gridlines, openings, markers and the proposed overhead-light layer
// are all drawn from their feet dimensions — there is no raster drawing, no
// pixel anchor and no non-uniform scaling, so browser zoom, window size and
// device pixel ratio cannot move a marker relative to the plan.
import { useCallback, useMemo, useRef, useState } from "react";
import {
  PLAN_BUILDING,
  PLAN_OPENINGS,
  PLAN_VIEW_BOX,
  PROPOSED_OVERHEAD_LEDS,
  feetToPlan,
} from "@/lib/electrical-grid-plan-geometry";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
import {
  PRECISION_META,
  VERIFICATION_LABEL,
  verificationOf,
  type LocationPrecision,
  type OperationalAsset,
} from "@/lib/electrical-grid-operational";

/** Marker colours, matched to the on-screen swatches and the PDF export. */
export const PRECISION_HEX: Record<LocationPrecision, string> = {
  EXACT: "#059669",
  NEAREST: "#0284c7",
  INTERVAL: "#f59e0b",
  GRIDLINE: "#6366f1",
  NON_FIXED: "#a855f7",
  UNRESOLVED: "#71717a",
};

export const PROPOSED_LED_HEX = "#f59e0b";

export const PLAN_ALT =
  "Scale plan of the 60 by 40 foot Farm Shop drawn in feet, with lettered rows A to F north to south and numbered columns 1 to 9 west to east, the GD2 and GD1 overhead doors and the north-east and south-west man doors";

/** Interval markers keep a visible span so they are never read as a point. */
const INTERVAL_SPAN_FT = 4;

/** Marker sizes in feet, so they scale with the plan. */
const R_FT = 0.62;
const R_SELECTED_FT = 0.9;

type RenderItem = {
  asset: OperationalAsset;
  dxFt: number;
  dyFt: number;
  /** Number of co-located records this marker stands for while collapsed. */
  badge: number;
};

export function GridPlanSvg({
  plotted,
  selectedId,
  onSelect,
  interactive = true,
  markerScale = 1,
  showProposedLeds = false,
  className,
}: {
  plotted: OperationalAsset[];
  selectedId?: string | null;
  onSelect?: (stableId: string) => void;
  interactive?: boolean;
  markerScale?: number;
  /** Draw the proposed 2 x 5 overhead LED design layer. */
  showProposedLeds?: boolean;
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

  // Co-located records collapse into one exact-anchor marker with a cluster
  // badge. They only spider apart when one of them is selected, so nothing is
  // displaced from its true physical position by default.
  const items = useMemo<RenderItem[]>(() => {
    const groups = new Map<string, OperationalAsset[]>();
    for (const a of plotted) {
      if (a.plottedXFt == null || a.plottedYFt == null) continue;
      const key = `${a.plottedXFt}|${a.plottedYFt}`;
      const list = groups.get(key) ?? [];
      list.push(a);
      groups.set(key, list);
    }
    const out: RenderItem[] = [];
    for (const list of groups.values()) {
      if (list.length === 1) {
        out.push({ asset: list[0]!, dxFt: 0, dyFt: 0, badge: 1 });
        continue;
      }
      const expanded = list.some((a) => a.stableId === selectedId);
      if (!expanded) {
        out.push({ asset: list[0]!, dxFt: 0, dyFt: 0, badge: list.length });
        continue;
      }
      list.forEach((a, i) => {
        const angle = (i / list.length) * Math.PI * 2;
        out.push({
          asset: a,
          dxFt: Math.cos(angle) * 1.6,
          dyFt: Math.sin(angle) * 1.6,
          badge: 1,
        });
      });
    }
    return out;
  }, [plotted, selectedId]);

  // Keyboard order: north-to-south, then west-to-east.
  const order = useMemo(
    () =>
      items
        .slice()
        .sort(
          (a, b) =>
            (a.asset.plottedYFt ?? 0) - (b.asset.plottedYFt ?? 0) ||
            (a.asset.plottedXFt ?? 0) - (b.asset.plottedXFt ?? 0),
        )
        .map((i) => i.asset.stableId),
    [items],
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
      role={interactive ? "group" : "img"}
      aria-label={interactive ? `${PLAN_ALT}. ${order.length} markers.` : PLAN_ALT}
      aria-describedby={interactive ? "grid-plan-keyboard-help" : undefined}
      preserveAspectRatio="xMidYMid meet"
      data-plan-units="feet"
    >
      {interactive ? (
        <desc id="grid-plan-keyboard-help">
          Use Tab to enter the markers, arrow keys or Home and End to move between them, Enter or
          Space to open the full record, and Escape to dismiss the helper text.
        </desc>
      ) : null}
      <PlanDrawing />
      {showProposedLeds ? <ProposedLedLayer /> : null}
      {items.map(({ asset: a, dxFt, dyFt, badge }) => {
        const anchor = feetToPlan(a.plottedXFt as number, a.plottedYFt as number);
        const shown = feetToPlan((a.plottedXFt as number) + dxFt, (a.plottedYFt as number) + dyFt);
        const offset = dxFt !== 0 || dyFt !== 0;
        const selected = selectedId === a.stableId;
        const r = (selected ? R_SELECTED_FT : R_FT) * markerScale;
        const fill = PRECISION_HEX[a.precision];
        const label =
          badge > 1
            ? `${badge} records at ${a.plottedXFt} ft east, ${a.plottedYFt} ft south. ${hintLines(a).join(". ")}`
            : hintLines(a).join(". ");
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
            data-cluster-size={badge}
          >
            {focused ? (
              <>
                <circle
                  cx={shown.x}
                  cy={shown.y}
                  r={r + 0.5}
                  fill="none"
                  stroke="#111827"
                  strokeWidth={0.34}
                  pointerEvents="none"
                />
                <circle
                  cx={shown.x}
                  cy={shown.y}
                  r={r + 0.5}
                  fill="none"
                  stroke="#facc15"
                  strokeWidth={0.2}
                  pointerEvents="none"
                />
              </>
            ) : null}
            {offset ? (
              <>
                <line
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={shown.x}
                  y2={shown.y}
                  stroke={fill}
                  strokeWidth={0.14}
                />
                <circle data-anchor-dot cx={anchor.x} cy={anchor.y} r={0.18} fill={fill} />
              </>
            ) : null}
            {a.spanned ? (
              <>
                <line
                  x1={feetToPlan((a.plottedXFt as number) - INTERVAL_SPAN_FT, 0).x}
                  y1={shown.y}
                  x2={feetToPlan((a.plottedXFt as number) + INTERVAL_SPAN_FT, 0).x}
                  y2={shown.y}
                  stroke={fill}
                  strokeWidth={0.28 * markerScale}
                  strokeDasharray="0.5 0.3"
                  opacity={0.85}
                />
                <circle
                  cx={shown.x}
                  cy={shown.y}
                  r={r * 0.7}
                  fill={fill}
                  fillOpacity={0.55}
                  stroke="#ffffff"
                  strokeWidth={0.14}
                  strokeDasharray="0.3 0.22"
                />
              </>
            ) : a.kind === "panel" ? (
              <rect
                x={shown.x - r}
                y={shown.y - r}
                width={r * 2}
                height={r * 2}
                rx={0.15}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={0.14}
              />
            ) : (
              <circle
                cx={shown.x}
                cy={shown.y}
                r={r}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={0.14}
              />
            )}
            {badge > 1 ? (
              // Cluster badge: the marker stays on the exact anchor and reports
              // how many records share it. Selecting it spiders the group.
              <>
                <circle
                  cx={shown.x + r * 0.95}
                  cy={shown.y - r * 0.95}
                  r={r * 0.85}
                  fill="#111827"
                  stroke="#ffffff"
                  strokeWidth={0.1}
                />
                <text
                  x={shown.x + r * 0.95}
                  y={shown.y - r * 0.95 + r * 0.3}
                  textAnchor="middle"
                  fontSize={r * 0.95}
                  fill="#ffffff"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  pointerEvents="none"
                >
                  {badge}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
      {hint ? <HoverHint asset={hint} /> : null}
    </svg>
  );
}

/** The bare plan (walls, gridlines, openings) in feet — for overlays that place
 * their own markers as percentages of the building envelope. */
export function GridPlanBackdrop({ className }: { className?: string }) {
  return (
    <svg
      viewBox={PLAN_VIEW_BOX}
      className={className ?? "block h-auto w-full"}
      role="img"
      aria-label={PLAN_ALT}
      preserveAspectRatio="xMidYMid meet"
      data-plan-units="feet"
    >
      <PlanDrawing />
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

/** Helper-card typography and padding, in feet, so the card scales with the
 * plan instead of with the pixel size of the container. */
const HINT_FONT_FT = 0.85;
const HINT_PAD_FT = 0.5;
const HINT_LINE_FT = HINT_FONT_FT * 1.35;
/** Keep the card this far inside the viewBox edge so its stroke stays visible. */
const HINT_MARGIN_FT = 0.3;
/** Gap between the anchor point and the card, so the marker stays readable. */
const HINT_GAP_FT = 1;

/**
 * Places the helper card fully inside the viewBox for any anchor, including the
 * four corners and the wall edges.
 *
 * Preferred side is right-and-below the anchor. When that would overflow, the
 * card flips to the opposite side; when neither side fits (a card wider or
 * taller than the plan on very small viewports), it is clamped to the edge.
 * Pure and exported so the placement is testable without a browser.
 */
export function hintCardBox(anchorXFt: number, anchorYFt: number, lines: string[]) {
  const maxLines = Math.max(
    1,
    Math.floor((PLAN_BUILDING.height - HINT_MARGIN_FT * 2 - HINT_PAD_FT * 2) / HINT_LINE_FT),
  );
  const shown = lines.slice(0, maxLines);
  lines = shown;
  const longest = Math.max(...lines.map((l) => l.length));
  const maxWidth = Math.min(26, PLAN_BUILDING.width - HINT_MARGIN_FT * 2);
  const width = Math.min(
    maxWidth,
    Math.max(
      Math.min(11, maxWidth),
      longest * HINT_FONT_FT * 0.52 + HINT_PAD_FT * 2,
    ),
  );
  const height = lines.length * HINT_LINE_FT + HINT_PAD_FT * 2;

  const clamp = (v: number, lo: number, hi: number) =>
    hi < lo ? lo : Math.min(Math.max(v, lo), hi);

  const right = anchorXFt + HINT_GAP_FT;
  const fitsRight = right + width <= PLAN_BUILDING.width - HINT_MARGIN_FT;
  const left = anchorXFt - HINT_GAP_FT - width;
  const x = clamp(
    fitsRight ? right : left,
    HINT_MARGIN_FT,
    PLAN_BUILDING.width - width - HINT_MARGIN_FT,
  );

  const below = anchorYFt + HINT_GAP_FT;
  const fitsBelow = below + height <= PLAN_BUILDING.height - HINT_MARGIN_FT;
  const above = anchorYFt - HINT_GAP_FT - height;
  const y = clamp(
    fitsBelow ? below : above,
    HINT_MARGIN_FT,
    PLAN_BUILDING.height - height - HINT_MARGIN_FT,
  );

  return { x, y, width, height, lines: shown };
}

/** Hover/focus helper text, drawn inside the same viewBox so it scales with the
 * plan and never drifts at a different browser zoom. */
function HoverHint({ asset }: { asset: OperationalAsset }) {
  if (asset.plottedXFt == null || asset.plottedYFt == null) return null;
  const at = feetToPlan(asset.plottedXFt, asset.plottedYFt);
  const lines = hintLines(asset);
  const fontSize = HINT_FONT_FT;
  const pad = HINT_PAD_FT;
  const lineH = HINT_LINE_FT;
  const { x, y: top, width, height, lines: shown } = hintCardBox(at.x, at.y, lines);

  return (
    <g pointerEvents="none" data-hint-card="true">
      <rect
        x={x}
        y={top}
        width={width}
        height={height}
        rx={0.35}
        fill="#0f172a"
        fillOpacity={0.92}
        stroke="#ffffff"
        strokeOpacity={0.5}
        strokeWidth={0.08}
      />
      {shown.map((line, i) => (
        <text
          key={line + i}
          x={x + pad}
          y={top + pad + fontSize + i * lineH - 0.15}
          fill="#ffffff"
          fontSize={i === 0 ? fontSize * 1.08 : fontSize}
          fontWeight={i === 0 ? 700 : 400}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/**
 * The plan itself: walls, the frozen gridlines and the drawn wall openings, all
 * from physical feet. Nothing here is traced from an image.
 */
function PlanDrawing() {
  return (
    <g pointerEvents="none">
      <rect
        x={0}
        y={0}
        width={PLAN_BUILDING.width}
        height={PLAN_BUILDING.height}
        fill="#ffffff"
      />
      {/* Gridlines: exact feet from the frozen axis definition. */}
      {AXIS_COLS.map((c) => (
        <line
          key={`col-${c.label}`}
          data-grid-col={c.label}
          data-x-ft={c.xFt}
          x1={c.xFt}
          y1={0}
          x2={c.xFt}
          y2={PLAN_BUILDING.height}
          stroke="#94a3b8"
          strokeWidth={0.06}
        />
      ))}
      {AXIS_ROWS.map((r) => (
        <line
          key={`row-${r.label}`}
          data-grid-row={r.label}
          data-y-ft={r.yFt}
          x1={0}
          y1={r.yFt}
          x2={PLAN_BUILDING.width}
          y2={r.yFt}
          stroke="#94a3b8"
          strokeWidth={0.06}
        />
      ))}
      {/* Grid labels, inset so they stay inside the building area. */}
      {AXIS_COLS.map((c) => (
        <text
          key={`col-label-${c.label}`}
          x={Math.min(Math.max(c.xFt, 0.6), PLAN_BUILDING.width - 0.4)}
          y={1.3}
          fontSize={0.9}
          fill="#64748b"
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {c.label}
        </text>
      ))}
      {AXIS_ROWS.map((r) => (
        <text
          key={`row-label-${r.label}`}
          x={0.5}
          y={Math.min(Math.max(r.yFt + 0.3, 1), PLAN_BUILDING.height - 0.3)}
          fontSize={0.9}
          fill="#64748b"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {r.label}
        </text>
      ))}
      {/* Walls. */}
      <rect
        x={0}
        y={0}
        width={PLAN_BUILDING.width}
        height={PLAN_BUILDING.height}
        fill="none"
        stroke="#0f172a"
        strokeWidth={0.4}
      />
      {/* Openings, drawn over the wall from their feet spans. */}
      {PLAN_OPENINGS.map((o) => {
        const isNorth = o.wall === "north";
        const stroke = o.kind === "overhead_door" ? "#2563eb" : "#0ea5e9";
        return (
          <g key={o.id} data-opening={o.id} data-start-ft={o.startFt} data-end-ft={o.endFt}>
            <line
              x1={isNorth ? o.startFt : 0}
              y1={isNorth ? 0 : o.startFt}
              x2={isNorth ? o.endFt : 0}
              y2={isNorth ? 0 : o.endFt}
              stroke="#ffffff"
              strokeWidth={0.5}
            />
            <line
              x1={isNorth ? o.startFt : 0}
              y1={isNorth ? 0 : o.startFt}
              x2={isNorth ? o.endFt : 0}
              y2={isNorth ? 0 : o.endFt}
              stroke={stroke}
              strokeWidth={0.26}
            />
            <text
              x={isNorth ? (o.startFt + o.endFt) / 2 : 0.6}
              y={isNorth ? 2.6 : (o.startFt + o.endFt) / 2}
              fontSize={0.8}
              fill={stroke}
              textAnchor={isNorth ? "middle" : "start"}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {o.id}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Proposed 2 x 5 overhead LED layer — design geometry, not field verified. */
function ProposedLedLayer() {
  return (
    <g pointerEvents="none" data-layer="proposed-overhead-led">
      {PROPOSED_OVERHEAD_LEDS.map((f) => (
        <g
          key={`led-${f.planOrder}`}
          data-proposed-led={f.planOrder}
          data-x-ft={f.xFt}
          data-y-ft={f.yFt}
        >
          {/* Light symbol: a glowing centre with radiating rays. */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return (
              <line
                key={deg}
                x1={f.xFt + Math.cos(rad) * 0.75}
                y1={f.yFt + Math.sin(rad) * 0.75}
                x2={f.xFt + Math.cos(rad) * 1.3}
                y2={f.yFt + Math.sin(rad) * 1.3}
                stroke={PROPOSED_LED_HEX}
                strokeWidth={0.12}
              />
            );
          })}
          <circle
            cx={f.xFt}
            cy={f.yFt}
            r={0.7}
            fill="#fef3c7"
            stroke={PROPOSED_LED_HEX}
            strokeWidth={0.16}
            strokeDasharray="0.35 0.2"
          />
          <text
            x={f.xFt}
            y={f.yFt + 0.3}
            fontSize={0.75}
            textAnchor="middle"
            fill="#92400e"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {f.planOrder}
          </text>
        </g>
      ))}
    </g>
  );
}
