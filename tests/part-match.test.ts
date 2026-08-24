import { describe, expect, it } from "vitest";
import { matchPart, partTokens } from "@/lib/part-match";

const inv = [
  { id: "a", label: "Engine oil filter" },
  { id: "b", label: "Hydraulic oil filter" },
  { id: "c", label: "Air filter (outer)" },
  { id: "d", label: "SAE 15W-40 engine oil" },
];

describe("part matching", () => {
  it("drops stop words from tokens", () => {
    expect(partTokens("Genuine OEM oil filter kit")).toEqual(["oil", "filter"]);
  });

  it("auto-accepts an exact name", () => {
    const m = matchPart("engine oil filter", inv);
    expect(m.best?.id).toBe("a");
    expect(m.confidence).toBe("exact");
    expect(m.needsConfirmation).toBe(false);
  });

  it("asks for confirmation when two items are equally plausible", () => {
    const m = matchPart("oil filter", inv);
    expect(m.needsConfirmation).toBe(true);
    expect(m.candidates.map((c) => c.id)).toContain("a");
    expect(m.candidates.map((c) => c.id)).toContain("b");
  });

  it("returns no candidates for an unknown part", () => {
    const m = matchPart("radiator pressure cap", inv);
    expect(m.confidence).toBe("none");
    expect(m.candidates).toHaveLength(0);
  });

  it("honours a lower threshold by auto-accepting weaker matches", () => {
    const strict = matchPart("15W-40 oil", inv, { autoAcceptScore: 0.95 });
    const loose = matchPart("15W-40 oil", inv, { autoAcceptScore: 0.3 });
    expect(strict.confidence).toBe("weak");
    expect(loose.confidence).toBe("strong");
  });
});
