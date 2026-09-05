// DEMO-ONLY sample farm.
//
// Every identifier here is prefixed DEMO- and this module is never imported by
// any real electrical page, function, export, report or AI context. It exists so
// the public demo can show the design-to-field workflow and the shared
// effective-location resolver working on a complete little site without touching
// the real Farm Shop records.
//
// The building envelope matches the frozen 60 ft x 40 ft shop envelope so the
// derived A1-F9 labels the resolver produces are real derived read-outs, not
// invented strings.
import {
  effectiveLocationForRecord,
  formatLocationProvenance,
  type EffectiveLocation,
  type EffectiveLocationRecord,
} from "@/lib/electrical-effective-location";

export const DEMO_FARM_VERSION = "demo-sample-farm-1";

export const DEMO_SITE = {
  name: "Meadow Ridge Demo Farm",
  note: "Example data for the demo only. No real equipment, no real measurements.",
  widthFt: 60,
  depthFt: 40,
} as const;

export interface DemoPanel {
  stableId: string;
  name: string;
  kind: "physical" | "logical";
  physicalPanel?: string;
  mains: string;
  spaces: number;
}

export const DEMO_PANELS: DemoPanel[] = [
  {
    stableId: "DEMO-PNL-BARN-MAIN",
    name: "Barn main panel",
    kind: "physical",
    mains: "200 A, 240 V single phase",
    spaces: 40,
  },
  {
    stableId: "DEMO-PNL-BARN-SOUTH",
    name: "South wall subpanel",
    kind: "physical",
    mains: "100 A feeder from barn main",
    spaces: 24,
  },
  {
    stableId: "DEMO-PNL-BARN-CRIT",
    name: "Backed-up critical group",
    kind: "logical",
    physicalPanel: "DEMO-PNL-BARN-MAIN",
    mains: "logical grouping only — no mains, no spaces",
    spaces: 0,
  },
];

export interface DemoCircuit {
  stableId: string;
  panel: string;
  breaker: number;
  poles: 1 | 2;
  amps: number;
  classification: "dedicated" | "shared";
  description: string;
}

export const DEMO_CIRCUITS: DemoCircuit[] = [
  { stableId: "DEMO-CON-001", panel: "DEMO-PNL-BARN-MAIN", breaker: 3, poles: 2, amps: 40, classification: "dedicated", description: "Feed room water heater" },
  { stableId: "DEMO-CON-002", panel: "DEMO-PNL-BARN-MAIN", breaker: 7, poles: 1, amps: 20, classification: "dedicated", description: "Milk room outlet" },
  { stableId: "DEMO-CON-003", panel: "DEMO-PNL-BARN-MAIN", breaker: 9, poles: 1, amps: 20, classification: "shared", description: "North aisle receptacles" },
  { stableId: "DEMO-CON-004", panel: "DEMO-PNL-BARN-MAIN", breaker: 11, poles: 1, amps: 20, classification: "shared", description: "Overhead lighting row A" },
  { stableId: "DEMO-CON-005", panel: "DEMO-PNL-BARN-SOUTH", breaker: 2, poles: 1, amps: 20, classification: "shared", description: "South wall receptacles" },
  { stableId: "DEMO-CON-006", panel: "DEMO-PNL-BARN-SOUTH", breaker: 4, poles: 1, amps: 15, classification: "dedicated", description: "Well pump control" },
  { stableId: "DEMO-CON-007", panel: "DEMO-PNL-BARN-SOUTH", breaker: 6, poles: 1, amps: 20, classification: "shared", description: "Exterior cameras" },
];

export type DemoStage =
  | "planned"
  | "rough_in"
  | "conductors"
  | "tested"
  | "complete";

export interface DemoLoad extends EffectiveLocationRecord {
  stableId: string;
  description: string;
  circuit: string;
  panel: string;
  logicalPanel?: string;
  stage: DemoStage;
  critical: boolean;
}

/**
 * Twelve example loads spanning every location source the resolver knows:
 * field-observed grid, approved design corner/face, approved design X/Y,
 * remapped grid and original grid only.
 */
export const DEMO_LOADS: DemoLoad[] = [
  {
    stableId: "DEMO-LD-001",
    description: "Feed room water heater",
    circuit: "DEMO-CON-001",
    panel: "DEMO-PNL-BARN-MAIN",
    logicalPanel: "DEMO-PNL-BARN-CRIT",
    stage: "complete",
    critical: true,
    fieldGridReference: "B2",
    fieldGridEvidence: "Demo audit item 1 — photographed on the feed room wall",
    fieldGridObservedAt: "2026-08-14T15:10:00.000Z",
    originalGrid: "B2",
  },
  {
    stableId: "DEMO-LD-002",
    description: "Milk room outlet",
    circuit: "DEMO-CON-002",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "tested",
    critical: false,
    fieldGridReference: "C4",
    fieldGridEvidence: "Demo audit item 2 — measured from the west wall",
    fieldGridObservedAt: "2026-08-14T15:25:00.000Z",
    remappedGridReference: "C4",
    originalGrid: "C4",
  },
  {
    stableId: "DEMO-LD-003",
    description: "North aisle receptacle 1",
    circuit: "DEMO-CON-003",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "conductors",
    critical: false,
    remappedGridReference: "A4",
    remappedEvidence: "Demo legacy-to-current grid map, accepted",
    originalGrid: "A3",
  },
  {
    stableId: "DEMO-LD-004",
    description: "North aisle receptacle 2",
    circuit: "DEMO-CON-003",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "conductors",
    critical: false,
    originalGrid: "A6",
  },
  {
    stableId: "DEMO-LD-005",
    description: "Overhead light 1 of 4",
    circuit: "DEMO-CON-004",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "planned",
    critical: false,
    designXFt: 15,
    designYFt: 10,
    designApprovalReference: "Approved design position: demo lighting layout rev A",
  },
  {
    stableId: "DEMO-LD-006",
    description: "Overhead light 2 of 4",
    circuit: "DEMO-CON-004",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "planned",
    critical: false,
    designXFt: 45,
    designYFt: 10,
    designApprovalReference: "Approved design position: demo lighting layout rev A",
  },
  {
    stableId: "DEMO-LD-007",
    description: "Overhead light 3 of 4",
    circuit: "DEMO-CON-004",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "rough_in",
    critical: false,
    designXFt: 15,
    designYFt: 30,
    designApprovalReference: "Approved design position: demo lighting layout rev A",
    fieldGridReference: "E2",
    fieldGridEvidence: "Demo audit item 7 — as found 2 ft north of the design position",
    fieldGridObservedAt: "2026-08-21T13:40:00.000Z",
  },
  {
    stableId: "DEMO-LD-008",
    description: "Overhead light 4 of 4",
    circuit: "DEMO-CON-004",
    panel: "DEMO-PNL-BARN-MAIN",
    stage: "planned",
    critical: false,
    designXFt: 45,
    designYFt: 30,
    designApprovalReference: "Approved design position: demo lighting layout rev A",
  },
  {
    stableId: "DEMO-LD-009",
    description: "South wall receptacle",
    circuit: "DEMO-CON-005",
    panel: "DEMO-PNL-BARN-SOUTH",
    stage: "tested",
    critical: false,
    fieldGridReference: "F5",
    fieldGridEvidence: "Demo audit item 9 — south wall, between posts",
    fieldGridObservedAt: "2026-08-21T14:05:00.000Z",
    wallClassification: "SOUTH_WALL",
  },
  {
    stableId: "DEMO-LD-010",
    description: "Well pump control",
    circuit: "DEMO-CON-006",
    panel: "DEMO-PNL-BARN-SOUTH",
    logicalPanel: "DEMO-PNL-BARN-CRIT",
    stage: "complete",
    critical: true,
    fieldGridReference: "D9",
    fieldGridEvidence: "Demo audit item 10 — east wall control enclosure",
    fieldGridObservedAt: "2026-08-21T14:20:00.000Z",
    originalGrid: "D9",
  },
  {
    stableId: "DEMO-LD-011",
    description: "Exterior camera — NE corner, north face",
    circuit: "DEMO-CON-007",
    panel: "DEMO-PNL-BARN-SOUTH",
    logicalPanel: "DEMO-PNL-BARN-CRIT",
    stage: "planned",
    critical: true,
    designLocationSource: "APPROVED_DESIGN_CORNER_FACE",
    cornerReference: "NE",
    mountingWallFace: "north",
    coverageDirection: "north",
    designXFt: 60,
    designYFt: 0,
    designApprovalReference: "Approved design position: demo camera layout rev A",
  },
  {
    stableId: "DEMO-LD-012",
    description: "Exterior camera — SW corner, west face",
    circuit: "DEMO-CON-007",
    panel: "DEMO-PNL-BARN-SOUTH",
    logicalPanel: "DEMO-PNL-BARN-CRIT",
    stage: "complete",
    critical: true,
    designLocationSource: "APPROVED_DESIGN_CORNER_FACE",
    cornerReference: "SW",
    mountingWallFace: "west",
    coverageDirection: "west",
    designXFt: 0,
    designYFt: 40,
    designApprovalReference: "Approved design position: demo camera layout rev A",
    fieldGridReference: "F1",
    fieldGridEvidence:
      "Demo audit item 12 — confirmed as-built at the SW corner, west face",
    fieldGridObservedAt: "2026-08-28T16:00:00.000Z",
  },
];

export const DEMO_STAGE_PERCENT: Record<DemoStage, number> = {
  planned: 10,
  rough_in: 35,
  conductors: 55,
  tested: 90,
  complete: 100,
};

export const DEMO_STAGE_LABEL: Record<DemoStage, string> = {
  planned: "Planned",
  rough_in: "Rough-in",
  conductors: "Conductors",
  tested: "Tested",
  complete: "Complete",
};

export interface DemoResolvedLoad {
  load: DemoLoad;
  resolved: EffectiveLocation;
  provenance: string;
  /** The source the winner replaced, when the record carries more than one. */
  supersedes: string | null;
  xFt: number | null;
  yFt: number | null;
}

/** Resolve every demo load through the same shared resolver the real pages use. */
export function resolveDemoFarm(): DemoResolvedLoad[] {
  return DEMO_LOADS.map((load) => {
    const resolved = effectiveLocationForRecord(load);
    const winner = resolved.effective;
    const others = resolved.statements
      .filter((s) => s.source !== winner?.source && s.xFt != null)
      .map((s) => s.source);
    return {
      load,
      resolved,
      provenance: winner ? formatLocationProvenance(winner) : "No usable location on record",
      supersedes: others.length ? others[0]! : null,
      xFt: winner?.xFt ?? null,
      yFt: winner?.yFt ?? null,
    };
  });
}

export interface DemoPanelRollup {
  panel: DemoPanel;
  loads: number;
  circuits: number;
  averagePercent: number;
}

export function demoPanelRollups(): DemoPanelRollup[] {
  return DEMO_PANELS.map((panel) => {
    const loads =
      panel.kind === "logical"
        ? DEMO_LOADS.filter((l) => l.logicalPanel === panel.stableId)
        : DEMO_LOADS.filter((l) => l.panel === panel.stableId);
    const circuits = new Set(loads.map((l) => l.circuit)).size;
    const averagePercent = loads.length
      ? Math.round(
          loads.reduce((sum, l) => sum + DEMO_STAGE_PERCENT[l.stage], 0) / loads.length,
        )
      : 0;
    return { panel, loads: loads.length, circuits, averagePercent };
  });
}
