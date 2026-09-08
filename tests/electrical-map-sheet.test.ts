import { describe, expect, it } from "vitest";
import { buildOperationalAssets, type OperationalInput } from "@/lib/electrical-grid-operational";
import {
  mapSheetFileName,
  mapSheetModel,
  renderMapSheetHtml,
} from "@/lib/electrical-map-sheet";

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
  panel: "PNL-FS-NW",
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

const measured: OperationalInput = {
  ...base,
  stableId: "FS-001",
  xFt: 42.5,
  yFt: 18,
  measuredMethod: "LASER",
  measuredAccuracyFt: 0.25,
  measuredAt: "2026-09-08",
};

function sheet(rows: OperationalInput[]) {
  return mapSheetModel({
    assets: buildOperationalAssets(rows),
    scopeLabel: "PNL-FS-NW",
    filterSummary: ["Panel: PNL-FS-NW"],
    gaps: ["FS-777 has no location recorded"],
    generatedAt: new Date("2026-09-08T14:05:00Z"),
  });
}

describe("premium print map sheet", () => {
  it("lists every record in scope with provenance, precision, derivation and audit", () => {
    const model = sheet([base, measured]);
    expect(model.counts.total).toBe(2);
    expect(model.rows.map((r) => r.stableId)).toEqual(["FS-001", "FS-999"]);
    const m = model.rows[0]!;
    expect(m.provenance).toBe("FIELD_VERIFIED_XY");
    expect(m.plotted).toBe("42.5 ft E / 18 ft S");
    expect(m.derivation).toBeTruthy();
    expect(m.auditId).toBeTruthy();
    expect(model.provenanceCounts.find((p) => p.provenance === "FIELD_VERIFIED_XY")?.count).toBe(1);
    expect(model.counts.measuredXy).toBe(1);
  });

  it("states the location authority and the deployment scope separately", () => {
    const model = sheet([base, measured]);
    expect(model.notice).toContain("field-verified location references");
    expect(model.deploymentNotice).toContain("deployment-local until synchronized");
  });

  it("surfaces a design-versus-verified conflict and never relabels the derived point", () => {
    const model = sheet([
      { ...base, stableId: "FS-500", grid: "D5", designGrid: "C4", fieldGridReference: "D5" },
    ]);
    const row = model.rows[0]!;
    expect(row.provenance).not.toBe("FIELD_VERIFIED_XY");
    expect(row.conflict).toContain("Design grid C4 conflicts");
    expect(row.conflict).toContain("field-verified location controls the plot");
    expect(model.counts.conflicts).toBe(1);
    expect(model.conflicts).toHaveLength(1);
  });

  it("renders printable HTML with the records, notices and gaps", () => {
    const html = renderMapSheetHtml(sheet([base, measured]));
    expect(html).toContain("FS-001");
    expect(html).toContain("FS-999");
    expect(html).toContain("Conflict notices");
    expect(html).toContain("FS-777 has no location recorded");
    expect(html).toContain("Panel: PNL-FS-NW");
  });

  it("stamps the file name with the scope and generation time", () => {
    expect(mapSheetFileName("PNL-FS-NW", new Date("2026-09-08T14:05:00Z"))).toBe(
      "farm-shop-map-sheet-PNL-FS-NW-2026-09-08-14-05-00",
    );
  });
});
