// Operational Farm Shop grid map: plots current FarmOps install locations on the
// corrected 40' x 60' drawing. Presentation only — it plots what
// electricalGridOperational supplies and never invents a location.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useUiChoice, useUiFlag } from "@/hooks/use-ui-preference";
import {
  GRID_BASE_OVERLAY_LABEL,
  GRID_BASE_OVERLAY_NOTE,
  GRID_BASE_OVERLAY_ORDER,
  OBSERVED_SOURCE_LABEL,
  PROGRESS_MODE_LABEL,
  PROGRESS_MODE_NOTE,
  PROGRESS_MODE_ORDER,
  gridCellCounts,
  progressCounts,
  progressModeMatches,
  recentObserved,
  type GridBaseOverlay,
  type ProgressMode,
} from "@/lib/electrical-grid-map-overlays";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Maximize2, Map as MapIcon, Printer, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { electricalGridOperational } from "@/lib/electrical-grid-operational.functions";
import {
  ASSET_KIND_LABEL,
  PLACEMENT_SOURCE_LABEL,
  PLACEMENT_SOURCE_ORDER,
  PRECISION_META,
  PRECISION_ORDER,
  VERIFICATION_LABEL,
  verificationOf,
  type AssetKind,
  type LocationPrecision,
  type OperationalAsset,
  type VerificationStatus,
} from "@/lib/electrical-grid-operational";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
import { GridPlanSvg, PROPOSED_LED_HEX } from "@/components/electrical/grid-plan-svg";
import {
  PLAN_ASPECT_RATIO,
  PROPOSED_OVERHEAD_LED_LEGEND,
} from "@/lib/electrical-grid-plan-geometry";
import { CollapsibleGroup } from "@/components/electrical/collapsible-section";
import {
  DESIGN_FIELD_HEX,
  DESIGN_FIELD_STATUS_LABEL,
  DESIGN_FIELD_TOLERANCE_FT,
  designFieldOverlay,
} from "@/lib/electrical-grid-design-vs-field";
import { cn } from "@/lib/utils";


function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded border px-1.5 py-0.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

const PRINT_MODE_KEY = "farmops.grid-map.print-mode";
type PrintMode = "solo" | "with-dq";

/** Remembered print choice: plan only, or plan plus the data-quality summary. */
function usePrintMode(): [PrintMode, (next: PrintMode) => void] {
  const [mode, setMode] = useState<PrintMode>("solo");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PRINT_MODE_KEY);
      if (saved === "solo" || saved === "with-dq") setMode(saved);
    } catch {
      // Storage unavailable; keep the default.
    }
  }, []);
  const apply = (next: PrintMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(PRINT_MODE_KEY, next);
    } catch {
      // Persistence is a convenience only.
    }
  };
  return [mode, apply];
}

/** Remembered on/off layer choice, so the map opens the way it was left. */
function usePersistedFlag(key: string, defaultOn = false): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState(defaultOn);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === "1" || saved === "0") setOn(saved === "1");
    } catch {
      // Storage unavailable; keep the default.
    }
  }, [key]);

  const apply = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Persistence is a convenience only.
    }
  };
  return [on, apply];
}


export function GridOperationalMap({ large = false }: { large?: boolean }) {
  const fetcher = useServerFn(electricalGridOperational);
  const q = useQuery({ queryKey: ["electrical", "grid-operational"], queryFn: () => fetcher() });

  const [panel, setPanel] = useState("ALL");
  const [kinds, setKinds] = useState<Set<AssetKind>>(
    new Set(Object.keys(ASSET_KIND_LABEL) as AssetKind[]),
  );
  const [precisions, setPrecisions] = useState<Set<LocationPrecision>>(new Set(PRECISION_ORDER));
  const [install, setInstall] = useState("ALL");
  const [verify, setVerify] = useState<"ALL" | VerificationStatus>("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  // Active build: the planned overhead LED layer and the design-vs-field
  // (planned vs verified) overlay are on by default, and the choice persists.
  const [showLeds, setShowLeds] = usePersistedFlag("farmops.grid-map.proposed-leds", true);
  // Account-level so the planned-vs-verified choice follows the user across
  // browsers and devices; localStorage is only a first-paint fallback.
  const [showDesignVsField, setShowDesignVsField] = useUiFlag(
    "grid-map.design-vs-field",
    "farmops.grid-map.design-vs-field",
    true,
  );


  // Base reference, progress mode and the most-recent-observed overlay are all
  // remembered on the account, so the view a user works in follows them.
  const [baseOverlay, setBaseOverlay] = useUiChoice<GridBaseOverlay>(
    "grid-map.base-overlay",
    "farmops.grid-map.base-overlay",
    GRID_BASE_OVERLAY_ORDER,
    "GRID_ONLY",
  );
  const [progressMode, setProgressMode] = useUiChoice<ProgressMode>(
    "grid-map.progress-mode",
    "farmops.grid-map.progress-mode",
    PROGRESS_MODE_ORDER,
    "PLANNED",
  );
  const [showRecent, setShowRecent] = useUiFlag(
    "grid-map.recent-observed",
    "farmops.grid-map.recent-observed",
    false,
  );

  const [printMode, setPrintMode] = usePrintMode();
  const [saving, setSaving] = useState(false);
  // Stamped at the moment a sheet is produced, so the header time is the
  // generation time rather than whenever the page happened to render.
  const [generatedAt, setGeneratedAt] = useState<Date>(() => new Date());

  const assets = q.data?.assets ?? [];


  const installStatuses = useMemo(
    () => [...new Set(assets.map((a) => a.installStatus).filter(Boolean) as string[])].sort(),
    [assets],
  );

  const filtered = useMemo(
    () =>
      assets.filter(
        (a) =>
          kinds.has(a.kind) &&
          precisions.has(a.precision) &&
          (panel === "ALL" || (a.panel ?? "NOT IN RECORD") === panel) &&
          (install === "ALL" || a.installStatus === install) &&
          (verify === "ALL" || verificationOf(a.verification) === verify) &&
          progressModeMatches(a, progressMode),
      ),
    [assets, kinds, precisions, panel, install, verify, progressMode],
  );

  // Progress arithmetic is read against the same scope the panel/type/precision
  // filters describe, so the mode counts and the plan always agree.
  const scoped = useMemo(
    () =>
      assets.filter(
        (a) =>
          kinds.has(a.kind) &&
          precisions.has(a.precision) &&
          (panel === "ALL" || (a.panel ?? "NOT IN RECORD") === panel) &&
          (install === "ALL" || a.installStatus === install) &&
          (verify === "ALL" || verificationOf(a.verification) === verify),
      ),
    [assets, kinds, precisions, panel, install, verify],
  );
  const progress = useMemo(() => progressCounts(scoped), [scoped]);

  const plotted = filtered.filter((a) => a.xPct != null);
  const disagreeing = filtered.filter((a) => a.placementDisagreement);
  const unplotted = filtered.filter((a) => a.xPct == null);
  const chosen = filtered.find((a) => a.stableId === selected) ?? null;

  // Design vs field: derived from positions the records already state.
  const designField = useMemo(() => designFieldOverlay(filtered), [filtered]);

  // Object counts per grid cell, read before a marker is selected.
  const cellCounts = useMemo(() => gridCellCounts(plotted), [plotted]);
  const recent = useMemo(() => (showRecent ? recentObserved(filtered, 12) : []), [filtered, showRecent]);
  const recentIds = useMemo(() => recent.map((r) => r.stableId), [recent]);


  const allKinds = (Object.keys(ASSET_KIND_LABEL) as AssetKind[]).length;
  const panelLabel = panel === "ALL" ? "all panels" : panel;

  /** Every active filter, written out so a printed sheet explains its own scope. */
  const filterSummary = useMemo(
    () => [
      `Panel: ${panelLabel}`,
      `Type: ${
        kinds.size === allKinds
          ? "all types"
          : kinds.size === 0
            ? "none selected"
            : (Object.keys(ASSET_KIND_LABEL) as AssetKind[])
                .filter((k) => kinds.has(k))
                .map((k) => ASSET_KIND_LABEL[k])
                .join(", ")
      }`,
      `Location precision: ${
        precisions.size === PRECISION_ORDER.length
          ? "all precisions"
          : precisions.size === 0
            ? "none selected"
            : PRECISION_ORDER.filter((p) => precisions.has(p))
                .map((p) => PRECISION_META[p].label)
                .join(", ")
      }`,
      `Install status: ${install === "ALL" ? "all" : install}`,
      `Field verification: ${verify === "ALL" ? "all" : VERIFICATION_LABEL[verify]}`,
      `Overhead lighting layer: ${showLeds ? "proposed 2 x 5 LED layout shown" : "hidden"}`,
      `Design vs field overlay: ${
        showDesignVsField
          ? `shown — ${designField.counts.MISMATCH} mismatch(es) beyond ${DESIGN_FIELD_TOLERANCE_FT} ft`
          : "hidden"
      }`,
    ],
    [
      panelLabel,
      kinds,
      precisions,
      install,
      verify,
      allKinds,
      showLeds,
      showDesignVsField,
      designField,
    ],
  );


  const discrepancies = q.data
    ? q.data.summary.precision.UNRESOLVED + q.data.summary.precision.INTERVAL
    : 0;

  const toggle = <T,>(set: Set<T>, apply: (s: Set<T>) => void, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  /** Print the dedicated print region only; the remembered mode decides whether
   * the data-quality summary follows the plan on its own page. */
  const print = (mode: PrintMode) => {
    setPrintMode(mode);
    setGeneratedAt(new Date());
    document.body.dataset["gridMapPrint"] = mode;
    const clear = () => {
      delete document.body.dataset["gridMapPrint"];
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
    window.setTimeout(clear, 2000);
  };

  /** Save the same rendering as a PDF file, using the remembered method so a
   * download matches what printing would produce. */
  const downloadPdf = async (mode: PrintMode) => {
    setPrintMode(mode);
    setSaving(true);
    try {
      const mod = await import("@/lib/electrical-grid-map-pdf");
      const printedAt = new Date();
      setGeneratedAt(printedAt);
      const doc = mod.renderGridMapPdf({
        plotted,
        unplotted,
        gaps: q.data?.gaps ?? [],
        panelLabel,
        filteredCount: filtered.length,
        impreciseCount: discrepancies,
        includeDataQuality: mode === "with-dq",
        filterSummary,
        showProposedLeds: showLeds,
        printedAt,
      });
      const name = mod.gridMapPdfFileName(panelLabel, printedAt);
      doc.save(name);
      toast.success("Grid map PDF saved", { description: name });
    } catch (err) {
      toast.error("Could not save the grid map PDF", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Card className="grid-map-screen-only">


      <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          Farm Shop grid map — current install locations
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
            <Link to="/electrical/grid-data-quality" search={{ tab: "status" }}>
              <ShieldAlert className="h-3.5 w-3.5 mr-1" />
              Data quality
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {discrepancies}
              </Badge>
            </Link>
          </Button>
          <div className="flex items-center rounded border border-border">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-none px-2 text-xs"
              onClick={() => print(printMode)}
              title={
                printMode === "solo"
                  ? "Print the grid map only (remembered choice)"
                  : "Print the grid map with the data quality summary (remembered choice)"
              }
            >
              <Printer className="mr-1 h-3.5 w-3.5" />
              Print {printMode === "solo" ? "map" : "map + DQ"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-none border-l border-border px-2 text-xs"
              onClick={() => void downloadPdf(printMode)}
              disabled={!q.data || saving}
              title={
                printMode === "solo"
                  ? "Download the grid map only as a PDF (remembered choice)"
                  : "Download the grid map with the data quality summary as a PDF (remembered choice)"
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {saving ? "Saving…" : "Download PDF"}
            </Button>
            <select
              className="h-7 border-l border-border bg-background px-1 text-xs"
              value={printMode}
              onChange={(e) => setPrintMode(e.target.value as PrintMode)}
              aria-label="Print method"
            >
              <option value="solo">Map only</option>
              <option value="with-dq">Map + data quality</option>
            </select>
          </div>
          {large ? null : (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Link to="/electrical/grid-map">
                <Maximize2 className="h-3.5 w-3.5 mr-1" />
                Expand
              </Link>
            </Button>
          )}

        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                Base
                <select
                  className="rounded border border-border bg-background px-1 py-0.5"
                  value={baseOverlay}
                  onChange={(e) => setBaseOverlay(e.target.value as GridBaseOverlay)}
                  title={GRID_BASE_OVERLAY_NOTE[baseOverlay]}
                >
                  {GRID_BASE_OVERLAY_ORDER.map((o) => (
                    <option key={o} value={o}>
                      {GRID_BASE_OVERLAY_LABEL[o]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                Progress
                <select
                  className="rounded border border-border bg-background px-1 py-0.5"
                  value={progressMode}
                  onChange={(e) => setProgressMode(e.target.value as ProgressMode)}
                  title={PROGRESS_MODE_NOTE[progressMode]}
                >
                  {PROGRESS_MODE_ORDER.map((m) => (
                    <option key={m} value={m}>
                      {PROGRESS_MODE_LABEL[m]} ({progress[m]})
                    </option>
                  ))}
                </select>
              </label>
              <Chip
                active={showRecent}
                onClick={() => setShowRecent(!showRecent)}
                title="Ring the 12 most recently observed records. Recency only — no position is changed."
              >
                Most recent observed
              </Chip>
              <span className="text-muted-foreground">
                {progress.installedPct}% of {progress.PLANNED} recorded installed
                {progress.stagedOnly
                  ? ` · ${progress.stagedOnly} staged audit observation(s), not approved`
                  : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{GRID_BASE_OVERLAY_NOTE[baseOverlay]}</p>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Panel:</span>
              <Chip active={panel === "ALL"} onClick={() => setPanel("ALL")}>
                All ({assets.length})
              </Chip>
              {q.data!.panels.map((p) => (
                <Chip
                  key={p.panel}
                  active={panel === p.panel}
                  onClick={() => setPanel(p.panel)}
                  title={p.basis}
                >
                  <span className="font-mono">
                    {p.panel === "NOT IN RECORD" ? "No panel in record" : p.panel}
                  </span>{" "}
                  ({p.count})
                </Chip>
              ))}
            </div>

            {/* Secondary filters stay folded away so the plan itself is what
                the reader sees first. */}
            <CollapsibleGroup
              title={`Filters — type, precision, install, verification (${filtered.length} of ${assets.length} shown)`}
              storageKey="grid-map.filters"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Type:</span>
                {(Object.keys(ASSET_KIND_LABEL) as AssetKind[]).map((k) => (
                  <Chip key={k} active={kinds.has(k)} onClick={() => toggle(kinds, setKinds, k)}>
                    {ASSET_KIND_LABEL[k]} ({assets.filter((a) => a.kind === k).length})
                  </Chip>
                ))}
                <span className="ml-2 mr-1 text-xs text-muted-foreground">Layers:</span>
                <Chip
                  active={showLeds}
                  onClick={() => setShowLeds(!showLeds)}
                  title="Proposed design layout only — not field verified and not tied to a record."
                >
                  Overhead lighting — proposed (10)
                </Chip>
                <Chip
                  active={showDesignVsField}
                  onClick={() => setShowDesignVsField(!showDesignVsField)}
                  title={`Overlay approved design X/Y against the latest verified field observation. Separations over ${DESIGN_FIELD_TOLERANCE_FT} ft are highlighted; nothing is changed.`}
                >
                  Planned vs verified ({designField.counts.MISMATCH} mismatch)
                </Chip>
              </div>


              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Precision:</span>
                {PRECISION_ORDER.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggle(precisions, setPrecisions, p)}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-opacity",
                      precisions.has(p) ? "opacity-100" : "opacity-40",
                    )}
                  >
                    <span className={cn("h-2.5 w-2.5 rounded-full", PRECISION_META[p].swatch)} />
                    {PRECISION_META[p].label} ({q.data!.summary.precision[p]})
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">
                  Install status
                  <select
                    className="rounded border border-border bg-background px-1 py-0.5"
                    value={install}
                    onChange={(e) => setInstall(e.target.value)}
                  >
                    <option value="ALL">All</option>
                    {installStatuses.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Field verification
                  <select
                    className="rounded border border-border bg-background px-1 py-0.5"
                    value={verify}
                    onChange={(e) => setVerify(e.target.value as "ALL" | VerificationStatus)}
                  >
                    <option value="ALL">All</option>
                    {(Object.keys(VERIFICATION_LABEL) as VerificationStatus[]).map((v) => (
                      <option key={v} value={v}>
                        {VERIFICATION_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </CollapsibleGroup>


            {/* Plan and markers share one SVG viewBox in the drawing's own
                coordinate space, so zoom, window size and DPR cannot move a
                marker relative to the plan. */}
            {/* The plan keeps its true aspect ratio and is capped to the visible
                viewport height, so increasing or decreasing browser zoom shrinks
                or grows the whole drawing instead of overflowing the screen. */}
            <div
              data-plan-container="grid-map"
              className="mx-auto w-full overflow-hidden rounded-md border border-border bg-white"
              style={{
                maxWidth: `max(28rem, calc((100vh - ${large ? "20rem" : "26rem"}) * ${PLAN_ASPECT_RATIO.toFixed(4)}))`,
              }}
            >
              <GridPlanSvg
                plotted={plotted}
                selectedId={selected}
                onSelect={setSelected}
                markerScale={large ? 1 : 0.8}
                showProposedLeds={showLeds}
                baseOverlay={baseOverlay}
                cellCounts={cellCounts}
                {...(showRecent ? { recentIds } : {})}
                {...(showDesignVsField ? { designOverlay: designField.pairs } : {})}
              />
            </div>

            {/* Stamp under the plan: the counts a reader needs at a glance,
                without the data-quality detail crowding the drawing. */}
            <p className="text-xs text-muted-foreground">
              {plotted.length} of {filtered.length} record(s) plotted ·{" "}
              <span className="font-medium text-foreground">
                {unplotted.length} not mapped (no permanent location in the record)
              </span>
              {q.data!.gaps.length ? ` · ${q.data!.gaps.length} record gap(s)` : ""} — detail in Data
              quality below.
            </p>
            {selected ? null : cellCounts.length ? (
              <p className="text-xs text-muted-foreground">
                Grid counts shown per cell ({cellCounts.length} cell(s) with records). Select a
                marker to hide the counts and read the record.
              </p>
            ) : null}
            {showRecent && recent.length ? (
              <CollapsibleGroup
                title={`Most recent observed — ${recent.length} record(s)`}
                storageKey="grid-map.recent-observed"
              >
                <ul className="space-y-1 text-xs">
                  {recent.map((r) => (
                    <li key={r.stableId} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono">{r.stableId}</span>
                      <Badge variant="outline">{OBSERVED_SOURCE_LABEL[r.source]}</Badge>
                      <span className="text-muted-foreground">
                        {new Date(r.observedAt).toLocaleString()}
                        {r.batchId ? ` · batch ${r.batchId}` : ""} · {r.note}
                      </span>
                    </li>
                  ))}
                </ul>
              </CollapsibleGroup>
            ) : null}
            {showLeds ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full border-2"
                  style={{ borderColor: PROPOSED_LED_HEX, background: "#fef3c7" }}
                />
                {PROPOSED_OVERHEAD_LED_LEGEND} — design/proposed centres, not field verified.
              </p>
            ) : null}
            {showDesignVsField ? (
              <CollapsibleGroup
                title={`Design vs field — ${designField.counts.MISMATCH} mismatch, ${designField.counts.MATCH} confirmed, ${designField.counts.DESIGN_ONLY} design only, ${designField.counts.FIELD_ONLY} field only`}
                storageKey="grid-map.design-vs-field"
              >
                <p className="text-xs text-muted-foreground">
                  Dashed squares are approved design centres, crosses are verified field
                  observations, and a leader line joins the two. A separation over{" "}
                  {DESIGN_FIELD_TOLERANCE_FT} ft is highlighted in red on the plan and listed here
                  for disposition — no record, grid reference or engineering value is changed by this
                  view.
                </p>
                <div className="flex flex-wrap gap-3 text-xs">
                  {(
                    Object.keys(DESIGN_FIELD_STATUS_LABEL) as (keyof typeof DESIGN_FIELD_HEX)[]
                  ).map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 rounded-sm border-2"
                        style={{ borderColor: DESIGN_FIELD_HEX[s] }}
                      />
                      {DESIGN_FIELD_STATUS_LABEL[s]} ({designField.counts[s]})
                    </span>
                  ))}
                </div>
                {designField.pairs.length ? (
                  <ul className="space-y-1 text-xs">
                    {designField.pairs.map((p) => (
                      <li key={p.stableId} className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className="font-mono underline decoration-dotted"
                          onClick={() => setSelected(p.stableId)}
                        >
                          {p.stableId}
                        </button>
                        <Badge
                          variant={p.status === "MISMATCH" ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {DESIGN_FIELD_STATUS_LABEL[p.status]}
                          {p.deltaFt != null ? ` · ${p.deltaFt} ft` : ""}
                        </Badge>
                        <span className="text-muted-foreground">{p.basis}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No record in this filter states an approved design position or a verified field
                    observation.
                  </p>
                )}
              </CollapsibleGroup>
            ) : null}


            {chosen ? <AssetDetail asset={chosen} /> : null}

            <CollapsibleGroup
              title={`Data quality — ${unplotted.length} not mapped, ${discrepancies} imprecise, ${disagreeing.length} placement conflict(s), ${q.data!.gaps.length} record gap(s)`}
              storageKey="grid-map.data-quality"
            >
              <p className="text-xs text-muted-foreground">
                Rows A–F run north→south at {AXIS_ROWS.map((r) => r.yFt).join("/")} ft; columns 1–9
                run west→east at {AXIS_COLS.map((c) => c.xFt).join("/")} ft. Interval dots mark a
                preserved span, not a final install point. Mobile and unresolved records are never
                snapped onto the drawing.
              </p>

              {unplotted.length ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium">
                    {unplotted.length} record(s) not plotted — no permanent location in the record
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {unplotted.map((a) => (
                      <Badge
                        key={`${a.kind}-${a.stableId}`}
                        variant="outline"
                        className="cursor-pointer text-[11px]"
                        title={a.precisionBasis}
                        onClick={() => setSelected(a.stableId)}
                      >
                        <span className="mr-1 font-mono">{a.stableId}</span>
                        {PRECISION_META[a.precision].label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {disagreeing.length ? (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                  <p className="text-xs font-medium">
                    {disagreeing.length} record(s) with disagreeing placement sources — nothing was
                    overwritten
                  </p>
                  {disagreeing.map((a) => (
                    <p
                      key={`dq-${a.kind}-${a.stableId}`}
                      className="cursor-pointer text-[11px] text-muted-foreground"
                      onClick={() => setSelected(a.stableId)}
                    >
                      <span className="font-mono">{a.stableId}</span> — {a.placementDisagreement}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="space-y-1 rounded-md border border-border p-2">
                <p className="text-xs font-medium">Records by placement source</p>
                {PLACEMENT_SOURCE_ORDER.filter((k) => q.data!.summary.placementSources[k]).map((k) => (
                  <p key={k} className="text-[11px] text-muted-foreground">
                    {PLACEMENT_SOURCE_LABEL[k]}: {q.data!.summary.placementSources[k]}
                  </p>
                ))}
              </div>

              {q.data!.gaps.length ? (
                <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2">
                  <p className="text-xs font-medium">Record gaps</p>
                  {q.data!.gaps.map((g, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {g}
                    </p>
                  ))}
                </div>
              ) : null}
            </CollapsibleGroup>

          </>
        )}
      </CardContent>
    </Card>

    {/* Dedicated print region: the same plotted records, rendered without
        controls. Data quality only follows when that method is chosen. */}
    {q.data ? (
      <div className="grid-map-print-region text-black">
        <h1 className="text-lg font-semibold">
          Farm Shop grid map — current install locations
        </h1>
        <p className="text-xs">
          Generated {generatedAt.toLocaleString()} ({generatedAt.toISOString()}) · {plotted.length} of{" "}
          {filtered.length} record(s) plotted · {unplotted.length} not mapped
          {q.data.gaps.length ? ` · ${q.data.gaps.length} record gap(s)` : ""}
        </p>
        <p className="text-[11px]">Filters — {filterSummary.join(" · ")}</p>
        <p className="text-[11px]">
          Base: {GRID_BASE_OVERLAY_LABEL[baseOverlay]} · Progress:{" "}
          {PROGRESS_MODE_LABEL[progressMode]} · {progress.installedPct}% of {progress.PLANNED}{" "}
          recorded installed
          {progress.stagedOnly
            ? ` · ${progress.stagedOnly} staged audit observation(s), not approved`
            : ""}
        </p>
        <div data-plan-container="print" className="mt-2 w-full overflow-hidden border border-black">
          <GridPlanSvg
            plotted={plotted}
            interactive={false}
            markerScale={0.8}
            showProposedLeds={showLeds}
            baseOverlay={baseOverlay}
            cellCounts={cellCounts}
          />
        </div>

        <p className="mt-1 text-[11px]">
          {plotted.length} of {filtered.length} record(s) plotted · {unplotted.length} not mapped (no
          permanent location in the record)
          {q.data.gaps.length ? ` · ${q.data.gaps.length} record gap(s)` : ""}
        </p>

        <div className="grid-map-print-dq mt-4 space-y-2">
          <h2 className="text-base font-semibold">Data quality</h2>
          <p className="text-[11px]">
            Rows A–F run north→south at {AXIS_ROWS.map((r) => r.yFt).join("/")} ft; columns 1–9 run
            west→east at {AXIS_COLS.map((c) => c.xFt).join("/")} ft. Interval dots mark a preserved
            span, not a final install point. Mobile and unresolved records are never snapped onto the
            drawing.
          </p>
          <p className="text-[11px] font-medium">
            {unplotted.length} not mapped · {discrepancies} imprecise · {disagreeing.length}{" "}
            placement conflict(s) · {q.data.gaps.length} record gap(s)
          </p>
          <p className="text-[11px]">
            Placement sources —{" "}
            {PLACEMENT_SOURCE_ORDER.filter((k) => q.data!.summary.placementSources[k])
              .map((k) => `${PLACEMENT_SOURCE_LABEL[k]}: ${q.data!.summary.placementSources[k]}`)
              .join(" · ")}
          </p>
          {disagreeing.length ? (
            <ul className="text-[11px]">
              {disagreeing.map((a) => (
                <li key={`print-conflict-${a.kind}-${a.stableId}`}>
                  <span className="font-mono">{a.stableId}</span> — {a.placementDisagreement}
                </li>
              ))}
            </ul>
          ) : null}
          {unplotted.length ? (
            <ul className="text-[11px]">
              {unplotted.map((a) => (
                <li key={`print-dq-${a.kind}-${a.stableId}`}>
                  <span className="font-mono">{a.stableId}</span> —{" "}
                  {PRECISION_META[a.precision].label}
                  {a.precisionBasis ? ` — ${a.precisionBasis}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {q.data.gaps.length ? (
            <div className="text-[11px]">
              <p className="font-medium">Record gaps</p>
              {q.data.gaps.map((g, i) => (
                <p key={i}>{g}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    ) : null}
    </>
  );
}


export function AssetDetail({ asset }: { asset: OperationalAsset }) {
  const rows: [string, string][] = [
    ["Stable ID", asset.stableId],
    ["Type", ASSET_KIND_LABEL[asset.kind]],
    ["Description", asset.description ?? "NOT IN RECORD"],
    ["Current FarmOps grid", asset.grid ?? "NOT IN RECORD"],
    ["Design / proposed grid", asset.designGrid ?? "NOT IN RECORD"],
    [
      "X / Y",
      asset.plottedXFt != null
        ? `${asset.plottedXFt} ft E, ${asset.plottedYFt} ft S`
        : "NOT IN RECORD",
    ],
    ["Location precision", PRECISION_META[asset.precision].label],
    ["Placement source", PLACEMENT_SOURCE_LABEL[asset.locationSource]],
    ["Install status", asset.installStatus ?? "NOT IN RECORD"],
    ["Field verification", VERIFICATION_LABEL[verificationOf(asset.verification)]],
    ["Evidence / source", asset.locationEvidence ?? asset.precisionBasis],
    ["Verified", asset.verifiedAt ?? "not verified"],
    ["Last updated", asset.updatedAt ?? "NOT IN RECORD"],
    ["Panel", asset.panel ?? "NOT IN RECORD"],
    ["Building / area", asset.location ?? "NOT IN RECORD"],
  ];
  return (
    <div className="rounded-md border border-border p-3 text-xs">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[9rem_1fr] gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="break-words">{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{asset.precisionBasis}</p>
      {asset.placementCandidates.length > 1 ? (
        <div className="mt-2 text-[11px]">
          <p className="font-medium">Placement sources evaluated</p>
          {asset.placementCandidates.map((c) => (
            <p
              key={c.source}
              className={
                c.source === asset.locationSource ? "text-foreground" : "text-muted-foreground"
              }
            >
              {c.source === asset.locationSource ? "Selected — " : "Not used — "}
              {PLACEMENT_SOURCE_LABEL[c.source]}: {c.xFt} ft E / {c.yFt} ft S ({c.precision}) —{" "}
              {c.basis}
            </p>
          ))}
        </div>
      ) : null}
      {asset.placementDisagreement ? (
        <p className="mt-1 text-[11px] text-destructive">{asset.placementDisagreement}</p>
      ) : null}
      {asset.panelBasis ? (
        <p className="text-[11px] text-muted-foreground">{asset.panelBasis}</p>
      ) : null}
      {asset.verificationNotes ? (
        <p className="text-[11px] text-muted-foreground">{asset.verificationNotes}</p>
      ) : null}
    </div>
  );
}
