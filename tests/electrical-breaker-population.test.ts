import { describe, expect, it } from "vitest";
import {
  breakerPopulationCsv,
  breakerPopulationDiagnostics,
  breakerPopulationMarkdown,
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

describe("planBreakerPopulation", () => {
  it("keeps PNL-H1 26/28 SUB PANEL 60A as one 2-pole breaker over two positions", () => {
    const rows = planBreakerPopulation({
      observations: [
        obs({
          fields: [f("ocp_amps", "60A", 60), f("label", "SUB PANEL 60A", "SUB PANEL 60A"), f("poles", "2", 2)],
        }),
      ],
      farmops: [],
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.poles).toBe(2);
    expect(r.slots).toHaveLength(2);
    expect(r.ocp_amps).toBe(60);
    expect(r.label).toBe("SUB PANEL 60A");
    expect(r.action).toBe("propose_create");
  });

  it("never infers unknown breaker amps", () => {
    const rows = planBreakerPopulation({
      observations: [
        obs({
          positions: [5],
          positions_text: "5",
          poles: 1,
          fields: [f("ocp_amps", "UNKNOWN", null, { unknown_value: true }), f("label", "KITCHEN", "KITCHEN")],
        }),
      ],
      farmops: [],
    });
    expect(rows[0]!.ocp_amps).toBeNull();
    expect(rows[0]!.amps_unknown).toBe(true);
  });

  it("keeps VERIFY text verification-required instead of a confirmed value", () => {
    const rows = planBreakerPopulation({
      observations: [
        obs({
          positions: [7],
          positions_text: "7",
          fields: [f("label", "VERIFY - well pump?", null, { verification_required: true, confidence: "low" })],
        }),
      ],
      farmops: [],
    });
    expect(rows[0]!.verification_status).toBe("required");
    expect(rows[0]!.action).toBe("requires_review");
  });

  it("blocks a 2-pole breaker that resolves to a single position", () => {
    const rows = planBreakerPopulation({
      observations: [
        obs({ positions: [26], positions_text: "26", poles: 2, fields: [f("poles", "2", 2)] }),
      ],
      farmops: [],
    });
    expect(rows[0]!.action).toBe("blocked_position_mismatch");
    expect(rows[0]!.blocking_reason).toContain("2-pole");
  });

  it("classifies an existing record as already_exists and compares values", () => {
    const existing: FarmOpsBreaker = {
      panel_id: "PNL-H1",
      side: "Right",
      position: 13,
      breaker_number: 26,
      poles: 2,
      ocp_amps: 50,
      label: "SUB PANEL",
    };
    const rows = planBreakerPopulation({
      observations: [
        obs({ fields: [f("ocp_amps", "60A", 60), f("label", "SUB PANEL 60A", "SUB PANEL 60A")] }),
      ],
      farmops: [existing],
    });
    expect(rows[0]!.action).toBe("already_exists");
    expect(rows[0]!.differences.map((d) => d.field)).toEqual(
      expect.arrayContaining(["ocp_amps", "label"]),
    );
  });

  it("blocks unresolved panels and reports diagnostics + exports", () => {
    const rows = planBreakerPopulation({
      observations: [
        obs({ panel_id: null, positions: [3], positions_text: "3", fields: [f("label", "X", "X")] }),
        obs({ fields: [f("ocp_amps", "60A", 60)] }),
      ],
      farmops: [],
    });
    const d = breakerPopulationDiagnostics(rows);
    expect(d.unique_breakers_considered).toBe(2);
    expect(d.blocked_unresolved).toBe(1);
    expect(d.eligible_to_create).toBe(1);
    expect(d.positions_to_create).toBe(2);
    expect(breakerPopulationCsv(rows).split("\n")).toHaveLength(3);
    expect(breakerPopulationMarkdown(rows, d, "2026-08-31T00:00:00Z")).toContain(
      "breaker-position population preview",
    );
  });
});
