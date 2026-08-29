import { describe, expect, it } from "vitest";
import { isEntitlementActive } from "@/lib/addons";
import { coerceValue } from "@/lib/electrical-entities";
import {
  checkStableId,
  completionFromStatus,
  encodedBranchOrigin,
  encodedParentMismatch,
  farmShopWalkOrder,
  findBreakerConflicts,
  nextBranchId,
  nextJboxId,
  nextStableId,
  panelPositions,
  parseGrid,
  parseHierarchicalId,
  sortByPanelExit,
} from "@/lib/electrical";
import {
  buildPlanSheet,
  classifySheet,
  mapSheet,
  parseOdsContentXml,
  planTotals,
} from "@/lib/electrical-ods";

describe("entitlements", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("allows active and trialing entitlements", () => {
    expect(isEntitlementActive({ status: "active", expires_at: null }, now)).toBe(true);
    expect(isEntitlementActive({ status: "trialing", expires_at: null }, now)).toBe(true);
  });
  it("fails closed for missing, expired, disabled or unknown rows", () => {
    expect(isEntitlementActive(null, now)).toBe(false);
    expect(isEntitlementActive({ status: "disabled", expires_at: null }, now)).toBe(false);
    expect(isEntitlementActive({ status: "expired", expires_at: null }, now)).toBe(false);
    expect(isEntitlementActive({ status: "sneaky", expires_at: null }, now)).toBe(false);
    expect(isEntitlementActive({ status: "active", expires_at: "2025-12-31" }, now)).toBe(false);
    expect(isEntitlementActive({ status: "active", expires_at: "not a date" }, now)).toBe(false);
  });
  it("honours a future expiry", () => {
    expect(isEntitlementActive({ status: "active", expires_at: "2026-06-01" }, now)).toBe(true);
  });
});

describe("stable IDs", () => {
  it("accepts the documented formats", () => {
    expect(checkStableId("load", "FS-097").ok).toBe(true);
    expect(checkStableId("panel", "PNL-FS-CRIT").ok).toBe(true);
    expect(checkStableId("raceway", "EMT-104").ok).toBe(true);
    expect(checkStableId("jbox", "JB-104-01").ok).toBe(true);
    expect(checkStableId("branch", "BR-104-02-03").ok).toBe(true);
  });
  it("rejects malformed IDs and blanks", () => {
    expect(checkStableId("raceway", "EMT104").ok).toBe(false);
    expect(checkStableId("raceway", "EMT-NE-001").ok).toBe(false);
    expect(checkStableId("raceway", "EMT-104-01").ok).toBe(false);
    expect(checkStableId("jbox", "").ok).toBe(false);
    expect(checkStableId("jbox", "JB-104-1").ok).toBe(false);
    expect(checkStableId("branch", "BR-104-2-1").ok).toBe(false);
    expect(checkStableId("branch", "BR 057").ok).toBe(false);
  });
  it("accepts the modelled House convention but rejects unknown prefixes", () => {
    expect(checkStableId("load", "HSE-12").ok).toBe(true);
    expect(checkStableId("load", "WIDGET-1").ok).toBe(false);
  });
  it("keeps legacy IDs valid but flags them", () => {
    const con = checkStableId("raceway", "CON-030");
    expect(con.ok).toBe(true);
    expect(con.warning).toMatch(/EMT/);
    const jb = checkStableId("jbox", "JB-014");
    expect(jb.ok).toBe(true);
    expect(jb.warning).toMatch(/JB-###-##/);
    expect(checkStableId("branch", "BR-057").warning).toBeTruthy();
  });
  it("reads the encoded hierarchy", () => {
    expect(parseHierarchicalId("BR-104-02-03")).toMatchObject({
      prefix: "BR",
      path: "104",
      jbox: "02",
      branch: "03",
    });
    expect(encodedBranchOrigin("BR-104-02-03")).toBe("JB-104-02");
    expect(encodedParentMismatch("BR-104-02-03", "JB-104-02")).toBeNull();
    expect(encodedParentMismatch("BR-104-02-03", "JB-104-03")).toMatchObject({
      encoded: "JB-104-02",
      linked: "JB-104-03",
    });
  });
  it("generates the next hierarchical ID", () => {
    expect(nextStableId("raceway", ["CON-001", "EMT-030"])).toBe("EMT-031");
    expect(nextJboxId("104", ["JB-104-01", "JB-104-02", "JB-105-01"])).toBe("JB-104-03");
    expect(nextJboxId(104, [])).toBe("JB-104-01");
    expect(nextBranchId("JB-104-02", ["BR-104-02-01", "BR-104-01-05"])).toBe("BR-104-02-02");
    expect(nextBranchId("JB-104-02", [])).toBe("BR-104-02-01");
  });
});


describe("panel positions", () => {
  it("derives positions from the panel's own space count", () => {
    const p = panelPositions(48);
    expect(p).toHaveLength(48);
    expect(p.filter((x) => x.side === "Left")).toHaveLength(24);
    expect(p[0]).toMatchObject({ side: "Left", index: 1, breaker: 1 });
    expect(p[1]).toMatchObject({ side: "Right", index: 1, breaker: 2 });
    expect(panelPositions(12)).toHaveLength(12);
    expect(panelPositions(null)).toHaveLength(0);
  });
  it("orders raceways from the lower-right corner counterclockwise", () => {
    const sorted = sortByPanelExit([
      { exit_order: 3, exit_side: "Top" },
      { exit_order: 1, exit_side: "Lower Right" },
      { exit_order: 2, exit_side: "Right" },
    ]);
    expect(sorted.map((s) => s.exit_side)).toEqual(["Lower Right", "Right", "Top"]);
  });
  it("flags two circuits on the same breaker", () => {
    const conflicts = findBreakerConflicts([
      { circuit_group_id: "CG-1", panel_uuid: "p1", breaker_number: 5 },
      { circuit_group_id: "CG-2", panel_uuid: "p1", breaker_number: 5 },
      { circuit_group_id: "CG-3", panel_uuid: "p1", breaker_number: 7 },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ids).toEqual(["CG-1", "CG-2"]);
  });
});

describe("Farm Shop walk order", () => {
  it("parses grid references", () => {
    expect(parseGrid("a6")).toMatchObject({ raw: "A6", row: 1, col: 6 });
    expect(parseGrid("nope")).toBeNull();
  });
  it("starts at A6 (NE) and runs clockwise", () => {
    const cells = ["C1", "A1", "A6", "C6", "B6", "B1"];
    const order = farmShopWalkOrder(cells);
    expect(order[0]).toBe("A6");
    expect(order[1]).toBe("B6");
    expect(order[2]).toBe("C6");
    expect(order[3]).toBe("C1");
    expect(order).toHaveLength(6);
  });
  it("ignores blanks and duplicates", () => {
    expect(farmShopWalkOrder([null, "", "A6", "A6"])).toEqual(["A6"]);
  });
});

describe("completion mapping", () => {
  it("maps status to a percentage", () => {
    expect(completionFromStatus("planned")).toBe(0);
    expect(completionFromStatus("complete")).toBe(100);
    expect(completionFromStatus("junk")).toBe(0);
  });
});

const ODS_XML = `
<office:document-content>
 <table:table table:name="Conduit Schedule">
  <table:table-row><table:table-cell><text:p>Conduit ID</text:p></table:table-cell><table:table-cell><text:p>Trade Size</text:p></table:table-cell><table:table-cell><text:p>Environment</text:p></table:table-cell><table:table-cell><text:p>Mystery</text:p></table:table-cell></table:table-row>
  <table:table-row><table:table-cell><text:p>CON-030</text:p></table:table-cell><table:table-cell><text:p>1&quot;</text:p></table:table-cell><table:table-cell><text:p>INTERIOR</text:p></table:table-cell><table:table-cell><text:p>x</text:p></table:table-cell></table:table-row>
  <table:table-row><table:table-cell><text:p>CON-031</text:p></table:table-cell><table:table-cell><text:p>3/4&quot;</text:p></table:table-cell><table:table-cell><text:p>SITE_UNDERGROUND</text:p></table:table-cell></table:table-row>
  <table:table-row><table:table-cell table:number-columns-repeated="3"/></table:table-row>
 </table:table>
</office:document-content>`;

describe("ODS parsing and import planning", () => {
  const sheets = parseOdsContentXml(ODS_XML);

  it("reads sheets, rows and entities", () => {
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Conduit Schedule");
    expect(sheets[0].rows[1][1]).toBe('1"');
  });

  it("classifies the sheet by name and headers", () => {
    expect(classifySheet(sheets[0])).toBe("raceway");
  });

  it("maps known columns and reports unmapped ones", () => {
    const mapped = mapSheet(
      sheets[0],
      "raceway",
      ["conduit_id", "trade_size", "environment"],
      "conduit_id",
    );
    expect(mapped.rows).toHaveLength(2);
    expect(mapped.rows[0].stableId).toBe("CON-030");
    expect(mapped.rows[0].values["trade_size"]).toBe('1"');
    expect(mapped.columns.find((c) => c.source === "Mystery")?.target).toBeNull();
  });

  it("diffs against existing rows and warns before overwriting field measurements", () => {
    const mapped = mapSheet(
      sheets[0],
      "raceway",
      ["conduit_id", "trade_size", "environment", "measured_length_ft"],
      "conduit_id",
    );
    mapped.rows[0].values["measured_length_ft"] = "40";
    const plan = buildPlanSheet(
      mapped,
      {
        "CON-030": {
          id: "11111111-1111-1111-1111-111111111111",
          conduit_id: "CON-030",
          trade_size: '1"',
          environment: "INTERIOR",
          measured_length_ft: 38,
        },
      },
      "conduit_id",
    );
    const updated = plan.rows.find((r) => r.stableId === "CON-030")!;
    expect(updated.action).toBe("update");
    expect(updated.warnings[0]).toMatch(/measured/i);
    expect(plan.rows.find((r) => r.stableId === "CON-031")!.action).toBe("create");
    expect(plan.unmapped).toContain("Mystery");
    expect(planTotals([plan])).toMatchObject({ create: 1, update: 1 });
  });

  it("proposes raceway merges instead of applying them", () => {
    const mapped = mapSheet(sheets[0], "raceway", ["conduit_id"], "conduit_id");
    mapped.rows[0].values["source_endpoint_ref"] = "PNL-FS-CRIT";
    mapped.rows[0].values["dest_endpoint_ref"] = "JB-014";
    mapped.rows[1].values["source_endpoint_ref"] = "PNL-FS-CRIT";
    mapped.rows[1].values["dest_endpoint_ref"] = "JB-014";
    const plan = buildPlanSheet(mapped, {}, "conduit_id");
    expect(plan.mergeProposals).toHaveLength(1);
    expect(plan.mergeProposals[0].note).toMatch(/review/i);
  });
});

describe("Complete % from the workbook", () => {
  const field = { key: "completion_percent", label: "Complete %", kind: "number" } as const;
  it("maps the Complete % header to completion_percent", () => {
    const xml = `
<office:document-content>
 <table:table table:name="Load_Master">
  <table:table-row><table:table-cell><text:p>Load ID</text:p></table:table-cell><table:table-cell><text:p>Complete %</text:p></table:table-cell><table:table-cell><text:p>Status</text:p></table:table-cell></table:table-row>
  <table:table-row><table:table-cell><text:p>FS-097</text:p></table:table-cell><table:table-cell><text:p>65%</text:p></table:table-cell><table:table-cell><text:p>planned</text:p></table:table-cell></table:table-row>
 </table:table>
</office:document-content>`;
    const sheets = parseOdsContentXml(xml);
    const mapped = mapSheet(sheets[0], "load", ["load_id", "completion_percent", "install_status"], "load_id");
    expect(mapped.rows[0].values["completion_percent"]).toBe("65%");
  });
  it("coerces percent text and fractions", () => {
    expect(coerceValue(field, "65%")).toBe(65);
    expect(coerceValue(field, "0.65")).toBe(65);
    expect(coerceValue(field, "100")).toBe(100);
    expect(coerceValue(field, "")).toBeNull();
  });
});
