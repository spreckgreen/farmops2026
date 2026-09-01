import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalWorkbookAvailability,
  clearCanonicalWorkbookSession,
  getCanonicalWorkbookSession,
  hasCanonicalWorkbookBytes,
  setCanonicalWorkbookSession,
} from "@/lib/electrical-canonical-workbook-session";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";

describe("shared canonical ODS workbook session", () => {
  beforeEach(() => clearCanonicalWorkbookSession());

  it("shares the validated workbook with adjudication and marks it authorized", () => {
    setCanonicalWorkbookSession({
      file_name: "PremoFarmElectrical.ods",
      base64: "UEsDBA==",
      sha256: PHASE_44A_BASELINE_SHA256.toUpperCase(),
      established_by: "parallel_validation",
    });
    const s = getCanonicalWorkbookSession()!;
    expect(s.sha256).toBe(PHASE_44A_BASELINE_SHA256);
    expect(s.baseline_authorized).toBe(true);
    expect(hasCanonicalWorkbookBytes()).toBe(true);
    const a = canonicalWorkbookAvailability(s);
    expect(a.state).toBe("available");
    if (a.state === "available") expect(a.base64).toBe("UEsDBA==");
  });

  it("refuses authorization for any other workbook", () => {
    setCanonicalWorkbookSession({
      file_name: "other.ods",
      base64: "AAA=",
      sha256: "deadbeef",
      established_by: "load_adjudication",
    });
    expect(getCanonicalWorkbookSession()!.baseline_authorized).toBe(false);
  });

  it("requires an explicit reattach when the bytes did not survive, never a cached value", () => {
    const meta = {
      file_name: "PremoFarmElectrical.ods",
      sha256: PHASE_44A_BASELINE_SHA256,
      parsed_at: "2026-09-01T00:00:00.000Z",
      baseline_authorized: true,
      established_by: "parallel_validation" as const,
    };
    const a = canonicalWorkbookAvailability({ ...meta, base64: null });
    expect(a.state).toBe("reattach_required");
    expect(canonicalWorkbookAvailability(null).state).toBe("none");
  });
});
