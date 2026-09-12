import { describe, expect, it } from "vitest";
import {
  CONTAINER_TEMPLATES,
  canAssignCompartment,
  compartmentPath,
  getContainerTemplate,
  isContainerKind,
} from "@/lib/inventory-containers";

describe("inventory container templates", () => {
  it("includes every requested container model", () => {
    expect(CONTAINER_TEMPLATES.map((template) => template.id)).toEqual([
      "ridgid_stackable_toolbox",
      "ridgid_drawer_toolbox",
      "first_aid_medical_bag",
      "first_aid_medical_case",
      "duffel_bag_kit",
      "computer_case",
      "vehicle_recovery_kit",
    ]);
  });

  it("provides addressable drawers for the RIDGID drawer box", () => {
    const template = getContainerTemplate("ridgid_drawer_toolbox");
    expect(template?.containerKind).toBe("drawer_unit");
    expect(template?.suggestedCompartments.map((row) => row.code)).toEqual(["D1","D2","D3"]);
  });

  it("provides medical, computer, and recovery layouts", () => {
    expect(getContainerTemplate("first_aid_medical_bag")?.category).toBe("medical");
    expect(getContainerTemplate("computer_case")?.category).toBe("compute");
    expect(getContainerTemplate("vehicle_recovery_kit")?.category).toBe("vehicle_recovery");
  });
});

describe("container placement helpers", () => {
  it("formats a nested, printable compartment address", () => {
    expect(compartmentPath([
      {id:"drawer",parentId:null,code:"D2"},
      {id:"bin",parentId:"drawer",code:"BIN-B"},
    ],"bin")).toBe("D2 / BIN-B");
  });

  it("rejects cyclic compartment data", () => {
    expect(() => compartmentPath([
      {id:"a",parentId:"b",code:"A"},
      {id:"b",parentId:"a",code:"B"},
    ],"a")).toThrow(/cycle/i);
  });

  it("only assigns a compartment belonging to the selected container", () => {
    expect(canAssignCompartment("box-1","box-1")).toBe(true);
    expect(canAssignCompartment("box-1","box-2")).toBe(false);
    expect(canAssignCompartment("box-1",null)).toBe(false);
  });

  it("recognizes expanded container kinds", () => {
    expect(isContainerKind("drawer_unit")).toBe(true);
    expect(isContainerKind("shipping_carton")).toBe(false);
  });
});
