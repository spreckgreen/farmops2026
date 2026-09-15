// Topology-derived circuit-group reconciliation for wiring runs.
// Preview first: a wiring run inherits its endpoint load's circuit group only when
// that load has exactly one assignment. Junction boxes and raceways are never
// assigned, because both can carry more than one circuit.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applyBranchCircuitGroups,
  previewBranchCircuitGroups,
} from "@/lib/electrical-circuit-group-topology.functions";
import { RACEWAY_NO_AUTO_ASSIGN_RULE } from "@/lib/electrical-circuit-group-topology";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function BranchCircuitGroupReconcile() {
  const preview = useServerFn(previewBranchCircuitGroups);
  const apply = useServerFn(applyBranchCircuitGroups);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["electrical", "branch-circuit-group-plan"],
    queryFn: () => preview(),
  });

  const run = useMutation({
    mutationFn: () => apply({ data: {} }),
    onSuccess: (res) => {
      toast.success(`Set the circuit group on ${res.linked} branch run(s).`);
      for (const m of res.messages.slice(0, 4)) toast.warning(m);
      void qc.invalidateQueries({ queryKey: ["electrical"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = q.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Circuit group from verified endpoint</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
            When a wiring run ends at a verified load and that load sits on exactly one circuit, the
            run is put on the same circuit. This comes from the recorded relationship, never
            from the run name. {RACEWAY_NO_AUTO_ASSIGN_RULE}
        </p>

        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.error ? (
          <p className="text-destructive">
            Could not read the circuit relationships: {(q.error as Error).message}
          </p>
        ) : plan ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{plan.totals.proposals} to set</Badge>
              <Badge variant="secondary">{plan.totals.satisfied} already correct</Badge>
              {plan.totals.skipped ? (
                <Badge variant="destructive">{plan.totals.skipped} need a decision</Badge>
              ) : null}
              {plan.totals.containers ? (
                <Badge variant="secondary">{plan.totals.containers} boxes left unassigned</Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={run.isPending || !plan.proposals.length}
                onClick={() => run.mutate()}
              >
                {run.isPending ? "Applying…" : "Set circuit groups"}
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
                          <th className="px-2 py-1 font-medium">Wiring run</th>
                        <th className="px-2 py-1 font-medium">Endpoint load</th>
                        <th className="px-2 py-1 font-medium">Circuit group</th>
                        <th className="px-2 py-1 font-medium">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.proposals.map((p) => (
                        <tr key={p.branch_id} className="border-t border-border align-top">
                          <td className="px-2 py-1 font-mono whitespace-nowrap">{p.branch_id}</td>
                          <td className="px-2 py-1 font-mono">{p.load_id}</td>
                          <td className="px-2 py-1">{p.display}</td>
                          <td className="px-2 py-1 text-muted-foreground">{p.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {plan.skipped.length ? (
                  <div className="rounded-md border border-destructive/40 p-2">
                    <p className="font-medium text-destructive">Left for a decision</p>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {plan.skipped.map((s) => (
                        <li key={s.branch_id}>
                          <span className="font-mono">{s.branch_id}</span> — {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {plan.containers.length ? (
                  <div className="rounded-md border border-border p-2">
                    <p className="font-medium">Boxes deliberately left unassigned</p>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {plan.containers.map((c) => (
                        <li key={c.stable_id}>
                          <span className="font-mono">{c.stable_id}</span> — {c.reason}
                        </li>
                      ))}
                    </ul>
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
