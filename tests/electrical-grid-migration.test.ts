import { describe, expect, it } from "vitest";
import {
  migrateAll,
  migrateRow,
  migrationCsv,
  nearestNewCol,
  nearestNewRow,
  oldLetterToFeet,
  oldNumberToFeet,
  parseOldGrid,
  summarizeMigration,
} from "@/lib/electrical-grid-migration";

describe("previous-drawing interpretation", () => {
  it("places A6 at the north-east corner", () => {
    expect(oldLetterToFeet("A")).toBe(0);
    expect(oldNumberToFeet(6)).toBe(60);
    expect(oldLetterToFeet("G")).toBe(40);
    expect(oldNumberToFeet(1)).toBe(0);
  });

  it("parses labels, half steps and via-notes without dropping them", () => {
    expect(parseOldGrid("E1 (via FS46)")).toMatchObject({
      letter: "E",
      number: 1,
      note: "(via FS46)",
      uninterpretable: false,
    });
    expect(parseOldGrid("G5.5").number).toBe(5.5);
    expect(parseOldGrid("??").uninterpretable).toBe(true);
    expect(parseOldGrid("0.00%").uninterpretable).toBe(true);
  });
});

describe("corrected-drawing gridlines", () => {
  it("snaps to the drawn line spacing", () => {
    expect(nearestNewRow(0).label).toBe("A");
    expect(nearestNewRow(40).label).toBe("F");
    expect(nearestNewCol(60).label).toBe("9");
    expect(nearestNewCol(57).label).toBe("8");
  });

  it("reports a tie when a position lands midway between two lines", () => {
    const mid = nearestNewCol(12);
    expect(mid.tie).toBe(true);
    expect([mid.label, mid.runnerUp?.label].sort()).toEqual(["2", "3"]);
    expect(nearestNewCol(9).tie).toBe(false);
  });
});

describe("physical remapping, not label remapping", () => {
  it("keeps the north-east corner in the north-east", () => {
    const r = migrateRow({
      kind: "load",
      stable_id: "FS-011",
      description: "Eero Wifi 7 outdoor hub (8')",
      grid: "A6",
      location: "NE Corner & SW Corner",
    });
    expect(r.proposed_new_grid).toBe("A9");
    expect(r.confidence).toBe("HIGH");
    expect(r.old_physical_position).toContain("60 ft E of west wall");
  });

  it("does not carry an old label through unchanged when the physical point moved", () => {
    const r = migrateRow({
      kind: "load",
      stable_id: "FS-039",
      description: "Double Gang plugs every 6' in lower shop",
      grid: "F6",
      location: "East Wall",
    });
    // Old F = 33.3 ft south → corrected row E (32 ft); old 6 = east wall → column 9.
    expect(r.proposed_new_grid).toBe("E9");
    expect(r.confidence).toBe("HIGH");
  });

  it("treats a half step as a midpoint position", () => {
    const r = migrateRow({
      kind: "load",
      stable_id: "FS-063",
      description: "Overhead LED",
      grid: "C2.5",
      location: "Main Shop Bays",
    });
    expect(r.mapping_basis).toContain("physical midpoint");
    expect(r.proposed_new_grid).toBe("C3");
  });

  it("flags genuinely ambiguous positions instead of rounding them", () => {
    const r = migrateRow({
      kind: "load",
      stable_id: "FS-073",
      description: "Outside plugs 2 double gang per wall GFCI",
      grid: "B2",
      location: "P1S3; P2s3 (2 evenly spaced per wall)",
    });
    // Old number 2 = 12 ft east, exactly between corrected columns 2 (8 ft) and 3 (16 ft).
    expect(r.proposed_new_grid).toBeNull();
    expect(r.confidence).toBe("REVIEW");
    expect(r.review_reason).toContain("midway");
  });

  it("keeps an odd-numbered old line that lands exactly on a corrected column", () => {
    const r = migrateRow({
      kind: "load",
      stable_id: "FS-048",
      description: "Double Gang plugs every 12' in Garage bays area",
      grid: "A3",
      location: "TBD",
    });
    expect(r.proposed_new_grid).toBe("A4");
    expect(r.confidence).toBe("HIGH");
  });


  it("refuses to invent a position from a junk grid cell", () => {
    for (const grid of ["?", "??", "0.00%"]) {
      const r = migrateRow({ kind: "load", stable_id: "FS-072", description: "Lights", grid });
      expect(r.proposed_new_grid).toBeNull();
      expect(r.confidence).toBe("REVIEW");
      expect(r.old_physical_position).toBe("NOT IN RECORD");
    }
  });
});

describe("corrected-drawing anchors", () => {
  it("places the drawn garage doors and NE man door from the drawing itself", () => {
    const gdW = migrateRow({
      kind: "load",
      stable_id: "FS-054",
      description: "Garage Door W",
      grid: "A3",
      location: "North Side",
    });
    expect(gdW.proposed_new_grid).toBe("A2");
    expect(gdW.confidence).toBe("HIGH");
    expect(gdW.mapping_basis).toContain("GD2");

    const gdE = migrateRow({
      kind: "load",
      stable_id: "FS-055",
      description: "Garage Doors E",
      grid: "A5",
      location: "North Side",
    });
    expect(gdE.proposed_new_grid).toBe("A5");

    const ne = migrateRow({
      kind: "load",
      stable_id: "FS-068",
      description: "Shop Man doors (small goose neck; double)",
      grid: "A5",
      location: "NE Man Door",
    });
    expect(ne.proposed_new_grid).toBe("A8");
  });

  it("flags a man door that names no corner", () => {
    const r = migrateRow({
      kind: "load",
      stable_id: "FS-068",
      description: "Shop Man doors (small goose neck; double)",
      grid: "A5",
      location: "Man Door",
    });
    expect(r.proposed_new_grid).toBeNull();
    expect(r.mapping_basis).toContain("two man doors");
  });
});

describe("panels and output", () => {
  it("includes PNL-FS-NW and PNL-FS-NE from the corrected corner gridlines", () => {
    const rows = migrateAll([
      { kind: "panel", stable_id: "PNL-FS-NW", description: "Farm Shop NW", grid: "" },
      { kind: "panel", stable_id: "PNL-FS-NE", description: "Farm Shop NE", grid: "" },
      { kind: "panel", stable_id: "PNL-FS-CRIT", description: "Critical", grid: "" },
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.stable_id, r]));
    expect(byId["PNL-FS-NW"].proposed_new_grid).toBe("A1");
    expect(byId["PNL-FS-NE"].proposed_new_grid).toBe("A9");
    expect(byId["PNL-FS-NW"].confidence).toBe("MEDIUM");
    expect(byId["PNL-FS-CRIT"].proposed_new_grid).toBeNull();
  });

  it("summarizes and exports the requested columns", () => {
    const rows = migrateAll([
      { kind: "load", stable_id: "FS-011", description: "Hub", grid: "A6" },
      { kind: "load", stable_id: "FS-073", description: "Plugs", grid: "B2" },
    ]);
    const s = summarizeMigration(rows);
    expect(s.rows).toBe(2);
    expect(s.high + s.medium + s.review).toBe(2);
    const csv = migrationCsv(rows);
    expect(csv.split("\n")[0]).toBe(
      "stable_id,description,old_grid,old_physical_position,proposed_new_grid,confidence,mapping_basis,review_reason",
    );
    expect(csv).toContain("OWNER REVIEW");
  });
});
