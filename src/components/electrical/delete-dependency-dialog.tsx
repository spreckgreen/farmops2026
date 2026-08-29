// Delete confirmation for electrical records with an actionable dependency
// breakdown: every referencing record is listed and linked so the user can go
// clear the reference instead of guessing what blocks the delete.
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { deleteElectrical, electricalDependents } from "@/lib/electrical.functions";
import type { ElectricalEntityKind } from "@/lib/electrical";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, ExternalLink, Trash2 } from "lucide-react";

export function DeleteDependencyDialog({
  kind,
  id,
  label,
  singular,
  onDeleted,
}: {
  kind: ElectricalEntityKind;
  id: string;
  label: string;
  singular: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const fetchDeps = useServerFn(electricalDependents);
  const remove = useServerFn(deleteElectrical);

  const deps = useQuery({
    queryKey: ["electrical", "dependents", kind, id],
    queryFn: () => fetchDeps({ data: { kind, id } }),
    enabled: open,
  });

  const del = useMutation({
    mutationFn: async () => remove({ data: { kind, id } }),
    onSuccess: () => {
      toast.success(`Deleted ${label || singular}`);
      void qc.invalidateQueries({ queryKey: ["electrical"] });
      setOpen(false);
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const report = deps.data;
  const blocked = (report?.total ?? 0) > 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={(v) => !del.isPending && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete {label || singular}?</DialogTitle>
            <DialogDescription>
              Stable IDs are never reused. This record cannot be deleted while other
              electrical records still reference it.
            </DialogDescription>
          </DialogHeader>

          {deps.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : deps.isError ? (
            <p className="text-sm text-destructive">
              Couldn’t check references: {(deps.error as Error).message}
            </p>
          ) : blocked ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p>
                  {report!.total} record{report!.total === 1 ? "" : "s"} still reference this{" "}
                  {singular}. Open each one below and clear the listed field, then delete.
                </p>
              </div>

              <div className="max-h-72 space-y-4 overflow-y-auto">
                {report!.groups.map((group) => (
                  <div key={`${group.kind}-${group.fkColumn}`} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{group.title}</p>
                      <Badge variant="secondary">{group.fieldLabel}</Badge>
                    </div>
                    <ul className="space-y-1">
                      {group.rows.map((row) => (
                        <li key={row.id} className="text-sm">
                          <Link
                            to="/electrical/item/$kind/$id"
                            params={{ kind: group.kind, id: row.id }}
                            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            <span className="font-mono">{row.stableId || row.id}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                          {row.description ? (
                            <span className="ml-2 text-muted-foreground">{row.description}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {report!.children.map((child) => (
                  <div key={child.title} className="space-y-1">
                    <p className="text-sm font-medium">
                      {child.title} <span className="text-muted-foreground">({child.count})</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{child.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No other electrical records reference this {singular}. Deleting is safe.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={del.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deps.isPending || blocked || del.isPending}
              onClick={() => del.mutate()}
            >
              {del.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
