// Panel diagram: pick one panel by name, see its topology drawn, and read a
// plain-language account of what the records prove and what is still missing.
// Read-only view over the authoritative electrical records.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { MermaidFigure } from "@/components/electrical/mermaid-figure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPanelDiagram } from "@/lib/electrical-panel-diagram.functions";
import {
  NOT_IN_RECORD,
  panelMermaid,
  panelReading,
  plannedMermaid,
  plannedPanel,
  plannedReading,
  type DiagramCircuit,
  type DiagramLoad,
  type DiagramPanel,
} from "@/lib/electrical-panel-diagram";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Network,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";


export const Route = createFileRoute("/electrical/panel-diagram")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Panel Topology — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Pick a panel by name to see its feeder, breakers, circuits and loads drawn as a diagram, with every missing link named.",
      },
      { property: "og:title", content: "Panel Topology — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "One panel at a time: the traceable path from feeder to load, plus the loads that should be accounted for on that panel but are not.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PanelDiagramPage,
});

function LoadRow({ load, note }: { load: DiagramLoad; note?: string }) {
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
        {rating ? (
          <span className="text-xs text-muted-foreground">{rating}</span>
        ) : (
          <span className="text-xs text-destructive">no amps / VA</span>
        )}
        {load.voltage && <span className="text-xs text-muted-foreground">{load.voltage} V</span>}
      </div>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function CircuitBlock({ circuit }: { circuit: DiagramCircuit }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-foreground">{circuit.id}</span>
        <span className="text-sm text-foreground">{circuit.description || "—"}</span>
        <Badge variant={circuit.breaker === NOT_IN_RECORD ? "destructive" : "outline"}>
          breaker {circuit.breaker}
        </Badge>
        {circuit.ratingAmps && <Badge variant="outline">{circuit.ratingAmps} A</Badge>}
        {circuit.voltage && <Badge variant="outline">{circuit.voltage} V</Badge>}
        {circuit.status && <Badge variant="secondary">{circuit.status}</Badge>}
        <span className="text-xs text-muted-foreground">
          {circuit.loads.length} load{circuit.loads.length === 1 ? "" : "s"}
        </span>
      </div>
      {circuit.loads.length > 0 ? (
        <div className="mt-2 space-y-1.5 border-l border-border pl-3">
          {circuit.loads.map((l) => (
            <LoadRow key={l.uuid || l.id} load={l} />
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-destructive">No load is linked to this circuit.</p>
      )}
    </div>
  );
}

type ViewMode = "planned" | "current";

function TopologyToggle({
  storageKey,
  source,
  downloadName,
  caption,
}: {
  storageKey: string;
  source: string;
  downloadName: string;
  caption: string;
}) {
  return (
    <PersistedSection
      storageKey={storageKey}
      defaultOpen
      title={
        <span className="flex items-center gap-2">
          <Network className="h-4 w-4" /> Mermaid topology diagram
        </span>
      }
    >
      <MermaidFigure source={source} downloadName={downloadName} />
      <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
    </PersistedSection>
  );
}


function PlannedDetail({ panel }: { panel: DiagramPanel }) {
  const plan = useMemo(() => plannedPanel(panel), [panel]);
  const reading = useMemo(() => plannedReading(panel), [panel]);
  const mermaid = useMemo(() => plannedMermaid(panel), [panel]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary" /> What the plan says
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-foreground">
            {reading.known.map((k) => (
              <p key={k}>{k}</p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" /> What the plan cannot answer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {reading.missing.map((m) => (
                <li key={m} className="text-muted-foreground">
                  {m}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Planned loads on {panel.id} ({plan.total})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Grouped by building / grid location. These are suggested alignments — nothing here
            claims an installed circuit or breaker.
          </p>
          {plan.groups.map((g) => (
            <div key={g.where} className="rounded-md border border-border bg-muted/30 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{g.where}</span>
                <Badge variant="outline">
                  {g.loads.length} load{g.loads.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <div className="mt-2 space-y-1.5 border-l border-border pl-3">
                {g.loads.map((e) => (
                  <LoadRow
                    key={e.load.uuid || e.load.id}
                    load={e.load}
                    note={
                      e.basis === "suggested_panel"
                        ? `planned here by suggested_panel = ${e.load.suggestedPanel}`
                        : e.basis === "building_area"
                          ? "planned here by shared building / grid location only"
                          : "already linked in the record (installed path exists)"
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {plan.groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No load is planned for this panel yet.
            </p>
          )}
        </CardContent>
      </Card>

      <TopologyToggle
        source={mermaid}
        downloadName={`${panel.id}-planned-topology`}
        caption="Dashed lines and dashed boxes are planned alignment. Solid lines mark loads the record already links."
      />
    </div>
  );
}

function PanelDetail({ panel }: { panel: DiagramPanel }) {
  const reading = useMemo(() => panelReading(panel), [panel]);
  const mermaid = useMemo(() => panelMermaid(panel), [panel]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary" /> What the record proves
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-foreground">
            {reading.known.map((k) => (
              <p key={k}>{k}</p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" /> What is missing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {reading.missing.map((m) => (
                <li key={m} className="text-muted-foreground">
                  {m}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Circuits on {panel.id} ({panel.circuits.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {panel.circuits.map((c) => (
            <CircuitBlock key={c.uuid || c.id} circuit={c} />
          ))}
          {panel.circuits.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No circuit group is linked to this panel yet.
            </p>
          )}
        </CardContent>
      </Card>

      {panel.directLoads.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              On a breaker here, but in no circuit group ({panel.directLoads.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {panel.directLoads.map((l) => (
              <LoadRow key={l.uuid || l.id} load={l} />
            ))}
          </CardContent>
        </Card>
      )}

      {panel.expectedLoads.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">
              Expected on {panel.id} but unaccounted ({panel.expectedLoads.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              These loads point at this panel (or its building) in the record but carry no circuit
              or breaker link, so they are not accounted for against it.
            </p>
            {panel.expectedLoads.map((l) => (
              <LoadRow
                key={l.uuid || l.id}
                load={l}
                note={
                  l.suggestedPanel
                    ? `suggested_panel = ${l.suggestedPanel} · needs circuit_group_uuid or a breaker position`
                    : `same building/area (${l.building || l.area || "—"}) · needs circuit_group_uuid or a breaker position`
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      <TopologyToggle
        source={mermaid}
        downloadName={`${panel.id}-topology`}
        caption="Solid lines are links a record proves. Dashed lines and dashed boxes are unproven — expected, not recorded."
      />
    </div>
  );
}


function PanelDiagramPage() {
  const fetcher = useServerFn(loadPanelDiagram);
  const q = useQuery({
    queryKey: ["electrical", "panel-diagram"],
    queryFn: () => fetcher(),
  });
  const [selected, setSelected] = useState<string>("");
  const [loadQuery, setLoadQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("planned");


  const panels = q.data?.panels ?? [];
  useEffect(() => {
    if (!selected && panels.length) setSelected(panels[0]!.id);
  }, [panels, selected]);

  const panel = panels.find((p) => p.id === selected) ?? null;

  const loadHits = useMemo(() => {
    const needle = loadQuery.trim().toLowerCase();
    if (!needle || !q.data) return [];
    const hits: { load: DiagramLoad; where: string; panelId: string | null }[] = [];
    const match = (l: DiagramLoad) =>
      `${l.id} ${l.description} ${l.area}`.toLowerCase().includes(needle);
    for (const p of q.data.panels) {
      for (const c of p.circuits) {
        for (const l of c.loads) {
          if (match(l)) hits.push({ load: l, where: `${p.id} · ${c.id}`, panelId: p.id });
        }
      }
      for (const l of p.directLoads) {
        if (match(l)) hits.push({ load: l, where: `${p.id} · breaker only`, panelId: p.id });
      }
      for (const l of p.expectedLoads) {
        if (match(l)) hits.push({ load: l, where: `expected on ${p.id}`, panelId: p.id });
      }
    }
    for (const l of q.data.unassignedLoads) {
      if (match(l)) hits.push({ load: l, where: "no panel in the record", panelId: null });
    }
    return hits.slice(0, 25);
  }, [loadQuery, q.data]);

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <Zap className="h-5 w-5 text-primary" />
              Panel topology
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "planned"
                ? "Planned state: the suggested alignment of loads to panels, from building / grid location and suggested panel. Intent, not installed fact."
                : "Current state: only links a record proves — feeder → panel → breaker → circuit → load. Nothing is inferred."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <Button
                variant={mode === "planned" ? "default" : "ghost"}
                size="sm"
                onClick={() => setMode("planned")}
              >
                Planned
              </Button>
              <Button
                variant={mode === "current" ? "default" : "ghost"}
                size="sm"
                onClick={() => setMode("current")}
              >
                Current state
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>


        {q.isLoading && <Skeleton className="h-64 w-full" />}
        {q.error && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              {(q.error as Error).message}
            </CardContent>
          </Card>
        )}

        {q.data && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Panels ({panels.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {panels.map((p) => {
                  const plannedTotal = plannedPanel(p).total;
                  return (
                    <Button
                      key={p.uuid || p.id}
                      variant={p.id === selected ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelected(p.id)}
                      className="font-mono"
                    >
                      {p.id}
                      <span className="ml-2 font-sans text-xs opacity-80">
                        {mode === "planned"
                          ? `${plannedTotal} planned`
                          : `${p.loadCount} loads${p.gapCount > 0 ? ` · ${p.gapCount} gaps` : ""}`}
                      </span>
                    </Button>
                  );
                })}
              </CardContent>
            </Card>

            {panel ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <span className="font-mono">{panel.id}</span>
                      {panel.description && <span>— {panel.description}</span>}
                      <Badge variant={mode === "planned" ? "secondary" : "default"}>
                        {mode === "planned" ? "planned state" : "current state"}
                      </Badge>
                      {panel.building && <Badge variant="outline">{panel.building}</Badge>}
                      {panel.voltage && <Badge variant="outline">{panel.voltage} V</Badge>}
                      {panel.busRatingAmps && (
                        <Badge variant="outline">{panel.busRatingAmps} A bus</Badge>
                      )}
                      {panel.status && <Badge variant="secondary">{panel.status}</Badge>}
                    </CardTitle>
                  </CardHeader>
                </Card>
                {mode === "planned" ? (
                  <PlannedDetail panel={panel} />
                ) : (
                  <PanelDetail panel={panel} />
                )}
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No panel selected.
                </CardContent>
              </Card>
            )}


            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="h-4 w-4" /> Find a load and see which panel holds it
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  value={loadQuery}
                  onChange={(e) => setLoadQuery(e.target.value)}
                  placeholder="Load ID, description or area — e.g. mini split, FS-082"
                  className="max-w-md"
                />
                {loadQuery.trim() && loadHits.length === 0 && (
                  <p className="text-sm text-muted-foreground">No load matches that text.</p>
                )}
                {loadHits.map((hit) => (
                  <div
                    key={`${hit.load.uuid || hit.load.id}-${hit.where}`}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2"
                  >
                    <span className="font-mono text-xs">{hit.load.id}</span>
                    <span className="text-sm">{hit.load.description || "Unnamed load"}</span>
                    <Badge variant={hit.panelId ? "outline" : "destructive"}>{hit.where}</Badge>
                    {hit.panelId && hit.panelId !== selected && (
                      <Button size="sm" variant="ghost" onClick={() => setSelected(hit.panelId!)}>
                        Open {hit.panelId}
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 pt-6 text-sm">
                <span>
                  <strong>{q.data.totals.panels}</strong> panels
                </span>
                <span>
                  <strong>{q.data.totals.connectedLoads}</strong> of {q.data.totals.loads} loads
                  traced to a panel
                </span>
                <span className="text-destructive">
                  <strong>{q.data.totals.unassignedLoads}</strong> loads with no panel in the record
                </span>
                <span className="text-destructive">
                  <strong>{q.data.orphanCircuits.length}</strong> circuits with no panel link
                </span>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ElectricalGate>
  );
}
