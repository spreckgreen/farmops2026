import { describe, expect, it } from "vitest";
import { buildOperationalAssets, type OperationalInput } from "@/lib/electrical-grid-operational";
import {
  PROVENANCE_LABELS_PER_PAGE,
  provenanceLabelFileName,
  provenanceLabelSheet,
  renderProvenanceLabelsHtml,
} from "@/lib/electrical-provenance-labels";

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
  return provenanceLabelSheet({
    assets: buildOperationalAssets(rows),
    scopeLabel: "PNL-FS-NW",
    filterSummary: ["Panel: PNL-FS-NW"],
    gaps: [],
    generatedAt: new Date("2026-09-08T14:05:00Z"),
  });
}

describe("provenance label sheet", () => {
  it("emits one label per record with provenance, precision and audit ID", () => {
    const s = sheet([base, measured]);
    expect(s.labels).toHaveLength(2);
    for (const l of s.labels) {
      expect(l.stableId).toBeTruthy();
      expect(l.provenance).toBeTruthy();
      expect(l.precision).toBeTruthy();
      expect(l.auditId).toBeTruthy();
    }
  });

  it("keeps measured X/Y distinct from derived provenance", () => {
    const s = sheet([base, measured]);
    const m = s.labels.find((l) => l.stableId === "FS-001")!;
    const derived = s.labels.find((l) => l.stableId === "FS-999")!;
    expect(m.provenance).toBe("FIELD_VERIFIED_XY");
    expect(derived.provenance).not.toBe("FIELD_VERIFIED_XY");
  });

  it("paginates 10-up and counts conflicts", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...base, stableId: `FS-${100 + i}` }));
    const s = sheet(many);
    expect(s.perPage).toBe(PROVENANCE_LABELS_PER_PAGE);
    expect(s.pages).toBe(2);
    expect(s.conflictCount).toBe(s.labels.filter((l) => l.conflict).length);
  });

  it("renders printable HTML with escaped label content", () => {
    const html = renderProvenanceLabelsHtml(sheet([base]));
    expect(html).toContain("FS-999");
    expect(html).toContain("Provenance");
    expect(html).toContain("Audit");
    expect(html).not.toContain("<script");
  });

  it("names the file from scope and timestamp", () => {
    expect(provenanceLabelFileName("PNL-FS-NW", new Date("2026-09-08T14:05:00Z"))).toBe(
      "electrical-provenance-labels-PNL-FS-NW-2026-09-08-14-05-00",
    );
  });
});
