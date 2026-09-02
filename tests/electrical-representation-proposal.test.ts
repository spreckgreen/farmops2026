import { describe, expect, it } from "vitest";

import {
  REPRESENTATION_CONCEPTS,
  representationPairFor,
  representationProposal,
  representationProposalCsv,
  representationProposalMarkdown,
  vaProduct,
} from "@/lib/electrical-representation-proposal";

const p = representationProposal({ generatedAt: "2026-09-02T00:00:00.000Z" });
const row = (id: string, concept: string) =>
  p.rows.find((r) => r.stable_id === id && r.concept === concept)!;

describe("FS-034 / FS-092 voltage and VA representation proposal", () => {
  it("models the five required concepts", () => {
    expect(REPRESENTATION_CONCEPTS).toEqual([
      "nominal_supply_voltage",
      "rated_nameplate_voltage",
      "connected_va",
      "connected_va_basis",
      "equipment_fla",
    ]);
  });

  it("preserves both voltage concepts for FS-034", () => {
    expect(row("FS-034", "nominal_supply_voltage").canonical_value).toBe("240 V");
    expect(row("FS-034", "rated_nameplate_voltage").nameplate_value).toBe("220 V");
    expect(row("FS-034", "rated_nameplate_voltage").proposed_representation).toContain("220 V");
    expect(row("FS-034", "rated_nameplate_voltage").proposed_representation).toContain("240 V");
  });

  it("keeps canonical 7200 VA on the nominal basis and 6600 VA as an alternative basis", () => {
    const va = row("FS-034", "connected_va");
    expect(va.canonical_value).toContain("7200 VA");
    expect(va.canonical_value).toContain("240 × 30 = 7200 VA");
    expect(va.nameplate_value).toContain("220 × 30 = 6600 VA");
    expect(va.va_basis).toBe("nominal_design_supply_voltage");
    expect(va.proposed_representation).toMatch(/not as a correction/);
  });

  it("models FS-092 nominal 120 V / nameplate 115 V with FLA 8.8 A", () => {
    expect(row("FS-092", "nominal_supply_voltage").canonical_value).toBe("120 V");
    expect(row("FS-092", "rated_nameplate_voltage").nameplate_value).toBe("115 V");
    const fla = row("FS-092", "equipment_fla");
    expect(fla.nameplate_value).toContain("8.8 A published FLA");
    expect(fla.proposed_representation).toContain("equipment_fla = 8.8 A");
    const va = row("FS-092", "connected_va");
    expect(va.canonical_value).toContain("120 × 8.8 = 1056 VA");
    expect(va.nameplate_value).toContain("115 × 8.8 = 1012 VA");
    expect(vaProduct(115, 8.8)).toBe(1012);
  });

  it("requires an explicit connected_va_basis", () => {
    for (const id of ["FS-034", "FS-092"]) {
      const basis = row(id, "connected_va_basis");
      expect(basis.proposed_representation).toContain("connected_va_basis is required");
      for (const v of [
        "nominal_design_supply_voltage",
        "equipment_nameplate_voltage",
        "manufacturer_supplied_va",
        "other_documented_basis",
      ]) {
        expect(basis.proposed_representation).toContain(v);
      }
    }
  });

  it("cites provenance on every row and authorizes no writes", () => {
    for (const r of p.rows) {
      expect(r.provenance.length).toBeGreaterThan(0);
      expect(r.farmops_write_authorized).toBe(false);
      expect(r.ods_edit_authorized).toBe(false);
    }
    expect(p.read_only).toBe(true);
    expect(p.apply_available).toBe(false);
  });

  it("reclassifies the four known Category-B pairs", () => {
    const cases: [string, string, number, number][] = [
      ["FS-034", "volts", 240, 220],
      ["FS-034", "connected_va", 7200, 6600],
      ["FS-092", "volts", 120, 115],
      ["FS-092", "connected_va", 1056, 1012],
    ];
    for (const [id, field, ods, fp] of cases) {
      const pair = representationPairFor({
        stable_id: id,
        farmops_entity: "electrical_loads",
        farmops_field: field,
        ods_value: ods,
        farmops_value: fp,
      });
      expect(pair, `${id}.${field}`).toBeTruthy();
      expect(pair!.disposition).toBe("SEMANTIC_REPRESENTATION_DIFFERENCE");
    }
    expect(p.counts.reclassified_pairs).toBe(4);
    expect(p.counts.retained_disagreements).toBe(0);
  });

  it("does not reclassify unrelated differences", () => {
    expect(
      representationPairFor({
        stable_id: "FS-034",
        farmops_entity: "electrical_loads",
        farmops_field: "volts",
        ods_value: 240,
        farmops_value: 208,
      }),
    ).toBeNull();
    expect(
      representationPairFor({
        stable_id: "FS-084",
        farmops_entity: "electrical_loads",
        farmops_field: "connected_va",
        ods_value: 14400,
        farmops_value: 6600,
      }),
    ).toBeNull();
  });

  it("exports CSV and Markdown with the required columns", () => {
    const csv = representationProposalCsv(p);
    const header = csv.split("\n")[0]!;
    for (const col of [
      "stable_id",
      "concept",
      "canonical_design_value",
      "equipment_nameplate_value",
      "farmops_legacy_value",
      "calculation_basis",
      "proposed_representation",
      "disposition",
      "provenance",
    ]) {
      expect(header).toContain(col);
    }
    const md = representationProposalMarkdown(p);
    expect(md).toContain("FS-034");
    expect(md).toContain("FS-092");
    expect(md).toContain("connected_va_basis");
  });
});
