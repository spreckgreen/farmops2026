// Phase 4.4b — initial-population safety gate.
//
// Pins the three-way classification, the "no inference" rules (amperage never
// derived from directory description text, uncertain text never promoted to a
// label), and the exact set of columns an Apply would populate.
import { describe, expect, it } from "vitest";
import {
  breakerPopulationDiagnostics,
  isCreatable,
  planBreakerPopulation,
} from "@/lib/electrical-breaker-population";
import type {
  BreakerObservation,
  Confidence,
  FarmOpsBreaker,
  ObservedField,
} from "@/lib/electrical-house-panel-field";

const prov = (row: number) => ({
  workbook: "House.ods",
  worksheet: "House_Main",
  source_row: row,
  source_column: null,
  source_photo: null,
});

function f(
  field: ObservedField["field"],
  observed_text: string,
  interpreted: string | number | null,
  opts: Partial<ObservedField> = {},
): ObservedField {
  return {
    field,
    observed_text,
    interpreted,
    confidence: (opts.confidence ?? "high") as Confidence,
    verification_required: opts.verification_required ?? false,
    unknown_value: opts.unknown_value ?? false,
    provenance: prov(1),
    ...opts,
  } as ObservedField;
}

function obs(over: Partial<BreakerObservation>): BreakerObservation {
  return {
    key: "k",
    panel_source_name: "House Main",
    panel_id: "PNL-H1",
    identity_status: "resolved",
    positions: [26, 28],
    positions_text: "26/28",
    poles: 2,
    slot: null,
    position_status: "resolved",
    fields: [],
    notes: "",
    provenance: prov(10),
    duplicate_sources: [],
    merged_positions_from: [],
    ...over,
  } as BreakerObservation;
}

const plan = (observations: BreakerObservation[], farmops: FarmOpsBreaker[] = []) =>
  planBreakerPopulation({ observations, farmops });

describe("initial-population safety gate", () => {
  it("classifies a fully structural breaker as SAFE_STRUCTURAL_CREATE", () => {
    const r = plan([
      obs({ fields: [f("poles", "2", 2), f("label", "SUB PANEL", "SUB PANEL")] }),
    ])[0]!;
    expect(r.safety_class).toBe("SAFE_STRUCTURAL_CREATE");
    expect(r.requires_field_verification).toBe(false);
    expect(r.verification_note).toBeNull();
    expect(isCreatable(r)).toBe(true);
  });

  it("never stores amperage taken from directory description text", () => {
    const r = plan([
      obs({
        positions: [5],
        positions_text: "5",
        poles: 1,
        fields: [f("label", "AC 1ST FL 30A", "AC 1ST FL 30A")],
      }),
    ])[0]!;
    expect(r.ocp_amps).toBeNull();
    expect(r.safety_class).toBe("SAFE_STRUCTURAL_CREATE");
    const amps = r.proposed_columns.find((c) => c.column === "ocp_amps")!;
    expect(amps.value).toBeNull();
    expect(amps.source_evidence).toContain("never inferred");
  });

  it("flags uncertain directory text for verification instead of writing it as a label", () => {
    const r = plan([
      obs({
        positions: [7],
        positions_text: "7",
        poles: 1,
        fields: [f("label", "??? maybe well pump", "??? maybe well pump", { confidence: "low" })],
      }),
    ])[0]!;
    expect(r.safety_class).toBe("CREATE_WITH_VERIFICATION_FLAGS");
    expect(r.label).toBeNull();
    expect(r.label_observed_text).toBe("??? maybe well pump");
    expect(r.requires_field_verification).toBe(true);
    expect(r.verification_note).toContain("??? maybe well pump");
    expect(isCreatable(r)).toBe(true);
  });

  it("keeps a position/pole mismatch BLOCKED and never infers the paired position", () => {
    const r = plan([
      obs({ positions: [26], positions_text: "26", poles: 2, fields: [f("poles", "2", 2)] }),
    ])[0]!;
    expect(r.safety_class).toBe("BLOCKED");
    expect(isCreatable(r)).toBe(false);
    expect(r.slots).toHaveLength(1);
  });

  it("blocks an unresolved panel and an existing record", () => {
    const existing: FarmOpsBreaker = {
      panel_id: "PNL-H1",
      side: "Right",
      position: 13,
      breaker_number: 26,
      poles: 2,
      ocp_amps: 60,
      label: "SUB PANEL",
    };
    const rows = plan(
      [
        obs({ panel_id: null, positions: [3], positions_text: "3", fields: [f("label", "X", "X")] }),
        obs({ fields: [f("label", "SUB PANEL", "SUB PANEL")] }),
      ],
      [existing],
    );
    expect(rows.every((r) => r.safety_class === "BLOCKED")).toBe(true);
    const d = breakerPopulationDiagnostics(rows);
    expect(d.blocked_total).toBe(2);
    expect(d.eligible_to_create).toBe(0);
    expect(d.positions_to_create).toBe(0);
  });

  it("reports the safety-gate summary counts", () => {
    const rows = plan([
      obs({ fields: [f("label", "SUB PANEL", "SUB PANEL")] }),
      obs({
        positions: [7],
        positions_text: "7",
        poles: 1,
        fields: [f("label", "VERIFY well pump", null, { verification_required: true })],
      }),
      obs({ positions: [9], positions_text: "9", poles: 2, fields: [f("poles", "2", 2)] }),
    ]);
    const d = breakerPopulationDiagnostics(rows);
    expect(d.safe_structural_creates).toBe(1);
    expect(d.creates_requiring_verification).toBe(1);
    expect(d.blocked_total).toBe(1);
    expect(d.safe_structural_creates + d.creates_requiring_verification + d.blocked_total).toBe(
      d.unique_breakers_considered,
    );
  });

  it("shows exactly which columns would be populated, with evidence", () => {
    const r = plan([obs({ fields: [f("label", "SUB PANEL", "SUB PANEL")] })])[0]!;
    const cols = r.proposed_columns.map((c) => c.column);
    expect(cols).toEqual(
      expect.arrayContaining(["panel_uuid", "side / position", "poles", "ocp_amps", "label", "notes"]),
    );
    expect(r.proposed_columns.every((c) => c.source_evidence.length > 0)).toBe(true);
    expect(r.proposed_columns.find((c) => c.column === "install_status")!.value).toBeNull();
  });
});
