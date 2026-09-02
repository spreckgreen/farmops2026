import { describe, expect, it } from "vitest";
import {
  nameplateChanges,
  nameplateColumnPatch,
  sanitizeNameplateProposal,
} from "@/lib/electrical-nameplate-write";

describe("sanitizeNameplateProposal", () => {
  it("keeps writable fields and drops junk", () => {
    expect(
      sanitizeNameplateProposal({
        manufacturer: " Mitsubishi ",
        model: "SUZ-KA18NAHZ",
        serial: "unknown",
        voltage: "208-230",
        fla: "12.4",
        hp: "1.5 HP", // not a writable field
        notes: "smudged",
        mocp: null,
      }),
    ).toEqual({
      manufacturer: "Mitsubishi",
      model: "SUZ-KA18NAHZ",
      voltage: "208-230",
      fla: "12.4",
    });
  });
});

describe("nameplateColumnPatch", () => {
  it("maps onto nameplate_* columns only", () => {
    expect(nameplateColumnPatch({ fla: "12.4", mocp: "20" })).toEqual({
      nameplate_fla_rla: "12.4",
      nameplate_mocp: "20",
    });
  });
});

describe("nameplateChanges", () => {
  it("skips values already recorded and flags overwrites", () => {
    const changes = nameplateChanges(
      { model: "SUZ-KA18NAHZ", mca: "15" },
      { nameplate_model: "SUZ-KA18NAHZ", nameplate_mca: "14" },
    );
    expect(changes.map((c) => [c.id, c.current, c.proposed, c.overwrite])).toEqual([
      ["mca", "14", "15", true],
    ]);
  });

  it("treats an empty row as a first write", () => {
    const changes = nameplateChanges({ serial: "A1" }, null);
    expect(changes[0]).toMatchObject({ column: "nameplate_serial", overwrite: false });
  });
});
