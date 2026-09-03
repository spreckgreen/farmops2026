import { describe, expect, it } from "vitest";
import { gridMapPdfFileName, renderGridMapPdf } from "@/lib/electrical-grid-map-pdf";
import type { OperationalAsset } from "@/lib/electrical-grid-operational";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGP88OEDAwwwMSABFA4AaKwC1hdCaIkAAAAASUVORK5CYII=";

const asset = (over: Partial<OperationalAsset>): OperationalAsset =>
  ({
    stableId: "FS-001",
    kind: "load",
    description: "d",
    grid: "A1",
    designGrid: null,
    precision: "EXACT",
    precisionBasis: "recorded",
    plottedXFt: 0,
    plottedYFt: 0,
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

describe("grid map pdf", () => {
  it("renders map only and map + data quality", () => {
    const base = {
      plotted: [asset({}), asset({ stableId: "PNL-FS-NE", kind: "panel" as const, xPct: 10, yPct: 20 })],
      unplotted: [asset({ stableId: "FS-099", precision: "NON_FIXED" as const, xPct: null, yPct: null })],
      gaps: ["gap one"],
      panelLabel: "all panels",
      filteredCount: 3,
      impreciseCount: 1,
      planDataUrl: png,
      planSize: { width: 1600, height: 1000 },
      printedAt: new Date("2026-09-03T12:00:00Z"),
    };
    const solo = renderGridMapPdf({ ...base, includeDataQuality: false });
    expect(solo.getNumberOfPages()).toBe(1);
    const withDq = renderGridMapPdf({ ...base, includeDataQuality: true });
    expect(withDq.getNumberOfPages()).toBeGreaterThan(1);
    expect(withDq.output("blob").size).toBeGreaterThan(500);
  });

  it("names the file with the scope and print time", () => {
    expect(gridMapPdfFileName("PNL-FS-NW", new Date("2026-09-03T12:00:00Z"))).toBe(
      "farm-shop-grid-map-PNL-FS-NW-2026-09-03-12-00-00.pdf",
    );
  });
});
