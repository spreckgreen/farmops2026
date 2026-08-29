// The seven imported panels carry engineering prose in install_status, which
// the database controlled-value trigger rejects on every later write. That is
// why they list but cannot be edited. Normalisation must keep the words.
import { describe, expect, it } from "vitest";
import { mergeLegacyStatusNote, normalizeInstallStatus } from "@/lib/electrical";

const IMPORTED = [
  "Planning Assumption",
  "Reserve West-wall space/pathway.",
  "Reserve wall/pathway.",
  "Design Basis",
  "Existing / Confirm",
];

describe("legacy install status normalisation", () => {
  it("maps engineering prose to planned and keeps the original text", () => {
    for (const raw of IMPORTED) {
      const norm = normalizeInstallStatus(raw);
      expect(norm.status).toBe("planned");
      expect(norm.legacy).toBe(raw);
      expect(mergeLegacyStatusNote(null, norm.legacy)).toContain(raw);
    }
  });

  it("accepts real statuses in any casing without touching notes", () => {
    for (const [raw, expected] of [
      ["complete", "complete"],
      ["As Built Verified", "as_built_verified"],
      ["rough-in started", "rough_in_started"],
    ] as const) {
      const norm = normalizeInstallStatus(raw);
      expect(norm.status).toBe(expected);
      expect(norm.legacy).toBeNull();
      expect(mergeLegacyStatusNote("keep me", norm.legacy)).toBe("keep me");
    }
  });

  it("defaults blanks to planned and never duplicates a note line", () => {
    expect(normalizeInstallStatus("").status).toBe("planned");
    const once = mergeLegacyStatusNote("field note", "Design Basis");
    expect(mergeLegacyStatusNote(once, "Design Basis")).toBe(once);
  });
});
