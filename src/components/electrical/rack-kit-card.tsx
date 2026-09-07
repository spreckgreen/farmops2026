// "Rack build kit" panel on an equipment rack record. The rack's installed
// components are described by a kit parts list, because rack gear is screwed
// down and stays with the rack (e.g. radio + rack shelf + power strip).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Boxes, Pencil, Plus } from "lucide-react";
import { createRackKit, getRackKit } from "@/lib/rack-kit.functions";
import { InventoryBomDialog } from "@/components/inventory-bom-dialog";
import { formatQty } from "@/lib/inventory-bom";

export function RackKitCard({ rackId }: { rackId: string }) {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getRackKit);
  const createFn = useServerFn(createRackKit);
  const [bomOpen, setBomOpen] = useState(false);

  const q = useQuery({
    queryKey: ["rack-kit", rackId],
    queryFn: () => readFn({ data: { rackId } }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rack-kit", rackId] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  const create = useMutation({
    mutationFn: () => createFn({ data: { rackId } }),
    onSuccess: () => {
      refresh();
      toast.success("Kit created — add the parts that are installed in this rack");
      setBomOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kit = q.data?.kit ?? null;
  const parts = q.data?.parts ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          Rack build kit
          {kit ? (
            <Badge variant="secondary" className="ml-1">
              {parts.length} {parts.length === 1 ? "part" : "parts"}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : kit ? (
          <>
            <div className="font-medium">{kit.name}</div>

            {parts.length === 0 ? (
              <p className="text-muted-foreground">
                No parts recorded yet. Add the gear that is installed in this rack.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {parts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">
                      {formatQty(p.quantity, p.unit)}
                    </span>
                    <span className="font-medium">{p.name}</span>
                    {p.location ? (
                      <span className="text-xs text-muted-foreground">{p.location}</span>
                    ) : null}
                    {p.notes ? (
                      <span className="text-xs text-muted-foreground italic">{p.notes}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setBomOpen(true)} className="gap-1">
                <Pencil className="h-4 w-4" />
                Edit rack parts
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/inventory">Open in Inventory</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              No kit yet. A kit lists the gear installed in this rack — radio, shelf, patch panel,
              power strip — so the rack's contents live in one place.
            </p>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? "Creating…" : "Create kit"}
            </Button>
          </>
        )}
      </CardContent>
      <InventoryBomDialog
        itemId={kit?.id ?? null}
        open={bomOpen}
        onOpenChange={(o) => {
          setBomOpen(o);
          if (!o) refresh();
        }}
      />
    </Card>
  );
}
