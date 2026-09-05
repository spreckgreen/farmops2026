// Building levels (floors) for each building, plus the read-only level
// reconciliation report. Nothing here bulk-writes locations: existing records
// only move floors through the preview and approval workflow.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listBuildingLevels,
  previewLevelMigration,
  saveBuildingLevel,
} from "@/lib/building-levels.functions";
import {
  ALL_LEVELS,
  LEVEL_PRESETS,
  sortLevels,
  type BuildingLevel,
} from "@/lib/building-levels";
import {
  BuildingLevelSelector,
  buildingLabel,
  type BuildingOption,
} from "@/components/electrical/building-level-selector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

export function BuildingLevelManager() {
  const load = useServerFn(listBuildingLevels);
  const save = useServerFn(saveBuildingLevel);
  const preview = useServerFn(previewLevelMigration);
  const queryClient = useQueryClient();

  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [levelId, setLevelId] = useState<string>(ALL_LEVELS);
  const [displayName, setDisplayName] = useState("Ground Floor");
  const [shortCode, setShortCode] = useState("L01");
  const [sortOrder, setSortOrder] = useState("0");
  const [elevation, setElevation] = useState("");
  const [rows, setRows] = useState("");
  const [columns, setColumns] = useState("");
  const [cellFt, setCellFt] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [confirmSingle, setConfirmSingle] = useState(false);

  const query = useQuery({ queryKey: ["building-levels"], queryFn: () => load() });
  const buildings = (query.data?.buildings ?? []) as BuildingOption[];
  const levels = (query.data?.levels ?? []) as BuildingLevel[];
  const activeBuilding = buildingId ?? buildings[0]?.id ?? null;
  const buildingLevels = useMemo(
    () => sortLevels(levels.filter((l) => l.site_building_id === activeBuilding)),
    [levels, activeBuilding],
  );

  const migration = useQuery({
    queryKey: ["building-levels-migration", activeBuilding, confirmSingle],
    enabled: Boolean(activeBuilding) && buildingLevels.length > 0,
    queryFn: () =>
      preview({
        data: { site_building_id: activeBuilding, confirmed_single_level: confirmSingle },
      }),
  });

  const saving = useMutation({
    mutationFn: () =>
      save({
        data: {
          site_building_id: activeBuilding!,
          display_name: displayName,
          short_code: shortCode,
          sort_order: Number(sortOrder) || 0,
          elevation_ft: elevation === "" ? null : Number(elevation),
          grid_rows: rows === "" ? null : Number(rows),
          grid_columns: columns === "" ? null : Number(columns),
          grid_cell_ft: cellFt === "" ? null : Number(cellFt),
          is_default: isDefault,
        },
      }),
    onSuccess: () => {
      toast.success(`${displayName} added.`);
      void queryClient.invalidateQueries({ queryKey: ["building-levels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function applyPreset(name: string) {
    const preset = LEVEL_PRESETS.find((p) => p.display_name === name);
    if (!preset) return;
    setDisplayName(preset.display_name);
    setShortCode(preset.short_code);
    setSortOrder(String(preset.sort_order));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Choose a building and level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <BuildingLevelSelector
            buildings={buildings}
            levels={levels}
            buildingId={activeBuilding}
            levelId={levelId}
            onBuildingChange={(id) => {
              setBuildingId(id);
              setLevelId(ALL_LEVELS);
            }}
            onLevelChange={setLevelId}
          />
          <div className="flex flex-wrap gap-2">
            {buildingLevels.map((l) => (
              <Badge key={l.id} variant={l.id === levelId ? "default" : "secondary"}>
                {l.display_name} · {l.short_code}
                {l.elevation_ft != null ? ` · ${l.elevation_ft} ft` : ""}
                {l.is_default ? " · default" : ""}
              </Badge>
            ))}
            {buildingLevels.length === 0 ? (
              <span className="text-sm text-muted-foreground">No levels recorded yet.</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add a level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {LEVEL_PRESETS.map((p) => (
              <Button
                key={p.short_code}
                size="sm"
                variant="outline"
                onClick={() => applyPreset(p.display_name)}
              >
                {p.display_name}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="lvl-name">Name</Label>
              <Input
                id="lvl-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lvl-code">Short code</Label>
              <Input id="lvl-code" value={shortCode} onChange={(e) => setShortCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lvl-sort">Order</Label>
              <Input id="lvl-sort" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lvl-elev">Floor height above ground (feet, optional)</Label>
              <Input id="lvl-elev" value={elevation} onChange={(e) => setElevation(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lvl-rows">Grid rows on this level (optional)</Label>
              <Input id="lvl-rows" value={rows} onChange={(e) => setRows(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lvl-cols">Grid columns on this level (optional)</Label>
              <Input id="lvl-cols" value={columns} onChange={(e) => setColumns(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lvl-cell">Cell size (feet, optional)</Label>
              <Input id="lvl-cell" value={cellFt} onChange={(e) => setCellFt(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
            Treat this as the building's default level
          </label>
          <Button
            size="sm"
            disabled={!activeBuilding || saving.isPending}
            onClick={() => saving.mutate()}
          >
            {saving.isPending ? "Saving…" : "Add level"}
          </Button>
          <p className="text-xs text-muted-foreground">
            A level's own floor plan and grid size may differ from the building's. Leave the grid
            boxes empty to reuse the building's grid.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Existing locations — {buildingLabel(buildings.find((b) => b.id === activeBuilding))}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={confirmSingle}
              onCheckedChange={(v) => setConfirmSingle(v === true)}
            />
            I confirm this building has only one level
          </label>
          {migration.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : null}
          {migration.data ? (
            <div className="space-y-3">
              {migration.data.groups.map((group) => (
                <div key={group.table} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{group.label}</span>
                    <span className="text-muted-foreground">
                      {group.plan.attach_count} can be placed · {group.plan.withheld_count} need a
                      decision
                    </span>
                  </div>
                  {group.reconciliation.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {group.reconciliation.slice(0, 8).map((r) => (
                        <li key={`${r.stable_id}-${r.issue}`}>
                          <span className="font-mono">{r.stable_id}</span> — {r.message}
                        </li>
                      ))}
                      {group.reconciliation.length > 8 ? (
                        <li>and {group.reconciliation.length - 8} more…</li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Nothing to reconcile on this list.
                    </p>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                This is a preview only. Coordinates and record names never change here, and each
                placement still needs your approval.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
