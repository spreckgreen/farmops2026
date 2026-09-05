// DEMO-ONLY sample site data for every FarmOps feature area.
//
// Companion to demo-sample-farm.ts, which covers the electrical records. Every
// identifier here is prefixed DEMO- and nothing in this module is imported by a
// real page, server function, export or AI context. It exists so the public
// sample farm demo can show one coherent little site with clickable example data
// for each module.

export interface DemoBuilding {
  id: string;
  /** Temporary building name, largest first, exactly as the site tracer assigns. */
  code: string;
  name: string;
  widthFt: number;
  depthFt: number;
  /** Position of the north-west corner on the demo site, in feet. */
  xFt: number;
  yFt: number;
  gridCellFt: number;
  gridLabel: string;
  note: string;
}

export const DEMO_SITE_EXTENT = { widthFt: 320, depthFt: 240 } as const;

export const DEMO_BUILDINGS: DemoBuilding[] = [
  {
    id: "DEMO-BLDG-1",
    code: "BLDG-1",
    name: "Main barn",
    widthFt: 60,
    depthFt: 40,
    xFt: 30,
    yFt: 40,
    gridCellFt: 8,
    gridLabel: "A1–F9",
    note: "Traced from satellite imagery, then confirmed with a tape at two corners.",
  },
  {
    id: "DEMO-BLDG-2",
    code: "BLDG-2",
    name: "Equipment shed",
    widthFt: 48,
    depthFt: 28,
    xFt: 160,
    yFt: 36,
    gridCellFt: 8,
    gridLabel: "A1–D6",
    note: "Rectangle with a lean-to on the south side.",
  },
  {
    id: "DEMO-BLDG-3",
    code: "BLDG-3",
    name: "Farm house",
    widthFt: 42,
    depthFt: 32,
    xFt: 40,
    yFt: 140,
    gridCellFt: 6,
    gridLabel: "A1–E7",
    note: "L-shaped footprint; the back wing holds the utility room.",
  },
  {
    id: "DEMO-BLDG-4",
    code: "BLDG-4",
    name: "Boiler room",
    widthFt: 20,
    depthFt: 16,
    xFt: 150,
    yFt: 150,
    gridCellFt: 4,
    gridLabel: "A1–D5",
    note: "Small outbuilding; grid runs clockwise from the door.",
  },
  {
    id: "DEMO-BLDG-5",
    code: "BLDG-5",
    name: "Pump house",
    widthFt: 12,
    depthFt: 12,
    xFt: 230,
    yFt: 160,
    gridCellFt: 4,
    gridLabel: "A1–C3",
    note: "Well head and pressure tank only.",
  },
];

export type DemoModuleKey =
  | "electrical"
  | "maintenance"
  | "inventory"
  | "food"
  | "procedures"
  | "security";

export interface DemoRecord {
  id: string;
  title: string;
  buildingId: string;
  /** Location inside that building, as a derived grid reference. */
  grid: string;
  status: string;
  /** Short status wording used to colour the badge. */
  tone: "ok" | "due" | "attention" | "planned";
  detail: string[];
}

export const DEMO_MAINTENANCE: DemoRecord[] = [
  {
    id: "DEMO-AST-001",
    title: "Compact tractor — 38 hp",
    buildingId: "DEMO-BLDG-2",
    grid: "B3",
    status: "Service due in 12 hours",
    tone: "due",
    detail: [
      "Meter reading 1,188 h, recorded 2026-08-30",
      "Next service: engine oil and filter at 1,200 h",
      "Last service 2026-05-11 at 1,050 h, oil and both fuel filters",
      "Parts on the shelf: 1 oil filter, 2 fuel filters",
    ],
  },
  {
    id: "DEMO-AST-002",
    title: "Skid loader",
    buildingId: "DEMO-BLDG-2",
    grid: "C5",
    status: "In service",
    tone: "ok",
    detail: [
      "Meter reading 642 h, recorded 2026-08-28",
      "Next service: hydraulic filter at 700 h",
      "Open note: left lift cylinder seeping, watch it",
    ],
  },
  {
    id: "DEMO-AST-003",
    title: "Outdoor wood boiler",
    buildingId: "DEMO-BLDG-4",
    grid: "B2",
    status: "Work order open",
    tone: "attention",
    detail: [
      "Work order DEMO-WO-014 — circulator pump noisy on start-up",
      "Raised 2026-09-01 by the morning walk-through",
      "Waiting on: replacement pump, ordered, not received",
      "Linked procedure: DEMO-PRC-003 boiler shutdown and drain",
    ],
  },
  {
    id: "DEMO-AST-004",
    title: "Well pump and pressure tank",
    buildingId: "DEMO-BLDG-5",
    grid: "A2",
    status: "In service",
    tone: "ok",
    detail: [
      "Pressure cut-in 40 psi, cut-out 60 psi, checked 2026-08-15",
      "Annual task: tank pre-charge check each March",
      "Powered from the south subpanel, well pump control circuit",
    ],
  },
  {
    id: "DEMO-AST-005",
    title: "Feed room water heater",
    buildingId: "DEMO-BLDG-1",
    grid: "B2",
    status: "In service",
    tone: "ok",
    detail: [
      "40 gal, 240 V, on its own 40 A circuit",
      "Anode rod inspection due 2027-02",
      "Same item appears in Electrical as DEMO-LD-001",
    ],
  },
];

export const DEMO_INVENTORY: DemoRecord[] = [
  {
    id: "DEMO-INV-001",
    title: "Engine oil 15W-40 — 5 gal pail",
    buildingId: "DEMO-BLDG-2",
    grid: "A1",
    status: "2 on hand",
    tone: "ok",
    detail: [
      "Shelf: north wall rack, bay 1",
      "Used by: tractor 200 h service, skid loader 250 h service",
      "Reorder point 1 pail",
    ],
  },
  {
    id: "DEMO-INV-002",
    title: "Fuel filter — tractor primary",
    buildingId: "DEMO-BLDG-2",
    grid: "A2",
    status: "Below reorder point",
    tone: "due",
    detail: [
      "1 on hand, reorder point 2",
      "Fits DEMO-AST-001 only",
      "Last purchase 2026-04-02, two units",
    ],
  },
  {
    id: "DEMO-INV-003",
    title: "20 A single-pole breaker",
    buildingId: "DEMO-BLDG-1",
    grid: "A9",
    status: "6 on hand",
    tone: "ok",
    detail: [
      "Kept in the electrical bin beside the barn main panel",
      "Matches the barn main and south subpanel",
    ],
  },
  {
    id: "DEMO-INV-004",
    title: "Circulator pump — boiler loop",
    buildingId: "DEMO-BLDG-4",
    grid: "C3",
    status: "On order",
    tone: "attention",
    detail: [
      "0 on hand, 1 ordered 2026-09-01",
      "Held for work order DEMO-WO-014",
    ],
  },
  {
    id: "DEMO-INV-005",
    title: "Garden seed — bush beans",
    buildingId: "DEMO-BLDG-3",
    grid: "D2",
    status: "1 lb on hand",
    tone: "ok",
    detail: ["Stored in the utility room cabinet", "Packed for the 2026 season"],
  },
];

export const DEMO_FOOD: DemoRecord[] = [
  {
    id: "DEMO-GRD-001",
    title: "Bush beans — row 3",
    buildingId: "DEMO-BLDG-3",
    grid: "outside, east plot",
    status: "Harvesting",
    tone: "ok",
    detail: [
      "Sown 2026-06-02, first pick 2026-08-04",
      "Picked to date 41 lb",
      "Seed from DEMO-INV-005",
    ],
  },
  {
    id: "DEMO-GRD-002",
    title: "Roma tomatoes — 24 plants",
    buildingId: "DEMO-BLDG-3",
    grid: "outside, east plot",
    status: "Harvesting",
    tone: "ok",
    detail: ["Transplanted 2026-05-24", "Picked to date 96 lb", "Canned 34 quarts"],
  },
  {
    id: "DEMO-GRD-003",
    title: "Fall garlic bed",
    buildingId: "DEMO-BLDG-3",
    grid: "outside, north plot",
    status: "Planting planned",
    tone: "planned",
    detail: ["Plant window 2026-10-10 to 2026-10-25", "180 cloves saved from July harvest"],
  },
  {
    id: "DEMO-GRD-004",
    title: "Canning shelf count",
    buildingId: "DEMO-BLDG-3",
    grid: "B5",
    status: "142 jars",
    tone: "ok",
    detail: [
      "Tomatoes 34 qt, beans 28 qt, pickles 22 qt, jam 58 pt",
      "Counted 2026-09-01",
    ],
  },
];

export const DEMO_PROCEDURES: DemoRecord[] = [
  {
    id: "DEMO-PRC-001",
    title: "Morning walk-through",
    buildingId: "DEMO-BLDG-1",
    grid: "whole site",
    status: "Daily",
    tone: "ok",
    detail: [
      "8 checks: water, feed, boiler pressure, pump pressure, camera tiles, doors, fuel, lights",
      "Last run 2026-09-05, raised 1 note",
      "Free with every FarmOps account",
    ],
  },
  {
    id: "DEMO-PRC-002",
    title: "Tractor 200-hour service",
    buildingId: "DEMO-BLDG-2",
    grid: "B3",
    status: "Ready to run",
    tone: "due",
    detail: [
      "11 steps, parts kit: 1 oil filter, 2 fuel filters, 8 qt 15W-40",
      "Draws the parts straight from Inventory",
      "Triggered by DEMO-AST-001 reaching 1,200 h",
    ],
  },
  {
    id: "DEMO-PRC-003",
    title: "Boiler shutdown and drain",
    buildingId: "DEMO-BLDG-4",
    grid: "B2",
    status: "Attached to work order",
    tone: "attention",
    detail: [
      "9 steps with two lock-out points",
      "Called out by DEMO-WO-014 before the pump swap",
    ],
  },
  {
    id: "DEMO-PRC-004",
    title: "Well pressure tank pre-charge check",
    buildingId: "DEMO-BLDG-5",
    grid: "A2",
    status: "Annual — next March",
    tone: "planned",
    detail: ["6 steps", "Records the measured pre-charge each year for comparison"],
  },
];

export const DEMO_SECURITY: DemoRecord[] = [
  {
    id: "DEMO-CAM-001",
    title: "Barn NE corner, north face",
    buildingId: "DEMO-BLDG-1",
    grid: "NE corner",
    status: "Online",
    tone: "ok",
    detail: [
      "Field of view 140°, useful range 25 ft",
      "Powered from the exterior camera circuit",
      "Last state check 2 minutes ago",
    ],
  },
  {
    id: "DEMO-CAM-002",
    title: "Barn SW corner, west face",
    buildingId: "DEMO-BLDG-1",
    grid: "SW corner",
    status: "Online",
    tone: "ok",
    detail: ["Field of view 140°, useful range 25 ft", "Confirmed as-built at the corner"],
  },
  {
    id: "DEMO-CAM-003",
    title: "Shed door",
    buildingId: "DEMO-BLDG-2",
    grid: "south face",
    status: "Offline",
    tone: "attention",
    detail: [
      "Last seen online 2026-09-04 19:40",
      "Feed address answers, no video — check the bridge stream name",
    ],
  },
  {
    id: "DEMO-CAM-004",
    title: "House drive, south face",
    buildingId: "DEMO-BLDG-3",
    grid: "south face",
    status: "Online",
    tone: "ok",
    detail: ["Field of view 155°, useful range 30 ft", "Shares the south side with DEMO-CAM-005"],
  },
  {
    id: "DEMO-CAM-005",
    title: "House walk, south face",
    buildingId: "DEMO-BLDG-3",
    grid: "south face",
    status: "Online",
    tone: "ok",
    detail: [
      "Aimed 30° west of DEMO-CAM-004 so the two cover the drive and the walk",
      "Overlap is expected on this side",
    ],
  },
  {
    id: "DEMO-CAM-006",
    title: "Pump house",
    buildingId: "DEMO-BLDG-5",
    grid: "east face",
    status: "No address yet",
    tone: "planned",
    detail: [
      "Placed by compass side only — no measured position recorded",
      "Waiting on a bridge stream address before it can report a state",
    ],
  },
];

export interface DemoModule {
  key: DemoModuleKey;
  label: string;
  blurb: string;
  /** Where the real, signed-in module lives. */
  to: string;
  records: DemoRecord[];
}

export const DEMO_MODULES: DemoModule[] = [
  {
    key: "maintenance",
    label: "Maintenance",
    blurb:
      "Every machine with its meter reading, what is due next, and the open work orders against it.",
    to: "/demo/maintenance",
    records: DEMO_MAINTENANCE,
  },
  {
    key: "inventory",
    label: "Inventory",
    blurb: "Parts and supplies with counts, shelf locations, and what each one fits.",
    to: "/demo/inventory",
    records: DEMO_INVENTORY,
  },
  {
    key: "food",
    label: "Food & garden",
    blurb: "Plantings, harvest weights and the canning shelf, season by season.",
    to: "/demo/food",
    records: DEMO_FOOD,
  },
  {
    key: "procedures",
    label: "Procedures",
    blurb: "Step-by-step jobs with their parts kits and lock-out points. Free forever.",
    to: "/demo/procedures",
    records: DEMO_PROCEDURES,
  },
  {
    key: "security",
    label: "Security",
    blurb: "Cameras with their aim, coverage and current on-or-off state.",
    to: "/demo/security",
    records: DEMO_SECURITY,
  },
];

export const DEMO_ALL_RECORDS: DemoRecord[] = DEMO_MODULES.flatMap((m) => m.records);

/** How many example records each building carries, per module. */
export function demoBuildingCounts(buildingId: string): Record<DemoModuleKey, number> {
  const counts = {
    electrical: 0,
    maintenance: 0,
    inventory: 0,
    food: 0,
    procedures: 0,
    security: 0,
  } as Record<DemoModuleKey, number>;
  for (const m of DEMO_MODULES) {
    counts[m.key] = m.records.filter((r) => r.buildingId === buildingId).length;
  }
  return counts;
}
