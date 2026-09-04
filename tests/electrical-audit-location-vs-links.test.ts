import { describe, expect, it } from "vitest";
import {
  LOCATION_DOES_NOT_SUPPRESS_LINKS_RULE,
  classifyItem,
  type AuditBatchItemInput,
} from "@/lib/electrical-audit-batch";

const loadRow = {
  id: "11111111-1111-4111-8111-111111111111",
  load_id: "FS-044",
  circuit_group_uuid: null,
  updated_at: "2026-09-03T00:00:00Z",
};

function item(over: Partial<AuditBatchItemInput> = {}): AuditBatchItemInput {
  return {
    item_key: "fs-044-b37",
    entity_kind: "load",
    target_stable_id: "FS-044",
    observation_class: "AS_BUILT",
    evidence: "FA-FS-2026-09-03-PM walkaround",
    refs: { circuit_group_ref: "CG-FS-101" },
    ...over,
  } as AuditBatchItemInput;
}

const ctx = {
  target: loadRow,
  resolved: new Map([["circuit_group|CG-FS-101", "22222222-2222-4222-8222-222222222222"]]),
};

describe("location incompleteness never suppresses a known link", () => {
  it("keeps the FS-044 → B37 circuit link when the grid reference is invalid", () => {
    const r = classifyItem(item({ field_grid_reference: "ZZ99" }), ctx);
    expect(r.disposition).toBe("ready");
    expect(r.operation).toBe("LINK");
    expect(Object.keys(r.patch)).toContain("circuit_group_uuid");
    expect(Object.keys(r.patch)).not.toContain("field_grid_reference");
    expect(r.messages.some((m) => m.text.includes(LOCATION_DOES_NOT_SUPPRESS_LINKS_RULE))).toBe(true);
  });

  it("keeps the link when an incomplete post callout fails validation", () => {
    const r = classifyItem(
      item({ pole: { pole_scheme: "FS_POLE_GRID_V1", pole_location_kind: "BETWEEN_POSTS", pole_ref_start: "01NE" } as never }),
      ctx,
    );
    expect(r.disposition).toBe("ready");
    expect(Object.keys(r.patch)).toEqual(["circuit_group_uuid"]);
  });

  it("still holds when the failure is not location-scoped", () => {
    const r = classifyItem(item({ install_state: "NOT_A_STATE" as never }), ctx);
    expect(r.disposition).toBe("hold");
  });

  it("still holds a location-only item that proposes no relationship", () => {
    const r = classifyItem(
      { ...item(), refs: undefined, field_grid_reference: "ZZ99" } as AuditBatchItemInput,
      ctx,
    );
    expect(r.disposition).toBe("hold");
  });
});
