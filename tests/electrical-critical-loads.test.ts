import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  booleanFlagUsable,
  nextSize,
  sizeCriticalPanel,
  PANEL_BUS_SIZES,
  type MasterLoadRow,
} from "@/lib/electrical-critical-loads";

const row = (over: Partial<MasterLoadRow>): MasterLoadRow => ({
  load_id: "FS-001",
  description: "Load",
  area: "Farm Shop",
  grid: "G1",
  count: 1,
  volts: 120,
  amps: 1,
  connected_va: 120,
  demand_va: null,
  phase: null,
  critical: true,
  future: true,
  continuous_load: true,
  backup_eligible: true,
  backup_priority: "TBD",
  backup_panel: "TBD",
  load_shed_group: "TBD",
  suggested_panel: null,
  install_status: "planned",
  notes: null,
  ...over,
});

describe("critical load study", () => {
  it("treats an all-true boolean column as unusable evidence", () => {
    const rows = [row({}), row({ load_id: "FS-002" })];
    expect(booleanFlagUsable(rows, "critical")).toBe(false);
    expect(booleanFlagUsable([row({}), row({ load_id: "X", critical: false })], "critical")).toBe(
      true,
    );
  });

  it("classifies candidates from recorded text and defaults tiers 1-4 on", () => {
    const { candidates } = buildCandidates([
      row({ load_id: "FS-101", description: "Well pump" }),
      row({ load_id: "FS-102", description: "Chest freezer" }),
      row({ load_id: "FS-103", description: "Fiber switch" }),
      row({ load_id: "FS-104", description: "Mini Split SE" }),
      row({ load_id: "FS-105", description: "Double Gang plugs every 6' in lower shop" }),
    ]);
    const tier = (id: string) => candidates.find((c) => c.load_id === id)!;
    expect(tier("FS-101").tier).toBe("T1_water_heat");
    expect(tier("FS-102").tier).toBe("T2_food_preservation");
    expect(tier("FS-103").tier).toBe("T3_comms_security");
    expect(tier("FS-104").tier).toBe("T5_comfort_hvac");
    expect(tier("FS-105").tier).toBe("not_critical");
    expect(tier("FS-101").selectedByDefault).toBe(true);
    expect(tier("FS-105").selectedByDefault).toBe(false);
  });

  it("uses volts × amps only when connected VA is absent and honours quantity", () => {
    const { candidates } = buildCandidates([
      row({ load_id: "FS-200", connected_va: null, volts: 240, amps: 10, count: 2 }),
    ]);
    expect(candidates[0].va).toBe(4800);
  });

  it("reports missing engineering values as gaps instead of filling them", () => {
    const { candidates } = buildCandidates([
      row({ load_id: "FS-300", connected_va: null, volts: null, amps: null }),
    ]);
    expect(candidates[0].va).toBeNull();
    expect(candidates[0].gaps.join(" ")).toMatch(/no recorded voltage/);
  });

  it("applies 125% to continuous load and picks the next standard bus size", () => {
    const { candidates } = buildCandidates([
      row({ load_id: "FS-401", description: "Fiber switch", connected_va: 12000 }),
      row({ load_id: "FS-402", description: "Garage Door W", connected_va: 12000 }),
    ]);
    const sizing = sizeCriticalPanel(candidates);
    expect(sizing.continuousVa).toBe(12000);
    expect(sizing.demandVa).toBe(27000);
    expect(sizing.demandAmps240).toBe(112.5);
    expect(sizing.recommendedBusAmps).toBe(125);
  });

  it("lets motor starting govern the generator recommendation", () => {
    const { candidates } = buildCandidates([
      row({ load_id: "FS-501", description: "Well pump", connected_va: 6000 }),
    ]);
    const sizing = sizeCriticalPanel(candidates);
    expect(sizing.largestMotor?.load_id).toBe("FS-501");
    expect(sizing.startingKva).toBe(18);
    expect(sizing.drivenBy).toBe("motor_starting");
    expect(sizing.recommendedGeneratorKw).toBe(18);
  });

  it("returns null when the requirement exceeds the largest listed size", () => {
    expect(nextSize(999, PANEL_BUS_SIZES)).toBeNull();
  });
});
