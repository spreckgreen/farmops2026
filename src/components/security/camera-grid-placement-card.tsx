// Place cameras on a building grid using the compass side already recorded.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listCameraGridBuildings, placeCamerasOnBuildingGrid } from "@/lib/cameras.functions";
import { buildingLabel, derivePlacements, gridExtent } from "@/lib/camera-grid-placement";
import { COMPASS_SIDE_LABEL, type CompassSide } from "@/lib/ring-cameras";
import type { CameraRow } from "@/lib/cameras";

export function CameraGridPlacementCard({
  rows,
  onPlaced,
}: {
  rows: readonly CameraRow[];
  onPlaced: () => void;
}) {
  const listBuildings = useServerFn(listCameraGridBuildings);
  const place = useServerFn(placeCamerasOnBuildingGrid);
  const [buildingId, setBuildingId] = useState<string>("");

  const buildingsQuery = useQuery({
    queryKey: ["camera-grid-buildings"],
    queryFn: () => listBuildings({}),
  });

  const buildings = buildingsQuery.data?.buildings ?? [];
  const selected = buildings.find((b: { id: string }) => b.id === buildingId) ?? null;
  const extent = gridExtent(selected as never);

  const plan = useMemo(
    () => derivePlacements(selected as never, rows as never),
    [selected, rows],
  );

  const placeMutation = useMutation({
    mutationFn: () => place({ data: { building_id: buildingId } }),
    onSuccess: (result) => {
      const failed = result.results.filter((r: { error?: string }) => r.error);
      if (failed.length > 0) {
        toast.error(`${failed.length} camera(s) could not be placed.`);
      } else {
        toast.success(`Placed ${result.placed} camera(s) on the grid.`);
      }
      onPlaced();
    },
    onError: (error: unknown) => toast.error(String((error as Error)?.message ?? error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Place cameras on a building grid</CardTitle>
        <CardDescription>
          Positions are worked out from the side of the building each camera is recorded on and
          that building&apos;s own grid. They are plan positions on the building outline, not
          tape-measured mount points — measure and adjust any camera where the exact spot matters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-sm">
          <Label>Building</Label>
          <Select value={buildingId} onValueChange={setBuildingId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a building" />
            </SelectTrigger>
            <SelectContent>
              {buildings.map((b: { id: string }) => (
                <SelectItem key={b.id} value={b.id}>
                  {buildingLabel(b as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selected && !extent ? (
          <p className="text-sm text-muted-foreground">
            This building has no grid yet. Define its grid first, then come back.
          </p>
        ) : null}

        {extent ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Grid {extent.columns} × {extent.rows} cells of {extent.cellFeet} ft —{" "}
              {extent.widthFeet} ft by {extent.depthFeet} ft.
            </p>
            <div className="rounded-md border divide-y">
              {plan.placements.map((p) => (
                <div key={p.id} className="flex flex-wrap gap-x-4 gap-y-1 p-3 text-sm">
                  <span className="font-medium">{p.camera_id}</span>
                  <span className="text-muted-foreground">
                    {COMPASS_SIDE_LABEL[p.side as CompassSide]}
                    {p.slots > 1 ? ` (${p.slot} of ${p.slots})` : ""}
                  </span>
                  <span>
                    {p.x_feet} ft, {p.y_feet} ft{p.cell ? ` — cell ${p.cell}` : ""}
                  </span>
                  <span className="text-muted-foreground">aims {p.heading_degrees}°</span>
                  {p.unchanged ? (
                    <span className="text-muted-foreground">already recorded</span>
                  ) : null}
                </div>
              ))}
              {plan.withheld.map((w) => (
                <div key={w.id} className="p-3 text-sm">
                  <span className="font-medium">{w.camera_id}</span>{" "}
                  <span className="text-muted-foreground">— {w.reason}</span>
                </div>
              ))}
            </div>
            <Button
              onClick={() => placeMutation.mutate()}
              disabled={placeMutation.isPending || plan.placements.length === 0}
            >
              {placeMutation.isPending
                ? "Placing…"
                : `Record these ${plan.placements.length} position(s)`}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
