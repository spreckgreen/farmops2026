import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { electricalSorStatus } from "@/lib/electrical-sor.functions";
import { SNAPSHOT_COLLECTIONS } from "@/lib/electrical-snapshot";
import type { SorStatus } from "@/lib/electrical-sor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/electrical/sor")({
  component: SorPage,
  head: () => ({
    meta: [
      { title: "Electrical Data Model / SOR Status — Bostead Farms" },
      {
        name: "description",
        content:
          "Which system is currently authoritative for electrical engineering data, the FarmOps data-model version, record counts and outstanding cutover blockers.",
      },
      { property: "og:title", content: "Electrical Data Model / SOR Status — Bostead Farms" },
      {
        property: "og:description",
        content: "Electrical System-of-Record authority, model version and cutover blockers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function SorPage() {
  return (
    <ElectricalGate>
      <SorStatusView />
    </ElectricalGate>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

function SorStatusView() {
  const fetcher = useServerFn(electricalSorStatus);
  const q = useQuery({
    queryKey: ["electrical", "sor"],
    queryFn: () => fetcher() as unknown as Promise<SorStatus>,
  });

  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  if (q.error)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );

  const s = q.data!;
  const farmopsAuthoritative = s.authority === "farmops";

  return (
    <div className="space-y-3">
      <Card className={farmopsAuthoritative ? undefined : "border-amber-500/60"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Current authority
            <Badge variant={farmopsAuthoritative ? "default" : "secondary"}>
              Phase {s.phase}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <Row label="Current authority" value={s.authority_label} />
          <Row label="FarmOps status" value={s.farmops_role} />
          <Row label="Data model version" value={s.model_version} />
          <Row label="Snapshot schema version" value={s.snapshot_schema_version} />
          <Row label="Canonical engineering workbook" value={s.canonical_ods_path} />
          <Row label="Last electrical record change" value={s.last_record_change ?? "—"} />
          <Row label="Last reconciliation snapshot" value={s.last_reconciliation ?? "—"} />
          <Row
            label="Unresolved QA differences"
            value={`${s.qa.errors} error${s.qa.errors === 1 ? "" : "s"}, ${s.qa.warnings} warning${
              s.qa.warnings === 1 ? "" : "s"
            }`}
          />
          <p className="pt-2 text-xs text-muted-foreground">
            FarmOps owns field / as-installed data today. It does not write, replace or
            synchronize the canonical workbook, and it does not become the System of Record
            until the Phase 4.5 cutover is explicitly approved.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Entity coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SNAPSHOT_COLLECTIONS.map((c) => (
              <div key={c} className="rounded-md border p-2">
                <div className="font-mono text-xs text-muted-foreground">{c}</div>
                <div className="text-lg">{s.counts[c]}</div>
              </div>
            ))}
          </div>
          <p className="pt-3 text-xs text-muted-foreground">
            Every collection is exported even when empty — see{" "}
            <Link to="/electrical/export" className="underline">
              Reconciliation export
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cutover blockers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!s.blockers.length ? (
            <p className="text-muted-foreground">
              No observable blockers. Cutover is still an explicit, owner-approved event.
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {s.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            QA detail lives on{" "}
            <Link to="/electrical/qa" className="underline">
              QA
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
