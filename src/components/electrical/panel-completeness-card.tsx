// Panel completeness — deliberately several separate results, never one
// unlabelled bar mixing capacity, construction and verification.
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { downloadCsv } from "@/lib/csv";
import { panelCompletenessCsv } from "@/lib/electrical-panel-completeness";
import {
  POSITION_CLASSES,
  POSITION_CLASS_LABELS,
  milestoneCountLines,
  type PanelCompleteness,
} from "@/lib/electrical-lifecycle";

function Metric({
  title,
  value,
  detail,
  denominator,
}: {
  title: string;
  value: string;
  detail: string;
  denominator: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{denominator}</p>
    </div>
  );
}

export function PanelCompletenessCard({ result }: { result: PanelCompleteness }) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => milestoneCountLines(result), [result]);
  const { capacity, positionClasses, rollout, infrastructure, loads } = result;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {result.panel_id}
          <Badge variant="secondary">{result.operational}</Badge>
          {result.holds.length > 0 ? (
            <Badge variant="destructive">
              {result.holds.length} hold{result.holds.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Derived from stored records{result.evidenceSource ? ` — evidence: ${result.evidenceSource}` : ""}
          . Last recalculated {new Date(result.calculatedAt).toLocaleString()}.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            title="Panel infrastructure"
            value={infrastructure.label}
            detail={`Stage ${infrastructure.stage} of ${infrastructure.of}`}
            denominator="The panel enclosure and its supply — separate from circuit rollout."
          />
          <Metric
            title="Capacity utilization"
            value={`${capacity.utilizationPercent}%`}
            detail={`${capacity.occupiedPositions} of ${capacity.usablePositions} positions occupied (${capacity.breakerCount} breakers)`}
            denominator={capacity.denominator}
          />
          <Metric
            title="Current-scope circuits"
            value={`${rollout.rolloutPercent}%`}
            detail={`${rollout.completedMilestones} of ${rollout.applicableMilestones} applicable milestones across ${rollout.inScopeCircuits} in-scope circuits`}
            denominator={rollout.denominator}
          />
          <Metric
            title="Position documentation"
            value={`${positionClasses.documentationCoveragePercent}%`}
            detail={`${positionClasses.classified} classified, ${positionClasses.unclassified} not yet classified`}
            denominator={positionClasses.denominator}
          />
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Circuit rollout across in-scope circuits only (capacity excluded):
          </p>
          <Progress value={rollout.rolloutPercent} />
        </div>

        <div className="flex flex-wrap gap-1">
          {POSITION_CLASSES.map((c) => (
            <Badge key={c} variant="outline">
              {POSITION_CLASS_LABELS[c]}: {positionClasses.totals[c]}
            </Badge>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide milestone counts" : "Show milestone counts"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              downloadCsv(`${result.panel_id}-completeness.csv`, panelCompletenessCsv(result))
            }
          >
            Export counts (CSV)
          </Button>
        </div>

        {open ? (
          <div className="space-y-3">
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="grid gap-1 text-xs sm:grid-cols-2">
              {rollout.counts.map((c) => (
                <p key={c.milestone}>
                  <span className="font-medium">{c.label}:</span> {c.complete} of {c.applicable}{" "}
                  ({c.percent}%)
                  {c.notApplicable ? ` · ${c.notApplicable} not applicable` : ""}
                  {c.unknown ? ` · ${c.unknown} no record yet` : ""}
                </p>
              ))}
              <p>
                <span className="font-medium">Identified loads connected:</span> {loads.connected} of{" "}
                {loads.identified} ({loads.percent}%) · {loads.verified} as-built verified
              </p>
            </div>
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What each denominator means</p>
              {result.denominators.map((d) => (
                <p key={d.name}>
                  <span className="font-medium">{d.name}:</span> {d.text}
                </p>
              ))}
              <p className="mt-1">
                <span className="font-medium">Weighted headline ({result.weighted.percent}%):</span>{" "}
                {result.weighted.formula}
              </p>
            </div>
          </div>
        ) : null}

        {result.holds.length ? (
          <div className="rounded-md border border-destructive/40 p-2 text-sm">
            <p className="font-medium">Active holds and conflicts (never counted as progress)</p>
            <ul className="mt-1 space-y-1 text-xs">
              {result.holds.map((h) => (
                <li key={`${h.kind}-${h.ref}-${h.reason}`}>
                  <Badge variant="destructive" className="mr-1">
                    {h.kind}
                  </Badge>
                  {h.ref} — {h.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
