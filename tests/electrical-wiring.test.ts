import { describe, expect, it } from "vitest";
import { buildWiringSchedule, filterWiringSchedule } from "@/lib/electrical-wiring";

const panels = [{ id: "p1", panel_id: "PNL-FS-NE", building: "Farm Shop", spaces: 42 }];
const circuits = [
  { id: "c1", circuit_group_id: "CKT-101", panel_uuid: "p1", description: "Mini split SE", circuit_rating_amps: 20 },
  { id: "c2", circuit_group_id: "CKT-102", panel_uuid: "p1", description: "Unslotted circuit" },
];
const loads = [
  { id: "l1", load_id: "FS-082", description: "Mini Split SE", area: "Farm Shop", circuit_group_uuid: "c1", connected_va: 14400 },
  { id: "l2", load_id: "FS-084", description: "Mini Split W", area: "Farm Shop", suggested_panel: "PNL-FS-NE" },
  { id: "l3", load_id: "BL-001", description: "Recirculating Pump", area: "Boiler" },
];
const positions = [
  { id: "b1", panel_uuid: "p1", side: "Left", position: 1, breaker_number: 1, poles: 2, ocp_amps: 30, circuit_group_uuid: "c1" },
  { id: "b2", panel_uuid: "p1", side: "Right", position: 2, breaker_number: 2, poles: 1 },
];

describe("buildWiringSchedule", () => {
  const schedule = buildWiringSchedule({ panels, circuitGroups: circuits, loads, positions });
  const panel = schedule.panels[0]!;

  it("lists real breaker positions with their circuit and connected loads", () => {
    const wired = panel.slots.find((s) => s.breakerNumber === "1")!;
    expect(wired.side).toBe("Left");
    expect(wired.ocpAmps).toBe("30");
    expect(wired.poles).toBe(2);
    expect(wired.circuitId).toBe("CKT-101");
    expect(wired.label).toBe("Mini split SE");
    expect(wired.loads.map((l) => l.id)).toEqual(["FS-082"]);
    expect(wired.state).toBe("wired");
  });

  it("marks an empty breaker as a gap instead of guessing", () => {
    const empty = panel.slots.find((s) => s.breakerNumber === "2")!;
    expect(empty.state).toBe("empty");
    expect(empty.circuitId).toBe("NOT IN RECORD");
    expect(empty.gaps).toContain("no circuit group linked to this breaker (circuit_group_uuid)");
    expect(empty.gaps).toContain("no load connected to this breaker");
  });

  it("reports circuits without a breaker position and loads expected but unwired", () => {
    expect(panel.circuitsWithoutSlot.map((c) => c.id)).toEqual(["CKT-102"]);
    expect(panel.expectedLoads.map((l) => l.id)).toEqual(["FS-084"]);
    expect(panel.gaps.some((g) => g.includes("no breaker position recorded"))).toBe(true);
  });

  it("counts wired vs unwired loads honestly", () => {
    expect(schedule.totals.wiredLoads).toBe(1);
    expect(schedule.totals.unwiredLoads).toBe(2);
    expect(schedule.unwiredLoads.map((l) => l.id)).toEqual(["BL-001", "FS-084"]);
  });

  it("shows an empty schedule when no breaker positions exist", () => {
    const empty = buildWiringSchedule({ panels, circuitGroups: [], loads, positions: [] });
    expect(empty.totals.slots).toBe(0);
    expect(empty.panels[0]!.gaps[0]).toContain("no breaker positions recorded");
  });

  it("filters by load description", () => {
    const filtered = filterWiringSchedule(schedule, "mini split");
    expect(filtered.panels[0]!.slots.map((s) => s.breakerNumber)).toEqual(["1"]);
  });
});
