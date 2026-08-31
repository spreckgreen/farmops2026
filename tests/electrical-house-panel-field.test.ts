// Phase 4.4b — House panel photo reconciliation regression fixture.
//
// The fixture mirrors the structure of `house_panels_bulk_update.ods`: one
// worksheet per photographed panel directory with panel / circuit / poles /
// breaker-amps / description columns.
import { describe, expect, it } from "vitest";
import type { Sheet } from "@/lib/electrical-ods";
import {
  FARM_SHOP_SCOPE,
  fieldReconciliationCsv,
  fieldReconciliationMarkdown,
  interpretAmps,
  interpretDescription,
  parseHousePanelSheets,
  parsePositions,
  reconcileHousePanelObservations,
  reconciliationTotals,
  resolvePanelIdentity,
  slotForBreakerNumber,
  type FarmOpsBreaker,
} from "@/lib/electrical-house-panel-field";

const HEADER = ["Panel", "Circuit", "Poles", "Breaker Amps", "Description", "Notes", "Photo"];

const sheets: Sheet[] = [
  {
    name: "HOUSE-MAIN",
    rows: [
      ["House main panel directory — photo transcription"],
      HEADER,
      ["HOUSE-MAIN", "26/28", "2", "60", "SUB PANEL", "", "IMG_2201.jpg"],
      ["HOUSE-MAIN", "1", "1", "20", "Kitchen lights - VERIFY", "", "IMG_2201.jpg"],
      ["HOUSE-MAIN", "3", "1", "VERIFY", "Well pump", "", "IMG_2201.jpg"],
      ["HOUSE-MAIN", "5", "1", "15", "UNKNOWN LOAD", "", "IMG_2202.jpg"],
      ["HOUSE-MAIN", "7", "1", "20", "Garage receptacles?", "", "IMG_2202.jpg"],
      ["HOUSE-ANNEX", "9", "1", "20", "Shed feed", "", "IMG_2203.jpg"],
      ["HOUSE-MAIN", "bad-pos", "1", "20", "Unreadable", "", "IMG_2203.jpg"],
    ],
  },
  {
    name: "HOUSE-SUBPANEL",
    rows: [
      HEADER,
      ["HOUSE-SUBPANEL", "2", "1", "20", "Basement receptacles", "", "IMG_2210.jpg"],
    ],
  },
];

const parsed = parseHousePanelSheets(sheets, { workbook: "house_panels_bulk_update.ods" });

const farmops: FarmOpsBreaker[] = [
  // 26 → Right 13 (two-column panel numbering).
  { panel_id: "PNL-H1", side: "Right", position: 13, breaker_number: 26, poles: 2, ocp_amps: null, label: null },
  { panel_id: "PNL-H1", side: "Left", position: 1, breaker_number: 1, poles: 1, ocp_amps: 20, label: "Kitchen lights" },
  { panel_id: "PNL-H1", side: "Left", position: 2, breaker_number: 3, poles: 1, ocp_amps: 30, label: "Well pump" },
  { panel_id: "PNL-H1", side: "Left", position: 3, breaker_number: 5, poles: 1, ocp_amps: 15, label: "Spare" },
  { panel_id: "PNL-H1", side: "Left", position: 4, breaker_number: 7, poles: 1, ocp_amps: 20, label: "Garage receptacles" },
  { panel_id: "PNL-H2", side: "Right", position: 1, breaker_number: 2, poles: 1, ocp_amps: 20, label: "Basement receptacles" },
];

describe("workbook parsing and identity", () => {
  it("resolves HOUSE-MAIN to PNL-H1 and HOUSE-SUBPANEL to PNL-H2", () => {
    expect(resolvePanelIdentity("HOUSE-MAIN")).toBe("PNL-H1");
    expect(resolvePanelIdentity("HOUSE-SUBPANEL")).toBe("PNL-H2");
    expect(resolvePanelIdentity("HOUSE-ANNEX")).toBeNull();
  });

  it("treats 26/28 SUB PANEL 60A as ONE 2-pole breaker over two positions", () => {
    const sub = parsed.observations.find((o) => o.positions_text === "26/28");
    expect(sub).toBeDefined();
    expect(sub!.positions).toEqual([26, 28]);
    expect(sub!.poles).toBe(2);
    expect(sub!.slot).toEqual({ side: "Right", position: 13 });
    // Exactly one logical breaker for those two positions, not two 60 A loads.
    expect(parsed.observations.filter((o) => o.positions.includes(28)).length).toBe(1);
    const amps = sub!.fields.filter((f) => f.field === "ocp_amps");
    expect(amps).toHaveLength(1);
    expect(amps[0].interpreted).toBe(60);
  });

  it("maps breaker numbers to physical slots", () => {
    expect(slotForBreakerNumber(1)).toEqual({ side: "Left", position: 1 });
    expect(slotForBreakerNumber(26)).toEqual({ side: "Right", position: 13 });
    expect(parsePositions("26/28")).toEqual([26, 28]);
    expect(parsePositions("bad-pos")).toEqual([]);
  });

  it("keeps VERIFY amperage unknown and never guesses", () => {
    const r = interpretAmps("VERIFY");
    expect(r.interpreted).toBeNull();
    expect(r.verification_required).toBe(true);
    expect(interpretAmps("60").interpreted).toBe(60);
  });

  it("does not fabricate a load from UNKNOWN LOAD", () => {
    const r = interpretDescription("UNKNOWN LOAD");
    expect(r.interpreted).toBeNull();
    expect(r.unknown_value).toBe(true);
  });

  it("retains verbatim observed text beside every interpretation", () => {
    for (const obs of parsed.observations) {
      for (const f of obs.fields) {
        expect(typeof f.observed_text).toBe("string");
        expect(f.provenance.workbook).toBe("house_panels_bulk_update.ods");
        expect(f.provenance.source_row).toBeGreaterThan(0);
      }
    }
  });
});

describe("three-way reconciliation", () => {
  const rows = reconcileHousePanelObservations({
    parsed,
    farmops,
    canonical: {
      "PNL-H1|1|ocp_amps": "20",
      "PNL-H1|3|ocp_amps": "20",
      "PNL-H1|7|label": "Garage receptacles",
    },
    currentSubpanelParent: null,
  });

  const find = (positions: string, field: string) =>
    rows.find((r) => r.positions_text === positions && r.field === field);

  it("classifies an unresolved panel name instead of inventing an identity", () => {
    const r = rows.find((x) => x.classification === "UNRESOLVED_PANEL_IDENTITY");
    expect(r?.panel_source_name).toBe("HOUSE-ANNEX");
    expect(r?.proposed_action).toBe("requires_review");
  });

  it("classifies an unparseable position", () => {
    expect(rows.some((r) => r.classification === "UNRESOLVED_CIRCUIT_POSITION")).toBe(true);
  });

  it("proposes PNL-H1 → PNL-H2 from the SUB PANEL breaker evidence", () => {
    const t = rows.find((r) => r.classification === "TOPOLOGY_PROPOSAL");
    expect(t?.topology).toMatchObject({ panel_id: "PNL-H2", proposed_parent: "PNL-H1" });
    expect(t?.proposed_action).toBe("propose_topology_update");
    expect(t?.topology?.evidence).toContain("26/28");
  });

  it("reports no topology proposal when the current revision already has it", () => {
    const already = reconcileHousePanelObservations({
      parsed,
      farmops,
      currentSubpanelParent: "PNL-H1",
    });
    expect(already.some((r) => r.classification === "TOPOLOGY_PROPOSAL")).toBe(false);
  });

  it("marks a VERIFY description as verification-required, not confirmed", () => {
    const r = find("1", "label");
    expect(r?.classification).toBe("FIELD_VERIFICATION_REQUIRED");
    expect(r?.proposed_action).toBe("requires_review");
    expect(r?.field_observed_text).toBe("Kitchen lights - VERIFY");
  });

  it("keeps a ? description verification-required", () => {
    expect(find("7", "label")?.verification_required).toBe(true);
  });

  it("preserves an UNKNOWN LOAD observation without proposing a value", () => {
    const r = find("5", "label");
    expect(r?.classification).toBe("UNKNOWN_FIELD_VALUE");
    expect(r?.proposed_action).toBe("preserve_observation_only");
    expect(r?.target).toBeUndefined();
  });

  it("flags an engineering disagreement rather than silently choosing", () => {
    // Canonical 20 A, FarmOps 30 A, field VERIFY → verification-required, no write.
    expect(find("3", "ocp_amps")?.proposed_action).not.toBe("propose_farmops_update");
  });

  it("matches when all three sources agree", () => {
    expect(find("1", "ocp_amps")?.classification).toBe("MATCH");
  });

  it("only proposes writes for supported observations and never whole rows", () => {
    for (const r of rows) {
      if (r.proposed_action !== "propose_farmops_update") continue;
      expect(r.target).toBeDefined();
      expect(r.target!.table).toBe("electrical_breaker_positions");
      // Exactly one column per proposal.
      expect(["ocp_amps", "poles", "label"]).toContain(r.target!.column);
    }
  });

  it("produces diagnostics, CSV and a Markdown report", () => {
    const totals = reconciliationTotals(parsed, rows);
    expect(totals.unique_logical_breakers).toBe(parsed.observations.length);
    expect(totals.source_rows_read).toBeGreaterThanOrEqual(totals.unique_logical_breakers);

    expect(totals.multi_pole).toBe(1);
    expect(totals.single_pole).toBeGreaterThan(0);
    expect(totals.topology_proposals).toBe(1);
    const csv = fieldReconciliationCsv(rows);
    expect(csv.split("\n")[0]).toContain("canonical_engineering");
    expect(csv).toContain("house_panels_bulk_update.ods");
    const md = fieldReconciliationMarkdown(parsed, rows, "2026-08-31T00:00:00.000Z");
    expect(md).toContain("Preview performed no database writes.");
    expect(md).toContain("SOR_AUTHORITY");
    expect(md).toContain("LOSS = 0");
  });

  it("never proposes a change to the canonical ODS or a future revision", () => {
    for (const r of rows) {
      expect(r.target?.table ?? "electrical_breaker_positions").toBe("electrical_breaker_positions");
      expect(r.topology?.panel_id ?? "PNL-H2").toBe("PNL-H2");
    }
  });
});

// ---------------------------------------------------------------------------
// Farm Shop scope: same evidence model, different naming and topology
// candidates. Ambiguity is reported, never guessed.
// ---------------------------------------------------------------------------
describe("farm shop scope", () => {
  const shopSheets: Sheet[] = [
    {
      name: "Shop NW",
      rows: [
        HEADER,
        ["FARM SHOP NW", "1", "1", "20", "Welder receptacle", "", "IMG_3001.jpg"],
        ["FARM SHOP NW", "3/5", "2", "60", "CRITICAL SUB PANEL", "", "IMG_3001.jpg"],
      ],
    },
    { name: "Shop Critical", rows: [HEADER, ["", "2", "1", "15", "Freezer", "", "IMG_3010.jpg"]] },
  ];

  const shopParsed = parseHousePanelSheets(shopSheets, {
    workbook: "farm_shop_panels.ods",
    aliases: FARM_SHOP_SCOPE.aliases,
    sheetPanelHints: FARM_SHOP_SCOPE.sheet_panel_hints,
  });

  it("resolves farm shop panel identity from aliases and worksheet hints", () => {
    expect(shopParsed.observations.map((o) => o.panel_id)).toEqual(
      expect.arrayContaining(["PNL-FS-NW", "PNL-FS-CRIT"]),
    );
  });

  it("proposes an unambiguous sub-panel feeder and reports the current parent", () => {
    const rows = reconcileHousePanelObservations({
      parsed: shopParsed,
      farmops: [],
      scope: FARM_SHOP_SCOPE,
      currentParents: { "PNL-FS-CRIT": null },
    });
    const topo = rows.find((r) => r.field === "parent_panel");
    expect(topo?.classification).toBe("TOPOLOGY_PROPOSAL");
    expect(topo?.panel_id).toBe("PNL-FS-CRIT");
    expect(topo?.topology?.proposed_parent).toBe("PNL-FS-NW");
  });

  it("does not guess when the feeder label matches more than one candidate", () => {
    const ambiguous = parseHousePanelSheets(
      [
        {
          name: "Shop NW",
          rows: [
            HEADER,
            ["FARM SHOP NW", "3/5", "2", "60", "SUB PANEL - critical equipment", "", "IMG_3002.jpg"],
          ],
        },
      ],
      {
        workbook: "farm_shop_panels.ods",
        aliases: FARM_SHOP_SCOPE.aliases,
        sheetPanelHints: FARM_SHOP_SCOPE.sheet_panel_hints,
      },
    );
    const rows = reconcileHousePanelObservations({
      parsed: ambiguous,
      farmops: [],
      scope: FARM_SHOP_SCOPE,
    });
    const topo = rows.find((r) => r.field === "parent_panel");
    expect(topo?.classification).toBe("TOPOLOGY_AMBIGUOUS");
    expect(topo?.proposed_action).toBe("requires_review");
    expect(topo?.topology).toBeUndefined();
    expect(reconciliationTotals(ambiguous, rows).topology_ambiguous).toBe(1);
  });

  it("titles the report with the scope area", () => {
    const rows = reconcileHousePanelObservations({
      parsed: shopParsed,
      farmops: [],
      scope: FARM_SHOP_SCOPE,
    });
    const md = fieldReconciliationMarkdown(shopParsed, rows, "2026-01-01T00:00:00.000Z", FARM_SHOP_SCOPE);
    expect(md).toContain("Farm Shop Panel Field-Observation Reconciliation");
  });
});
