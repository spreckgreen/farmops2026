import { describe, expect, it } from "vitest";
import {
  buildOperationalAssets,
  fieldVerifiedLocationNotice,
  placementCandidatesFor,
  type OperationalInput,
} from "@/lib/electrical-grid-operational";
import { auditBatchItemSchema, buildPatch } from "@/lib/electrical-audit-batch";

const base: OperationalInput = {
  kind: "load",
  stableId: "FS-999",
  description: "Test load",
  grid: "C4",
  designGrid: "C4",
  legacyGrid: null,
  gridReference: "C4",
  storedPrecision: "GRIDLINE",
  xFt: null,
  yFt: null,
  designXFt: 10,
  designYFt: 10,
  installStatus: "installed",
  verification: null,
  verificationNotes: null,
  locationEvidence: null,
  verifiedAt: null,
  updatedAt: null,
  location: "Farm Shop",
  panel: null,
  panelBasis: null,
  circuitClass: null,
  circuitClassBasis: null,
  fieldGridReference: "D5",
  poleScheme: null,
  poleLocationKind: null,
  poleRefStart: null,
  poleRefEnd: null,
  pendingObservation: null,
};

describe("measured field X/Y records", () => {
  it("outrank a verified grid cell and plot as a measured point", () => {
    const row: OperationalInput = {
      ...base,
      xFt: 42.5,
      yFt: 18,
      measuredMethod: "LASER",
      measuredAccuracyFt: 0.25,
      measuredAt: "2026-09-08",
    };
    const [top] = placementCandidatesFor(row);
    expect(top?.source).toBe("VERIFIED_FIELD_OBSERVATION_XY");
    expect(top?.precision).toBe("EXACT");
    expect(top?.spanned).toBe(false);
    expect(top?.basis).toContain("Measured field coordinate");

    const [asset] = buildOperationalAssets([row]);
    expect(asset?.plotProvenance).toBe("FIELD_VERIFIED_XY");
    expect(asset?.plottedXFt).toBe(42.5);
    expect(asset?.plottedYFt).toBe(18);
    expect(asset?.verifiedReference).toContain("measured");
  });

  it("are ignored when no measurement method is recorded", () => {
    const row: OperationalInput = { ...base, xFt: 42.5, yFt: 18 };
    const [asset] = buildOperationalAssets([row]);
    expect(asset?.plotProvenance).not.toBe("FIELD_VERIFIED_XY");
  });

  it("are reported separately in the location authority notice", () => {
    expect(fieldVerifiedLocationNotice({ verified: 21, measuredXy: 1 })).toContain(
      "1 of them carry a measured field X/Y coordinate record",
    );
    expect(fieldVerifiedLocationNotice({ verified: 20, measuredXy: 0 })).toContain(
      "None contains a measured field X/Y coordinate.",
    );
  });

  it("are writable by a field audit observation", () => {
    const item = auditBatchItemSchema.parse({
      item_key: "m1",
      entity_kind: "load",
      target_stable_id: "FS-999",
      observation_class: "FIELD_AS_BUILT",
      evidence: "Laser measured from shop SW corner",
      measured_xy: { x_ft: 42.5, y_ft: 18, method: "LASER", accuracy_ft: 0.25 },
    });
    const { patch, messages } = buildPatch(item, {});
    expect(patch["location_x_ft"]).toBe(42.5);
    expect(patch["location_y_ft"]).toBe(18);
    expect(patch["measured_xy_method"]).toBe("LASER");
    expect(patch["measured_xy_accuracy_ft"]).toBe(0.25);
    expect(patch["grid_reference_precision"]).toBe("EXACT");
    expect(messages.some((m) => m.level === "error")).toBe(false);
  });

  it("rejects an unknown measurement method", () => {
    expect(() =>
      auditBatchItemSchema.parse({
        item_key: "m2",
        entity_kind: "load",
        observation_class: "FIELD_AS_BUILT",
        evidence: "x",
        measured_xy: { x_ft: 1, y_ft: 1, method: "GUESS" },
      }),
    ).toThrow();
  });
});
