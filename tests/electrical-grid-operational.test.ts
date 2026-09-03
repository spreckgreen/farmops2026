// Regression tests for the consolidated Farm Shop grid pages: routing,
// record/classification counts, missing-location handling and audit history.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildOperationalAssets,
  parseNewGrid,
  queueGroupsFor,
  summarizeOperational,
  verificationOf,
  type OperationalInput,
} from "@/lib/electrical-grid-operational";

const base: OperationalInput = {
  kind: "load",
  stableId: "FS-001",
  description: "Test load",
  grid: "A1",
  designGrid: null,
  legacyGrid: null,
  gridReference: null,
  storedPrecision: null,
  xFt: null,
  yFt: null,
  designXFt: null,
  designYFt: null,
  installStatus: "planned",
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

describe("corrected-grid parsing", () => {
  it("reads exact, interval and both-axis interval references", () => {
    expect(parseNewGrid("A1")).toMatchObject({ ok: true, interval: false });
    expect(parseNewGrid("C-D3")).toMatchObject({ ok: true, interval: true });
    expect(parseNewGrid("E2-3")).toMatchObject({ ok: true, interval: true });
    expect(parseNewGrid("C-D2-3")).toMatchObject({ ok: true, interval: true });
  });

  it("keeps mobile and non-location artifacts out of the coordinate system", () => {
    expect(parseNewGrid("MOBILE")).toMatchObject({ mobile: true, ok: false });
    for (const artifact of ["?", "??", "NA", "0.00%"]) {
      expect(parseNewGrid(artifact)).toMatchObject({ artifact: true, ok: false });
    }
  });
});

describe("operational classification", () => {
  it("never plots unresolved or mobile records", () => {
    const assets = buildOperationalAssets([
      row({ stableId: "FS-100", grid: "MOBILE" }),
      row({ stableId: "FS-101", grid: "??" }),
      row({ stableId: "FS-102", grid: null }),
    ]);
    for (const a of assets) {
      expect(a.xPct).toBeNull();
      expect(a.plottedXFt).toBeNull();
      expect(a.locationSource).toBe("NOT_PLOTTED");
    }
    expect(assets.map((a) => a.precision)).toEqual(["NON_FIXED", "UNRESOLVED", "UNRESOLVED"]);
  });

  // Recorded X/Y no longer wins by default: it must be a verified field
  // observation that is the current installed location.
  it("keeps intervals as intervals and prefers verified field-observation X/Y", () => {
    const [interval, recorded] = buildOperationalAssets([
      row({ stableId: "FS-200", grid: "C3", gridReference: "C-D2-3" }),
      row({
        stableId: "FS-201",
        grid: "B4",
        xFt: 21,
        yFt: 9,
        storedPrecision: "NEAREST",
        verification: "VERIFIED_AS_INSTALLED",
        installStatus: "complete",
      }),
    ]);
    expect(interval!.precision).toBe("INTERVAL");
    expect(interval!.spanned).toBe(true);
    expect(recorded!.precision).toBe("NEAREST");
    expect(recorded!.locationSource).toBe("VERIFIED_FIELD_OBSERVATION_XY");
    expect(recorded!.plottedXFt).toBe(21);
  });

  it("does not reinterpret legacy load coordinates as corrected-grid coordinates", () => {
    const [eastWall, southEast] = buildOperationalAssets([
      row({ stableId: "FS-202", grid: "A6" }),
      row({ stableId: "FS-203", grid: "G6" }),
    ]);
    expect(eastWall).toMatchObject({
      plottedXFt: 60,
      plottedYFt: 0,
      locationSource: "DERIVED_FROM_LEGACY_GRID",
    });
    expect(southEast).toMatchObject({
      plottedXFt: 60,
      plottedYFt: 40,
      locationSource: "DERIVED_FROM_LEGACY_GRID",
    });
  });

  it("prefers a corrected grid_reference over the legacy grid column", () => {
    const [asset] = buildOperationalAssets([
      row({ stableId: "FS-204", grid: "A6", gridReference: "A8" }),
    ]);
    expect(asset).toMatchObject({
      plottedXFt: 56,
      plottedYFt: 0,
      locationSource: "DERIVED_FROM_GRID_REFERENCE",
    });
  });

  it("classification counts reconcile to the record total", () => {
    const assets = buildOperationalAssets([
      row({ stableId: "FS-1", grid: "A1" }),
      row({ stableId: "FS-2", grid: "C-D3" }),
      row({ stableId: "FS-3", grid: "MOBILE" }),
      row({ stableId: "FS-4", grid: "?" }),
      row({ kind: "junction_box", stableId: "JB-001-01", grid: "B5" }),
    ]);
    const s = summarizeOperational(assets);
    const sum = Object.values(s.precision).reduce((a, b) => a + b, 0);
    expect(s.total).toBe(5);
    expect(sum).toBe(s.total);
    expect(s.plotted + s.unplotted).toBe(s.total);
    expect(s.precision.GRIDLINE).toBe(1);
    expect(s.precision.NEAREST).toBe(1);
  });

  it("groups the walkaround queue and flags post-install changes", () => {
    const [unresolved, mobile, changed] = buildOperationalAssets([
      row({ stableId: "FS-9", grid: "NA" }),
      row({ stableId: "FS-10", grid: "MOBILE" }),
      row({
        stableId: "FS-11",
        grid: "B2",
        designGrid: "A1",
        installStatus: "complete",
      }),
    ]);
    expect(queueGroupsFor(unresolved!)).toContain("UNRESOLVED");
    expect(queueGroupsFor(mobile!)).toContain("MOBILE_CONFIRMATION");
    expect(queueGroupsFor(changed!)).toContain("CHANGED_AFTER_INSTALL");
  });

  it("treats an explicitly mobile verification as non-fixed", () => {
    const [a] = buildOperationalAssets([
      row({ stableId: "FS-12", grid: "A1", verification: "INTENTIONALLY_MOBILE" }),
    ]);
    expect(a!.precision).toBe("NON_FIXED");
    expect(a!.xPct).toBeNull();
    expect(queueGroupsFor(a!)).not.toContain("MOBILE_CONFIRMATION");
    expect(verificationOf("bogus")).toBe("NOT_REVIEWED");
  });
});

describe("routing consolidation", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("redirects the four retired pages to the right data-quality tab", () => {
    const cases: [string, string][] = [
      ["src/routes/electrical.grid-recovery.tsx", "canonical-comparison"],
      ["src/routes/electrical.mapping-audit.tsx", "status"],
      ["src/routes/electrical.mapping-repair.tsx", "repair"],
      ["src/routes/electrical.grid-migration.tsx", "history"],
    ];
    for (const [file, tab] of cases) {
      const src = read(file);
      expect(src).toContain('to: "/electrical/grid-data-quality"');
      expect(src).toContain(`tab: "${tab}"`);
    }
  });

  it("leaves only Grid map in the electrical Diagrams & maps navigation", () => {
    const nav = read("src/components/electrical/electrical-gate.tsx");
    expect(nav).toContain('to: "/electrical/grid-map"');
    for (const gone of [
      '"/electrical/grid-recovery"',
      '"/electrical/mapping-audit"',
      '"/electrical/mapping-repair"',
      '"/electrical/grid-migration"',
    ]) {
      expect(nav).not.toContain(gone);
    }
  });

  it("links electrical grid data quality from admin", () => {
    expect(read("src/routes/admin.index.tsx")).toContain("/electrical/grid-data-quality");
  });

  it("keeps the grid map free of migration and bulk-repair controls", () => {
    const map = read("src/components/electrical/grid-operational-map.tsx");
    expect(map).not.toContain("GridApplyGate");
    expect(map).not.toContain("MappingRepairPanel");
    expect(map).toContain("/electrical/grid-data-quality");
  });
});

describe("audit history preservation", () => {
  const src = readFileSync("src/lib/electrical-grid-operational.functions.ts", "utf8");

  it("records every verification write in immutable audit history", () => {
    expect(src).toContain("recordElectricalChange");
    expect(src).toContain("grid_field_verification");
  });

  it("preserves the design location instead of overwriting it with as-built", () => {
    expect(src).toContain('patch["design_grid"] = before["grid"]');
    expect(src).toContain('patch["design_x_ft"] = before["location_x_ft"]');
  });

  it("never writes coordinates for mobile records", () => {
    expect(src).toContain('patch["location_x_ft"] = null');
  });
});
