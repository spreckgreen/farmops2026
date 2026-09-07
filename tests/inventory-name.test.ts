import { describe, expect, it } from "vitest";
import { nameMatchesSuggestion, suggestedItemName } from "@/lib/inventory-name";

describe("suggestedItemName", () => {
  it("joins manufacturer and model", () => {
    expect(suggestedItemName("Kenwood", "TS-480 SAT")).toBe("Kenwood TS-480 SAT");
  });

  it("trims and skips missing halves", () => {
    expect(suggestedItemName("  Generic ", null)).toBe("Generic");
    expect(suggestedItemName(null, " 12-2 NM-B ")).toBe("12-2 NM-B");
    expect(suggestedItemName("", "")).toBe("");
  });
});

describe("nameMatchesSuggestion", () => {
  it("treats a matching or blank name as not hand-edited", () => {
    expect(nameMatchesSuggestion("Kenwood TS-480 SAT", "Kenwood", "TS-480 SAT")).toBe(true);
    expect(nameMatchesSuggestion("kenwood ts-480 sat", "Kenwood", "TS-480 SAT")).toBe(true);
    expect(nameMatchesSuggestion("", "Kenwood", "TS-480 SAT")).toBe(true);
  });

  it("detects a custom name", () => {
    expect(nameMatchesSuggestion("Shop HF radio", "Kenwood", "TS-480 SAT")).toBe(false);
  });
});
