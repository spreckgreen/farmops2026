import { describe, expect, it } from "vitest";
import {
  AMPS_SEMANTICS,
  BRYANT_MANUFACTURER_CURRENTS,
  bryantSemanticPatch,
  currentComparability,
  LEGACY_AMPS_COLUMN,
  loadCurrentSemantics,
  OPEN_CURRENT_SEMANTICS_FINDINGS,
  SEMANTIC_COLUMN,
} from "@/lib/electrical-current-model";

describe("additive current semantic model", () => {
  it("limits the enum to the eight established concepts", () => {
    expect([...AMPS_SEMANTICS]).toEqual([
      "CONNECTED_LOAD_CURRENT",
      "EQUIPMENT_FLA",
      "RATED_CURRENT",
      "RLA",
      "MCA",
      "MOCP",
      "INSTALLED_OCP_RATING",
      "DESIGN_CIRCUIT_AMPACITY",
    ]);
  });

  it("never backfills a semantic field from legacy amps", () => {
    const record = { amps: 60, amps_semantic: null, amps_semantic_provenance: null };
    const view = loadCurrentSemantics(record);
    expect(view.legacyAmps).toBe(60);
    expect(view.legacyUnresolved).toBe(true);
    expect(view.rows.every((r) => r.value === null)).toBe(true);
  });

  it("shows semantic unresolved rather than load current for an unproven legacy value", () => {
    const view = loadCurrentSemantics({ amps: 25, amps_semantic: "MOCP" }); // enum without provenance
    expect(view.legacyUnresolved).toBe(true);
    expect(view.legacySemantic).toBeNull();
  });

  it("keeps legacy amps byte-for-byte unchanged when Bryant provenance is applied", () => {
    const before = { load_id: "FS-084", amps: 60, volts: 240 };
    const patch = bryantSemanticPatch("FS-084")!;
    const after = { ...before, ...patch };
    expect(after.amps).toBe(before.amps);
    expect(Object.keys(patch)).not.toContain(LEGACY_AMPS_COLUMN);
    expect(Object.keys(patch)).not.toContain("amps_semantic");
  });

  it("populates only manufacturer-supported Bryant fields and never derives MCA", () => {
    for (const id of ["FS-082", "FS-083", "FS-084"]) {
      const patch = bryantSemanticPatch(id)!;
      expect(patch).toEqual({
        maximum_overcurrent_protection: 25,
        rated_current_amps: 1.69,
        rated_load_amps: 4.15,
      });
      expect(patch[SEMANTIC_COLUMN.MCA]).toBeUndefined();
    }
    expect(BRYANT_MANUFACTURER_CURRENTS.minimum_circuit_ampacity).toBeNull();
    expect(bryantSemanticPatch("FS-034")).toBeNull();
  });

  it("suppresses comparison between an unproven legacy scalar and a manufacturer field", () => {
    const r = currentComparability(
      { column: "amps" },
      { column: SEMANTIC_COLUMN.MOCP },
    );
    expect(r.comparable).toBe(false);
  });

  it("compares like concepts only", () => {
    expect(
      currentComparability({ column: SEMANTIC_COLUMN.MOCP }, { column: SEMANTIC_COLUMN.MOCP })
        .comparable,
    ).toBe(true);
    expect(
      currentComparability({ column: SEMANTIC_COLUMN.RLA }, { column: SEMANTIC_COLUMN.MCA })
        .comparable,
    ).toBe(false);
    expect(
      currentComparability(
        { column: "amps", semantic: "MOCP", provenance: "installer sticker photo" },
        { column: SEMANTIC_COLUMN.MOCP },
      ).comparable,
    ).toBe(true);
  });

  it("keeps the four current-semantics findings open", () => {
    expect(OPEN_CURRENT_SEMANTICS_FINDINGS).toHaveLength(4);
    expect(
      OPEN_CURRENT_SEMANTICS_FINDINGS.map((f) => `${f.stableId}:${f.system}:${f.value}`),
    ).toEqual([
      "FS-082:canonical_ods:0",
      "FS-083:canonical_ods:0",
      "FS-084:canonical_ods:60",
      "FS-084:farmops:25",
    ]);
  });
});
