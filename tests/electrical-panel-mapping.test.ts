import { describe, it, expect } from "vitest";
import { classifySheet, mapSheet } from "@/lib/electrical-ods";
import { ENTITIES, coerceValue, importColumns } from "@/lib/electrical-entities";

const panelTargets = importColumns("panel");
const field = (key: string) =>
  ENTITIES.panel.fields.find((f) => f.key === key)!;

const sheet = {
  name: "Panels",
  rows: [
    ["Premo Farm — Panel Schedule", "", "", "", "", "", "", "", "", ""],
    [
      "Panel ID",
      "Panel Description",
      "Bldg",
      "Grid Ref",
      "Bus Rating (A)",
      "Voltage (V)",
      "Phase",
      "Spaces",
      "Circuits",
      "Fed From",
    ],
    [
      "PNL-FS-CRIT",
      "Farm Shop critical loads",
      "Farm Shop",
      "A6",
      "200 A",
      "120/240V",
      "1Ph 3W",
      "30",
      "24",
      "PNL-FS-NE",
    ],
  ],
};

describe("ODS Panels column mapping", () => {
  it("classifies the Panels sheet", () => {
    expect(classifySheet(sheet)).toBe("panel");
  });

  it("binds every canonical panel column", () => {
    const mapped = mapSheet(sheet, "panel", panelTargets, "panel_id");
    const bound = Object.fromEntries(
      mapped.columns.filter((c) => c.target).map((c) => [c.source, c.target]),
    );
    expect(bound).toEqual({
      "Panel ID": "panel_id",
      "Panel Description": "description",
      Bldg: "building",
      "Grid Ref": "grid",
      "Bus Rating (A)": "bus_rating_amps",
      "Voltage (V)": "voltage",
      Phase: "phase",
      Spaces: "spaces",
      Circuits: "circuits",
      "Fed From": "feeder_source",
    });
    expect(mapped.rows).toHaveLength(1);
    expect(mapped.rows[0].values).toMatchObject({
      panel_id: "PNL-FS-CRIT",
      description: "Farm Shop critical loads",
      building: "Farm Shop",
      grid: "A6",
      bus_rating_amps: "200 A",
      voltage: "120/240V",
      phase: "1Ph 3W",
      spaces: "30",
      circuits: "24",
      feeder_source: "PNL-FS-NE",
    });
  });

  it("coerces engineering numbers with units", () => {
    expect(coerceValue(field("bus_rating_amps"), "200 A")).toBe(200);
    expect(coerceValue(field("voltage"), "120/240V")).toBe(240);
    expect(coerceValue(field("spaces"), "30")).toBe(30);
    expect(coerceValue(field("circuits"), "24 ckts")).toBe(24);
    expect(coerceValue(field("bus_rating_amps"), "")).toBeNull();
    expect(coerceValue(field("bus_rating_amps"), "n/a")).toBeNull();
  });

  it("keeps raceway header meanings intact", () => {
    const raceway = {
      name: "Conduit_Runs",
      rows: [
        ["Conduit ID", "From", "To", "Purpose", "Trade Size"],
        ["CON-030", "Farm Shop", "Pump House", "Power", '1"'],
      ],
    };
    const mapped = mapSheet(raceway, "raceway", importColumns("raceway"), "conduit_id");
    expect(mapped.rows[0].values).toMatchObject({
      conduit_id: "CON-030",
      from_label: "Farm Shop",
      to_label: "Pump House",
      purpose: "Power",
      trade_size: '1"',
    });
  });
});
