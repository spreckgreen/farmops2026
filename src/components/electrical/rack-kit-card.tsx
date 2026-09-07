// "Build out this rack" panel on an equipment rack record. The rack's installed
// components are described by a kit parts list, because rack gear is screwed
// down and stays with the rack (e.g. switch + patch panel + shelf + PDU).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Boxes, Plus } from "lucide-react";
import { createRackKit, getRackKit } from "@/lib/rack-kit.functions";
import { InventoryBomDialog } from "@/components/inventory-bom-dialog";

export function RackKitCard({ rackId }: { rackId: string }) {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getRackKit);
  const createFn = useServerFn(createRackKit);
  const [bomOpen, setBomOpen] = useState(false);

  const q = useQuery({
    queryKey: ["rack-kit", rackId],
    queryFn: () => readFn({ data: { rackId } }),
  });

  const create = useMutation({
    mutationFn: () => createFn({ data: { rackId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rack-kit", rackId] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["electrical", "topology", "rack", rackId] });
      toast.success("Kit created — add the parts that are installed in this rack");
      setBomOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kit = q.data?.kit ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4" />
          Rack build kit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : kit ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{kit.name}</span>
              <Badge variant="secondary">
                {kit.componentCount} {kit.componentCount === 1 ? "part" : "parts"}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              The parts list describes what is installed in this rack. Add or change parts here.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setBomOpen(true)} className="gap-1">
                <Plus className="h-4 w-4" />
                Edit rack parts
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/inventory">Open in Inventory</Link>
              </Button>
            </div>
          </>
        ) : q.data?.linkedNonKitAsset ? (
          <p className="text-muted-foreground">
            This rack is linked to the asset “{q.data.linkedNonKitAsset.name}”. Clear that link on
            the rack first, then a kit can describe what is installed in it.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              No kit yet. A kit lists the gear installed in this rack — switch, patch panel, shelf,
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
      <InventoryBomDialog itemId={kit?.id ?? null} open={bomOpen} onOpenChange={setBomOpen} />
    </Card>
  );
}
