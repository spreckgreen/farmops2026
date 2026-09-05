// Wiring schedule: every panel's real breaker positions, circuit labels and
// connected loads, with each unproven link marked as a gap. Read-only.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  NOT_RECORDED,
  RATING_IS_NOT_LOAD_CURRENT,
  displayAmps,
  displayVa,
  isRecordedNumber,
} from "@/lib/electrical-current-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { loadWiringSchedule } from "@/lib/electrical-wiring.functions";
import {
  NOT_IN_RECORD,
  filterWiringSchedule,
  type WiringLoad,
  type WiringPanel,
  type WiringSlot,
} from "@/lib/electrical-wiring";
import { AlertTriangle, CheckCircle2, RefreshCw, Search } from "lucide-react";

export const Route = createFileRoute("/electrical/wiring")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Wiring Schedule — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Every panel's recorded breaker positions, circuit labels and connected loads, with each missing link named instead of guessed.",
      },
      { property: "og:title", content: "Wiring Schedule — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "Panel-by-panel breaker schedule built only from proven record links, with gaps marked.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WiringPage,
});

function LoadLine({ load }: { load: WiringLoad }) {
  // A missing amps or VA value is "not recorded" — never rendered as zero and
  // never replaced with the branch-circuit rating.
  const hasAmps = isRecordedNumber(load.amps);
  const hasVa = isRecordedNumber(load.va);
  const rating = [hasAmps ? displayAmps(load.amps) : null, hasVa ? displayVa(load.va) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-foreground">{load.id}</span>
      <span className="text-foreground">{load.description || "Unnamed load"}</span>
      {load.area && <Badge variant="outline">{load.area}</Badge>}
      {load.via === "breaker" && <Badge variant="secondary">breaker-only link</Badge>}
      {rating ? (
        <span className="text-muted-foreground">{rating}</span>
      ) : (
        <span className="text-muted-foreground" title={RATING_IS_NOT_LOAD_CURRENT}>
          amps / VA {NOT_RECORDED}
        </span>
      )}
    </div>
  );
}

function SlotRow({ slot }: { slot: WiringSlot }) {
  const tone =
    slot.state === "wired"
      ? "border-border"
      : slot.state === "breaker_only"
        ? "border-amber-500/60"
        : "border-destructive/50";
  return (
    <div className={`rounded-md border ${tone} bg-muted/20 p-2.5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-xs text-background">
          {slot.side} {slot.breakerNumber}
        </span>
        {slot.poles > 1 && <Badge variant="outline">{slot.poles}-pole</Badge>}
        <Badge variant={slot.ocpAmps ? "outline" : "destructive"}>
          {slot.ocpAmps ? `${slot.ocpAmps} A` : "no breaker rating"}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">{slot.circuitId}</span>
        <span className="text-sm text-foreground">{slot.label}</span>
        {slot.status && <Badge variant="secondary">{slot.status}</Badge>}
      </div>
      {slot.loads.length > 0 ? (
        <div className="mt-2 space-y-1 border-l border-border pl-3">
          {slot.loads.map((l) => (
            <LoadLine key={l.uuid || l.id} load={l} />
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-destructive">No load connected to this breaker.</p>
      )}
      {slot.gaps.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {slot.gaps.map((g) => (
            <li key={g}>• {g}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PanelCard({ panel }: { panel: WiringPanel }) {
  const left = panel.slots.filter((s) => /left|odd|a$/i.test(s.side));
  const right = panel.slots.filter((s) => !/left|odd|a$/i.test(s.side));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-mono">{panel.id}</span>
          {panel.description && <span>— {panel.description}</span>}
          {panel.building && <Badge variant="outline">{panel.building}</Badge>}
          <Badge variant="outline">
            {panel.spaces ? `${panel.spaces} spaces` : "spaces NOT IN RECORD"}
          </Badge>
          <Badge variant={panel.counts.wired > 0 ? "secondary" : "destructive"}>
            {panel.counts.wired}/{panel.counts.slots} breakers wired
          </Badge>
          <Badge variant="outline">{panel.counts.loads} loads</Badge>
          {panel.status && <Badge variant="secondary">{panel.status}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {panel.slots.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-2">
              {left.map((s) => (
                <SlotRow key={s.key} slot={s} />
              ))}
            </div>
            <div className="space-y-2">
              {right.map((s) => (
                <SlotRow key={s.key} slot={s} />
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-foreground">
            This panel has no breaker positions in the record, so there is no schedule to show —
            every wiring connection for {panel.id} is still {NOT_IN_RECORD}.
          </p>
        )}

        {panel.circuitsWithoutSlot.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Circuits with no breaker position ({panel.circuitsWithoutSlot.length})
            </h3>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {panel.circuitsWithoutSlot.map((c) => (
                <li key={c.id}>
                  <span className="font-mono text-foreground">{c.id}</span> {c.label}
                  {c.ratingAmps ? ` · ${c.ratingAmps} A` : ""} · {c.loadCount} load(s)
                </li>
              ))}
            </ul>
          </div>
        )}

        {panel.expectedLoads.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Expected here but wired to nothing ({panel.expectedLoads.length})
            </h3>
            <div className="mt-1 space-y-1">
              {panel.expectedLoads.slice(0, 40).map((l) => (
                <LoadLine key={l.uuid || l.id} load={l} />
              ))}
              {panel.expectedLoads.length > 40 && (
                <p className="text-xs text-muted-foreground">
                  + {panel.expectedLoads.length - 40} more
                </p>
              )}
            </div>
          </div>
        )}

        {panel.gaps.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4" /> Gaps
            </h3>
            <ul className="mt-1 space-y-0.5 text-xs text-foreground">
              {panel.gaps.map((g) => (
                <li key={g}>• {g}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WiringPage() {
  const fetchSchedule = useServerFn(loadWiringSchedule);
  const [query, setQuery] = useState("");
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["electrical-wiring"],
    queryFn: () => fetchSchedule(),
  });
  const view = useMemo(
    () => (data ? filterWiringSchedule(data, query) : null),
    [data, query],
  );

  return (
    <ElectricalGate>
      <div className="space-y-4 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Wiring schedule</h1>
          <p className="text-sm text-muted-foreground">
            Each panel's recorded breaker positions, their circuit labels and the loads actually
            connected to them. Nothing is inferred — unproven links read {NOT_IN_RECORD}.
          </p>
        </header>

        {error && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">
              Could not load the wiring records: {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {isPending && (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {data && view && (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 p-4">
                <Badge variant="outline">{data.totals.panels} panels</Badge>
                <Badge variant="outline">
                  {data.totals.wiredSlots}/{data.totals.slots} breakers wired
                </Badge>
                <Badge variant="outline">{data.totals.circuits} circuits</Badge>
                <Badge variant="outline">
                  {data.totals.wiredLoads}/{data.totals.loads} loads connected
                </Badge>
                <Badge variant={data.totals.gaps > 0 ? "destructive" : "secondary"}>
                  {data.totals.gaps} gaps
                </Badge>
                <div className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Panel, breaker, circuit or load"
                      className="w-64 pl-8"
                    />
                  </div>
                  <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                    <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </CardContent>
            </Card>

            {data.totals.slots === 0 && (
              <Card>
                <CardContent className="p-4 text-sm text-foreground">
                  No breaker positions exist in the record yet, so no panel has a wiring schedule.
                  Import the canonical panel schedules to populate breakers, circuits and their load
                  connections — until then this page will honestly show every connection as{" "}
                  {NOT_IN_RECORD}.
                </CardContent>
              </Card>
            )}

            {view.panels.map((panel) => (
              <PanelCard key={panel.uuid || panel.id} panel={panel} />
            ))}

            {view.panels.length === 0 && query && (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Nothing in the wiring records matches “{query}”.
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {view.unwiredLoads.length === 0 ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                  Loads connected to no breaker ({view.unwiredLoads.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {view.unwiredLoads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Every load in the record is connected to a breaker position.
                  </p>
                ) : (
                  <>
                    {view.unwiredLoads.slice(0, 100).map((l) => (
                      <LoadLine key={l.uuid || l.id} load={l} />
                    ))}
                    {view.unwiredLoads.length > 100 && (
                      <p className="text-xs text-muted-foreground">
                        + {view.unwiredLoads.length - 100} more
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ElectricalGate>
  );
}
