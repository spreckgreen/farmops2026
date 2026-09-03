import { describe, expect, it } from "vitest";
import {
  buildGridMapPoints,
  classifyCircuit,
  derivedGridLabel,
  placeLoad,
  summarizeGridMap,
  type GridMapLoadInput,
} from "@/lib/electrical-grid-map";

const base: GridMapLoadInput = {
  load_id: "FS-001",
  description: "Fiber switch",
  area: "Farm Shop",
  location: "Network Rack",
  grid: "G6",
  legacy_grid: null,
  grid_reference: null,
  location_x_ft: null,
  location_y_ft: null,
  dedicated: true,
  dedicated_shared: null,
  circuit_group_ref: null,
  amps: 1.25,
  volts: 120,
  connected_va: null,
  design_circuit_ampacity: null,
  installed_ocp_rating: null,
  minimum_circuit_ampacity: null,
  maximum_overcurrent_protection: null,
  panel: null,
  panelBasis: null,
};

describe("circuit classification", () => {
  it("treats a documented rating above 20 A as large dedicated", () => {
    expect(classifyCircuit({ ...base, installed_ocp_rating: 50 }).klass).toBe("LARGE_DEDICATED");
  });
  it("treats a documented 20 A rating as dedicated 20 A", () => {
    expect(classifyCircuit({ ...base, design_circuit_ampacity: 20 }).klass).toBe("DEDICATED_20A");
  });
  it("classifies shared rows as shared", () => {
    expect(classifyCircuit({ ...base, dedicated: false }).klass).toBe("SHARED");
    expect(classifyCircuit({ ...base, dedicated_shared: "S" }).klass).toBe("SHARED");
  });
  it("uses recorded size signals when no circuit rating exists", () => {
    expect(classifyCircuit({ ...base, amps: 30 }).klass).toBe("LARGE_DEDICATED");
    expect(classifyCircuit({ ...base, amps: 1.25 }).klass).toBe("DEDICATED_20A");
  });
  it("leaves rows with no D/S and no size unclassified", () => {
    expect(
      classifyCircuit({ ...base, dedicated: null, amps: null }).klass,
    ).toBe("UNCLASSIFIED");
  });
});

describe("placement", () => {
  it("derives feet from the legacy grid", () => {
    const p = placeLoad({ ...base, grid: "A1" });
    expect(p).toMatchObject({ xFt: 0, yFt: 0, basis: "DERIVED_FROM_LEGACY_GRID" });
    const g6 = placeLoad({ ...base, grid: "G6" });
    expect(g6.xFt).toBe(60);
    expect(g6.yFt).toBe(40);
    expect(g6.gridReference).toBe("F9");
  });
  it("keeps MOBILE and artifacts unplaced", () => {
    for (const grid of ["MOBILE", "0.00%", "NA", "?", ""]) {
      expect(placeLoad({ ...base, grid }).basis).toBe("UNPLACED");
    }
  });
  it("prefers a recorded physical position", () => {
    const p = placeLoad({ ...base, location_x_ft: 18, location_y_ft: 16 });
    expect(p.basis).toBe("RECORDED_XY");
    expect(p.gridReference).toBe("C3");
  });
  it("preserves intervals on equidistant coordinates", () => {
    expect(derivedGridLabel(12, 20)).toBe("C-D2-3");
  });
});

describe("points", () => {
  it("fans out co-located loads and counts placement", () => {
    const rows = [base, { ...base, load_id: "FS-002" }, { ...base, load_id: "FS-003", grid: "MOBILE" }];
    const pts = buildGridMapPoints(rows);
    expect(`${pts[0].xPct},${pts[0].yPct}`).not.toBe(`${pts[1].xPct},${pts[1].yPct}`);
    expect(pts[2].xPct).toBeNull();
    expect(summarizeGridMap(pts)).toMatchObject({ placed: 2, unplaced: 1, total: 3 });
  });
});
