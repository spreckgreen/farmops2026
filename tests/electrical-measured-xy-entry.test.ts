import { describe, expect, it } from "vitest";
import {
  MEASURED_XY_ENTITY_KINDS,
  buildMeasuredXyManifest,
  emptyMeasuredXyRow,
  measuredXyItemKey,
  suggestMeasuredXyBatchId,
  validateMeasuredXyRow,
  type MeasuredXyEntryHeader,
} from "@/lib/electrical-measured-xy-entry";

const header: MeasuredXyEntryHeader = {
  batchId: "MXY-FS-2026-09-08-R1",
  title: "Measured field X/Y coordinates",
  observedDate: "2026-09-08",
  building: "Farm Shop",
  scope: "Measured field X/Y coordinates",
  source: "entry screen",
};

const good = (over: Partial<ReturnType<typeof emptyMeasuredXyRow>> = {}) => ({
  ...emptyMeasuredXyRow("r1"),
  stableId: "FS-035",
  x: "42.5",
  y: "18",
  method: "LASER" as const,
  accuracyFt: "0.25",
  evidence: "Laser from NW slab corner, two passes",
  ...over,
});

describe("measured X/Y entry", () => {
  it("only offers record kinds that can hold a measured coordinate", () => {
    expect(MEASURED_XY_ENTITY_KINDS).toEqual(["panel", "jbox", "load", "switch_bank"]);
  });

  it("suggests a deterministic batch ID", () => {
    expect(suggestMeasuredXyBatchId("fs", "2026-09-08", 2)).toBe("MXY-FS-2026-09-08-R2");
  });

  it("requires stable ID, coordinates and evidence", () => {
    const errs = validateMeasuredXyRow(emptyMeasuredXyRow("r1"));
    expect(errs.join(" ")).toContain("Stable ID");
    expect(errs.join(" ")).toContain("X (ft east)");
    expect(errs.join(" ")).toContain("Evidence");
  });

  it("rejects a non-positive accuracy and a malformed date", () => {
    const errs = validateMeasuredXyRow(good({ accuracyFt: "0", measuredAt: "Sept 8" }));
    expect(errs.some((e) => e.includes("Accuracy"))).toBe(true);
    expect(errs.some((e) => e.includes("Measured on"))).toBe(true);
  });

  it("builds a field-as-built manifest carrying the measurement", () => {
    const built = buildMeasuredXyManifest(header, [good()]);
    expect(built.ok).toBe(true);
    const item = built.manifest!.items[0]!;
    expect(item.entity_kind).toBe("load");
    expect(item.observation_class).toBe("FIELD_AS_BUILT");
    expect(item.measured_xy).toMatchObject({
      x_ft: 42.5,
      y_ft: 18,
      method: "LASER",
      accuracy_ft: 0.25,
      measured_at: "2026-09-08",
    });
    expect(item.item_key).toBe(measuredXyItemKey(good(), 0));
  });

  it("rejects the same record measured twice in one batch", () => {
    const built = buildMeasuredXyManifest(header, [
      good(),
      { ...good({ x: "43" }), id: "r2" },
    ]);
    expect(built.ok).toBe(false);
    expect(built.rowErrors[1]!.errors.join(" ")).toContain("measured twice");
  });

  it("rejects an empty batch and a bad header date", () => {
    expect(buildMeasuredXyManifest(header, []).headerErrors.join(" ")).toContain("at least one");
    const bad = buildMeasuredXyManifest({ ...header, observedDate: "8/9/26" }, [good()]);
    expect(bad.ok).toBe(false);
    expect(bad.headerErrors.join(" ")).toContain("Observed date");
  });
});
