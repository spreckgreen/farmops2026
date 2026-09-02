// Panel diagram: the whole distribution tree — panels, feeders, breakers,
// circuits and loads — with every unresolved link marked as a gap.
// Read-only view over the authoritative records.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPanelDiagram } from "@/lib/electrical-panel-diagram.functions";
import {
  filterPanelDiagram,
  NOT_IN_RECORD,
  type DiagramCircuit,
  type DiagramLoad,
  type DiagramPanel,
} from "@/lib/electrical-panel-diagram";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Zap } from "lucide-react";

export const Route = createFileRoute("/electrical/panel-diagram")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Panel Diagram — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Every panel, feeder, breaker, circuit and load in one traceable tree, with unresolved connections marked as explicit gaps.",
      },
      { property: "og:title", content: "Panel Diagram — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "Panel-first distribution tree built from the authoritative electrical records: connections you can trace and gaps you can close.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PanelDiagramPage,
});

function GapList({ gaps }: { gaps: string[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {gaps.map((g) => (
        <li key={g} className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{g}</span>
        </li>
      ))}
    </ul>
  );
}

function LoadRow({ load }: { load: DiagramLoad }) {
  const rating = [load.amps ? `${load.amps} A` : null, load.va ? `${load.va} VA` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{load.id}</span>
        <span className="text-sm text-foreground">{load.description || "Unnamed load"}</span>
        {load.area && <Badge variant="outline">{load.area}</Badge>}
        {load.status && <Badge variant="secondary">{load.status}</Badge>}
        {rating && <span className="text-xs text-muted-foreground">{rating}</span>}
        {load.voltage && <span className="text-xs text-muted-foreground">{load.voltage} V</span>}
        {load.gaps.length === 0 ? (
          <Badge variant="outline">traceable</Badge>
        ) : (
          <Badge variant="destructive">
            {load.gaps.length} gap{load.gaps.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <GapList gaps={load.gaps} />
    </div>
  );
}

function CircuitBlock({ circuit }: { circuit: DiagramCircuit }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{circuit.id}</span>
        <span className="text-sm text-foreground">{circuit.description || "—"}</span>
        <Badge variant="outline">breaker {circuit.breaker}</Badge>
        {circuit.ratingAmps && <Badge variant="outline">{circuit.ratingAmps} A</Badge>}
        {circuit.voltage && <Badge variant="outline">{circuit.voltage} V</Badge>}
        {circuit.status && <Badge variant="secondary">{circuit.status}</Badge>}
        <span className="text-xs text-muted-foreground">
          {circuit.loads.length} load{circuit.loads.length === 1 ? "" : "s"}
        </span>
      </div>
      <GapList gaps={circuit.gaps} />
      {circuit.loads.length > 0 && (
        <div className="mt-2 space-y-1.5 border-l border-border pl-3">
          {circuit.loads.map((l) => (
            <LoadRow key={l.uuid || l.id} load={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function PanelBlock({ panel, defaultOpen }: { panel: DiagramPanel; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full flex-wrap items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <CardTitle className="text-base">
            <span className="font-mono">{panel.id}</span>
            {panel.description ? ` — ${panel.description}` : ""}
          </CardTitle>
          {panel.building && <Badge variant="outline">{panel.building}</Badge>}
          {panel.voltage && <Badge variant="outline">{panel.voltage} V</Badge>}
          {panel.busRatingAmps && <Badge variant="outline">{panel.busRatingAmps} A bus</Badge>}
          {panel.status && <Badge variant="secondary">{panel.status}</Badge>}
          <span className="text-xs text-muted-foreground">
            {panel.circuits.length} circuits · {panel.loadCount} loads
          </span>
          {panel.gapCount > 0 && <Badge variant="destructive">{panel.gapCount} gaps</Badge>}
        </button>
        <p className="mt-1 pl-6 text-xs text-muted-foreground">
          fed by:{" "}
          <span className={panel.feederKnown ? "text-foreground" : "text-destructive"}>
            {panel.feeder}
          </span>
        </p>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          <GapList gaps={panel.gaps} />
          {panel.circuits.map((c) => (
            <CircuitBlock key={c.uuid || c.id} circuit={c} />
          ))}
          {panel.directLoads.length > 0 && (
            <div className="rounded-md border border-dashed border-border p-2.5">
              <p className="text-xs text-muted-foreground">
                Loads on a breaker position in this panel with no circuit group:
              </p>
              <div className="mt-2 space-y-1.5">
                {panel.directLoads.map((l) => (
                  <LoadRow key={l.uuid || l.id} load={l} />
                ))}
              </div>
            </div>
          )}
          {panel.circuits.length === 0 && panel.directLoads.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing is linked to this panel in the record yet.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PanelDiagramPage() {
  const fetcher = useServerFn(loadPanelDiagram);
  const q = useQuery({
    queryKey: ["electrical", "panel-diagram"],
    queryFn: () => fetcher(),
  });
  const [query, setQuery] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);

  const view = useMemo(() => {
    if (!q.data) return null;
    const filtered = filterPanelDiagram(q.data, query);
    if (!gapsOnly) return filtered;
    return {
      ...filtered,
      panels: filtered.panels.filter((p) => p.gapCount > 0),
    };
  }, [q.data, query, gapsOnly]);

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <Zap className="h-5 w-5 text-primary" />
              Panel diagram
            </h1>
            <p className="text-sm text-muted-foreground">
              Panels → feeder → breaker → circuit → load, straight from the records. Anything the
              record does not prove is shown as {NOT_IN_RECORD} or a gap — never inferred.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {q.isLoading && <Skeleton className="h-64 w-full" />}
        {q.error && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              {(q.error as Error).message}
            </CardContent>
          </Card>
        )}

        {q.data && view && (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 pt-6 text-sm">
                <span>
                  <strong>{q.data.totals.panels}</strong> panels
                </span>
                <span>
                  <strong>{q.data.totals.circuits}</strong> circuits
                </span>
                <span>
                  <strong>{q.data.totals.connectedLoads}</strong> of {q.data.totals.loads} loads
                  traced to a panel
                </span>
                <span className="text-destructive">
                  <strong>{q.data.totals.unassignedLoads}</strong> loads with no panel
                </span>
                <span className="text-destructive">
                  <strong>{q.data.totals.gaps}</strong> gaps total
                </span>
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by panel, circuit, load ID, description or area…"
                className="max-w-md"
              />
              <Button
                variant={gapsOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setGapsOnly((v) => !v)}
              >
                {gapsOnly ? "Showing panels with gaps" : "Only panels with gaps"}
              </Button>
            </div>

            <div className="space-y-3">
              {view.panels.map((p) => (
                <PanelBlock
                  key={p.uuid || p.id}
                  panel={p}
                  defaultOpen={Boolean(query) || view.panels.length <= 3}
                />
              ))}
              {view.panels.length === 0 && (
                <Card>
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    No panels match this filter.
                  </CardContent>
                </Card>
              )}
            </div>

            {view.orphanCircuits.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-destructive">
                    Circuits with no panel link ({view.orphanCircuits.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {view.orphanCircuits.map((c) => (
                    <CircuitBlock key={c.uuid || c.id} circuit={c} />
                  ))}
                </CardContent>
              </Card>
            )}

            {view.unassignedLoads.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-destructive">
                    Loads not connected in the record ({view.unassignedLoads.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {view.unassignedLoads.map((l) => (
                    <LoadRow key={l.uuid || l.id} load={l} />
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </ElectricalGate>
  );
}
