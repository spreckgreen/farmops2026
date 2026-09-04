import { describe, expect, it } from "vitest";
import {
  ELECTRICIAN_VIEWABLE_SECTIONS,
  RECONCILIATION_SECTIONS,
  canOpenSection,
  electricalAccess,
  isReconciliationSection,
  sectionFromPathname,
} from "@/lib/electrical-access";
import { ADDON_KEYS, ELECTRICAL_READ_ADDONS, PANEL_SHEET_ADDONS } from "@/lib/addons";

describe("read-only electrician electrical access", () => {
  it("registers the read-only add-on as a farm-wide read key", () => {
    expect(ADDON_KEYS).toContain("electrical_readonly");
    // The field-write add-on implies read as well, so it belongs in the read set.
    expect(ELECTRICAL_READ_ADDONS).toEqual([
      "electrical",
      "electrical_fieldwrite",
      "electrical_readonly",
    ]);
    expect(PANEL_SHEET_ADDONS).toContain("electrical_readonly");
  });

  it("opens every electrician screen but no reconciliation tab", () => {
    const a = electricalAccess({ full: false, readOnly: true });
    expect(a.canView).toBe(true);
    expect(a.readOnly).toBe(true);
    expect(a.canReconcile).toBe(false);
    for (const s of ELECTRICIAN_VIEWABLE_SECTIONS) expect(canOpenSection(a, s)).toBe(true);
    for (const s of RECONCILIATION_SECTIONS) expect(canOpenSection(a, s)).toBe(false);
  });

  it("keeps the full add-on unrestricted", () => {
    const a = electricalAccess({ full: true, readOnly: false });
    expect(a.canReconcile).toBe(true);
    expect(a.readOnly).toBe(false);
    for (const s of [...ELECTRICIAN_VIEWABLE_SECTIONS, ...RECONCILIATION_SECTIONS]) {
      expect(canOpenSection(a, s)).toBe(true);
    }
  });

  it("keeps scanned-label access to the scanned panel only", () => {
    const a = electricalAccess({ full: false, readOnly: false, scan: true });
    expect(a.scanOnly).toBe(true);
    expect(a.sections).toEqual(["panel"]);
    expect(canOpenSection(a, "entities")).toBe(false);
  });

  it("grants nothing without an entitlement", () => {
    const a = electricalAccess({ full: false, readOnly: false });
    expect(a.canView).toBe(false);
    expect(a.sections).toEqual([]);
  });

  it("classifies reconciliation areas explicitly", () => {
    for (const s of ["mapping", "sor", "validation", "adjudication", "import", "export"] as const) {
      expect(isReconciliationSection(s)).toBe(true);
    }
    for (const s of ["overview", "entities", "workbook", "topology", "panel"] as const) {
      expect(isReconciliationSection(s)).toBe(false);
    }
  });

  it("maps electrical URLs onto sections", () => {
    expect(sectionFromPathname("/electrical")).toBe("overview");
    expect(sectionFromPathname("/electrical/")).toBe("overview");
    expect(sectionFromPathname("/electrical/panel/PNL-H1")).toBe("panel");
    expect(sectionFromPathname("/electrical/load")).toBe("entities");
    expect(sectionFromPathname("/electrical/item/load/FS-042")).toBe("entities");
    expect(sectionFromPathname("/electrical/validation")).toBe("validation");
    expect(sectionFromPathname("/electrical/export")).toBe("export");
  });
});
