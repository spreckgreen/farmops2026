// Operational Farm Shop grid map: plots current FarmOps install locations on the
// corrected 40' x 60' drawing. Presentation only — it plots what
// electricalGridOperational supplies and never invents a location.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Maximize2, Map as MapIcon, ShieldAlert } from "lucide-react";
import { electricalGridOperational } from "@/lib/electrical-grid-operational.functions";
import {
  ASSET_KIND_LABEL,
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
import planImage from "@/assets/farm-shop-grid-plan.png";
import { CollapsibleGroup } from "@/components/electrical/collapsible-section";
import { cn } from "@/lib/utils";

/** Plan envelope inside the drawing, measured from the grid corner markers. */
const PLAN = { left: 12.91, right: 86.4, top: 19.52, bottom: 75.97 };

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
  const [printMode, setPrintMode] = usePrintMode();

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
          (verify === "ALL" || verificationOf(a.verification) === verify),
      ),
    [assets, kinds, precisions, panel, install, verify],
  );

  const plotted = filtered.filter((a) => a.xPct != null);
  const unplotted = filtered.filter((a) => a.xPct == null);
  const chosen = filtered.find((a) => a.stableId === selected) ?? null;

  const discrepancies = q.data
    ? q.data.summary.precision.UNRESOLVED + q.data.summary.precision.INTERVAL
    : 0;

  const toggle = <T,>(set: Set<T>, apply: (s: Set<T>) => void, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  return (
    <Card>
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


            <div
              className={cn(
                "relative w-full overflow-hidden rounded-md border border-border bg-white",
                large ? "max-h-[75vh]" : "",
              )}
            >
              <img
                src={planImage}
                alt="Overhead grid plan of the 40 by 60 foot Farm Shop with lettered rows A to F north to south and numbered columns 1 to 9 west to east, showing the north wall openings and the north-east and south-west man doors"
                className="block h-auto w-full select-none"
                draggable={false}
              />
              {plotted.map((a) => {
                const left = PLAN.left + ((a.xPct ?? 0) / 100) * (PLAN.right - PLAN.left);
                const top = PLAN.top + ((a.yPct ?? 0) / 100) * (PLAN.bottom - PLAN.top);
                return (
                  <button
                    key={`${a.kind}-${a.stableId}`}
                    type="button"
                    className="absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
                    style={{ left: `${left}%`, top: `${top}%` }}
                    onClick={() => setSelected(a.stableId)}
                    onFocus={() => setSelected(a.stableId)}
                    aria-label={`${a.stableId} ${a.description ?? ""}`}
                  >
                    <span
                      className={cn(
                        "block ring-2 ring-white/90 shadow",
                        PRECISION_META[a.precision].dot,
                        a.kind === "panel" ? "rounded-sm" : "rounded-full",
                        a.spanned ? "opacity-70 ring-dashed" : "",
                        large ? "h-3.5 w-3.5" : "h-2.5 w-2.5",
                        selected === a.stableId && "scale-150",
                      )}
                    />
                  </button>
                );
              })}
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

            {chosen ? <AssetDetail asset={chosen} /> : null}

            <CollapsibleGroup
              title={`Data quality — ${unplotted.length} not mapped, ${discrepancies} imprecise, ${q.data!.gaps.length} record gap(s)`}
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
      {asset.panelBasis ? (
        <p className="text-[11px] text-muted-foreground">{asset.panelBasis}</p>
      ) : null}
      {asset.verificationNotes ? (
        <p className="text-[11px] text-muted-foreground">{asset.verificationNotes}</p>
      ) : null}
    </div>
  );
}
