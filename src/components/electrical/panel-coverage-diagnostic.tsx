// Phase 4.4b — panel-position coverage diagnostic (read-only presentation).
//
// Shows the full chain for every physical panel position: transcription
// evidence → parsed logical breaker → existing FarmOps record. Nothing here
// creates, edits or infers a breaker.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import {
  PANEL_COVERAGE_CSV,
  POSITION_COVERAGE_LABELS,
  POSITION_COVERAGE_STATES,
  type PanelCoverageReport,
  type PositionCoverageState,
} from "@/lib/electrical-panel-coverage";

const ATTENTION: PositionCoverageState[] = [
  "missing_from_transcription",
  "field_observed_unresolved",
  "suppressed_duplicate",
];

export function PanelCoverageDiagnostic({
  report,
  csv,
}: {
  report: PanelCoverageReport;
  csv: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const attentionTotal = useMemo(
    () => ATTENTION.reduce((n, s) => n + report.totals.counts[s], 0),
    [report],
  );

  if (!report.panels.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Panel-position coverage (read-only)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Physical panel positions → transcription evidence → logical breakers parsed → existing
          breaker records. The denominator is each panel's own position universe, so a physical
          breaker the workbook never mentioned is reported as missing rather than dropped from the
          count.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`flex flex-wrap items-start gap-2 rounded-md border p-3 text-sm ${
            report.inventory_complete
              ? "border-border bg-muted/40"
              : "border-destructive/50 bg-destructive/10"
          }`}
        >
          {report.inventory_complete ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          )}
          <div className="space-y-1">
            <div className="font-medium">
              {report.inventory_complete
                ? "Every physical position is accounted for."
                : "Breaker inventory is NOT complete."}
            </div>
            {report.incomplete_reasons.map((r) => (
              <p key={r} className="text-muted-foreground">
                {r}
              </p>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{report.totals.positions_expected} positions expected</Badge>
          <Badge variant="outline">
            {report.totals.logical_breakers_parsed} logical breakers parsed
          </Badge>
          <Badge variant="outline">
            {report.totals.positions_with_records} positions with records
          </Badge>
          {POSITION_COVERAGE_STATES.filter((s) => report.totals.counts[s] > 0).map((s) => (
            <Badge key={s} variant={ATTENTION.includes(s) ? "destructive" : "secondary"}>
              {POSITION_COVERAGE_LABELS[s]}: {report.totals.counts[s]}
            </Badge>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => downloadCsv(PANEL_COVERAGE_CSV, csv)}
          >
            <Download className="mr-1 h-4 w-4" /> Export coverage CSV
          </Button>
        </div>

        {report.panels.map((p) => {
          const attention = p.positions.filter((pos) => ATTENTION.includes(pos.state));
          const open = expanded === p.panel_id;
          return (
            <div key={p.panel_id} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono font-medium">{p.panel_id}</span>
                <Badge variant="outline">
                  {p.positions_expected} positions ·{" "}
                  {p.capacity_source === "panel_configuration"
                    ? "panel configuration"
                    : "inferred from evidence"}
                </Badge>
                <Badge variant="outline">{p.logical_breakers_parsed} logical breakers</Badge>
                {attention.length ? (
                  <Badge variant="destructive">{attention.length} need attention</Badge>
                ) : (
                  <Badge variant="secondary">no gaps detected</Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setExpanded(open ? null : p.panel_id)}
                >
                  {open ? "Hide positions" : "Show every position"}
                </Button>
              </div>

              {attention.length ? (
                <div className="space-y-1 text-sm">
                  {attention.map((pos) => (
                    <div key={pos.breaker_number} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">
                        breaker {pos.breaker_number} · {pos.side} {pos.position}
                      </span>
                      <Badge variant="destructive">{pos.state_label}</Badge>
                      <span className="text-xs text-muted-foreground">{pos.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {open ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1 pr-3">Breaker</th>
                        <th className="py-1 pr-3">Slot</th>
                        <th className="py-1 pr-3">Classification</th>
                        <th className="py-1 pr-3">Evidence</th>
                        <th className="py-1 pr-3">Record</th>
                        <th className="py-1">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.positions.map((pos) => (
                        <tr key={pos.breaker_number} className="border-t border-border align-top">
                          <td className="py-1 pr-3 font-mono">{pos.breaker_number}</td>
                          <td className="py-1 pr-3 font-mono">
                            {pos.side} {pos.position}
                          </td>
                          <td className="py-1 pr-3">{pos.state_label}</td>
                          <td className="py-1 pr-3">
                            {pos.has_transcription_evidence ? (pos.logical_owner ?? "yes") : "—"}
                          </td>
                          <td className="py-1 pr-3">{pos.has_record ? "yes" : "—"}</td>
                          <td className="py-1 text-muted-foreground">{pos.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
