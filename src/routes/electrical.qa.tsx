// Electrical topology QA report. Read-only: it surfaces integrity problems in
// the records (duplicate or malformed stable IDs, orphans, FK/reference
// disagreement, breaker conflicts, invalid controlled values) and never edits.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import {
  electricalIntegrityReport,
  normalizeLegacyStatuses,
} from "@/lib/electrical.functions";
import { IdRepairReport } from "@/components/electrical/id-repair-report";
import { RefAuditReport } from "@/components/electrical/ref-audit-report";
import { GridAuditReport } from "@/components/electrical/grid-audit-report";
import { LoadCompareReport } from "@/components/electrical/load-compare-report";
import { TopologyPunchList } from "@/components/electrical/topology-punch-list";
import { RacewayPathPopulation } from "@/components/electrical/raceway-path-population";
import { BreakerPopulationPreview } from "@/components/electrical/breaker-population-preview";
import { FieldObservationJournal } from "@/components/electrical/field-observation-journal";
import { HousePanelFieldReconciliation } from "@/components/electrical/house-panel-field-reconciliation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, Wrench } from "lucide-react";

export const Route = createFileRoute("/electrical/qa")({
  component: QaPage,
  head: () => ({
    meta: [
      { title: "Electrical Topology QA — Bostead Farms" },
      {
        name: "description",
        content:
          "Integrity report for electrical records: duplicate IDs, orphan runs, missing endpoints, breaker conflicts and invalid controlled values.",
      },
      { property: "og:title", content: "Electrical Topology QA — Bostead Farms" },
      {
        property: "og:description",
        content: "Integrity report for panels, raceways, junction boxes, branch runs and loads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function QaPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <GridAuditReport />
        <LoadCompareReport />
        <IdRepairReport />
        <RefAuditReport />
        <RacewayPathPopulation />
        <HousePanelFieldReconciliation scope="house" />
        <HousePanelFieldReconciliation scope="farm_shop" />
        <BreakerPopulationPreview scope="house" />
        <FieldObservationJournal />


        <QaReport />
      </div>
    </ElectricalGate>
  );
}


const CODE_LABELS: Record<string, string> = {
  duplicate_stable_id: "Duplicate stable IDs",
  malformed_stable_id: "Malformed stable IDs",
  invalid_controlled_value: "Invalid controlled values",
  missing_endpoint: "Missing endpoints",
  unknown_endpoint: "Unknown endpoints",
  endpoint_type_mismatch: "Endpoint type mismatches",
  fk_ref_disagreement: "Link / reference disagreement",
  self_reference: "Self-referencing topology",
  unknown_panel: "Unknown panels",
  unknown_circuit_group: "Unknown circuit groups",
  unknown_load: "Unknown loads",
  breaker_conflict: "Breaker conflicts",
  orphan_endpoint: "Orphan records",
  incomplete_topology: "Incomplete topology",
  orphan_waypoint: "Orphan waypoints",
  unresolved_upstream_topology: "Unresolved upstream topology",
  ambiguous_service_domain: "Ambiguous service domain",
  panel_feeder_cycle: "Panel feeder cycles",
  encoded_parent_mismatch: "Encoded parent does not match linked parent",
};

function QaReport() {
  const run = useServerFn(electricalIntegrityReport);
  const normalize = useServerFn(normalizeLegacyStatuses);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const q = useQuery({ queryKey: ["electrical", "qa"], queryFn: () => run() });

  const legacyStatuses = (q.data?.findings ?? []).filter(
    (f) => f.code === "invalid_controlled_value" && /install status/i.test(f.message),
  ).length;

  const [preview, setPreview] = useState<
    { kind: string; stable_id: string; was: string; now: string }[] | null
  >(null);

  const fix = useMutation({
    mutationFn: async (apply: boolean) => normalize({ data: { apply } }),
    onSuccess: (r) => {
      if (!r.applied) {
        setPreview(r.proposed);
        if (!r.proposed.length) toast.success("No legacy status values found.");
        return;
      }
      if (r.errors.length) toast.error(`${r.errors.length} record(s) could not be updated.`);
      toast.success(
        `Fixed ${r.fixed.length} record(s) — the original text was kept verbatim in Notes.`,
      );
      setPreview(null);
      void q.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grouped = useMemo(() => {
    const findings = (q.data?.findings ?? []).filter(
      (f) => !onlyErrors || f.severity === "error",
    );
    const map = new Map<string, typeof findings>();
    for (const f of findings) {
      const list = map.get(f.code) ?? [];
      list.push(f);
      map.set(f.code, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [q.data, onlyErrors]);

  const summary = q.data?.summary;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-base">Topology integrity</CardTitle>
            <p className="text-sm text-muted-foreground">
              A report only — nothing here changes records. Fix findings before any future
              engineering export.
            </p>
          </div>
          <div className="flex gap-2">
            {legacyStatuses ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={fix.isPending}
                onClick={() => fix.mutate(false)}
              >
                <Wrench className="h-4 w-4" />
                {fix.isPending ? "Checking…" : `Review ${legacyStatuses} legacy status value(s)`}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setOnlyErrors((v) => !v)}>
              {onlyErrors ? "Show warnings too" : "Errors only"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
              Re-run
            </Button>
          </div>
        </CardHeader>

        {preview?.length ? (
          <CardContent className="space-y-2 border-b border-border pb-3">
            <p className="text-sm">
              These records hold engineering text in the controlled Install status field, so the
              database rejects every write to them. Nothing changes until you apply: the original
              wording is kept verbatim in Notes and no record is deleted, recreated or renamed.
            </p>
            <div className="space-y-1 text-sm">
              {preview.map((p) => (
                <div key={`${p.kind}-${p.stable_id}`} className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-mono">
                    {p.stable_id}
                  </Badge>
                  <span className="text-muted-foreground">“{p.was}”</span>
                  <span>→ Install status “{p.now}” + Notes line</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={fix.isPending} onClick={() => fix.mutate(true)}>
                {fix.isPending ? "Applying…" : `Apply to ${preview.length} record(s)`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        ) : null}

        <CardContent>

          {q.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : q.error ? (
            <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          ) : (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant={summary?.errors ? "destructive" : "outline"}>
                {summary?.errors ?? 0} errors
              </Badge>
              <Badge variant="secondary">
                {summary?.incomplete ?? 0} warnings / incomplete
              </Badge>
              <Badge variant="outline">{summary?.valid ?? 0} valid</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <TopologyPunchList
        gaps={q.data?.gaps ?? []}
        summary={q.data?.gapSummary}
        loading={q.isLoading}
      />


      {!q.isLoading && !q.error && !grouped.length ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            No integrity problems found in the current electrical records.
          </CardContent>
        </Card>
      ) : null}

      {grouped.map(([code, findings]) => (
        <Card key={code}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {CODE_LABELS[code] ?? code} <span className="text-muted-foreground">({findings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {findings.map((f, i) => (
              <div
                key={`${f.code}-${f.id ?? f.stableId}-${i}`}
                className="flex flex-wrap items-baseline gap-2 border-b border-border pb-1 text-sm last:border-0"
              >
                <Badge variant={f.severity === "error" ? "destructive" : "secondary"}>
                  {f.severity}
                </Badge>
                {f.id && f.kind !== "waypoint" ? (
                  <Link
                    to="/electrical/item/$kind/$id"
                    params={{ kind: f.kind as ElectricalEntityKind, id: f.id }}
                    className="font-mono underline underline-offset-2"
                  >
                    {f.stableId || "(no ID)"}
                  </Link>
                ) : (
                  <span className="font-mono">{f.stableId || "(no ID)"}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {f.kind === "waypoint" ? "waypoint" : ENTITIES[f.kind as ElectricalEntityKind].singular}
                </span>
                <span className="text-muted-foreground">{f.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
