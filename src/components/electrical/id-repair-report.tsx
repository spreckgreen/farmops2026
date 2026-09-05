// Phase 4.2 correction control: propagate corrected junction-box stable IDs
// (JB-105 -> JB-105-01) into stale dependent data. Preview-first — nothing is
// written until the operator sees every before/after and presses Apply.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { repairEncodedTopology } from "@/lib/electrical.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Wrench } from "lucide-react";

type Plan = Awaited<ReturnType<typeof repairEncodedTopology>>["plan"];

export function IdRepairReport() {
  const repair = useServerFn(repairEncodedTopology);
  const qc = useQueryClient();
  const [plan, setPlan] = useState<Plan | null>(null);

  const run = useMutation({
    mutationFn: async (apply: boolean) => repair({ data: { apply } }),
    onSuccess: (r) => {
      setPlan(r.plan);
      const count = r.plan.refs.length + r.plan.branchIds.length + r.plan.dependents.length;
      if (!r.applied) {
        if (!count) toast.success("No stale junction-box references or encoded parents found.");
        return;
      }
      if (r.errors.length) toast.error(`${r.errors.length} record(s) could not be updated.`);
      else toast.success(`Applied ${r.changes.length} correction(s).`);
      void qc.invalidateQueries({ queryKey: ["electrical"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = plan
    ? plan.refs.length + plan.branchIds.length + plan.dependents.length
    : 0;


  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Corrected junction-box IDs — propagate to dependents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Junction boxes entered without their sequence suffix (
          <span className="font-mono">JB-105</span>) have been corrected to the canonical
          form (<span className="font-mono">JB-105-01</span>). The relational parent is
          authoritative: this refreshes stale legacy endpoint text and rewrites branch-run
          IDs whose encoded junction-box sequence reflects the mis-entered box. Corrected
          junction-box IDs are never reverted, and no record is deleted or recreated.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => run.mutate(false)}
            disabled={run.isPending}
          >
            <Wrench className="mr-2 h-4 w-4" /> Preview corrections
          </Button>
          <Button
            size="sm"
            onClick={() => run.mutate(true)}
            disabled={run.isPending || !plan || pending === 0}
          >
            Apply {pending || ""} correction{pending === 1 ? "" : "s"}
          </Button>
        </div>

        {plan ? (
          <div className="space-y-3">
            {plan.branchIds.length ? (
              <div className="space-y-1">
                <p className="font-medium">Branch-run stable IDs</p>
                {plan.branchIds.map((r) => (
                  <div key={r.id} className="rounded-md border border-border p-2">
                    <span className="font-mono">{r.was}</span> →{" "}
                    <span className="font-mono">{r.now}</span>{" "}
                    <span className="text-muted-foreground">
                      (relational parent <span className="font-mono">{r.parent}</span>)
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {plan.dependents.length ? (
              <div className="space-y-1">
                <p className="font-medium">Dependent references to corrected branch run IDs</p>
                {plan.dependents.map((r, i) => (
                  <div key={`${r.table}-${r.id}-${r.field}-${i}`} className="rounded-md border border-border p-2">
                    <span className="font-mono">{r.stable_id}</span>{" "}
                    <Badge variant="secondary" className="font-mono text-xs">
                      {r.table}.{r.field}
                    </Badge>{" "}
                    <span className="font-mono line-through">{r.was}</span> →{" "}
                    <span className="font-mono">{r.now}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {plan.refs.length ? (
              <div className="space-y-1">
                <p className="font-medium">Legacy endpoint references</p>
                {plan.refs.map((r, i) => (
                  <div key={`${r.id}-${r.field}-${i}`} className="rounded-md border border-border p-2">
                    <span className="font-mono">{r.stable_id}</span>{" "}
                    <Badge variant="secondary" className="font-mono text-xs">
                      {r.field}
                    </Badge>{" "}
                    <span className="font-mono line-through">{r.was}</span> →{" "}
                    <span className="font-mono">{r.now}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {plan.blocked.length ? (
              <div className="space-y-1">
                <p className="font-medium text-destructive">Needs a decision — not changed</p>
                {plan.blocked.map((b, i) => (
                  <div key={`${b.stable_id}-${i}`} className="rounded-md border border-border p-2">
                    <span className="font-mono">{b.stable_id}</span>{" "}
                    <span className="text-muted-foreground">{b.reason}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {pending === 0 && !plan.blocked.length ? (
              <p className="text-muted-foreground">Nothing to correct.</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
