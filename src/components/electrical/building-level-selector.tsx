// Reusable building + level selector. It always sits BEFORE the grid selector,
// because a grid reference only means something on a known floor.
import { ALL_LEVELS, sortLevels, type BuildingLevel } from "@/lib/building-levels";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface BuildingOption {
  id: string;
  building_name?: string | null;
  temp_name?: string | null;
}

export function buildingLabel(building: BuildingOption | null | undefined): string {
  if (!building) return "—";
  const name = String(building.building_name ?? "").trim();
  const temp = String(building.temp_name ?? "").trim();
  if (name && temp && name !== temp) return `${name} (${temp})`;
  return name || temp || "Building";
}

interface Props {
  buildings: BuildingOption[];
  levels: BuildingLevel[];
  buildingId: string | null;
  levelId: string;
  onBuildingChange: (id: string) => void;
  onLevelChange: (id: string) => void;
  /** Offer an "All levels" overview entry. */
  allowAllLevels?: boolean;
}

export function BuildingLevelSelector({
  buildings,
  levels,
  buildingId,
  levelId,
  onBuildingChange,
  onLevelChange,
  allowAllLevels = true,
}: Props) {
  const forBuilding = sortLevels(levels.filter((l) => l.site_building_id === buildingId));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="level-building">Building</Label>
        <Select value={buildingId ?? ""} onValueChange={onBuildingChange}>
          <SelectTrigger id="level-building">
            <SelectValue placeholder="Choose a building" />
          </SelectTrigger>
          <SelectContent>
            {buildings.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {buildingLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="level-floor">Level</Label>
        <Select value={levelId} onValueChange={onLevelChange}>
          <SelectTrigger id="level-floor">
            <SelectValue placeholder="Choose a level" />
          </SelectTrigger>
          <SelectContent>
            {allowAllLevels ? <SelectItem value={ALL_LEVELS}>All levels</SelectItem> : null}
            {forBuilding.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.display_name} ({l.short_code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {forBuilding.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This building has no levels yet. Add one below — a single-storey building just needs
            Ground Floor.
          </p>
        ) : null}
      </div>
    </div>
  );
}
