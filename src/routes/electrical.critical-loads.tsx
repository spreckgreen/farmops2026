// Critical-load study: which master loads belong on PNL-FS-CRIT, and what the
// standby generator has to carry. Read-only — selection lives in the browser.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, RefreshCw, Search } from "lucide-react";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { PersistedSection } from "@/components/electrical/persisted-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CRITICAL_PANEL_ID, loadCriticalLoadFeed } from "@/lib/critical-loads.functions";
import {
  NOT_IN_RECORD,
  SIZING_ASSUMPTIONS,
  TIER_LABELS,
  buildCandidates,
  criticalLoadsCsv,
  sizeCriticalPanel,
  type CriticalCandidate,
  type CriticalTier,
} from "@/lib/electrical-critical-loads";

export const Route = createFileRoute("/electrical/critical-loads")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Critical Loads & Generator Sizing — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Master-load view of the loads proposed for PNL-FS-CRIT with connected VA, continuous demand, motor starting and standby generator sizing.",
      },
      {
        property: "og:title",
        content: "Critical Loads & Generator Sizing — Bostead Farms Electrical",
      },
      {
        property: "og:description",
        content:
          "Select the critical-panel load set and see the resulting bus ampacity and generator kW requirement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CriticalLoadsPage,
});

const va = (n: number | null) => (n === null ? NOT_IN_RECORD : `${n.toLocaleString()} VA`);

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function CandidateRow({
  row,
  checked,
  onToggle,
}: {
  row: CriticalCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-border py-2 text-xs">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-foreground">{row.load_id}</span>
          <span className="text-foreground">{row.description}</span>
          {row.area && <Badge variant="outline">{row.area}</Badge>}
          {row.grid && <Badge variant="outline">grid {row.grid}</Badge>}
          {row.continuous && <Badge variant="secondary">continuous</Badge>}
          {row.motor && <Badge variant="secondary">motor start</Badge>}
        </div>
        <div className="mt-1 text-muted-foreground">
          {row.quantity > 1 ? `${row.quantity} × · ` : ""}
          {row.volts === null ? NOT_IN_RECORD : `${row.volts} V`} ·{" "}
          {row.amps === null ? NOT_IN_RECORD : `${row.amps} A`} · {va(row.va)}
        </div>
        {row.evidence.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {row.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {row.gaps.length > 0 && (
          <div className="mt-1 text-destructive">Gaps: {row.gaps.join("; ")}</div>
        )}
      </div>
    </div>
  );
}

function CriticalLoadsPage() {
  const fetchFeed = useServerFn(loadCriticalLoadFeed);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["electrical", "critical-loads"],
    queryFn: () => fetchFeed(),
  });
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const built = useMemo(
    () => (data ? buildCandidates(data.loads) : { candidates: [], flagUsable: null }),
    [data],
  );
  const candidates = built.candidates;
  const isSelected = (row: CriticalCandidate) => overrides[row.load_id] ?? row.selectedByDefault;
  const selected = candidates.filter(isSelected);
  const sizing = useMemo(() => sizeCriticalPanel(selected), [selected]);

  const byTier = useMemo(() => {
    const groups = new Map<CriticalTier, CriticalCandidate[]>();
    const term = search.trim().toLowerCase();
    for (const c of candidates) {
      if (
        term &&
        !`${c.load_id} ${c.description} ${c.area ?? ""} ${c.grid ?? ""}`.toLowerCase().includes(term)
      ) {
        continue;
      }
      const list = groups.get(c.tier) ?? [];
      list.push(c);
      groups.set(c.tier, list);
    }
    return groups;
  }, [candidates, search]);

  const tierOrder: CriticalTier[] = [
    "T1_water_heat",
    "T2_food_preservation",
    "T3_comms_security",
    "T4_egress_lighting",
    "T5_comfort_hvac",
    "not_critical",
  ];

  const setTier = (tier: CriticalTier, value: boolean) =>
    setOverrides((prev) => {
      const next = { ...prev };
      for (const c of candidates) if (c.tier === tier) next[c.load_id] = value;
      return next;
    });

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  {CRITICAL_PANEL_ID} critical-load study & generator sizing
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Built from the master load list. Candidates are proposed from recorded
                  evidence, never from an assumed circuit assignment. Tick or untick loads and
                  the panel and generator numbers below recompute.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.length === 0}
                  onClick={() =>
                    download(
                      "pnl-fs-crit-critical-loads.csv",
                      criticalLoadsCsv(selected),
                      "text/csv",
                    )
                  }
                >
                  <Download className="mr-1 h-3 w-3" />
                  Selected CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : error ? (
              <p className="text-destructive">
                Couldn't read the master load list: {(error as Error).message}
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Loads selected" value={`${sizing.selectedCount}`} sub={`of ${candidates.length} master loads`} />
                  <Stat
                    label="Calculated demand"
                    value={`${sizing.demandVa.toLocaleString()} VA`}
                    sub={`${sizing.demandAmps240} A at ${SIZING_ASSUMPTIONS.panelVolts} V`}
                  />
                  <Stat
                    label={`${CRITICAL_PANEL_ID} bus`}
                    value={
                      sizing.recommendedBusAmps ? `${sizing.recommendedBusAmps} A` : "above 225 A"
                    }
                    sub="next standard size at or above the calculated load"
                  />
                  <Stat
                    label="Generator"
                    value={
                      sizing.recommendedGeneratorKw
                        ? `${sizing.recommendedGeneratorKw} kW`
                        : "above 60 kW"
                    }
                    sub={
                      sizing.drivenBy === "motor_starting"
                        ? "driven by motor starting"
                        : "driven by running load"
                    }
                  />
                </div>
                {built.flagUsable && !built.flagUsable.critical && (
                  <div className="flex gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p>
                      The imported <span className="font-mono">critical</span> and{" "}
                      <span className="font-mono">backup_eligible</span> columns read{" "}
                      <span className="font-mono">true</span> on every master-load row, so they
                      carry no engineering information and are not used to select loads here.
                      Candidates come from recorded descriptions, areas, shed groups and notes,
                      and each one shows its evidence.
                    </p>
                  </div>
                )}
                {data?.panel ? (
                  <p className="text-xs text-muted-foreground">
                    Recorded {CRITICAL_PANEL_ID}: bus{" "}
                    {data.panel.bus_rating_amps ? `${data.panel.bus_rating_amps} A` : NOT_IN_RECORD}{" "}
                    · voltage {data.panel.voltage ?? NOT_IN_RECORD} · spaces{" "}
                    {data.panel.spaces ?? NOT_IN_RECORD} · feeder source{" "}
                    {data.panel.feeder_source ?? NOT_IN_RECORD}.{" "}
                    {data.panel.install_status ?? ""}
                  </p>
                ) : (
                  <p className="text-xs text-destructive">
                    {CRITICAL_PANEL_ID} is not in the panel record yet — sizing below is a design
                    proposal only.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {!isLoading && !error && (
          <>
            <PersistedSection
              storageKey="critical-loads.sizing"
              title="Panel and generator sizing basis"
              defaultOpen
              badges={<Badge variant="outline">{sizing.selectedCount} loads</Badge>}
            >
              <div className="space-y-3 text-sm">
                <table className="w-full text-xs">
                  <tbody>
                    <Line label="Connected VA (selected loads)" value={va(sizing.connectedVa)} />
                    <Line
                      label="Continuous portion (×1.25 applied)"
                      value={va(sizing.continuousVa)}
                    />
                    <Line label="Non-continuous portion" value={va(sizing.nonContinuousVa)} />
                    <Line
                      label="Calculated demand (non-continuous + 125% continuous)"
                      value={`${sizing.demandVa.toLocaleString()} VA · ${sizing.demandAmps240} A at ${SIZING_ASSUMPTIONS.panelVolts} V`}
                    />
                    <Line
                      label="Largest motor / compressor load"
                      value={
                        sizing.largestMotor
                          ? `${sizing.largestMotor.load_id} — ${sizing.largestMotor.description} (${sizing.largestMotor.va.toLocaleString()} VA)`
                          : "none among the selected loads"
                      }
                    />
                    <Line
                      label="Generator running load"
                      value={`${sizing.runningKva} kVA · ${sizing.runningKw} kW at ${SIZING_ASSUMPTIONS.powerFactor} PF`}
                    />
                    <Line
                      label={`Starting load (largest motor ×${SIZING_ASSUMPTIONS.motorStartMultiplier})`}
                      value={`${sizing.startingKva} kVA`}
                    />
                    <Line
                      label="Recommended generator"
                      value={
                        sizing.recommendedGeneratorKw
                          ? `${sizing.recommendedGeneratorKw} kW standby (${sizing.drivenBy === "motor_starting" ? "motor starting governs" : "running load ×1.25 governs"})`
                          : "larger than the 60 kW ceiling in this study"
                      }
                    />
                    <Line
                      label="Loads selected with no connected VA"
                      value={`${sizing.loadsWithoutVa} — they contribute nothing and understate the total`}
                    />
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground">
                  Assumptions, stated so an electrician can challenge them: panel at{" "}
                  {SIZING_ASSUMPTIONS.panelVolts} V single phase, continuous loads at 125%, power
                  factor {SIZING_ASSUMPTIONS.powerFactor}, largest motor starting at{" "}
                  {SIZING_ASSUMPTIONS.motorStartMultiplier}× running VA, generator sized with{" "}
                  {Math.round((SIZING_ASSUMPTIONS.generatorHeadroom - 1) * 100)}% running headroom.
                  This is a planning study, not a stamped calculation, and no diversity or NEC
                  article-220 demand factors are applied.
                </p>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="critical-loads.tiers"
              title="Load shed order (cumulative)"
              badges={<Badge variant="outline">{sizing.tierTotals.length} tiers</Badge>}
            >
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Tier</th>
                    <th className="p-2">Loads</th>
                    <th className="p-2">Tier VA</th>
                    <th className="p-2">Cumulative VA</th>
                  </tr>
                </thead>
                <tbody>
                  {sizing.tierTotals.map((t, i) => (
                    <tr key={t.tier} className="border-t">
                      <td className="p-2">{TIER_LABELS[t.tier]}</td>
                      <td className="p-2">{t.count}</td>
                      <td className="p-2">{t.va.toLocaleString()}</td>
                      <td className="p-2">{sizing.shedTiers[i]?.cumulativeVa.toLocaleString()}</td>
                    </tr>
                  ))}
                  {sizing.tierTotals.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-muted-foreground">
                        No loads selected.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </PersistedSection>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a load by ID, description, area or grid"
                    className="h-8 text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {tierOrder.map((tier) => {
              const rows = byTier.get(tier) ?? [];
              if (rows.length === 0) return null;
              const selectedHere = rows.filter(isSelected).length;
              const tierVa = rows
                .filter(isSelected)
                .reduce((s, r) => s + (r.va ?? 0), 0);
              return (
                <PersistedSection
                  key={tier}
                  storageKey={`critical-loads.tier.${tier}`}
                  title={TIER_LABELS[tier]}
                  defaultOpen={tier === "T1_water_heat"}
                  badges={
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline">
                        {selectedHere}/{rows.length} selected
                      </Badge>
                      <Badge variant="secondary">{Math.round(tierVa).toLocaleString()} VA</Badge>
                    </div>
                  }
                >
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setTier(tier, true)}>
                        Select all
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setTier(tier, false)}>
                        Clear all
                      </Button>
                    </div>
                    <div>
                      {rows.map((row) => (
                        <CandidateRow
                          key={row.load_id}
                          row={row}
                          checked={isSelected(row)}
                          onToggle={() =>
                            setOverrides((prev) => ({
                              ...prev,
                              [row.load_id]: !isSelected(row),
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                </PersistedSection>
              );
            })}
          </>
        )}
      </div>
    </ElectricalGate>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t align-top">
      <td className="p-2 text-muted-foreground">{label}</td>
      <td className="p-2 text-foreground">{value}</td>
    </tr>
  );
}
