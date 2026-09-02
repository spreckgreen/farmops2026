// Load_Master business-rule view for one panel: physical rows vs logical
// circuits. Rules are applied literally; nothing is inferred.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PersistedSection } from "@/components/electrical/persisted-section";
import { loadRuleLoads } from "@/lib/electrical-load-rules.functions";
import {
  BUSINESS_RULES,
  NOT_IN_RECORD,
  panelRuleRollup,
  type GeneratorTier,
  type LogicalCircuit,
  type PhysicalLoad,
} from "@/lib/electrical-load-business-rules";

type RuleView = "logical" | "physical";

const tierVariant = (tier: GeneratorTier) =>
  tier === "REQUIRED"
    ? "default"
    : tier === "EXCLUDE"
      ? "outline"
      : tier === "REVIEW"
        ? "destructive"
        : "secondary";

const va = (v: number | null) => (v == null ? NOT_IN_RECORD : `${v.toLocaleString()} VA`);

function PhysicalRow({ load }: { load: PhysicalLoad }) {
  return (
    <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{load.loadId}</span>
        <span className="text-sm">{load.description || "Unnamed load"}</span>
        {load.area && <Badge variant="outline">{load.area}</Badge>}
        <Badge variant={load.criticality === "CRITICAL" ? "default" : load.criticality === "REVIEW" ? "destructive" : "outline"}>
          {load.criticality}
        </Badge>
        <Badge variant={tierVariant(load.tier)}>{load.tier}</Badge>
        <Badge variant="outline">D/S {load.dedicatedShared}</Badge>
        <Badge variant="outline">CG {load.circuitGroupId}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Criticality: {load.criticalityBasis}. Tier: {load.tierBasis}. Demand Basis:{" "}
        {load.demand.basis}; Demand VA as stated: {load.preserved.demandVa}; Connected VA:{" "}
        {va(load.demand.connectedVa)}; Phase: {load.preserved.phase}; Continuous:{" "}
        {load.preserved.continuousLoad}; Start class: {load.preserved.generatorStartClass}; Start
        amps: {load.preserved.generatorStartAmps}.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Suggested Panel (design intent): {load.suggestedPanel} · Backup Panel (separate concept):{" "}
        {load.backupPanel} · Future: {load.future} · Install status: {load.installStatus}
      </p>
      {load.notes.map((n) => (
        <p key={n} className="mt-1 text-xs text-destructive">
          {n}
        </p>
      ))}
    </div>
  );
}

function CircuitRow({ circuit }: { circuit: LogicalCircuit }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{circuit.key}</span>
        <Badge variant={circuit.kind === "UNRESOLVED" ? "destructive" : "outline"}>
          {circuit.kind}
        </Badge>
        <Badge variant={tierVariant(circuit.tier)}>{circuit.tier}</Badge>
        <Badge variant="outline">
          {circuit.countsAsCircuit ? "1 breaker" : "not counted as a circuit"}
        </Badge>
        <Badge variant="outline">
          {circuit.plannedRatingAmps == null
            ? `rating ${NOT_IN_RECORD}`
            : `${circuit.plannedRatingAmps} A planning`}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {circuit.loads.length} load{circuit.loads.length === 1 ? "" : "s"} · connected{" "}
          {va(circuit.connectedVaTotal)} · demand {va(circuit.demandVaTotal)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Rating basis: {circuit.ratingBasis}</p>
      {circuit.coLoads.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Non-critical co-loads carried by this energized branch: {circuit.coLoads.join(", ")}
        </p>
      )}
      {circuit.demandUnknownLoads.length > 0 && (
        <p className="mt-1 text-xs text-destructive">
          Demand unknown (not inferred): {circuit.demandUnknownLoads.join(", ")}
        </p>
      )}
      {circuit.notes.map((n) => (
        <p key={n} className="mt-1 text-xs text-muted-foreground">
          {n}
        </p>
      ))}
      <div className="mt-2 space-y-1.5 border-l border-border pl-3">
        {circuit.loads.map((l) => (
          <PhysicalRow key={l.loadId} load={l} />
        ))}
      </div>
    </div>
  );
}

export function PanelRuleView({ panelId }: { panelId: string }) {
  const fetchLoads = useServerFn(loadRuleLoads);
  const [view, setView] = useState<RuleView>("logical");
  const { data, isLoading, error } = useQuery({
    queryKey: ["electrical", "rule-loads"],
    queryFn: () => fetchLoads(),
  });

  const rollup = useMemo(
    () => (data ? panelRuleRollup(panelId, data as unknown as Record<string, unknown>[]) : null),
    [data, panelId],
  );

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          Could not read the load records: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }
  if (!rollup) return null;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Planned load by business rule — {panelId}
            <Badge variant="outline">{rollup.counts.physicalRows} physical rows</Badge>
            <Badge variant="outline">{rollup.counts.logicalCircuits} logical circuits</Badge>
            <Badge variant={rollup.counts.unresolvedRows ? "destructive" : "outline"}>
              {rollup.counts.unresolvedRows} unresolved
            </Badge>
            <Badge variant="default">{rollup.counts.critical} critical</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(rollup.counts.tier) as GeneratorTier[]).map((t) => (
              <Badge key={t} variant={tierVariant(t)}>
                {t}: {rollup.counts.tier[t]}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Connected VA indicator: {va(rollup.connectedVaTotal)} · Demand VA as stated:{" "}
            {va(rollup.demandVaTotal)}
            {rollup.demandUnknownLoads.length > 0
              ? ` · demand unknown on ${rollup.demandUnknownLoads.length} row(s)`
              : ""}
          </p>
          <div className="flex gap-1 rounded-md border border-border p-1">
            <Button
              size="sm"
              variant={view === "logical" ? "default" : "ghost"}
              onClick={() => setView("logical")}
            >
              Logical circuits (sizing view)
            </Button>
            <Button
              size="sm"
              variant={view === "physical" ? "default" : "ghost"}
              onClick={() => setView("physical")}
            >
              Physical loads
            </Button>
          </div>
          {rollup.statements.map((s) => (
            <p key={s} className="text-xs text-muted-foreground">
              {s}
            </p>
          ))}
        </CardContent>
      </Card>

      <PersistedSection
        storageKey={`panel-diagram.rules.${view}`}
        title={view === "logical" ? "Logical circuits" : "Physical load rows"}
        defaultOpen
      >
        {view === "logical" ? (
          rollup.circuits.length ? (
            <div className="space-y-2">
              {rollup.circuits.map((c) => (
                <CircuitRow key={`${c.kind}:${c.key}`} circuit={c} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No load row names {panelId} in Suggested Panel, so no planned circuit can be formed
              for it from the record.
            </p>
          )
        ) : rollup.physical.length ? (
          <div className="space-y-1.5">
            {rollup.physical.map((l) => (
              <PhysicalRow key={l.loadId} load={l} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No load row names {panelId} in Suggested Panel.
          </p>
        )}
      </PersistedSection>

      <PersistedSection
        storageKey="panel-diagram.rules.review"
        title={`Needs review (${rollup.reviewItems.length})`}
      >
        {rollup.reviewItems.length ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {rollup.reviewItems.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Every row on this panel has a decidable Critical, Backup Priority and D/S value.
          </p>
        )}
      </PersistedSection>

      <PersistedSection storageKey="panel-diagram.rules.list" title="Business rules applied">
        <ul className="space-y-1 text-xs text-muted-foreground">
          {BUSINESS_RULES.map((r) => (
            <li key={r.id}>
              <span className="font-mono text-foreground">{r.id}</span> — {r.rule}
            </li>
          ))}
        </ul>
      </PersistedSection>
    </div>
  );
}
