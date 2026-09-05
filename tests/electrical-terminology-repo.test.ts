import { describe, expect, it } from "vitest";
import { errorCount } from "@/lib/electrical-terminology-audit";
import { scanRepository } from "../scripts/lib/terminology-scan";

// Documentation/UI validation gate: prohibited terminology fails the test run.
describe("repository terminology gate", () => {
  const { scanned, findings } = scanRepository();

  it("scans every audited electrical surface", () => {
    expect(scanned).toBeGreaterThan(50);
  });

  it("has no prohibited user-facing terminology", () => {
    const errors = findings.filter((f) => f.severity === "error");
    expect(
      errors.map((f) => `${f.location}:${f.line} "${f.matched}" -> ${f.instead}`),
    ).toEqual([]);
    expect(errorCount(findings)).toBe(0);
  });
});
