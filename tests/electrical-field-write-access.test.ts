import { describe, expect, it } from "vitest";
import {
  canOpenSection,
  electricalAccess,
  sectionFromPathname,
} from "@/lib/electrical-access";
import {
  ELECTRICAL_FIELD_WRITE_ADDONS,
  ELECTRICAL_READ_ADDONS,
  FIELDWRITE_ELECTRICAL_ADDON,
} from "@/lib/addons";

describe("electrical field-write access", () => {
  it("lets a field-write electrician write but not reconcile", () => {
    const a = electricalAccess({ full: false, readOnly: false, fieldWrite: true });
    expect(a.canWrite).toBe(true);
    expect(a.readOnly).toBe(false);
    expect(a.auditedWrites).toBe(true);
    expect(a.canReconcile).toBe(false);
    expect(canOpenSection(a, "entities")).toBe(true);
    expect(canOpenSection(a, "qa")).toBe(false);
    expect(canOpenSection(a, "import")).toBe(false);
  });

  it("keeps the read-only grant unable to write", () => {
    const a = electricalAccess({ full: false, readOnly: true });
    expect(a.canWrite).toBe(false);
    expect(a.readOnly).toBe(true);
    expect(a.auditedWrites).toBe(false);
  });

  it("does not audit the full add-on as a field-write grant", () => {
    const a = electricalAccess({ full: true, readOnly: false, fieldWrite: true });
    expect(a.canWrite).toBe(true);
    expect(a.auditedWrites).toBe(false);
    expect(a.canReconcile).toBe(true);
  });

  it("exposes the change log to every farm-wide grant, not to scans", () => {
    expect(canOpenSection(electricalAccess({ full: false, readOnly: true }), "changes")).toBe(true);
    expect(
      canOpenSection(electricalAccess({ full: false, readOnly: false, scan: true }), "changes"),
    ).toBe(false);
    expect(sectionFromPathname("/electrical/changes")).toBe("changes");
  });

  it("includes the field-write key in both read and write gates", () => {
    expect(ELECTRICAL_READ_ADDONS).toContain(FIELDWRITE_ELECTRICAL_ADDON);
    expect(ELECTRICAL_FIELD_WRITE_ADDONS).toContain(FIELDWRITE_ELECTRICAL_ADDON);
    expect(ELECTRICAL_FIELD_WRITE_ADDONS).not.toContain("electrical_readonly");
  });
});
