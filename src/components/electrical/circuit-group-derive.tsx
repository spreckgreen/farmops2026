// Reviewable derivation of circuit groups from Load_Master data.
// Dry-run first: nothing is written until "Create groups & link loads" is used,
// and unresolved or ambiguous references are always reported, never guessed.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applyCircuitGroupDerivation,
  previewCircuitGroupDerivation,
} from "@/lib/electrical-circuit-groups.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function CircuitGroupDerive() {
  const preview = useServerFn(previewCircuitGroupDerivation);
  const apply = useServerFn(applyCircuitGroupDerivation);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["electrical", "circuit-group-derivation"],
    queryFn: () => preview(),
  });

  const run = useMutation({
    mutationFn: () => apply({ data: {} }),
    onSuccess: (res) => {
      toast.success(
        `Created ${res.createdGroups} circuit group(s), linked ${res.linkedLoads} load(s).`,
      );
      for (const m of res.messages.slice(0, 4)) toast.warning(m);
      void qc.invalidateQueries({ queryKey: ["electrical"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = q.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Derive from Load_Master</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Circuit groups come from the load records&apos; circuit group ID and description —
          there is no separate Circuit Groups worksheet. This is a dry run until you apply it,
          and it never deletes or rebuilds existing records.
        </p>

        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : plan ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{plan.totals.groups} groups resolved</Badge>
              <Badge variant="secondary">{plan.totals.sharedGroups} shared</Badge>
              <Badge variant="outline">{plan.totals.createGroups} to create</Badge>
              <Badge variant="outline">{plan.totals.linkLoads} loads to link</Badge>
              {plan.totals.unresolved ? (
                <Badge variant="destructive">{plan.totals.unresolved} unresolved loads</Badge>
              ) : null}
              {plan.ambiguous.length ? (
                <Badge variant="destructive">{plan.ambiguous.length} ambiguous refs</Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={run.isPending || !plan.groups.length}
                onClick={() => run.mutate()}
              >
                {run.isPending ? "Applying…" : "Create groups & link loads"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
                {open ? "Hide plan" : "Review plan"}
              </Button>
            </div>

            {open ? (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-2 py-1 font-medium">Circuit group</th>
                        <th className="px-2 py-1 font-medium">Action</th>
                        <th className="px-2 py-1 font-medium">Description</th>
                        <th className="px-2 py-1 font-medium">Loads</th>
                        <th className="px-2 py-1 font-medium">Read from</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.groups.map((g) => (
                        <tr key={g.circuit_group_id} className="border-t border-border align-top">
                          <td className="px-2 py-1 font-mono whitespace-nowrap">
                            {g.circuit_group_id}
                          </td>
                          <td className="px-2 py-1">{g.exists ? "link only" : "create"}</td>
                          <td className="px-2 py-1 text-muted-foreground">{g.description}</td>
                          <td className="px-2 py-1 font-mono">{g.loadIds.join(", ")}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {g.sources.join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {plan.ambiguous.length ? (
                  <div className="rounded-md border border-destructive/40 p-2">
                    <p className="font-medium text-destructive">Ambiguous references</p>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {plan.ambiguous.map((a) => (
                        <li key={a.ref}>
                          <span className="font-mono">{a.ref}</span> matches {a.existing.length}{" "}
                          existing groups — resolve by hand.
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {plan.unresolved.length ? (
                  <div className="rounded-md border border-border p-2">
                    <p className="font-medium">Loads with no circuit group reference</p>
                    <p className="mt-1 font-mono text-muted-foreground">
                      {plan.unresolved.map((u) => u.load_id).join(", ")}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
