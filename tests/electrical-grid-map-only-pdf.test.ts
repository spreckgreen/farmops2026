import { describe, expect, it } from "vitest";
import {
  gridMapOnlyPdfFileName,
  renderGridMapOnlyPdf,
} from "@/lib/electrical-grid-map-pdf";
import type { OperationalAsset } from "@/lib/electrical-grid-operational";

const asset = (over: Partial<OperationalAsset>): OperationalAsset =>
  ({
    stableId: "FS-001",
    kind: "load",
    description: "d",
    grid: "A1",
    designGrid: null,
    precision: "EXACT",
    precisionBasis: "recorded",
    plottedXFt: 10,
    plottedYFt: 20,
    xPct: 50,
    yPct: 50,
    spanned: false,
    locationSource: "RECORDED_COORDINATES",
    stackIndex: 0,
    stackSize: 1,
    panel: "PNL-FS-NW",
    location: "Farm Shop",
    installStatus: null,
    verification: null,
    verificationNotes: null,
    verifiedAt: null,
    updatedAt: null,
    locationEvidence: null,
    ...over,
  }) as OperationalAsset;

const geometry = {
  widthFt: 60,
  depthFt: 40,
  rows: [{ label: "A", offsetFt: 0 }],
  cols: [{ label: "1", offsetFt: 0 }],
};

describe("map-only grid PDF", () => {
  it("is one landscape page", () => {
    const doc = renderGridMapOnlyPdf({
      plotted: [asset({})],
      gridMapName: "Farm Shop corrected grid",
      geometry,
      panelLabel: "all panels",
      printedAt: new Date("2026-09-08T12:00:00Z"),
    });
    expect(doc.getNumberOfPages()).toBe(1);
    const size = doc.internal.pageSize;
    expect(size.getWidth()).toBeGreaterThan(size.getHeight());
  });

  it("names the file with the grid map, scope and date", () => {
    expect(
      gridMapOnlyPdfFileName("Farm Shop corrected grid", "PNL-FS-NW", new Date("2026-09-08T12:00:00Z")),
    ).toBe("grid-map-Farm-Shop-corrected-grid-PNL-FS-NW-2026-09-08.pdf");
  });
});
