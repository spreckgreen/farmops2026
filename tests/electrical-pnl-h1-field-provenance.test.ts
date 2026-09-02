import { describe, expect, it } from "vitest";
import {
  ESTABLISHED_ADJUDICATIONS,
  CLOSED_DISPOSITIONS,
  UNRESOLVED_DISPOSITIONS,
  adjudicationsFor,
} from "@/lib/electrical-convergence";
import {
  PNL_H1_LABEL_OBSERVATION,
  PNL_H1_VERIFIED_FIELDS,
  isPnlH1LabelVerifiedField,
  pnlH1PreservedFacts,
} from "@/lib/electrical-pnl-h1-field-provenance";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";

const SHA = "89da43c7f1f94948e17ecfdc942dbdba022cfee5ba504b70865529cf39877388";

describe("PNL-H1 Category-D field provenance adjudication", () => {
  it("records the observed Siemens label facts verbatim", () => {
    expect(PNL_H1_LABEL_OBSERVATION).toMatchObject({
      manufacturer: "Siemens",
      equipment: "Indoor Load Center",
      catalog_model: "PN4040B1200CU",
      bus_rating_amps: 200,
      spaces: 40,
      provenance_kind: "OWNER_SUPPLIED_INSTALLED_EQUIPMENT_MANUFACTURER_LABEL_PHOTOGRAPH",
    });
  });

  it("covers exactly the two findings, without changing either value", () => {
    expect(PNL_H1_VERIFIED_FIELDS.map((f) => f.field)).toEqual(["bus_rating_amps", "spaces"]);
    expect(PNL_H1_VERIFIED_FIELDS.map((f) => f.farmops_value)).toEqual([200, 40]);
    expect(isPnlH1LabelVerifiedField("PNL-H1", "bus_rating_amps")).toBe(true);
    expect(isPnlH1LabelVerifiedField("PNL-H1", "voltage")).toBe(false);
    expect(isPnlH1LabelVerifiedField("PNL-H2", "spaces")).toBe(false);
  });

  it("adjudicates both as FARMOPS_AS_BUILT_VALUE_VERIFIED, SHA-bound to the 4.4a baseline", () => {
    expect(PHASE_44A_BASELINE_SHA256).toBe(SHA);
    for (const field of ["bus_rating_amps", "spaces"]) {
      const hits = adjudicationsFor("PNL-H1", field);
      expect(hits).toHaveLength(1);
      const a = hits[0]!;
      expect(a.disposition).toBe("FARMOPS_AS_BUILT_VALUE_VERIFIED");
      expect(a.classification).toBe("FARMOPS_AS_BUILT_VALUE_VERIFIED");
      expect(a.category).toBe("D");
      expect(a.ods_sha256).toBe(SHA);
      expect(a.write_authorized).toBe(false);
      expect(a.rationale).toMatch(/not a canonical ODS correction/);
      expect(a.rationale).toMatch(/verified, not corrected/);
    }
  });

  it("resolves for Phase 4.5 without becoming a canonical correction", () => {
    expect(CLOSED_DISPOSITIONS.has("FARMOPS_AS_BUILT_VALUE_VERIFIED")).toBe(true);
    expect(UNRESOLVED_DISPOSITIONS.has("FARMOPS_AS_BUILT_VALUE_VERIFIED")).toBe(false);
    const ids = ESTABLISHED_ADJUDICATIONS.filter((a) => a.stable_id === "PNL-H1").map((a) => a.id);
    expect(ids).toEqual([
      "pnl-h1-label-verified-bus_rating_amps",
      "pnl-h1-label-verified-spaces",
    ]);
    // No PNL-H1 entry may ask for a canonical ODS correction.
    expect(
      ESTABLISHED_ADJUDICATIONS.filter(
        (a) => a.stable_id === "PNL-H1" && a.disposition === "CANONICAL_ODS_CORRECTION_REQUIRED",
      ),
    ).toHaveLength(0);
  });

  it("preserves both source states and the label provenance", () => {
    const facts = pnlH1PreservedFacts("spaces");
    expect(facts).toContain("ODS observed: blank (no canonical statement)");
    expect(facts.join("\n")).toMatch(/FarmOps as-built \(verified, unchanged\): 40/);
    expect(facts.join("\n")).toMatch(/PN4040B1200CU/);
    expect(facts.join("\n")).toMatch(/remain blank and unmodified/);
  });
});
