// Phase 4.4b — Convergence summary + disposition layer over the immutable raw
// Parallel Validation comparison. Read-only: nothing here writes FarmOps,
// modifies the canonical workbook or offers an apply path.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { CollapsibleSection } from "@/components/electrical/collapsible-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  CLASSIFICATION_LABELS,
  type Classification,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import {
  CONVERGENCE_DISPOSITIONS,
  CONVERGENCE_DISPOSITION_LABELS,
  UNRESOLVED_DISPOSITIONS,
  convergeValidation,
  convergenceCsv,
  convergenceMarkdown,
  type ConvergenceDisposition,
} from "@/lib/electrical-convergence";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ConvergenceSummary({ report }: { report: ValidationReport }) {
  const convergence = useMemo(() => convergeValidation(report), [report]);
  const [rawFilter, setRawFilter] = useState<Classification | "all">("all");
  const [dispFilter, setDispFilter] = useState<ConvergenceDisposition | "all">("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convergence.findings.filter(
      (f) =>
        (rawFilter === "all" || f.raw_classification === rawFilter) &&
        (dispFilter === "all" || f.disposition === dispFilter) &&
        (!q ||
          f.stable_id.toLowerCase().includes(q) ||
          f.field.toLowerCase().includes(q) ||
          f.label.toLowerCase().includes(q) ||
          f.domain.toLowerCase().includes(q)),
    );
  }, [convergence, rawFilter, dispFilter, search]);

  const c = convergence.counts;
  const p45 = convergence.phase_45;

  return (
    <>
      <div className="rounded-md border p-2 text-xs space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Convergence summary (disposition layer)</span>
          <Badge variant="outline">read-only</Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7"
            onClick={() => {
              download(
                "electrical-convergence.csv",
                convergenceCsv(convergence),
                "text/csv;charset=utf-8",
              );
              download(
                "electrical-convergence.md",
                convergenceMarkdown(convergence),
                "text/markdown;charset=utf-8",
              );
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            Convergence artifacts
          </Button>
        </div>

        <p className="text-muted-foreground">
          The raw comparison above stays reproducible from the ODS SHA plus the FarmOps snapshot and
          is never rewritten here. An adjudicated scalar inequality remains a raw conflict — it
          gains a disposition, not a match.
        </p>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Raw findings: {c.raw_findings}</Badge>
          <Badge variant="outline">Adjudicated: {c.adjudicated}</Badge>
          <Badge variant={c.unresolved ? "destructive" : "outline"}>
            Unresolved: {c.unresolved}
          </Badge>
          <Badge variant="outline">
            Canonical ODS corrections pending: {c.canonical_corrections_pending}
          </Badge>
          <Badge variant="outline">
            FarmOps corrections pending: {c.farmops_corrections_pending}
          </Badge>
          <Badge variant="outline">
            Semantic representation differences (F): {c.semantic_representation_differences}
          </Badge>
          <Badge variant={c.current_semantics_unresolved ? "destructive" : "outline"}>
            Current semantics unresolved: {c.current_semantics_unresolved}
          </Badge>
          <Badge variant="outline">
            Provenance / field verification pending: {c.provenance_or_field_verification_pending}
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-4">Raw classification</th>
                <th className="py-1 pr-4">Raw</th>
                <th className="py-1 pr-4">Adjudicated</th>
                <th className="py-1">Unresolved</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(convergence.by_raw_classification) as Classification[])
                .filter((k) => convergence.by_raw_classification[k].raw > 0)
                .map((k) => {
                  const b = convergence.by_raw_classification[k];
                  return (
                    <tr key={k} className="border-t border-border">
                      <td className="py-1 pr-4">{CLASSIFICATION_LABELS[k]}</td>
                      <td className="py-1 pr-4 font-mono">{b.raw}</td>
                      <td className="py-1 pr-4 font-mono">{b.adjudicated}</td>
                      <td className="py-1 font-mono">{b.unresolved}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {convergence.stale.length ? (
          <div className="space-y-1">
            <span className="font-medium">Stale adjudications — reduce nothing</span>
            {convergence.stale.map((s) => (
              <p key={s.adjudication.id} className="text-destructive">
                {s.adjudication.id} — adjudicated against {s.expected_sha256.slice(0, 12)}…, this
                run is {s.run_sha256.slice(0, 12)}…
              </p>
            ))}
          </div>
        ) : null}

        <div className="rounded-md border p-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Phase 4.5 readiness gate</span>
            <Badge variant={p45.status === "READY" ? "outline" : "destructive"}>{p45.status}</Badge>
          </div>
          <p className="text-muted-foreground">
            Separate from the Phase 4.4a acceptance gate (currently {p45.phase_44a_status}). Phase
            4.5 is never ready merely because semantic loss is 0 or Phase 4.4a passed — it is driven
            by unresolved disposition state only.
          </p>
          {p45.reasons.map((r) => (
            <p key={r} className="text-destructive">
              {r}
            </p>
          ))}
        </div>
      </div>

      <CollapsibleSection title="Raw classification → adjudication → disposition">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={rawFilter === "all" ? "default" : "outline"}
              onClick={() => setRawFilter("all")}
            >
              All raw ({convergence.findings.length})
            </Button>
            {(Object.keys(convergence.by_raw_classification) as Classification[])
              .filter((k) => convergence.by_raw_classification[k].raw > 0)
              .map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={rawFilter === k ? "default" : "outline"}
                  onClick={() => setRawFilter(k)}
                >
                  {CLASSIFICATION_LABELS[k]} ({convergence.by_raw_classification[k].raw})
                </Button>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={dispFilter === "all" ? "secondary" : "ghost"}
              onClick={() => setDispFilter("all")}
            >
              All dispositions
            </Button>
            {CONVERGENCE_DISPOSITIONS.filter((d) => convergence.by_disposition[d] > 0).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={dispFilter === d ? "secondary" : "ghost"}
                onClick={() => setDispFilter(d)}
              >
                {CONVERGENCE_DISPOSITION_LABELS[d]} ({convergence.by_disposition[d]})
              </Button>
            ))}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by stable ID, field or entity…"
            className="max-w-md"
          />

          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3">Entity</th>
                    <th className="py-1 pr-3">Stable ID</th>
                    <th className="py-1 pr-3">Field</th>
                    <th className="py-1 pr-3">Raw classification</th>
                    <th className="py-1 pr-3">Raw ODS → FarmOps</th>
                    <th className="py-1 pr-3">Adjudication</th>
                    <th className="py-1 pr-3">Disposition</th>
                    <th className="py-1">Preserved facts / rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 1000).map((f, i) => (
                    <tr
                      key={`${f.domain}-${f.stable_id}-${f.field}-${i}`}
                      className="border-t border-border align-top"
                    >
                      <td className="py-1 pr-3 font-mono">{f.domain}</td>
                      <td className="py-1 pr-3 font-mono">{f.stable_id}</td>
                      <td className="py-1 pr-3">{f.label}</td>
                      <td className="py-1 pr-3">
                        <Badge variant="outline">{f.raw_classification}</Badge>
                      </td>
                      <td className="py-1 pr-3 font-mono">
                        {f.raw_ods_value || "(blank)"} → {f.raw_farmops_value || "(blank)"}
                      </td>
                      <td className="py-1 pr-3">
                        {f.adjudication ? (
                          <>
                            <div className="font-mono">{f.adjudication_classification}</div>
                            <div className="text-muted-foreground">{f.adjudication.source}</div>
                          </>
                        ) : f.stale_adjudications.length ? (
                          <span className="text-destructive">
                            stale ({f.stale_adjudications.map((a) => a.id).join(", ")})
                          </span>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        <Badge
                          variant={
                            UNRESOLVED_DISPOSITIONS.has(f.disposition) ? "destructive" : "outline"
                          }
                        >
                          {f.disposition}
                        </Badge>
                        {f.derived ? (
                          <div className="text-muted-foreground">derived, not adjudicated</div>
                        ) : null}
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {f.preserved.map((p) => (
                          <div key={p} className="font-mono text-foreground">
                            {p}
                          </div>
                        ))}
                        {f.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 1000 ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  Showing the first 1000 of {rows.length} rows — download the convergence CSV for
                  the complete list.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No findings match these filters.</p>
          )}
        </div>
      </CollapsibleSection>
    </>
  );
}
