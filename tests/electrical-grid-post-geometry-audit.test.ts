import { describe, expect, it } from "vitest";
import { POST_GEOMETRY_AUDIT, PROPOSED_POST_POSITIONS } from "@/lib/electrical-grid-post-geometry";
describe("post geometry audit", () => {
  it("passes against the frozen outline", () => {
    console.log(JSON.stringify(POST_GEOMETRY_AUDIT.issues), POST_GEOMETRY_AUDIT.ringLengthFt, POST_GEOMETRY_AUDIT.checks.filter(c=>!c.ok));
    console.log(PROPOSED_POST_POSITIONS.map(p=>`${p.ref} ${p.xFt},${p.yFt} ${p.gridCell}`).join("\n"));
    expect(POST_GEOMETRY_AUDIT.ok).toBe(true);
  });
});
