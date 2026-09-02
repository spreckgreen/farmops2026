import { describe, expect, it } from "vitest";
import {
  coverageStatus,
  largeLoadReasons,
  nameplateSearchHint,
  scanNameplateCoverage,
  summarizeCoverage,
  type NameplateCoverageInput,
} from "@/lib/electrical-nameplate-coverage";

function load(over: Partial<NameplateCoverageInput> = {}): NameplateCoverageInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    load_id: "LD-001",
    description: "Mini split — shop",
    location: "Shop",
    area: null,
    volts: "240",
    amps: null,
    connected_va: null,
    equipment_model: null,
    dedicated: null,
    equipment_fla: null,
    minimum_circuit_ampacity: null,
    maximum_overcurrent_protection: null,
    nameplate_manufacturer: null,
    nameplate_model: null,
    nameplate_serial: null,
    nameplate_volts: null,
    nameplate_phase: null,
    nameplate_fla_rla: null,
    nameplate_mca: null,
    nameplate_mocp: null,
    nameplate_source: null,
    nameplate_captured_at: null,
    ...over,
  };
}

describe("large-load selection", () => {
  it("skips small loads", () => {
    expect(largeLoadReasons(load({ connected_va: 180, amps: 1.5 }))).toEqual([]);
  });

  it("picks up VA, amps, MCA, MOCP and dedicated circuits", () => {
    expect(largeLoadReasons(load({ connected_va: 4800 }))[0]).toBe("4800 VA connected");
    expect(largeLoadReasons(load({ amps: "20" }))[0]).toBe("20 A");
    expect(largeLoadReasons(load({ minimum_circuit_ampacity: 15 }))[0]).toBe("MCA 15 A");
    expect(largeLoadReasons(load({ maximum_overcurrent_protection: 30 }))[0]).toBe(
      "MOCP 30 A",
    );
    expect(largeLoadReasons(load({ dedicated: true }))).toContain("dedicated circuit");
  });
});

describe("coverage status", () => {
  it("is missing with no nameplate fields", () => {
    const c = coverageStatus(load());
    expect(c.status).toBe("missing");
    expect(c.missing).toContain("Manufacturer");
  });

  it("is partial with identity only", () => {
    expect(coverageStatus(load({ nameplate_model: "SUZ-KA18NAHZ" })).status).toBe("partial");
  });

  it("needs identity plus a rating to be recorded", () => {
    const core = {
      nameplate_manufacturer: "Mitsubishi",
      nameplate_model: "SUZ-KA18NAHZ",
      nameplate_volts: "208-230",
    };
    expect(coverageStatus(load(core)).status).toBe("partial");
    expect(coverageStatus(load({ ...core, nameplate_mca: "15" })).status).toBe("recorded");
  });
});

describe("search hint", () => {
  it("prefers recorded nameplate identity, falls back to equipment model", () => {
    expect(
      nameplateSearchHint(
        load({ nameplate_manufacturer: "Bryant", nameplate_model: "FS-082" }),
      ),
    ).toBe("Bryant FS-082");
    expect(nameplateSearchHint(load({ equipment_model: "Z421KWT" }))).toBe("Z421KWT");
    expect(nameplateSearchHint(load())).toBeNull();
  });
});

describe("scan", () => {
  it("orders gaps first and summarises", () => {
    const items = scanNameplateCoverage([
      load({
        id: "22222222-2222-4222-8222-222222222222",
        load_id: "LD-002",
        connected_va: 2400,
        nameplate_manufacturer: "Mitsubishi",
        nameplate_model: "M1",
        nameplate_volts: "240",
        nameplate_mca: "15",
      }),
      load({ load_id: "LD-001", connected_va: 4800, equipment_model: "Z421KWT" }),
      load({ id: "33333333-3333-4333-8333-333333333333", load_id: "LD-003", amps: 2 }),
    ]);
    expect(items.map((i) => i.ref)).toEqual(["LD-001", "LD-002"]);
    expect(items[0]!.status).toBe("missing");
    expect(items[0]!.searchable).toBe(true);
    expect(summarizeCoverage(items)).toEqual({
      total: 2,
      recorded: 1,
      partial: 0,
      missing: 1,
      searchable: 1,
    });
  });
});
