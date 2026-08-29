import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { naming_standards } from "@/lib/electrical.functions";
import { mergeStandards } from "@/lib/electrical-standards";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/electrical/standards")({
  component: StandardsPage,
  head: () => ({
    meta: [
      { title: "Electrical Naming Standards — Bostead Farms" },
      {
        name: "description",
        content:
          "Stable ID formats, panel exit conventions and field walk order rules for the electrical infrastructure record.",
      },
      { property: "og:title", content: "Electrical Naming Standards — Bostead Farms" },
      {
        property: "og:description",
        content: "Stable ID formats and field conventions for electrical records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function StandardsPage() {
  return (
    <ElectricalGate>
      <Standards />
    </ElectricalGate>
  );
}

function Standards() {
  const fetcher = useServerFn(naming_standards);
  const q = useQuery({ queryKey: ["electrical", "standards"], queryFn: () => fetcher() });
  const rows = mergeStandards((q.data ?? []) as unknown as Record<string, unknown>[]);
  const storedKeys = new Set(
    ((q.data ?? []) as unknown as Record<string, unknown>[]).map((r) => String(r["key"] ?? "")),
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conventions that must not drift</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>
            Stable IDs are permanent and carry no physical attributes — a raceway keeps{" "}
            <span className="font-mono">CON-030</span> even if its size, route or status
            changes.
          </p>
          <p>
            Panel raceway exits are numbered from the lower-right corner and proceed
            counterclockwise while facing the panel.
          </p>
          <p>
            The Farm Shop installation walk starts at <span className="font-mono">A6</span>{" "}
            (NE corner) and proceeds clockwise, outside-in.
          </p>
          <p>
            Interior and site raceways live in one dataset and are separated by the
            environment field, not by duplicate records.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Naming and design standards</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              {q.error ? (
                <p className="text-sm text-destructive">
                  Stored standards could not be loaded ({(q.error as Error).message}). Showing
                  the built-in conventions.
                </p>
              ) : null}
              {rows.map((row) => (
                <div key={row.key} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{row.title}</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {row.key}
                    </Badge>
                    {storedKeys.has(row.key) ? null : (
                      <Badge variant="outline" className="text-xs">
                        Built-in
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">
                    {row.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

