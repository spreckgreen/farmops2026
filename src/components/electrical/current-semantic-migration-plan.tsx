// Phase 4.4b — canonical electrical-current semantic migration planning (UI).
// Read-only by construction: there is no Apply control, no mutation and no
// write path. It plans the target schema before any canonical value is edited.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BLOCKER_LABELS,
  CONFIDENCE_LABELS,
  CURRENT_MIGRATION_FIXTURE_IDS,
  currentMigrationCsv,
  currentMigrationMarkdown,
  planCurrentSemanticMigration,
} from "@/lib/electrical-current-semantic-migration";
import { VA_BASIS_LABELS } from "@/lib/electrical-amp-semantics";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

const n = (v: number | null) => (v === null ? "not stated" : String(v));

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CurrentSemanticMigrationPlan({
  baseline,
  rows,
}: {
  baseline: AdjudicationBaseline;
  rows: FarmOpsLoadRow[];
}) {
  const plan = useMemo(
    () => planCurrentSemanticMigration({ baseline, rows }),
    [baseline, rows],
  );
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const visible = onlyUnresolved
    ? plan.rows.filter((r) => r.confidence === "unresolved")
    : plan.rows;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Planning view only. It identifies records where the canonical{" "}
        <code>Amps</code> column may represent different electrical concepts and
        proposes the target field for each, against {plan.workbook_name} (SHA-256{" "}
        <span className="font-mono">{plan.workbook_sha256}</span>). Nothing is written: no FarmOps
        update, no canonical ODS edit, and no change to service, topology, panel or breaker data.
        MOCP is never used as a connected current, MCA is never derived, and 0 A is not read as a
        verified zero load.
      </p>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{plan.counts.affected} records</Badge>
        <Badge variant="secondary">{plan.counts.unresolved} unresolved</Badge>
        <Badge variant="outline">{plan.counts.established} established</Badge>
        <Badge variant="secondary">{plan.counts.zero_amps} at 0 A</Badge>
        <Badge variant="secondary">{plan.counts.va_dependent} VA depend on unresolved current</Badge>
        <Badge variant="outline">{plan.counts.blocked} blocked</Badge>
        <Badge variant={plan.is_phase_44a_baseline ? "outline" : "destructive"}>
          {plan.is_phase_44a_baseline ? "Phase 4.4a baseline" : "Not the Phase 4.4a baseline"}
        </Badge>
        {plan.missing_fixture_ids.length ? (
          <Badge variant="destructive">
            Fixtures absent from workbook: {plan.missing_fixture_ids.join(", ")}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(
              "current-semantic-migration-plan.csv",
              currentMigrationCsv(plan),
              "text/csv",
            )
          }
        >
          <Download className="mr-1 h-4 w-4" /> Migration plan CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(
              "current-semantic-migration-plan.md",
              currentMigrationMarkdown(plan),
              "text/markdown",
            )
          }
        >
          <Download className="mr-1 h-4 w-4" /> Migration plan Markdown
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOnlyUnresolved((v) => !v)}>
          {onlyUnresolved ? "Show all records" : "Show unresolved only"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Target semantic schema</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-2">Field</th>
                <th className="p-2">Authority</th>
                <th className="p-2">VA operand</th>
                <th className="p-2">Definition</th>
                <th className="p-2">Invariants</th>
              </tr>
            </thead>
            <tbody>
              {plan.schema.map((s) => (
                <tr key={s.field} className="border-t border-border align-top">
                  <td className="p-2 font-mono">{s.field}</td>
                  <td className="p-2 text-muted-foreground">{s.authority}</td>
                  <td className="p-2">
                    <Badge variant={s.va_operand_eligible ? "default" : "secondary"}>
                      {s.va_operand_eligible ? "eligible" : "never"}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">{s.definition}</td>
                  <td className="p-2 text-muted-foreground">{s.invariants.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="p-2">Stable ID</th>
              <th className="p-2">Current ODS Amps</th>
              <th className="p-2">Likely / known semantic</th>
              <th className="p-2">Evidence</th>
              <th className="p-2">Confidence</th>
              <th className="p-2">Dependent formulas / VA</th>
              <th className="p-2">Recommended target field(s)</th>
              <th className="p-2">Migration blocker</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.stable_id} className="border-t border-border align-top">
                <td className="p-2">
                  <span className="font-mono">{r.stable_id}</span>
                  {r.is_fixture ? (
                    <Badge className="ml-1" variant="outline">
                      fixture
                    </Badge>
                  ) : null}
                  <div className="text-muted-foreground">{r.description}</div>
                  <div className="text-muted-foreground">
                    {r.worksheet ?? "—"} · row {r.worksheet_row ?? "—"}
                  </div>
                </td>
                <td className="p-2 font-mono">
                  {n(r.ods_amps)}
                  <div className="text-muted-foreground">
                    {n(r.ods_volts)} V · {n(r.ods_va)} VA
                  </div>
                  <div className="text-muted-foreground">
                    MOCP {n(r.manufacturer.maximum_overcurrent_protection)} · RCA{" "}
                    {n(r.manufacturer.rated_current_amps)} · RLA {n(r.manufacturer.rated_load_amps)}{" "}
                    · MCA{" "}
                    {r.manufacturer.minimum_circuit_ampacity ?? r.manufacturer.mca_status}
                  </div>
                </td>
                <td className="p-2">
                  {r.semantic}
                  {r.coincidences.length ? (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                      {r.coincidences.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="p-2 text-muted-foreground">
                  <ul className="space-y-1">
                    {r.evidence.map((e) => (
                      <li key={e.source}>
                        <span className="font-mono">{e.source}</span>
                        {e.states_semantic ? (
                          <Badge className="ml-1" variant="outline">
                            states semantic
                          </Badge>
                        ) : null}
                        <div>{e.states}</div>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="p-2">
                  <Badge variant={r.confidence === "established" ? "default" : "secondary"}>
                    {r.confidence}
                  </Badge>
                  <div className="mt-1 text-muted-foreground">
                    {CONFIDENCE_LABELS[r.confidence]}
                  </div>
                </td>
                <td className="p-2">
                  {r.dependent_formulas.map((d) => (
                    <div key={d.field} className="mb-1">
                      <span className="font-mono">{d.field}</span> = {n(d.value)}
                      <div className="text-muted-foreground">{VA_BASIS_LABELS[d.basis]}</div>
                      {d.depends_on_unresolved_current ? (
                        <Badge variant="destructive">depends on unresolved current</Badge>
                      ) : null}
                    </div>
                  ))}
                </td>
                <td className="p-2">
                  {r.recommended_target_fields.length ? (
                    <ul className="space-y-1">
                      {r.recommended_target_fields.map((f) => (
                        <li key={f} className="font-mono">
                          {f}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">none — no value to migrate</span>
                  )}
                  {r.excluded_fields.length ? (
                    <div className="mt-1 text-muted-foreground">
                      Excluded: {r.excluded_fields.map((e) => e.field).join(", ")}
                    </div>
                  ) : null}
                </td>
                <td className="p-2">
                  {r.blockers.map((b) => (
                    <div key={b} className="mb-1">
                      <Badge variant={b === "NONE" ? "outline" : "secondary"}>{b}</Badge>
                      <div className="text-muted-foreground">{BLOCKER_LABELS[b]}</div>
                    </div>
                  ))}
                  <div className="mt-1 text-muted-foreground">{r.planned_action}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Fixtures {CURRENT_MIGRATION_FIXTURE_IDS.join(", ")} are always evaluated. Manufacturer values
        for the Bryant equipment stay distinct — MOCP 25 A, RCA 1.69 A, RLA 4.15 A, MCA NULL — and
        are never merged into a single scalar.
      </p>
    </div>
  );
}
