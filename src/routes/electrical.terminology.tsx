import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { TermHint } from "@/components/electrical/term-hint";
import {
  NEC_PROFILE,
  TERMINOLOGY_REGISTRY_VERSION,
  TERMS,
  type TermEntry,
} from "@/lib/electrical-terminology";
import {
  RECONCILIATION_CSV_COLUMNS,
  REVIEW_GATE,
  reconciliationReport,
  type MigrationImpact,
} from "@/lib/electrical-terminology-audit";
import { downloadCsv, rowsToCsv } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/electrical/terminology")({
  component: TerminologyPage,
  head: () => ({
    meta: [
      { title: "Electrical Terminology Registry — Bostead Farms" },
      {
        name: "description",
        content:
          "Versioned registry of NEC-defined and FarmOps operational electrical terms, with the reconciliation report of every current term, its canonical wording and migration impact.",
      },
      { property: "og:title", content: "Electrical Terminology Registry — Bostead Farms" },
      {
        property: "og:description",
        content:
          "NEC-defined versus FarmOps operational wording, code edition of record and the terminology reconciliation report.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function TerminologyPage() {
  return (
    <ElectricalGate>
      <Terminology />
    </ElectricalGate>
  );
}

const IMPACT_LABEL: Record<MigrationImpact, string> = {
  none: "No change",
  display_only: "Wording only",
  display_and_help: "Wording + help text",
  needs_review: "Needs a decision",
};

function classBadge(t: TermEntry) {
  if (t.classification === "NEC_DEFINED") return <Badge variant="secondary">NEC-defined</Badge>;
  if (t.classification === "NEC_USAGE") return <Badge variant="outline">NEC usage</Badge>;
  return <Badge variant="outline">FarmOps term</Badge>;
}

function Terminology() {
  const [q, setQ] = useState("");
  const rows = useMemo(() => reconciliationReport(), []);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? TERMS.filter(
        (t) =>
          t.canonical.toLowerCase().includes(needle) ||
          t.id.includes(needle) ||
          t.aliases.some((a) => a.includes(needle)) ||
          t.deprecated.some((d) => d.usage.toLowerCase().includes(needle)),
      )
    : TERMS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Electrical terminology</h1>
        <p className="text-sm text-muted-foreground">
          Which words this record uses, which of them come from the code book, and which are
          FarmOps' own working terms. Registry {TERMINOLOGY_REGISTRY_VERSION}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Code of record</CardTitle>
          <CardDescription>
            Wording follows this edition. A different adopted edition or a local amendment can
            change definitions, so the edition is stored with the registry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Edition: </span>
            {NEC_PROFILE.necEdition}
          </p>
          <p>
            <span className="font-medium">Jurisdiction: </span>
            {NEC_PROFILE.jurisdiction}
          </p>
          <p>
            <span className="font-medium">Comparable editions: </span>
            {NEC_PROFILE.compatibleEditions.join(", ")}
          </p>
          <p>
            <span className="font-medium">Local amendments: </span>
            {NEC_PROFILE.localAmendments.length > 0
              ? NEC_PROFILE.localAmendments.join("; ")
              : "none recorded"}
          </p>
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {NEC_PROFILE.notice}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Term registry</CardTitle>
          <CardDescription>
            Search a word you have seen anywhere in the electrical screens, an import header or an
            old field label.
          </CardDescription>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a term or alias, e.g. plug, daisy chain, dedicated"
            className="max-w-md"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No term matches that search.</p>
          ) : null}
          {shown.map((t) => (
            <div key={t.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <TermHint id={t.id} className="font-medium" />
                {classBadge(t)}
                <span className="text-xs text-muted-foreground">{t.id}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{t.plain}</p>
              {t.necRelation ? (
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium text-foreground">Relation to the code: </span>
                  {t.necRelation}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.necEdition} — {t.necReference}
                </p>
              )}
              {t.aliases.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Accepted aliases (searchable, not displayed): {t.aliases.join(", ")}
                </p>
              ) : null}
              {t.deprecated.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {t.deprecated.map((d) => (
                    <li key={d.usage}>
                      Do not display &ldquo;{d.usage}&rdquo; — say {d.instead}. {d.reason}
                      {d.aliasOnly ? " Kept as a searchable alias." : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                Fields: {[...(t.affects.db ?? []), ...(t.affects.export ?? [])].join(", ") || "—"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Reconciliation report</CardTitle>
            <CardDescription>
              Every current term, its proposed wording, code status, source reference, the screens
              it appears on and what changing it would touch.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                `electrical-terminology-reconciliation-${TERMINOLOGY_REGISTRY_VERSION}.csv`,
                rowsToCsv(
                  rows.map((r) => ({
                    ...r,
                    currentTerms: r.currentTerms.join("; "),
                    affectedScreens: r.affectedScreens.join("; "),
                    affectedFields: r.affectedFields.join("; "),
                    migrationImpact: IMPACT_LABEL[r.migrationImpact],
                  })),
                  RECONCILIATION_CSV_COLUMNS as unknown as ReadonlyArray<{
                    key: string;
                    label: string;
                  }>,
                ),
              )
            }
          >
            Download report (CSV)
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            {REVIEW_GATE.statement} Reviewer: {REVIEW_GATE.reviewer}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Proposed term</th>
                  <th className="py-1 pr-3">Code status</th>
                  <th className="py-1 pr-3">Source</th>
                  <th className="py-1 pr-3">Screens</th>
                  <th className="py-1 pr-3">Impact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.termId} className="border-t border-border align-top">
                    <td className="py-1 pr-3 font-medium">{r.proposedCanonical}</td>
                    <td className="py-1 pr-3">{r.necStatus}</td>
                    <td className="py-1 pr-3">{r.sourceReference}</td>
                    <td className="py-1 pr-3">{r.affectedScreens.join(", ") || "—"}</td>
                    <td className="py-1 pr-3">
                      <Badge variant={r.migrationImpact === "needs_review" ? "default" : "outline"}>
                        {IMPACT_LABEL[r.migrationImpact]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
