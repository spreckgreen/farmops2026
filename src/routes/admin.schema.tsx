import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2, Database } from "lucide-react";
import {
  getSchemaDiagnostics,
  type SchemaDiagnostics,
} from "@/lib/schema-diagnostics.functions";

export const Route = createFileRoute("/admin/schema")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Schema Diagnostics — Bostead" },
      {
        name: "description",
        content:
          "Verify required tables, enum types, RLS policies, and triggers exist in the Bostead database.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SchemaDiagnosticsPage,
});

function SchemaDiagnosticsPage() {
  const fetcher = useServerFn(getSchemaDiagnostics);
  const q = useQuery<SchemaDiagnostics>({
    queryKey: ["schema-diagnostics"],
    queryFn: () => fetcher(),
    staleTime: 30_000,
  });

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-6 w-6" /> Schema Diagnostics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Verifies that every table, enum type, and trigger the app expects is present
              in this database. Use after applying migrations to a self-hosted instance.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            {q.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Re-run</span>
          </Button>
        </header>

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Running diagnostics…
          </div>
        ) : q.error ? (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">
              {(q.error as Error).message}
            </CardContent>
          </Card>
        ) : q.data ? (
          <Report data={q.data} />
        ) : null}
      </div>
    </AppLayout>
  );
}

function Report({ data }: { data: SchemaDiagnostics }) {
  const missingTables = data.tables.filter((t) => !t.present);
  const rlsIssues = data.tables.filter(
    (t) => t.present && (!t.rls_enabled || t.policy_count === 0),
  );
  const missingEnums = data.enums.filter((e) => !e.present);
  const missingTriggers = data.triggers.filter((t) => !t.present);
  const allOk =
    missingTables.length === 0 &&
    missingEnums.length === 0 &&
    missingTriggers.length === 0 &&
    rlsIssues.length === 0;

  return (
    <div className="space-y-6">
      <Card className={allOk ? "border-emerald-500/40" : "border-amber-500/60"}>
        <CardContent className="pt-6 flex items-start gap-3">
          {allOk ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
          )}
          <div className="text-sm space-y-1">
            <p className="font-medium">
              {allOk
                ? "All required schema objects are present."
                : "Some schema objects are missing or misconfigured."}
            </p>
            <p className="text-muted-foreground">
              Missing tables: {missingTables.length} · Missing enums:{" "}
              {missingEnums.length} · Missing triggers: {missingTriggers.length} ·
              RLS/policy issues: {rlsIssues.length}
            </p>
            <p className="text-xs text-muted-foreground">
              Checked at {new Date(data.checked_at).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>

      <Section
        title={`Tables (${data.tables.length})`}
        empty="No tables checked."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.tables.map((t) => (
            <div
              key={t.table}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <div className="flex items-center gap-2 font-mono">
                {t.present ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {t.table}
              </div>
              <div className="flex items-center gap-1">
                {t.present && (
                  <>
                    <Badge variant={t.rls_enabled ? "secondary" : "destructive"}>
                      RLS {t.rls_enabled ? "on" : "off"}
                    </Badge>
                    <Badge
                      variant={t.policy_count > 0 ? "secondary" : "outline"}
                      title="Policy count"
                    >
                      {t.policy_count}p
                    </Badge>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Enum types (${data.enums.length})`} empty="No enums checked.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.enums.map((e) => (
            <div
              key={e.type}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <div className="flex items-center gap-2 font-mono">
                {e.present ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {e.type}
              </div>
              <div className="text-xs text-muted-foreground truncate max-w-[55%]">
                {e.labels.join(", ")}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Triggers (${data.triggers.length})`} empty="No triggers checked.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.triggers.map((t) => (
            <div
              key={`${t.table}.${t.trigger}`}
              className="flex items-center gap-2 rounded-md border p-2 text-sm font-mono"
            >
              {t.present ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive shrink-0" />
              )}
              <span className="truncate">
                {t.table}.{t.trigger}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {!allOk && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to fix</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Missing objects usually mean migrations haven't been applied. On a
              self-hosted instance run:
            </p>
            <pre className="bg-muted rounded p-3 text-xs overflow-x-auto">
{`cat supabase/migrations/*.sql \\
  | sudo docker exec -i supabase-db psql -U postgres -d postgres
sudo docker exec supabase-db psql -U postgres -d postgres \\
  -c "NOTIFY pgrst, 'reload schema';"`}
            </pre>
            <p>Then click Re-run above.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children ?? <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  );
}
