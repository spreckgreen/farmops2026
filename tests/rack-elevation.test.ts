import { describe, expect, it } from "vitest";
import {
  buildRackElevation,
  formatSpan,
  nextFreePosition,
  type RackPartPlacement,
} from "@/lib/rack-elevation";

const part = (over: Partial<RackPartPlacement> & { id: string; name: string }): RackPartPlacement => ({
  rackUnits: 1,
  positionU: null,
  quantity: 1,
  ...over,
});

describe("rack elevation", () => {
  it("orders placed parts bottom to top and reports the span", () => {
    const e = buildRackElevation(
      [
        part({ id: "a", name: "Patch panel", rackUnits: 1, positionU: 7 }),
        part({ id: "b", name: "Shelf", rackUnits: 2, positionU: 3 }),
      ],
      15,
    );
    expect(e.placed.map((p) => p.name)).toEqual(["Shelf", "Patch panel"]);
    expect(formatSpan(e.placed[0]!)).toBe("U3–U4");
    expect(formatSpan(e.placed[1]!)).toBe("U7");
    expect(e.usedU).toBe(3);
    expect(e.freeU).toBe(12);
  });

  it("never guesses: parts with no size or no position stay unplaced", () => {
    const e = buildRackElevation(
      [
        part({ id: "a", name: "Kenwood TS-480 SAT", rackUnits: null, positionU: 2 }),
        part({ id: "b", name: "Power strip", rackUnits: 1, positionU: null }),
      ],
      15,
    );
    expect(e.placed).toHaveLength(0);
    expect(e.unplaced.map((p) => p.name)).toEqual(["Kenwood TS-480 SAT", "Power strip"]);
    expect(e.usedU).toBe(0);
  });

  it("flags two parts claiming the same space", () => {
    const e = buildRackElevation(
      [
        part({ id: "a", name: "Shelf", rackUnits: 2, positionU: 3 }),
        part({ id: "b", name: "Radio", rackUnits: 1, positionU: 4 }),
      ],
      15,
    );
    expect(e.conflicts).toEqual([{ a: "Shelf", b: "Radio", spaces: [4] }]);
  });

  it("flags gear that sticks out past the top of the rack", () => {
    const e = buildRackElevation([part({ id: "a", name: "Shelf", rackUnits: 3, positionU: 14 })], 15);
    expect(e.overflow.map((p) => p.name)).toEqual(["Shelf"]);
  });

  it("suggests the lowest free run that fits, or nothing when full", () => {
    const e = buildRackElevation(
      [
        part({ id: "a", name: "Shelf", rackUnits: 2, positionU: 1 }),
        part({ id: "b", name: "Radio", rackUnits: 1, positionU: 3 }),
      ],
      5,
    );
    expect(nextFreePosition(e, 2)).toBe(4);
    expect(nextFreePosition(e, 3)).toBeNull();
  });

  it("leaves capacity unknown when the rack records no height", () => {
    const e = buildRackElevation([part({ id: "a", name: "Shelf", rackUnits: 2, positionU: 1 })], null);
    expect(e.sizeU).toBeNull();
    expect(e.freeU).toBeNull();
    expect(e.emptyU).toEqual([]);
    expect(nextFreePosition(e, 1)).toBeNull();
  });
});
