// Kit build-out workspace — the same layout the equipment racks use, working on
// any inventory kit: the parts list, how many spaces each part takes, where it
// sits, and a bottom-up picture of the stack.
import { useState } from "react";
import type { ReactElement } from "react";
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
import { AlertTriangle, Boxes, ImageIcon, Loader2, Pencil, Server } from "lucide-react";
import {
  generateKitPartFace,
  getKitBuild,
  setKitPartPlacement,
  setKitSize,
} from "@/lib/kit-build.functions";
import type { KitBuildPart } from "@/lib/kit-build.functions";
import { InventoryBomDialog } from "@/components/inventory-bom-dialog";
import { formatQty } from "@/lib/inventory-bom";
import { buildRackElevation, formatSpan, nextFreePosition } from "@/lib/rack-elevation";

const U_PX = 30;

function PlacementRow({
  part,
  suggestion,
  onSave,
  saving,
  onDrawFace,
  drawing,
}: {
  part: KitBuildPart;
  suggestion: number | null;
  onSave: (rackUnits: number | null, positionU: number | null) => void;
  saving: boolean;
  onDrawFace: () => void;
  drawing: boolean;
}) {
  const [units, setUnits] = useState(part.rackUnits == null ? "" : String(part.rackUnits));
  const [pos, setPos] = useState(part.positionU == null ? "" : String(part.positionU));

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-3 py-2 last:border-0">
      <div className="h-9 w-16 shrink-0 overflow-hidden rounded border border-border bg-muted/50">
        {part.faceImageUrl ? (
          <img
            src={part.faceImageUrl}
            alt={`Front panel of ${part.name}`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
      </div>
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
            toast.error("Use whole numbers of spaces");
            return;
          }
          onSave(u, p);
        }}
      >
        Save
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={drawing || part.rackUnits == null}
        title={
          part.rackUnits == null
            ? "Record how many spaces this part takes first"
            : "Draw this part's front panel"
        }
        onClick={onDrawFace}
        className="gap-1"
      >
        {drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        {part.faceImageUrl ? "Redraw" : "Draw panel"}
      </Button>
    </div>
  );
}

export function KitBuildCard({ kitItemId }: { kitItemId: string }) {
  const queryClient = useQueryClient();
  const readFn = useServerFn(getKitBuild);
  const placeFn = useServerFn(setKitPartPlacement);
  const faceFn = useServerFn(generateKitPartFace);
  const sizeFn = useServerFn(setKitSize);
  const [bomOpen, setBomOpen] = useState(false);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["kit-build", kitItemId],
    queryFn: () => readFn({ data: { kitItemId } }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["kit-build", kitItemId] });
    queryClient.invalidateQueries({ queryKey: ["kit-rack-buildouts"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  const place = useMutation({
    mutationFn: (v: {
      componentRowId: string;
      rackUnits: number | null;
      positionU: number | null;
    }) => placeFn({ data: { kitItemId, ...v, applyToItem: true } }),
    onSuccess: () => {
      refresh();
      toast.success("Position saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const drawFace = useMutation({
    mutationFn: (componentRowId: string) => faceFn({ data: { kitItemId, componentRowId } }),
    onMutate: (componentRowId: string) => setDrawingId(componentRowId),
    onSuccess: () => {
      refresh();
      toast.success("Front panel drawn");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setDrawingId(null),
  });

  const saveSize = useMutation({
    mutationFn: (sizeU: number | null) => sizeFn({ data: { kitItemId, sizeU } }),
    onSuccess: () => {
      refresh();
      setSizeDraft(null);
      toast.success("Build height saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const view = q.data ?? null;
  const parts = view?.parts ?? [];
  const sizeU = view?.sizeU ?? null;
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {view?.rack ? <Server className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
          {view?.rack ? `${view.rack.stableId} build-out` : (view?.kit.name ?? "Kit build-out")}
          <Badge variant="secondary">
            {parts.length} {parts.length === 1 ? "part" : "parts"}
          </Badge>
          {sizeU != null ? (
            <Badge variant="outline">
              {elevation.usedU} of {sizeU} spaces used
            </Badge>
          ) : null}
        </CardTitle>
        {view ? (
          <p className="text-xs text-muted-foreground">
            {view.rack ? `${view.kit.name} · ` : ""}
            {view.rack?.description || view.kit.location || "No location recorded"}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : q.error ? (
          <p className="text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
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
                      {o.name} at {formatSpan(o)} runs past the top of the build
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {view?.rack ? null : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36">
                  <Label className="text-xs text-muted-foreground">Build height (spaces)</Label>
                  <Input
                    value={sizeDraft ?? (sizeU == null ? "" : String(sizeU))}
                    onChange={(e) => setSizeDraft(e.target.value)}
                    inputMode="numeric"
                    placeholder="e.g. 12"
                    className="mt-1 h-8 bg-card/60"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saveSize.isPending}
                  onClick={() => {
                    const raw = (sizeDraft ?? "").trim();
                    if (sizeDraft == null) return;
                    const n = raw === "" ? null : Number(raw);
                    if (n != null && (!Number.isInteger(n) || n <= 0)) {
                      toast.error("Use a whole number of spaces");
                      return;
                    }
                    saveSize.mutate(n);
                  }}
                >
                  Save height
                </Button>
                <p className="text-xs text-muted-foreground">
                  Set a height to draw the stack. Leave blank for a plain parts list.
                </p>
              </div>
            )}

            {sizeU != null ? (
              <div className="overflow-hidden rounded-md border-x-4 border-y border-border bg-muted/40">
                {(() => {
                  const blocks: ReactElement[] = [];
                  let u = sizeU;
                  while (u >= 1) {
                    const part = elevation.placed.find((p) => p.topU === u);
                    if (part) {
                      const partData = parts.find((p) => p.id === part.id);
                      blocks.push(
                        <div
                          key={`p${part.id}`}
                          className="relative flex items-center gap-3 overflow-hidden border-b border-border/60 bg-card px-3"
                          style={{ height: part.rackUnits * U_PX }}
                        >
                          {partData?.faceImageUrl ? (
                            <img
                              src={partData.faceImageUrl}
                              alt={`Front panel of ${part.name}`}
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : null}
                          <div
                            className={`relative flex w-full items-center gap-2 ${
                              partData?.faceImageUrl
                                ? "bg-background/70 px-2 py-0.5 backdrop-blur-sm"
                                : ""
                            }`}
                          >
                            <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">
                              {formatSpan(part)}
                            </span>
                            <span className="truncate font-medium">{part.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {part.rackUnits}U
                            </span>
                          </div>
                        </div>,
                      );
                      u -= part.rackUnits;
                    } else {
                      const covering = elevation.placed.find((p) => u >= p.positionU && u <= p.topU);
                      blocks.push(
                        <div
                          key={`e${u}`}
                          className="flex items-center gap-3 border-b border-border/60 px-3 font-mono text-xs"
                          style={{ height: U_PX }}
                        >
                          <span className="w-12 shrink-0 text-muted-foreground">U{u}</span>
                          <span className="truncate text-muted-foreground/70">
                            {covering ? `↑ ${covering.name}` : "empty"}
                          </span>
                        </div>,
                      );
                      u -= 1;
                    }
                  }
                  return blocks;
                })()}
              </div>
            ) : null}

            {parts.length === 0 ? (
              <p className="text-muted-foreground">
                No parts recorded yet. Add the gear that makes up this kit.
              </p>
            ) : (
              <div className="rounded-md border border-border">
                {parts.map((p) => (
                  <PlacementRow
                    key={p.id}
                    part={p}
                    suggestion={
                      placedById.has(p.id) ? null : nextFreePosition(elevation, p.rackUnits ?? 1)
                    }
                    saving={place.isPending}
                    onSave={(rackUnits, positionU) =>
                      place.mutate({ componentRowId: p.id, rackUnits, positionU })
                    }
                    onDrawFace={() => drawFace.mutate(p.id)}
                    drawing={drawingId === p.id}
                  />
                ))}
              </div>
            )}

            {elevation.unplaced.length > 0 && sizeU != null ? (
              <p className="text-xs text-muted-foreground">
                Not placed yet: {elevation.unplaced.map((p) => p.name).join(", ")} — give each one a
                size in spaces and a starting space.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setBomOpen(true)} className="gap-1">
                <Pencil className="h-4 w-4" />
                Edit kit parts
              </Button>
              {view?.rack ? (
                <Button asChild size="sm" variant="outline">
                  <Link
                    to="/electrical/item/$kind/$id"
                    params={{ kind: "rack", id: view.rack.id }}
                  >
                    Open rack
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <Link to="/inventory">Open in Inventory</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <InventoryBomDialog
        itemId={kitItemId}
        open={bomOpen}
        onOpenChange={(o) => {
          setBomOpen(o);
          if (!o) refresh();
        }}
      />
    </Card>
  );
}
