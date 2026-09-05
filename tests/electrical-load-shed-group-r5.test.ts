import { describe, expect, it } from "vitest";
import {
  LOAD_SHED_GROUP_BATCH_ID,
  LOAD_SHED_GROUP_LOADS,
  buildLoadShedGroupR5,
  loadShedGroupCsv,
  type LoadShedGroupLoadRow,
} from "@/lib/electrical-load-shed-group-r5";

const row = (over: Partial<LoadShedGroupLoadRow> & { load_id: string }): LoadShedGroupLoadRow => ({
  load_shed_group: "PNL-FS-NE",
  suggested_panel: "PNL-FS-NE",
  logical_panel_ref: "PNL-FS-CRIT",
  resilience_class: "CRITICAL_CAMERA_GROUP",
  ...over,
});

const bothWrong = [row({ load_id: "FS-003" }), row({ load_id: "FS-004" })];

describe("load-shedding group correction", () => {
  it("stages exactly the two affected records, one field each", () => {
    const built = buildLoadShedGroupR5({ loads: bothWrong });
    expect(built.manifest.batch_id).toBe(LOAD_SHED_GROUP_BATCH_ID);
    expect(built.manifest.items).toHaveLength(2);
    for (const item of built.manifest.items) {
      expect(item.operation).toBe("UPDATE");
      expect(Object.keys(item.fields ?? {})).toEqual(["load_shed_group"]);
      expect((item.fields as Record<string, unknown>)["load_shed_group"]).toBe("PNL-FS-CRIT");
      expect(LOAD_SHED_GROUP_LOADS).toContain(item.target_stable_id as never);
    }
  });

  it("never touches the physical panel, logical link or resilience class", () => {
    const json = JSON.stringify(buildLoadShedGroupR5({ loads: bothWrong }).manifest);
    for (const field of [
      "suggested_panel",
      "logical_panel_ref",
      "resilience_class",
      "load_shed_capable",
      "circuit_group_uuid",
      "install_status",
    ]) {
      const staged = buildLoadShedGroupR5({ loads: bothWrong }).manifest.items.some(
        (i) => field in ((i.fields ?? {}) as Record<string, unknown>),
      );
      expect(staged).toBe(false);
    }
    expect(json).toContain("out of scope and unchanged");
  });

  it("stages nothing when the field already reads the logical panel", () => {
    const built = buildLoadShedGroupR5({
      loads: LOAD_SHED_GROUP_LOADS.map((id) => row({ load_id: id, load_shed_group: "PNL-FS-CRIT" })),
    });
    expect(built.alreadyCorrect).toEqual(["FS-003", "FS-004"]);
    expect(built.manifest.items).toHaveLength(1);
    expect(built.manifest.items[0]?.operation).toBe("HOLD_UNRESOLVED");
  });

  it("holds any other value instead of overwriting it", () => {
    const built = buildLoadShedGroupR5({
      loads: [
        row({ load_id: "FS-003", load_shed_group: "TBD" }),
        row({ load_id: "FS-004", load_shed_group: null }),
      ],
    });
    expect(built.held).toEqual(["FS-003", "FS-004"]);
    expect(built.manifest.items.every((i) => i.operation === "HOLD_UNRESOLVED")).toBe(true);
    expect(built.rows.every((r) => r.after === null)).toBe(true);
  });

  it("holds a record that does not exist", () => {
    const built = buildLoadShedGroupR5({ loads: [row({ load_id: "FS-003" })] });
    expect(built.loadsNotFound).toEqual(["FS-004"]);
    expect(built.manifest.items).toHaveLength(2);
  });

  it("is deterministic, so the import fingerprint is stable", () => {
    const a = JSON.stringify(buildLoadShedGroupR5({ loads: bothWrong }).manifest);
    const b = JSON.stringify(buildLoadShedGroupR5({ loads: [...bothWrong].reverse() }).manifest);
    expect(a).toBe(b);
  });

  it("exports a readable before/after CSV", () => {
    const csv = loadShedGroupCsv(buildLoadShedGroupR5({ loads: bothWrong }).rows);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain('"FS-003","true","PNL-FS-NE","PNL-FS-CRIT"');
  });
});
