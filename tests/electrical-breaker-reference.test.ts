import { describe, expect, it } from "vitest";
import {
  breakerReference,
  breakerRelationshipLabel,
  checkCircuitGroupId,
} from "@/lib/electrical-breaker-reference";
import { BUILT_IN_STANDARDS, STABLE_ID_REFERENCE } from "@/lib/electrical-standards";

describe("derived breaker reference", () => {
  it("formats PNL-<panel>-B<breaker number>", () => {
    expect(breakerReference("PNL-FS-NW", 39)).toBe("PNL-FS-NW-B39");
    expect(breakerReference("pnl-fs-ne", "7")).toBe("PNL-FS-NE-B7");
  });

  it("never invents a partial reference", () => {
    expect(breakerReference("PNL-FS-NW", null)).toBeNull();
    expect(breakerReference(null, 39)).toBeNull();
    expect(breakerReference("PNL-FS-NW", 0)).toBeNull();
    expect(breakerReference("PNL-FS-NW", "L3")).toBeNull();
  });

  it("renders the relationship display form", () => {
    expect(
      breakerRelationshipLabel({
        panel_id: "PNL-FS-NW",
        breaker_number: 39,
        circuit_group_id: "CG-FS-014",
        description: "Shop east receptacles",
      }),
    ).toBe("PNL-FS-NW-B39 → CG-FS-014 [Shop east receptacles]");
    expect(
      breakerRelationshipLabel({ panel_id: "PNL-FS-NW", breaker_number: 39, circuit_group_id: "CG-FS-014" }),
    ).toBe("PNL-FS-NW-B39 → CG-FS-014");
  });

  it("keeps circuit group IDs independent of breaker assignment", () => {
    expect(checkCircuitGroupId("CG-FS-014").ok).toBe(true);
    const bad = checkCircuitGroupId("CG-FS-014-B39");
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("never contain a breaker reference");
  });

  it("documents both conventions in the standards", () => {
    const entry = BUILT_IN_STANDARDS.find((s) => s.key === "breaker_reference");
    expect(entry?.body).toContain("PNL-FS-NW-B39");
    expect(entry?.body).toContain("circuit_group_uuid");
    expect(STABLE_ID_REFERENCE.some((r) => r.format === "CG-<site>-<sequence>")).toBe(true);
  });
});
