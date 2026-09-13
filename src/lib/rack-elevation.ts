// Pure rack elevation math for a rack build kit.
//
// A rack has a fixed number of rack spaces (U) — e.g. RACK-FS-HAM-01 is 15U.
// Each part can record how tall it is (a shelf might be 2U, a patch panel 1U)
// and which space it starts at, counted from the BOTTOM of the rack: a 2U shelf
// at position 3 occupies U3 and U4. Nothing here invents a size or a position —
// parts with no size or no position stay unplaced and are reported as such.

export type RackLane = "full" | "left" | "right";

export interface RackPartPlacement {
  id: string;
  name: string;
  /** Height in rack spaces, when recorded. */
  rackUnits: number | null;
  /** Lowest rack space occupied, counted from the bottom (1 = bottom). */
  positionU: number | null;
  /** Horizontal portion of the rack face occupied by the device. */
  rackLane?: RackLane | null;
  /** How many of this part the kit lists. */
  quantity: number;
}

export interface PlacedRackPart extends RackPartPlacement {
  rackUnits: number;
  positionU: number;
  /** Highest rack space occupied. */
  topU: number;
}

export interface RackElevation {
  /** Rack height in spaces, when the rack records one. */
  sizeU: number | null;
  /** Parts with both a size and a position, ordered bottom to top. */
  placed: PlacedRackPart[];
  /** Parts missing a size or a position — shown, never guessed. */
  unplaced: RackPartPlacement[];
  /** Spaces used by placed parts. */
  usedU: number;
  /** Spaces left, when the rack height is known. */
  freeU: number | null;
  /** Space numbers, bottom to top, with no placed part. */
  emptyU: number[];
  /** Pairs of parts claiming the same space. */
  conflicts: Array<{ a: string; b: string; spaces: number[] }>;
  /** Parts that stick out past the top of the rack. */
  overflow: PlacedRackPart[];
}

function lanesOverlap(a: RackLane | null | undefined, b: RackLane | null | undefined): boolean {
  const laneA = a ?? "full";
  const laneB = b ?? "full";
  return laneA === "full" || laneB === "full" || laneA === laneB;
}

function spansOf(p: PlacedRackPart): number[] {
  const out: number[] = [];
  for (let u = p.positionU; u <= p.topU; u += 1) out.push(u);
  return out;
}

export function buildRackElevation(
  parts: RackPartPlacement[],
  sizeU: number | null,
): RackElevation {
  const placed: PlacedRackPart[] = [];
  const unplaced: RackPartPlacement[] = [];

  for (const p of parts) {
    if (p.rackUnits == null || p.rackUnits <= 0 || p.positionU == null || p.positionU < 1) {
      unplaced.push(p);
      continue;
    }
    placed.push({ ...p, rackUnits: p.rackUnits, positionU: p.positionU, topU: p.positionU + p.rackUnits - 1 });
  }

  placed.sort((a, b) => a.positionU - b.positionU || a.name.localeCompare(b.name));

  const conflicts: RackElevation["conflicts"] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i]!;
      const b = placed[j]!;
      const from = Math.max(a.positionU, b.positionU);
      const to = Math.min(a.topU, b.topU);
      if (from <= to && lanesOverlap(a.rackLane, b.rackLane)) {
        const spaces: number[] = [];
        for (let u = from; u <= to; u += 1) spaces.push(u);
        conflicts.push({ a: a.name, b: b.name, spaces });
      }
    }
  }

  const occupied = new Set<number>();
  for (const p of placed) for (const u of spansOf(p)) occupied.add(u);

  const emptyU: number[] = [];
  if (sizeU != null && sizeU > 0) {
    for (let u = 1; u <= sizeU; u += 1) if (!occupied.has(u)) emptyU.push(u);
  }

  const overflow = sizeU != null && sizeU > 0 ? placed.filter((p) => p.topU > sizeU) : [];

  return {
    sizeU: sizeU != null && sizeU > 0 ? sizeU : null,
    placed,
    unplaced,
    usedU: occupied.size,
    freeU: sizeU != null && sizeU > 0 ? Math.max(0, sizeU - occupied.size) : null,
    emptyU,
    conflicts,
    overflow,
  };
}

/**
 * Lowest run of free spaces tall enough for `units`, or null when the rack has
 * no room (or no recorded height). Used to suggest a position, never to assign
 * one silently.
 */
export function nextFreePosition(
  elevation: RackElevation,
  units: number,
  rackLane: RackLane = "full",
): number | null {
  if (elevation.sizeU == null || units <= 0) return null;
  for (let start = 1; start + units - 1 <= elevation.sizeU; start += 1) {
    const top = start + units - 1;
    const blocked = elevation.placed.some(
      (part) =>
        start <= part.topU &&
        part.positionU <= top &&
        lanesOverlap(part.rackLane, rackLane),
    );
    if (!blocked) return start;
  }
  return null;
}

/** "U3–U4" for a 2U part at position 3, "U7" for a 1U part. */
export function formatSpan(p: { positionU: number; topU: number }): string {
  return p.positionU === p.topU ? `U${p.positionU}` : `U${p.positionU}–U${p.topU}`;
}
