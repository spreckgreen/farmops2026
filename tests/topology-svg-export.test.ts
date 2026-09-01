import { describe, it, expect } from "vitest";
import { standaloneSvg } from "../src/lib/electrical-topology-tree";
describe("standaloneSvg", () => {
  it("binds xlink and sets pixel size", () => {
    const out = standaloneSvg('<svg id="a" width="100%" style="max-width: 20px;" viewBox="0 0 20 40" xmlns="http://www.w3.org/2000/svg"><a xlink:href="#x"/></svg>');
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).toContain('width="20" height="40"');
    expect(out).not.toContain('100%');
  });
});
