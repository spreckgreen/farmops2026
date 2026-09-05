// A starter room/area and circuit plan for a simple rectangular outbuilding.
//
// This proposes a layout only. It carries no engineering values: no amps, no
// wire sizes, no panel ratings, no breaker numbers. Circuit entries are planned
// references the owner renames or replaces with real records once the wiring is
// known, and every entry is written with the "planned (design)" basis so field
// evidence can supersede it later.
import { gridExtent, type GridBuilding } from "@/lib/camera-grid-placement";

export interface StarterArea {
  area_name: string;
  area_kind: string;
  grid_cells: string;
  notes: string;
  circuits: StarterCircuit[];
}

export interface StarterCircuit {
  circuit_group_ref: string;
  panel_ref: string;
  notes: string;
}

function cellsFor(
  rowLabels: string[],
  columnLabels: string[],
  rowRange: [number, number],
  columnRange: [number, number],
): string {
  const cells: string[] = [];
  for (let r = rowRange[0]; r <= rowRange[1]; r += 1) {
    for (let c = columnRange[0]; c <= columnRange[1]; c += 1) {
      const row = rowLabels[r];
      const column = columnLabels[c];
      if (row && column) cells.push(`${row}${column}`);
    }
  }
  return cells.join(", ");
}

const PLANNED_NOTE = "Planned layout — rename or replace once the real wiring is recorded.";

/**
 * Split the building grid into a service side, two bays and the exterior, with
 * one planned circuit reference each.
 */
export function starterOutbuildingPlan(
  building: GridBuilding | null | undefined,
  panelRef: string,
): StarterArea[] {
  const extent = gridExtent(building);
  if (!extent) return [];
  const { rowLabels, columnLabels, rows, columns } = extent;
  const midColumn = Math.max(0, Math.floor(columns / 2) - 1);
  const lastColumn = columns - 1;
  const serviceRow = 0;
  const bayStartRow = Math.min(1, rows - 1);
  const lastRow = rows - 1;

  return [
    {
      area_name: "Service wall",
      area_kind: "MECHANICAL",
      grid_cells: cellsFor(rowLabels, columnLabels, [serviceRow, serviceRow], [0, lastColumn]),
      notes: `${PLANNED_NOTE} Intended location for the sub-panel and disconnect.`,
      circuits: [
        {
          circuit_group_ref: "GAR-LIGHTS (planned)",
          panel_ref: panelRef,
          notes: "Planned overhead lighting circuit — no breaker assigned yet.",
        },
      ],
    },
    {
      area_name: "Bay 1",
      area_kind: "BAY",
      grid_cells: cellsFor(rowLabels, columnLabels, [bayStartRow, lastRow], [0, midColumn]),
      notes: PLANNED_NOTE,
      circuits: [
        {
          circuit_group_ref: "GAR-OUTLETS-1 (planned)",
          panel_ref: panelRef,
          notes: "Planned receptacle circuit for this bay — no breaker assigned yet.",
        },
      ],
    },
    {
      area_name: "Bay 2",
      area_kind: "BAY",
      grid_cells: cellsFor(
        rowLabels,
        columnLabels,
        [bayStartRow, lastRow],
        [Math.min(midColumn + 1, lastColumn), lastColumn],
      ),
      notes: PLANNED_NOTE,
      circuits: [
        {
          circuit_group_ref: "GAR-OUTLETS-2 (planned)",
          panel_ref: panelRef,
          notes: "Planned receptacle circuit for this bay — no breaker assigned yet.",
        },
      ],
    },
    {
      area_name: "Exterior",
      area_kind: "EXTERIOR",
      grid_cells: "",
      notes: `${PLANNED_NOTE} Outside lights, door opener and any exterior receptacles.`,
      circuits: [
        {
          circuit_group_ref: "GAR-EXTERIOR (planned)",
          panel_ref: panelRef,
          notes: "Planned exterior lighting and door opener circuit — no breaker assigned yet.",
        },
      ],
    },
  ];
}
