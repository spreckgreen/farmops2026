import { describe, expect, it } from "vitest";
import {
  satisfyingCircuitGroup,
  type PermanentCircuitGroup,
} from "@/lib/electrical-hold-reconciliation";

const groups: PermanentCircuitGroup[] = [
  { circuit_group_id: "CG-FS-007", panel_id: "PNL-FS-NW", breaker_number: 29, description: "E" },
  { circuit_group_id: "CG-FS-006", panel_id: "PNL-FS-NW", breaker_number: 31, description: "D" },
];

const held = {
  item_key: "circuit-nw-29-membership",
  entity_kind: "circuit_group",
  panel_ref: "PNL-FS-NW",
  breaker_number: 29,
  observed_label: "E",
};

describe("stale circuit-group membership holds", () => {
  it("is satisfied by the permanent group on the same panel/breaker/label", () => {
    expect(satisfyingCircuitGroup(held, groups)?.circuit_group_id).toBe("CG-FS-007");
  });

  it("stays held when the breaker position differs", () => {
    expect(satisfyingCircuitGroup({ ...held, breaker_number: 41 }, groups)).toBeNull();
  });

  it("stays held when the label differs", () => {
    expect(satisfyingCircuitGroup({ ...held, observed_label: "F" }, groups)).toBeNull();
  });

  it("stays held without a panel reference or breaker number", () => {
    expect(satisfyingCircuitGroup({ ...held, panel_ref: null }, groups)).toBeNull();
    expect(satisfyingCircuitGroup({ ...held, breaker_number: null }, groups)).toBeNull();
  });

  it("never resolves non circuit-group holds", () => {
    expect(satisfyingCircuitGroup({ ...held, entity_kind: "load" }, groups)).toBeNull();
  });

  it("treats an ambiguous match as unresolved", () => {
    const dup = [...groups, { ...groups[0]!, circuit_group_id: "CG-FS-099" }];
    expect(satisfyingCircuitGroup(held, dup)).toBeNull();
  });
});
