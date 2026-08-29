import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { electricalOverview } from "@/lib/electrical.functions";
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import { installStatusLabel } from "@/lib/electrical";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, MapPin } from "lucide-react";

export const Route = createFileRoute("/electrical/")({
  component: ElectricalOverviewPage,
  head: () => ({
    meta: [
      { title: "Electrical Infrastructure — Bostead Farms" },
      {
        name: "description",
        content:
          "Field record of panels, raceways, junction boxes, branch runs and loads with install status and validation.",
      },
      { property: "og:title", content: "Electrical Infrastructure — Bostead Farms" },
      {
        property: "og:description",
        content: "Panels, raceways, junction boxes, branch runs and loads with field status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ElectricalOverviewPage() {
  return (
    <ElectricalGate>
      <Overview />
    </ElectricalGate>
  );
}

function Overview() {
  const fetcher = useServerFn(electricalOverview);
  const q = useQuery({ queryKey: ["electrical", "overview"], queryFn: () => fetcher() });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );

  const data = q.data!;
  const totalRecords = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const done = data.byStatus
    .filter((s) => s.status === "complete" || s.status === "as_built_verified")
    .reduce((a, b) => a + b.count, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ENTITY_KINDS.map((kind) => (
          <Link key={kind} to="/electrical/$kind" params={{ kind }}>
            <Card className="h-full hover:border-primary/50 transition-colors">
              <CardContent className="py-4">
                <div className="text-2xl font-bold">{data.counts[kind] ?? 0}</div>
                <div className="text-xs text-muted-foreground">{ENTITIES[kind].title}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Install progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={totalRecords ? Math.round((done / totalRecords) * 100) : 0} />
          <p className="text-xs text-muted-foreground">
            {done} of {totalRecords} records complete or as-built verified.
          </p>
          <div className="flex flex-wrap gap-2">
            {data.byStatus.map((s) => (
              <Badge key={s.status} variant="outline">
                {installStatusLabel(s.status)}: {s.count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Validation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!data.issues.length ? (
              <p className="text-muted-foreground">
                No duplicate breakers, orphan references or missing endpoints found.
              </p>
            ) : (
              data.issues.slice(0, 40).map((issue, i) => (
                <p
                  key={i}
                  className={
                    issue.severity === "error"
                      ? "text-destructive"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  {issue.message}
                </p>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Farm Shop walk order
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground text-xs">
              Starts at A6 (NE corner), clockwise, outside-in. Display order only — it never
              affects stable IDs.
            </p>
            <div className="flex flex-wrap gap-1 font-mono text-xs">
              {data.fieldWalk.length ? (
                data.fieldWalk.map((g, i) => (
                  <Badge key={`${g}-${i}`} variant="secondary">
                    {i + 1}. {g}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">No Farm Shop grids recorded yet.</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Open field worklist</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.worklist.length ? (
            <p className="text-sm text-muted-foreground">Everything is complete.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {data.worklist.slice(0, 100).map((w) => (
                    <tr key={`${w.kind}-${w.stable_id}`} className="border-t border-border">
                      <td className="px-2 py-1.5 font-mono whitespace-nowrap">{w.stable_id}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {ENTITIES[w.kind].singular}
                      </td>
                      <td className="px-2 py-1.5">{w.description || "—"}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline">{installStatusLabel(w.install_status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
