// Shared change-audit view.
//
// Same component serves two audiences: an administrator reviewing everything an
// electrician recorded, and an electrician checking their own submissions. The
// server decides which rows come back, so the only difference here is whether
// the review controls are offered.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, Undo2 } from "lucide-react";

import {
  listElectricalChangeAudit,
  reviewElectricalChange,
  type AuditEntry,
} from "@/lib/electrical-audit.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Filter = "all" | "unreviewed" | "reviewed";

function actionBadge(action: AuditEntry["action"]) {
  const variant =
    action === "delete" ? "destructive" : action === "create" ? "default" : "secondary";
  return (
    <Badge variant={variant as "default" | "secondary" | "destructive"}>{action}</Badge>
  );
}

function ChangeList({ changes }: { changes: AuditEntry["changes"] }) {
  if (!changes.length) {
    return <span className="text-muted-foreground">No field-level detail recorded.</span>;
  }
  return (
    <ul className="space-y-0.5">
      {changes.map((c) => (
        <li key={c.column} className="font-mono text-xs">
          <span className="text-muted-foreground">{c.column}</span>{" "}
          <span className="line-through opacity-70">{c.before ?? "—"}</span>{" "}
          <span aria-hidden>→</span> <span>{c.after ?? "—"}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChangeAuditReport({ actorLabel }: { actorLabel?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [actor, setActor] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useServerFn(listElectricalChangeAudit);
  const review = useServerFn(reviewElectricalChange);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["electrical-change-audit", filter, actor],
    queryFn: () => load({ data: { filter, actor: actor || undefined, limit: 200 } }),
  });

  const reviewMut = useMutation({
    mutationFn: (vars: { id: string; reviewed: boolean; note?: string }) =>
      review({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(vars.reviewed ? "Marked reviewed." : "Re-opened for review.");
      void queryClient.invalidateQueries({ queryKey: ["electrical-change-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const report = query.data;
  const isAdmin = report?.isAdmin === true;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {actorLabel ?? (isAdmin ? "Electrical change audit" : "My electrical changes")}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "unreviewed", "reviewed"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "unreviewed" ? "Awaiting review" : "Reviewed"}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {query.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="Filter by actor email"
              className="max-w-xs"
            />
            {report?.actors.length ? (
              <div className="flex flex-wrap gap-1">
                {report.actors.map((a) => (
                  <Button key={a} size="sm" variant="ghost" onClick={() => setActor(a)}>
                    {a}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Every edit an electrician recorded in the as-installed field record, newest first. Reviewing is a sign-off note — it never alters the record itself."
            : "Everything you recorded in the electrical field record. An administrator reviews these entries; nothing here changes your data."}
          {report ? ` ${report.total} entries · ${report.unreviewed} awaiting review.` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : query.error ? (
          <p className="text-sm text-destructive">{(query.error as Error).message}</p>
        ) : !report?.entries.length ? (
          <p className="text-sm text-muted-foreground">
            No recorded changes{filter === "unreviewed" ? " awaiting review" : ""} yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  {isAdmin ? <TableHead>Who</TableHead> : null}
                  <TableHead>What</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.entries.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell className="text-xs">
                        <div>{e.actor_email ?? "unknown"}</div>
                        <div className="text-muted-foreground">{e.access_basis ?? ""}</div>
                      </TableCell>
                    ) : null}
                    <TableCell className="text-sm space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {actionBadge(e.action)}
                        <Badge variant="outline">{e.entity_kind}</Badge>
                        {e.entity_ref ? <span className="font-mono text-xs">{e.entity_ref}</span> : null}
                      </div>
                      <div>{e.summary ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{e.section}</div>
                    </TableCell>
                    <TableCell className="text-sm max-w-md">
                      <ChangeList changes={e.changes} />
                    </TableCell>
                    <TableCell className="text-xs space-y-1">
                      {e.reviewed_at ? (
                        <>
                          <Badge variant="secondary">
                            Reviewed {e.reviewed_at.slice(0, 10)}
                          </Badge>
                          {e.review_note ? <div>{e.review_note}</div> : null}
                          {isAdmin ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                reviewMut.mutate({ id: e.id, reviewed: false })
                              }
                              disabled={reviewMut.isPending}
                            >
                              <Undo2 className="h-3 w-3 mr-1" /> Re-open
                            </Button>
                          ) : null}
                        </>
                      ) : isAdmin ? (
                        <div className="space-y-1">
                          <Input
                            value={notes[e.id] ?? ""}
                            onChange={(ev) =>
                              setNotes((n) => ({ ...n, [e.id]: ev.target.value }))
                            }
                            placeholder="Optional note"
                            className="h-8 text-xs"
                          />
                          <Button
                            size="sm"
                            onClick={() =>
                              reviewMut.mutate({
                                id: e.id,
                                reviewed: true,
                                note: notes[e.id]?.trim() || undefined,
                              })
                            }
                            disabled={reviewMut.isPending}
                          >
                            <Check className="h-3 w-3 mr-1" /> Mark reviewed
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline">Awaiting review</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
