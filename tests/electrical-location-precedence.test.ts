// Location precedence: an applied field audit is the highest authority for every
// attribute it verified, even when no measured X/Y exists.
import { describe, expect, it } from "vitest";
import {
  buildOperationalAssets,
  fieldVerifiedLocationNotice,
  summarizeOperational,
  DEPLOYMENT_SCOPE_NOTICE,
  type OperationalInput,
} from "@/lib/electrical-grid-operational";

const base: OperationalInput = {
  kind: "load",
  stableId: "FS-900",
  description: "Precedence test",
  grid: null,
  designGrid: null,
  legacyGrid: null,
  gridReference: null,
  storedPrecision: null,
  xFt: null,
  yFt: null,
  designXFt: null,
  designYFt: null,
  installStatus: "complete",
  verification: null,
  verificationNotes: null,
  locationEvidence: null,
  verifiedAt: null,
  updatedAt: null,
  location: "Farm Shop",
  panel: "PNL-FS-NW",
  panelBasis: "test",
  circuitClass: null,
  circuitClassBasis: null,
};
const row = (over: Partial<OperationalInput>): OperationalInput => ({ ...base, ...over });

describe("field-audit location precedence", () => {
  it("plots from the verified grid when design X/Y conflicts, and surfaces the conflict", () => {
    const [a] = buildOperationalAssets([
      row({
        stableId: "FS-901",
        fieldGridReference: "C3",
        designXFt: 4,
        designYFt: 36,
        locationEvidence: "Applied audit FA-FS-2026-09-06-R1",
      }),
    ]);
    expect(a!.locationSource).toBe("OBSERVED_FIELD_GRID");
    expect(a!.plotProvenance).toBe("FIELD_VERIFIED_GRID_CENTROID");
    expect(a!.verifiedReference).toBe("C3");
    expect(a!.auditId).toBe("FA-FS-2026-09-06-R1");
    expect(a!.placementDisagreement).toBeTruthy();
  });

  it("preserves interval precision for a verified interval", () => {
    const [a] = buildOperationalAssets([
      row({ stableId: "FS-902", fieldGridReference: "C-D2-3" }),
    ]);
    expect(a!.precision).toBe("INTERVAL");
    expect(a!.spanned).toBe(true);
    expect(a!.plotProvenance).toBe("FIELD_VERIFIED_INTERVAL");
  });

  it("lets a verified measured X/Y outrank every derived coordinate", () => {
    const [a] = buildOperationalAssets([
      row({
        stableId: "FS-903",
        xFt: 21,
        yFt: 9,
        verification: "VERIFIED_AS_INSTALLED",
        fieldGridReference: "C3",
        designXFt: 4,
        designYFt: 36,
      }),
    ]);
    expect(a!.locationSource).toBe("VERIFIED_FIELD_OBSERVATION_XY");
    expect(a!.plotProvenance).toBe("FIELD_VERIFIED_XY");
    expect(a!.plottedXFt).toBe(21);
  });

  it("never labels a design coordinate as field verified", () => {
    const [a] = buildOperationalAssets([
      row({ stableId: "FS-904", designXFt: 8, designYFt: 8 }),
    ]);
    expect(a!.locationSource).toBe("APPROVED_DESIGN_XY");
    expect(a!.plotProvenance).toBe("DESIGN_XY");
  });

  it("states the instance-local notice and keeps deployment scope separate", () => {
    const summary = summarizeOperational(
      buildOperationalAssets([row({ stableId: "FS-905", fieldGridReference: "C3" })]),
    );
    expect(summary.fieldVerified).toBe(1);
    expect(summary.measuredFieldXy).toBe(0);
    expect(summary.locationAuthorityNotice).toContain("not measured coordinates");
    expect(summary.deploymentScopeNotice).toBe(DEPLOYMENT_SCOPE_NOTICE);
    expect(fieldVerifiedLocationNotice({ verified: 20, measuredXy: 0 })).toBe(
      "20 records in this FarmOps instance contain field-verified location references. None contains a measured field X/Y coordinate. FarmOps therefore plots each record from its verified grid, post, or interval using a deterministic derived rendering point. These points are field-authoritative at the recorded precision, but they are not measured coordinates.",
    );
  });

  it("reports an audit that exists only elsewhere as unavailable locally", () => {
    const notice = fieldVerifiedLocationNotice({ verified: 0, measuredXy: 0 });
    expect(notice).toContain("No records in this FarmOps instance");
    expect(notice).toContain("deployment-local until synchronized");
  });
});
