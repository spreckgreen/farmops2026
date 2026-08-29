import { describe, expect, it } from "vitest";
import { deriveCircuitGroups, loadGroupRef } from "@/lib/electrical-circuit-groups";
import { mergeStandards, BUILT_IN_STANDARDS } from "@/lib/electrical-standards";
import { mapSheet, parseOdsContentXml, classifySheet } from "@/lib/electrical-ods";

const load = (over: Partial<Parameters<typeof loadGroupRef>[0]> = {}) => ({
  id: over.id ?? "r1",
  load_id: over.load_id ?? "FS-001",
  ...over,
});

describe("circuit group derivation from Load_Master", () => {
  it("reads the group ref by precedence", () => {
    expect(loadGroupRef(load({ circuit_group_ref: "D1", source_circuit: "X" }))?.source).toBe(
      "circuit_group_ref",
    );
    expect(loadGroupRef(load({ source_circuit: "D2" }))).toMatchObject({
      ref: "D2",
      source: "source_circuit",
    });
    expect(loadGroupRef(load({ notes: "Source Circuit: S7 spare" }))).toMatchObject({
      ref: "S7",
      source: "legacy_note",
    });
    expect(loadGroupRef(load({ notes: "no circuit here" }))).toBeNull();
  });

  it("creates one shared group per distinct ref and links every load", () => {
    const plan = deriveCircuitGroups(
      [
        load({ id: "a", load_id: "FS-001", circuit_group_ref: "D1", area: "Shop" }),
        load({ id: "b", load_id: "FS-002", circuit_group_ref: "D1", area: "Shop" }),
        load({ id: "c", load_id: "PH-019a", source_circuit: "S3" }),
      ],
      [],
    );
    expect(plan.totals.groups).toBe(2);
    expect(plan.totals.sharedGroups).toBe(1);
    expect(plan.totals.createGroups).toBe(2);
    expect(plan.links).toHaveLength(3);
    expect(plan.links.every((l) => l.pending)).toBe(true);
    expect(plan.groups[0].loadIds).toEqual(["FS-001", "FS-002"]);
  });

  it("reuses existing groups and skips already-linked loads", () => {
    const plan = deriveCircuitGroups(
      [
        load({ id: "a", load_id: "FS-001", circuit_group_ref: "D1", circuit_group_uuid: "g1" }),
        load({ id: "b", load_id: "FS-002", circuit_group_ref: "D1" }),
      ],
      [{ id: "g1", circuit_group_id: "D1", description: "Shop receptacles" }],
    );
    expect(plan.totals.createGroups).toBe(0);
    expect(plan.groups[0].description).toBe("Shop receptacles");
    expect(plan.links.map((l) => l.load_id)).toEqual(["FS-002"]);
  });

  it("reports unresolved loads and ambiguous refs instead of guessing", () => {
    const plan = deriveCircuitGroups(
      [
        load({ id: "a", load_id: "FS-003" }),
        load({ id: "b", load_id: "FS-004", circuit_group_ref: "D9" }),
      ],
      [
        { id: "g1", circuit_group_id: "D9" },
        { id: "g2", circuit_group_id: "D9" },
      ],
    );
    expect(plan.unresolved.map((u) => u.load_id)).toEqual(["FS-003"]);
    expect(plan.ambiguous).toHaveLength(1);
    expect(plan.groups).toHaveLength(0);
    expect(plan.links).toHaveLength(0);
  });
});

describe("naming standards", () => {
  it("is never blank and prefers stored rows", () => {
    expect(mergeStandards([]).length).toBe(BUILT_IN_STANDARDS.length);
    const merged = mergeStandards([
      { key: "id_formats", title: "Stored formats", body: "Stored body", sort_order: 1 },
      { key: "custom", title: "Custom", body: "Body", sort_order: 5 },
    ]);
    expect(merged[0].title).toBe("Stored formats");
    expect(merged.find((m) => m.key === "custom")).toBeTruthy();
  });
});

const CONDUIT_XML = `
<office:document-content>
 <table:table table:name="Conduit_Runs">
  <table:table-row>
   <table:table-cell><text:p>Conduit ID</text:p></table:table-cell>
   <table:table-cell><text:p>Route Group</text:p></table:table-cell>
   <table:table-cell><text:p>From</text:p></table:table-cell>
   <table:table-cell><text:p>To</text:p></table:table-cell>
   <table:table-cell><text:p>Purpose</text:p></table:table-cell>
   <table:table-cell><text:p>Service Type</text:p></table:table-cell>
   <table:table-cell><text:p>Size</text:p></table:table-cell>
   <table:table-cell><text:p>Material</text:p></table:table-cell>
   <table:table-cell><text:p>Length (ft)</text:p></table:table-cell>
   <table:table-cell><text:p>Notes</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
   <table:table-cell><text:p>CON-002</text:p></table:table-cell>
   <table:table-cell><text:p>FS-NE</text:p></table:table-cell>
   <table:table-cell><text:p>PNL-FS-NE</text:p></table:table-cell>
   <table:table-cell><text:p>JB-014</text:p></table:table-cell>
   <table:table-cell><text:p>Power</text:p></table:table-cell>
   <table:table-cell><text:p>Branch</text:p></table:table-cell>
   <table:table-cell><text:p>1"</text:p></table:table-cell>
   <table:table-cell><text:p>EMT</text:p></table:table-cell>
   <table:table-cell><text:p>95</text:p></table:table-cell>
   <table:table-cell><text:p>Field verified</text:p></table:table-cell>
  </table:table-row>
 </table:table>
</office:document-content>`;

describe("Conduit_Runs column mapping", () => {
  it("binds canonical conduit columns explicitly, not by loose substring", () => {
    const sheets = parseOdsContentXml(CONDUIT_XML);
    expect(classifySheet(sheets[0])).toBe("raceway");
    const mapped = mapSheet(
      sheets[0],
      "raceway",
      [
        "conduit_id",
        "route_group",
        "from_label",
        "to_label",
        "purpose",
        "service_type",
        "trade_size",
        "material",
        "planned_length_ft",
        "notes",
      ],
      "conduit_id",
    );
    const values = mapped.rows[0].values;
    expect(values).toMatchObject({
      conduit_id: "CON-002",
      route_group: "FS-NE",
      from_label: "PNL-FS-NE",
      to_label: "JB-014",
      purpose: "Power",
      service_type: "Branch",
      trade_size: '1"',
      material: "EMT",
      planned_length_ft: "95",
      notes: "Field verified",
    });
  });

  it("never binds two source columns to the same target", () => {
    const sheets = parseOdsContentXml(CONDUIT_XML);
    const mapped = mapSheet(sheets[0], "raceway", ["conduit_id", "notes"], "conduit_id");
    const targets = mapped.columns.map((c) => c.target).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });
});
