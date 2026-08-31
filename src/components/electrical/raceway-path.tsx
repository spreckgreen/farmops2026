// Phase 4.4b — continuous raceway topology views.
//
// A raceway shows the junction boxes along it in physical order; a junction box
// shows the continuous raceway it sits on and its position. Both display stable
// IDs only — never row UUIDs.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { installStatusLabel } from "@/lib/electrical";
import { positionLabel } from "@/lib/electrical-raceway-path";
import { listRacewayJunctionPoints } from "@/lib/electrical-raceway-path.functions";

export function RacewayJunctionPoints({ racewayId }: { racewayId: string }) {
  const fetcher = useServerFn(listRacewayJunctionPoints);
  const q = useQuery({
    queryKey: ["electrical", "raceway-path", racewayId],
    queryFn: () => fetcher({ data: { raceway_id: racewayId } }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Junction points along this raceway</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : !q.data?.length ? (
          <p className="text-muted-foreground">
            No junction boxes are recorded along this raceway yet. Link a box from its own record by
            setting its parent raceway and position — this is one continuous run, so no extra
            raceway is created between boxes.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {q.data.map((p) => (
              <li key={p.id ?? p.stable_id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {positionLabel(p.sequence)}
                </Badge>
                {p.id ? (
                  <Link
                    to="/electrical/item/$kind/$id"
                    params={{ kind: "jbox", id: p.id }}
                    className="font-mono underline underline-offset-2"
                  >
                    {p.stable_id}
                  </Link>
                ) : (
                  <span className="font-mono">{p.stable_id}</span>
                )}
                <span className="text-muted-foreground">{p.box_type || p.description}</span>
                {p.install_status ? (
                  <Badge variant="secondary">{installStatusLabel(p.install_status)}</Badge>
                ) : null}
                {p.sequence == null ? (
                  <span className="text-xs text-muted-foreground">position not recorded</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function JboxRacewayTopology({
  racewayUuid,
  racewayRef,
  sequence,
}: {
  racewayUuid: string | null;
  racewayRef: string | null;
  sequence: number | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Raceway topology</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {!racewayUuid ? (
          <p className="text-muted-foreground">
            This junction box is not linked to a continuous raceway yet. The link plus the position
            is the authoritative topology; the encoded ID (for example JB-104-02) only cross-checks
            it and is never used to infer the relationship.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Parent raceway</span>
              <Link
                to="/electrical/item/$kind/$id"
                params={{ kind: "raceway", id: racewayUuid }}
                className="font-mono underline underline-offset-2"
              >
                {racewayRef || "raceway"}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Position along the run</span>
              <Badge variant="outline" className="font-mono">
                {positionLabel(sequence)}
              </Badge>
              {sequence == null ? (
                <span className="text-xs text-muted-foreground">
                  Set the position so the ordered topology is complete.
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
