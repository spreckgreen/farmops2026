// One coordinate system for the Farm Shop plan and every marker.
//
// The backdrop is the original `farm-shop-grid-plan.png`, placed 1:1 inside the
// SVG viewBox `0 0 1448 1086`. Markers, the proposed overhead-light layer and
// the helper card are drawn into that same viewBox, converting physical feet
// through the single documented transform:
//
//   mapX = 185 + (xFeet / 60) * 1068
//   mapY = 210 + (yFeet / 40) * 616
//
// There is no HTML percentage overlay and no non-uniform scaling, so container
// width, browser zoom and device pixel ratio cannot move a marker relative to
// the plan. Everything is clipped to the drawing, so nothing plots off-page.
import { useCallback, useMemo, useRef, useState } from "react";
import planImage from "@/assets/farm-shop-grid-plan.png";
import {
  PLAN_DRAWING,
  PLAN_VIEW_BOX,
  PROPOSED_OVERHEAD_LEDS,
  SHOP_DEPTH_FT,
  clampToBuilding,
  feetToPlan,
} from "@/lib/electrical-grid-plan-geometry";
import {
  PLACEMENT_SOURCE_LABEL,
  PRECISION_META,
  VERIFICATION_LABEL,
  verificationOf,
  type LocationPrecision,
  type OperationalAsset,
} from "@/lib/electrical-grid-operational";
import {
  DESIGN_FIELD_HEX,
  DESIGN_FIELD_STATUS_LABEL,
  type DesignFieldPair,
} from "@/lib/electrical-grid-design-vs-field";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
import {
  overlayPosts,
  overlayShowsGrid,
  type GridBaseOverlay,
  type GridCellCount,
} from "@/lib/electrical-grid-map-overlays";


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
  "Overhead grid plan of the 60 by 40 foot Farm Shop, with lettered rows A to F north to south and numbered columns 1 to 9 west to east, the GD2 and GD1 overhead doors and the north-east and south-west man doors";

/**
 * Symbol sizing. Marker glyphs are annotation, not building fabric, so they are
 * sized as a share of the drawing rather than as a physical footprint: `u(n)`
 * converts the previous foot-based symbol sizes into drawing units, keeping the
 * on-screen appearance of every symbol unchanged.
 */
const SYMBOL_UNIT = PLAN_DRAWING.height / SHOP_DEPTH_FT;
const u = (n: number) => n * SYMBOL_UNIT;

/** Interval markers keep a visible span so they are never read as a point. */
const INTERVAL_SPAN_FT = 4;

/** Marker radii, in drawing units. */
const R = u(0.62);
const R_SELECTED = u(0.9);

const CLIP_ID = "farm-shop-plan-clip";

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
  designOverlay,
  baseOverlay = "GRID_ONLY",
  cellCounts,
  recentIds,
  className,
}: {
  plotted: OperationalAsset[];
  selectedId?: string | null;
  onSelect?: (stableId: string) => void;
  interactive?: boolean;
  markerScale?: number;
  /** Draw the proposed 2 x 5 overhead LED design layer. */
  showProposedLeds?: boolean;
  /** Approved-design vs field-observation overlay; mismatches are highlighted. */
  designOverlay?: DesignFieldPair[];
  /** Which base reference to draw: pole-based grid, A1–F9 only, or posts only. */
  baseOverlay?: GridBaseOverlay;
  /** Per-cell object counts, drawn until a marker is selected. */
  cellCounts?: GridCellCount[];
  /** Most-recently-observed records, ringed so they read at a glance. */
  recentIds?: string[];
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
      data-plan-units="drawing"
    >
      {interactive ? (
        <desc id="grid-plan-keyboard-help">
          Use Tab to enter the markers, arrow keys or Home and End to move between them, Enter or
          Space to open the full record, and Escape to dismiss the helper text.
        </desc>
      ) : null}
      <defs>
        <clipPath id={CLIP_ID}>
          <rect x={0} y={0} width={PLAN_DRAWING.width} height={PLAN_DRAWING.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${CLIP_ID})`}>
        <PlanDrawing />
        <BaseReferenceLayer overlay={baseOverlay} />
        {cellCounts?.length && !selectedId ? <CellCountLayer counts={cellCounts} /> : null}
        {showProposedLeds ? <ProposedLedLayer /> : null}
        {designOverlay?.length ? <DesignFieldLayer pairs={designOverlay} /> : null}

        {items.map(({ asset: a, dxFt, dyFt, badge }) => {
          const anchor = feetToPlan(a.plottedXFt as number, a.plottedYFt as number);
          // Spidered members may be nudged for readability, but never outside
          // the building envelope — and they keep a leader line to the anchor.
          const nudged = feetToPlan(
            (a.plottedXFt as number) + dxFt,
            (a.plottedYFt as number) + dyFt,
          );
          const shown = clampToBuilding(nudged.x, nudged.y);
          const offset = dxFt !== 0 || dyFt !== 0;
          const selected = selectedId === a.stableId;
          const r = (selected ? R_SELECTED : R) * markerScale;
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
                    onKeyDown: (e: React.KeyboardEvent<SVGGElement>) =>
                      onMarkerKeyDown(e, a.stableId),
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
                    r={r + u(0.5)}
                    fill="none"
                    stroke="#111827"
                    strokeWidth={u(0.34)}
                    pointerEvents="none"
                  />
                  <circle
                    cx={shown.x}
                    cy={shown.y}
                    r={r + u(0.5)}
                    fill="none"
                    stroke="#facc15"
                    strokeWidth={u(0.2)}
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
                    strokeWidth={u(0.14)}
                  />
                  <circle
                    data-anchor-dot
                    cx={anchor.x}
                    cy={anchor.y}
                    r={u(0.18)}
                    fill={fill}
                  />
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
                    strokeWidth={u(0.28) * markerScale}
                    strokeDasharray={`${u(0.5)} ${u(0.3)}`}
                    opacity={0.85}
                  />
                  <circle
                    cx={shown.x}
                    cy={shown.y}
                    r={r * 0.7}
                    fill={fill}
                    fillOpacity={0.55}
                    stroke="#ffffff"
                    strokeWidth={u(0.14)}
                    strokeDasharray={`${u(0.3)} ${u(0.22)}`}
                  />
                </>
              ) : a.kind === "panel" ? (
                <rect
                  x={shown.x - r}
                  y={shown.y - r}
                  width={r * 2}
                  height={r * 2}
                  rx={u(0.15)}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={u(0.14)}
                />
              ) : (
                <circle
                  cx={shown.x}
                  cy={shown.y}
                  r={r}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={u(0.14)}
                />
              )}
              {recentIds?.includes(a.stableId) ? (
                // Most-recent-observed overlay: a solid outer ring. It reports
                // recency only and never changes the plotted position.
                <circle
                  data-recent-observed
                  cx={shown.x}
                  cy={shown.y}
                  r={r + u(0.62)}
                  fill="none"
                  stroke="#0f766e"
                  strokeWidth={u(0.18)}
                  pointerEvents="none"
                />
              ) : null}
              {a.locationSource === "PENDING_FIELD_OBSERVATION" ? (
                // Staged field observation: a separate, visibly provisional layer
                // drawn as a dashed halo so it is never read as applied data.
                <circle
                  data-pending-observation
                  cx={shown.x}
                  cy={shown.y}
                  r={r + u(0.34)}
                  fill="none"
                  stroke="#b45309"
                  strokeWidth={u(0.2)}
                  strokeDasharray={`${u(0.32)} ${u(0.26)}`}
                  pointerEvents="none"
                />
              ) : null}
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
                    strokeWidth={u(0.1)}
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
      </g>
    </svg>
  );
}

/** The bare plan, for consumers that draw their own overlay on top. */
export function GridPlanBackdrop({ className }: { className?: string }) {
  return (
    <svg
      viewBox={PLAN_VIEW_BOX}
      className={className ?? "block h-auto w-full"}
      role="img"
      aria-label={PLAN_ALT}
      preserveAspectRatio="xMidYMid meet"
      data-plan-units="drawing"
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
    `Position from: ${PLACEMENT_SOURCE_LABEL[asset.locationSource]}`,
    ...(asset.locationSource === "PENDING_FIELD_OBSERVATION"
      ? [
          `Staged observation ${asset.pendingObservation?.batchId ?? ""} — awaiting approval, not applied`.trim(),
        ]
      : []),
    ...(asset.spanned ? ["Interval — a preserved span, not a final point"] : []),
    ...(asset.placementDisagreement ? ["Placement conflict — see Data quality"] : []),

  ];
}

/** Helper-card typography and padding, in drawing units, so the card scales
 * with the plan instead of with the pixel size of the container. */
const HINT_FONT = u(0.85);
const HINT_PAD = u(0.5);
const HINT_LINE = HINT_FONT * 1.35;
/** Keep the card this far inside the viewBox edge so its stroke stays visible. */
const HINT_MARGIN = u(0.3);
/** Gap between the anchor point and the card, so the marker stays readable. */
const HINT_GAP = u(1);

/**
 * Places the helper card fully inside the drawing for any anchor in feet,
 * including the four corners and the wall edges.
 *
 * Preferred side is right-and-below the anchor. When that would overflow, the
 * card flips to the opposite side; when neither side fits, it is clamped to the
 * edge. Pure and exported so the placement is testable without a browser.
 */
export function hintCardBox(anchorXFt: number, anchorYFt: number, lines: string[]) {
  const maxLines = Math.max(
    1,
    Math.floor((PLAN_DRAWING.height - HINT_MARGIN * 2 - HINT_PAD * 2) / HINT_LINE),
  );
  const shown = lines.slice(0, maxLines);
  lines = shown;
  const longest = Math.max(...lines.map((l) => l.length));
  const maxWidth = Math.min(u(26), PLAN_DRAWING.width - HINT_MARGIN * 2);
  const width = Math.min(
    maxWidth,
    Math.max(Math.min(u(11), maxWidth), longest * HINT_FONT * 0.52 + HINT_PAD * 2),
  );
  const height = lines.length * HINT_LINE + HINT_PAD * 2;

  const clamp = (v: number, lo: number, hi: number) =>
    hi < lo ? lo : Math.min(Math.max(v, lo), hi);

  const at = feetToPlan(anchorXFt, anchorYFt);
  const right = at.x + HINT_GAP;
  const fitsRight = right + width <= PLAN_DRAWING.width - HINT_MARGIN;
  const left = at.x - HINT_GAP - width;
  const x = clamp(
    fitsRight ? right : left,
    HINT_MARGIN,
    PLAN_DRAWING.width - width - HINT_MARGIN,
  );

  const below = at.y + HINT_GAP;
  const fitsBelow = below + height <= PLAN_DRAWING.height - HINT_MARGIN;
  const above = at.y - HINT_GAP - height;
  const y = clamp(
    fitsBelow ? below : above,
    HINT_MARGIN,
    PLAN_DRAWING.height - height - HINT_MARGIN,
  );

  return { x, y, width, height, lines: shown };
}

/** Hover/focus helper text, drawn inside the same viewBox so it scales with the
 * plan and never drifts at a different browser zoom. */
function HoverHint({ asset }: { asset: OperationalAsset }) {
  if (asset.plottedXFt == null || asset.plottedYFt == null) return null;
  const lines = hintLines(asset);
  const { x, y: top, width, height, lines: shown } = hintCardBox(
    asset.plottedXFt,
    asset.plottedYFt,
    lines,
  );

  return (
    <g pointerEvents="none" data-hint-card="true">
      <rect
        x={x}
        y={top}
        width={width}
        height={height}
        rx={u(0.35)}
        fill="#0f172a"
        fillOpacity={0.92}
        stroke="#ffffff"
        strokeOpacity={0.5}
        strokeWidth={u(0.08)}
      />
      {shown.map((line, i) => (
        <text
          key={line + i}
          x={x + HINT_PAD}
          y={top + HINT_PAD + HINT_FONT + i * HINT_LINE - u(0.15)}
          fill="#ffffff"
          fontSize={i === 0 ? HINT_FONT * 1.08 : HINT_FONT}
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
 * The base plan: the original overhead grid drawing, placed 1:1 in the viewBox.
 * It is never redrawn or re-traced — walls, gridlines, dimension strings, both
 * man doors and the overhead doors are the drawing's own.
 */
function PlanDrawing() {
  return (
    <image
      href={planImage}
      x={0}
      y={0}
      width={PLAN_DRAWING.width}
      height={PLAN_DRAWING.height}
      preserveAspectRatio="xMidYMid meet"
      data-plan-backdrop="farm-shop-grid-plan"
      pointerEvents="none"
    />
  );
}

/** Proposed 2 x 5 overhead LED layer — design geometry, not field verified. */
function ProposedLedLayer() {
  return (
    <g pointerEvents="none" data-layer="proposed-overhead-led">
      {PROPOSED_OVERHEAD_LEDS.map((f) => {
        const at = feetToPlan(f.xFt, f.yFt);
        return (
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
                  x1={at.x + Math.cos(rad) * u(0.75)}
                  y1={at.y + Math.sin(rad) * u(0.75)}
                  x2={at.x + Math.cos(rad) * u(1.3)}
                  y2={at.y + Math.sin(rad) * u(1.3)}
                  stroke={PROPOSED_LED_HEX}
                  strokeWidth={u(0.12)}
                />
              );
            })}
            <circle
              cx={at.x}
              cy={at.y}
              r={u(0.7)}
              fill="#fef3c7"
              stroke={PROPOSED_LED_HEX}
              strokeWidth={u(0.16)}
              strokeDasharray={`${u(0.35)} ${u(0.2)}`}
            />
            <text
              x={at.x}
              y={at.y + u(0.3)}
              fontSize={u(0.75)}
              textAnchor="middle"
              fill="#92400e"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {f.planOrder}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Approved design vs latest field observation.
 *
 * Design positions are drawn as dashed squares, verified field positions as
 * small crosses, and the two are joined by a leader line. A mismatch beyond
 * tolerance gets a red halo and its separation in feet — the layer reports the
 * disagreement, it never resolves it. */
function DesignFieldLayer({ pairs }: { pairs: DesignFieldPair[] }) {
  return (
    <g pointerEvents="none" data-layer="design-vs-field">
      {pairs.map((p) => {
        const hex = DESIGN_FIELD_HEX[p.status];
        const mismatch = p.status === "MISMATCH";
        const title = `${p.stableId} — ${DESIGN_FIELD_STATUS_LABEL[p.status]}`;
        const design =
          p.designXFt != null && p.designYFt != null ? feetToPlan(p.designXFt, p.designYFt) : null;
        const field =
          p.fieldXFt != null && p.fieldYFt != null ? feetToPlan(p.fieldXFt, p.fieldYFt) : null;
        return (
          <g
            key={`dvf-${p.stableId}`}
            data-design-field={p.stableId}
            data-design-field-status={p.status}
            data-delta-ft={p.deltaFt ?? ""}
          >
            <title>{title}</title>
            {design ? (
              <rect
                data-design-marker
                x={design.x - u(0.55)}
                y={design.y - u(0.55)}
                width={u(1.1)}
                height={u(1.1)}
                fill="none"
                stroke={hex}
                strokeWidth={u(0.16)}
                strokeDasharray={`${u(0.35)} ${u(0.22)}`}
              />
            ) : null}
            {field ? (
              <g data-field-marker stroke={hex} strokeWidth={u(0.16)}>
                <line
                  x1={field.x - u(0.5)}
                  y1={field.y - u(0.5)}
                  x2={field.x + u(0.5)}
                  y2={field.y + u(0.5)}
                />
                <line
                  x1={field.x + u(0.5)}
                  y1={field.y - u(0.5)}
                  x2={field.x - u(0.5)}
                  y2={field.y + u(0.5)}
                />
              </g>
            ) : null}
            {design && field ? (
              <line
                data-design-field-leader
                x1={design.x}
                y1={design.y}
                x2={field.x}
                y2={field.y}
                stroke={hex}
                strokeWidth={mismatch ? u(0.2) : u(0.12)}
                strokeDasharray={mismatch ? undefined : `${u(0.3)} ${u(0.25)}`}
              />
            ) : null}
            {mismatch && field ? (
              <>
                <circle
                  data-mismatch-halo
                  cx={field.x}
                  cy={field.y}
                  r={u(1.5)}
                  fill="none"
                  stroke={hex}
                  strokeWidth={u(0.22)}
                  strokeOpacity={0.85}
                />
                <text
                  x={field.x}
                  y={field.y - u(1.9)}
                  fontSize={u(0.85)}
                  textAnchor="middle"
                  fill={hex}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {p.deltaFt} ft off
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Base reference overlay: the corrected A–F / 1–9 grid lines and/or the proposed
 * perimeter post callouts. Both are drawn from frozen geometry — the post
 * positions are the proposed derivation from the corrected outline and are not
 * field confirmed, so they are drawn as open, dashed callouts.
 */
function BaseReferenceLayer({ overlay }: { overlay: GridBaseOverlay }) {
  const posts = overlayPosts(overlay);
  return (
    <g data-base-overlay={overlay} pointerEvents="none">
      {overlayShowsGrid(overlay) ? (
        <g data-grid-lines>
          {AXIS_COLS.map((c) => {
            const top = feetToPlan(c.xFt, 0);
            const bottom = feetToPlan(c.xFt, SHOP_DEPTH_FT);
            return (
              <g key={`col-${c.label}`}>
                <line
                  x1={top.x}
                  y1={top.y}
                  x2={bottom.x}
                  y2={bottom.y}
                  stroke="#1e293b"
                  strokeOpacity={0.28}
                  strokeWidth={u(0.06)}
                />
                <text
                  x={top.x}
                  y={top.y - u(0.5)}
                  textAnchor="middle"
                  fontSize={u(0.8)}
                  fill="#1e293b"
                  fillOpacity={0.75}
                >
                  {c.label}
                </text>
              </g>
            );
          })}
          {AXIS_ROWS.map((r) => {
            const west = feetToPlan(0, r.yFt);
            const east = feetToPlan(60, r.yFt);
            return (
              <g key={`row-${r.label}`}>
                <line
                  x1={west.x}
                  y1={west.y}
                  x2={east.x}
                  y2={east.y}
                  stroke="#1e293b"
                  strokeOpacity={0.28}
                  strokeWidth={u(0.06)}
                />
                <text
                  x={west.x - u(0.9)}
                  y={west.y + u(0.28)}
                  textAnchor="middle"
                  fontSize={u(0.8)}
                  fill="#1e293b"
                  fillOpacity={0.75}
                >
                  {r.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
      {posts.length ? (
        <g data-post-callouts>
          {posts.map((p) => {
            const at = feetToPlan(p.xFt, p.yFt);
            return (
              <g key={`post-${p.ref}`}>
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={u(0.44)}
                  fill="#ffffff"
                  fillOpacity={0.8}
                  stroke="#334155"
                  strokeWidth={u(0.12)}
                  strokeDasharray={`${u(0.2)} ${u(0.16)}`}
                />
                <text
                  x={at.x}
                  y={at.y + u(0.26)}
                  textAnchor="middle"
                  fontSize={u(0.5)}
                  fill="#334155"
                >
                  {p.ref}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
    </g>
  );
}

/**
 * How many records sit in each grid cell, shown before any marker is selected so
 * the plan reads as a density map first. Counts come from plotted records only —
 * nothing is snapped into a cell to be counted.
 */
function CellCountLayer({ counts }: { counts: GridCellCount[] }) {
  return (
    <g data-cell-counts pointerEvents="none">
      {counts.map((c) => {
        const at = feetToPlan(c.xFt, c.yFt);
        return (
          <g key={`count-${c.cell}`}>
            <circle
              cx={at.x}
              cy={at.y}
              r={u(1.05)}
              fill="#0f172a"
              fillOpacity={0.08}
              stroke="#0f172a"
              strokeOpacity={0.25}
              strokeWidth={u(0.08)}
            />
            <text
              x={at.x}
              y={at.y + u(0.36)}
              textAnchor="middle"
              fontSize={u(1)}
              fontWeight={600}
              fill="#0f172a"
              fillOpacity={0.75}
            >
              {c.count}
            </text>
          </g>
        );
      })}
    </g>
  );
}
