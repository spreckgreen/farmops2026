// "Rack build kit" panel on an equipment rack record. Rack gear is screwed down
// and stays with the rack, so the rack's contents are a kit parts list — and
// each part can record its shelf size in rack spaces (U) and which space it sits
// at, which gives the rack a stacked elevation and a spaces-used count.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Boxes, Pencil, Plus } from "lucide-react";
import { createRackKit, getRackKit, setRackPartPlacement } from "@/lib/rack-kit.functions";
import type { RackKitPart } from "@/lib/rack-kit.functions";
import { InventoryBomDialog } from "@/components/inventory-bom-dialog";
import { formatQty } from "@/lib/inventory-bom";
import { buildRackElevation, formatSpan, nextFreePosition } from "@/lib/rack-elevation";

function PlacementRow({
  part,
  suggestion,
  onSave,
  saving,
}: {
  part: RackKitPart;
  suggestion: number | null;
  onSave: (rackUnits: number | null, positionU: number | null) => void;
  saving: boolean;
}) {
  const [units, setUnits] = useState(part.rackUnits == null ? "" : String(part.rackUnits));
  const [pos, setPos] = useState(part.positionU == null ? "" : String(part.positionU));

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-3 py-2 last:border-0">
      <div className="min-w-40 flex-1">
        <div className="font-medium">{part.name}</div>
        <div className="text-xs text-muted-foreground">
          {formatQty(part.quantity, part.unit)}
          {part.location ? ` · ${part.location}` : ""}
        </div>
      </div>
      <div className="w-24">
        <Label className="text-xs text-muted-foreground">Spaces (U)</Label>
        <Input
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          inputMode="numeric"
          placeholder={part.itemRackUnits == null ? "—" : String(part.itemRackUnits)}
          className="mt-1 h-8 bg-card/60"
        />
      </div>
      <div className="w-28">
        <Label className="text-xs text-muted-foreground">Starts at U</Label>
        <Input
          value={pos}
          onChange={(e) => setPos(e.target.value)}
          inputMode="numeric"
          placeholder={suggestion == null ? "—" : String(suggestion)}
          className="mt-1 h-8 bg-card/60"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={saving}
        onClick={() => {
          const u = units.trim() === "" ? null : Number(units);
          const p = pos.trim() === "" ? null : Number(pos);
          if ((u != null && !Number.isInteger(u)) || (p != null && !Number.isInteger(p))) {
            toast.error("Use whole numbers of rack spaces");
            return;
          }
          onSave(u, p);
        }}
      >
        Save
      </Button>
    </div>
  );
}

export function RackKitCard({ rackId }: { rackId: string }) {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getRackKit);
  const createFn = useServerFn(createRackKit);
  const placeFn = useServerFn(setRackPartPlacement);
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
      toast.success("Kit created — add the gear that is installed in this rack");
      setBomOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const place = useMutation({
    mutationFn: (v: { componentRowId: string; rackUnits: number | null; positionU: number | null }) =>
      placeFn({ data: { rackId, ...v, applyToItem: true } }),
    onSuccess: () => {
      refresh();
      toast.success("Rack position saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kit = q.data?.kit ?? null;
  const parts = q.data?.parts ?? [];
  const sizeU = q.data?.rackSizeU ?? null;
  const elevation = buildRackElevation(
    parts.map((p) => ({
      id: p.id,
      name: p.name,
      rackUnits: p.rackUnits,
      positionU: p.positionU,
      quantity: p.quantity,
    })),
    sizeU,
  );
  const placedById = new Map(elevation.placed.map((p) => [p.id, p]));
  // Top space first, so the picture reads like the rack in front of you.
  const rows = sizeU == null ? [] : Array.from({ length: sizeU }, (_, i) => sizeU - i);
  const startsAt = new Map(elevation.placed.map((p) => [p.positionU, p]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Boxes className="h-4 w-4" />
          Rack build kit
          {kit ? (
            <Badge variant="secondary">
              {parts.length} {parts.length === 1 ? "part" : "parts"}
            </Badge>
          ) : null}
          {kit && sizeU != null ? (
            <Badge variant="outline">
              {elevation.usedU} of {sizeU} spaces used
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : !kit ? (
          <>
            <p className="text-muted-foreground">
              No kit yet. A kit lists the gear installed in this rack — radio, shelf, patch panel,
              power strip — with the rack spaces each one takes.
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
        ) : (
          <>
            <div className="font-medium">{kit.name}</div>

            {(elevation.conflicts.length > 0 || elevation.overflow.length > 0) && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
                <div className="flex items-center gap-1 font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Check these positions
                </div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {elevation.conflicts.map((c, i) => (
                    <li key={`c${i}`}>
                      {c.a} and {c.b} both claim U{c.spaces.join(", U")}
                    </li>
                  ))}
                  {elevation.overflow.map((o) => (
                    <li key={o.id}>
                      {o.name} at {formatSpan(o)} runs past the top of the rack
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sizeU == null ? (
              <p className="text-muted-foreground">
                This rack has no height recorded, so spaces can't be counted. Set its rack size to
                see the stack.
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border font-mono text-xs">
                {rows.map((u) => {
                  const startingHere = startsAt.get(u);
                  const occupied = elevation.placed.find((p) => u >= p.positionU && u <= p.topU);
                  return (
                    <div
                      key={u}
                      className={`flex items-center gap-3 border-b border-border/60 px-3 py-1 last:border-0 ${
                        occupied ? "bg-primary/10" : ""
                      }`}
                    >
                      <span className="w-8 shrink-0 text-muted-foreground">U{u}</span>
                      <span className="truncate">
                        {startingHere ? (
                          <>
                            <span className="font-sans font-medium">{startingHere.name}</span>
                            <span className="ml-2 text-muted-foreground">
                              {startingHere.rackUnits}U · {formatSpan(startingHere)}
                            </span>
                          </>
                        ) : occupied ? (
                          <span className="text-muted-foreground">↑ {occupied.name}</span>
                        ) : (
                          <span className="text-muted-foreground/60">empty</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {parts.length === 0 ? (
              <p className="text-muted-foreground">
                No parts recorded yet. Add the gear that is installed in this rack.
              </p>
            ) : (
              <div className="rounded-md border border-border">
                {parts.map((p) => (
                  <PlacementRow
                    key={p.id}
                    part={p}
                    suggestion={
                      placedById.has(p.id)
                        ? null
                        : nextFreePosition(elevation, p.rackUnits ?? 1)
                    }
                    saving={place.isPending}
                    onSave={(rackUnits, positionU) =>
                      place.mutate({ componentRowId: p.id, rackUnits, positionU })
                    }
                  />
                ))}
              </div>
            )}

            {elevation.unplaced.length > 0 && sizeU != null ? (
              <p className="text-xs text-muted-foreground">
                Not placed in the rack yet:{" "}
                {elevation.unplaced.map((p) => p.name).join(", ")} — give each one a size in spaces
                and a starting space.
              </p>
            ) : null}

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
