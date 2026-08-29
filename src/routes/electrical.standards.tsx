import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { naming_standards } from "@/lib/electrical.functions";
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
          <CardTitle className="text-base">Reference table</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : q.error ? (
            <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          ) : !(q.data ?? []).length ? (
            <p className="text-sm text-muted-foreground">No naming standards recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Entity</th>
                    <th className="px-3 py-2 font-medium">Format</th>
                    <th className="px-3 py-2 font-medium">Example</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(q.data ?? []).map((row) => (
                    <tr key={String(row["id"])} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {String(row["entity"] ?? row["entity_kind"] ?? "")}
                      </td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        {String(row["format"] ?? row["pattern"] ?? "")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="font-mono">
                          {String(row["example"] ?? "")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {String(row["notes"] ?? row["description"] ?? "")}
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
