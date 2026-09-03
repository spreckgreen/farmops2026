// Farm Shop grid dot map. Presentation only: it plots points supplied by
// electricalGridMap over the corrected 40' x 60' overhead grid plan.
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AXIS_COLS,
  AXIS_ROWS,
  CLASS_META,
  CLASS_ORDER,
  type CircuitClass,
  type GridMapPoint,
} from "@/lib/electrical-grid-map";
import planImage from "@/assets/farm-shop-grid-plan.png";
import { cn } from "@/lib/utils";

/** Plan envelope inside the drawing, measured from the grid corner markers. */
const PLAN = { left: 12.91, right: 86.4, top: 19.52, bottom: 75.97 };

export interface PanelOption {
  panel: string;
  count: number;
  basis: string;
}

export function FarmShopGridMap({
  points,
  panels,
  selectedPanel,
  onSelectPanel,
  visibleClasses,
  onToggleClass,
  large = false,
}: {
  points: GridMapPoint[];
  panels: PanelOption[];
  selectedPanel: string;
  onSelectPanel: (panel: string) => void;
  visibleClasses: Set<CircuitClass>;
  onToggleClass: (klass: CircuitClass) => void;
  large?: boolean;
}) {
  const [hover, setHover] = useState<GridMapPoint | null>(null);

  const shown = useMemo(
    () =>
      points.filter(
        (p) =>
          p.xPct != null &&
          p.yPct != null &&
          visibleClasses.has(p.klass) &&
          (selectedPanel === "ALL" || p.panel === selectedPanel),
      ),
    [points, visibleClasses, selectedPanel],
  );

  const unplaced = useMemo(
    () =>
      points.filter(
        (p) =>
          p.xPct == null &&
          visibleClasses.has(p.klass) &&
          (selectedPanel === "ALL" || p.panel === selectedPanel),
      ),
    [points, visibleClasses, selectedPanel],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Panel:</span>
        <Button
          size="sm"
          variant={selectedPanel === "ALL" ? "default" : "outline"}
          className="h-7 px-2 text-xs"
          onClick={() => onSelectPanel("ALL")}
        >
          All ({points.length})
        </Button>
        {panels.map((p) => (
          <Button
            key={p.panel}
            size="sm"
            variant={selectedPanel === p.panel ? "default" : "outline"}
            className="h-7 px-2 text-xs font-mono"
            title={p.basis}
            disabled={p.count === 0}
            onClick={() => onSelectPanel(p.panel)}
          >
            {p.panel === "NOT IN RECORD" ? "No panel in record" : p.panel} ({p.count})
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {CLASS_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onToggleClass(k)}
            className={cn(
              "flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 transition-opacity",
              visibleClasses.has(k) ? "opacity-100" : "opacity-40",
            )}
          >
            <span className={cn("h-2.5 w-2.5 rounded-full", CLASS_META[k].swatch)} />
            {CLASS_META[k].label}
            <span className="text-muted-foreground">
              ({points.filter((p) => p.klass === k).length})
            </span>
          </button>
        ))}
      </div>

      <div
        className={cn(
          "relative w-full overflow-hidden rounded-md border border-border bg-white",
          large ? "max-h-[75vh]" : "",
        )}
      >
        <img
          src={planImage}
          alt="Overhead grid plan of the 40 by 60 foot Farm Shop with lettered rows A to F and numbered columns 1 to 9"
          className="block w-full h-auto select-none"
          draggable={false}
        />

        {shown.map((p) => {
          const left = PLAN.left + ((p.xPct ?? 0) / 100) * (PLAN.right - PLAN.left);
          const top = PLAN.top + ((p.yPct ?? 0) / 100) * (PLAN.bottom - PLAN.top);
          return (
            <button
              key={p.loadId}
              type="button"
              className="absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
              style={{ left: `${left}%`, top: `${top}%` }}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover((cur) => (cur?.loadId === p.loadId ? null : cur))}
              onFocus={() => setHover(p)}
              onBlur={() => setHover((cur) => (cur?.loadId === p.loadId ? null : cur))}
              aria-label={`${p.loadId} ${p.label}`}
            >
              <span
                className={cn(
                  "block rounded-full ring-2 ring-white/90 shadow",
                  CLASS_META[p.klass].dot,
                  large ? "h-3.5 w-3.5" : "h-2.5 w-2.5",
                  hover?.loadId === p.loadId && "scale-150",
                )}
              />
            </button>
          );
        })}

        {hover ? (
          <div
            className="pointer-events-none absolute z-10 max-w-[19rem] rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg"
            style={{
              left: `${Math.min(
                72,
                PLAN.left + ((hover.xPct ?? 0) / 100) * (PLAN.right - PLAN.left) + 1.5,
              )}%`,
              top: `${Math.max(
                2,
                PLAN.top + ((hover.yPct ?? 0) / 100) * (PLAN.bottom - PLAN.top) - 4,
              )}%`,
            }}
          >
            <div className="font-mono font-semibold">{hover.loadId}</div>
            <div className="font-medium">{hover.label}</div>
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-muted-foreground">
              <span>Class</span>
              <span>{CLASS_META[hover.klass].label}</span>
              <span>Grid</span>
              <span className="font-mono">
                {hover.gridReference}
                {hover.rawGrid !== hover.gridReference ? ` (legacy ${hover.rawGrid})` : ""}
              </span>
              <span>Position</span>
              <span>
                {hover.xFt != null ? `${hover.xFt} ft E, ${hover.yFt} ft S` : "not in record"}
              </span>
              <span>Panel</span>
              <span className="font-mono">{hover.panel}</span>
              <span>Recorded</span>
              <span>
                {hover.amps} · {hover.volts}
              </span>
              <span>Location</span>
              <span>{hover.location}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{hover.classBasis}</p>
            <p className="text-[11px] text-muted-foreground">{hover.coordinateNote}</p>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Rows A–F run north→south at {AXIS_ROWS.map((r) => r.yFt).join("/")} ft; columns 1–9 run
        west→east at {AXIS_COLS.map((c) => c.xFt).join("/")} ft. Co-located loads are fanned out
        slightly so each dot stays hoverable — the fan is display only.
      </p>

      {unplaced.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">
            {unplaced.length} load(s) not plotted — no position in the record
          </p>
          <div className="flex flex-wrap gap-1">
            {unplaced.map((p) => (
              <Badge key={p.loadId} variant="outline" className="text-[11px]" title={p.coordinateNote}>
                <span className="font-mono mr-1">{p.loadId}</span>
                {p.rawGrid}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
