import { describe, expect, it } from "vitest";
import { checkStableId } from "@/lib/electrical";
import {
  breakerRelationshipLabel,
  checkCircuitGroupId,
} from "@/lib/electrical-breaker-reference";
import { previewCsv } from "@/lib/electrical-audit-batch";

describe("shared stable-ID validator enforces circuit-group identity", () => {
  it("accepts a compliant permanent ID", () => {
    expect(checkStableId("circuit_group", "CG-FS-014").ok).toBe(true);
  });

  it("refuses a new group whose ID encodes a breaker reference", () => {
    const r = checkStableId("circuit_group", "PNL-FS-NW-B39");
    expect(r.ok).toBe(false);
    expect(checkCircuitGroupId("PNL-FS-NW-B39").ok).toBe(false);
  });

  it("refuses other malformed new IDs", () => {
    expect(checkStableId("circuit_group", "CG-14").ok).toBe(false);
    expect(checkStableId("circuit_group", "CG-FS-14A").ok).toBe(false);
  });

  it("warns instead of failing for an existing non-compliant record", () => {
    const r = checkStableId("circuit_group", "CG-14", { mode: "existing" });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeTruthy();
  });
});

describe("derived breaker relationship label", () => {
  it("formats breaker reference to circuit group with description", () => {
    expect(
      breakerRelationshipLabel({
        panel_id: "PNL-FS-NW",
        breaker_number: 39,
        circuit_group_id: "CG-FS-014",
        description: "Shop east receptacles",
      }),
    ).toBe("PNL-FS-NW-B39 → CG-FS-014 [Shop east receptacles]");
  });

  it("returns null when the relationship is not recorded", () => {
    expect(
      breakerRelationshipLabel({
        panel_id: "PNL-FS-NW",
        breaker_number: 39,
        circuit_group_id: null,
      }),
    ).toBeNull();
  });
});

describe("audit preview export", () => {
  it("carries a derived breaker_relationship column", () => {
    const csv = previewCsv([]);
    expect(csv.split("\n")[0]).toContain("breaker_relationship");
  });
});
