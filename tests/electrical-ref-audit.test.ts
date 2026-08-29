import { describe, expect, it } from "vitest";
import {
  buildRefAudit,
  refAuditToCsv,
  refAuditToMarkdown,
} from "@/lib/electrical-ref-audit";
import type { ElectricalGraphData } from "@/lib/electrical-mermaid";

const graph = (over: Partial<ElectricalGraphData> = {}): ElectricalGraphData => ({
  panel: [],
  circuit_group: [],
  load: [],
  raceway: [],
  jbox: [],
  branch: [],
  ...over,
});

const slot = (rows: ReturnType<typeof buildRefAudit>["rows"], fkColumn: string) =>
  rows.find((r) => r.fkColumn === fkColumn)!;

describe("reference migration audit", () => {
  it("reports an exact match when the link agrees with the legacy reference", () => {
    const report = buildRefAudit(
      graph({
        panel: [{ id: "p1", panel_id: "PNL-FS-CRIT" }],
        raceway: [
          {
            id: "c1",
            conduit_id: "CON-030",
            source_panel_uuid: "p1",
            source_endpoint_ref: "PNL-FS-CRIT",
          },
        ],
      }),
    );
    const row = slot(report.rows, "source_panel_uuid");
    expect(row).toMatchObject({
      disposition: "exact_match",
      reason: "fk_matches_reference",
      stableId: "CON-030",
      fkTarget: "PNL-FS-CRIT",
    });
    expect(report.summary.conflict).toBe(0);
  });

  it("leaves a null link when a reference resolves but is not linked yet", () => {
    const report = buildRefAudit(
      graph({
        jbox: [{ id: "j1", jbox_id: "JB-014" }],
        raceway: [{ id: "c1", conduit_id: "CON-031", dest_endpoint_ref: "JB-014" }],
      }),
    );
    expect(slot(report.rows, "dest_jbox_uuid")).toMatchObject({
      disposition: "null_fk",
      reason: "exact_match_available_not_linked",
      candidates: 1,
    });
  });

  it("leaves a null link and reports an unresolvable reference", () => {
    const report = buildRefAudit(
      graph({ raceway: [{ id: "c1", conduit_id: "CON-032", dest_endpoint_ref: "JB-999" }] }),
    );
    const row = slot(report.rows, "dest_jbox_uuid");
    expect(row.disposition).toBe("null_fk");
    expect(row.reason).toBe("reference_not_found");
    expect(row.candidates).toBe(0);
  });

  it("flags an ambiguous reference as a conflict rather than guessing", () => {
    const report = buildRefAudit(
      graph({
        jbox: [
          { id: "j1", jbox_id: "JB-014" },
          { id: "j2", jbox_id: "JB-014" },
        ],
        raceway: [{ id: "c1", conduit_id: "CON-033", source_endpoint_ref: "JB-014" }],
      }),
    );
    const row = slot(report.rows, "source_jbox_uuid");
    expect(row).toMatchObject({ disposition: "conflict", reason: "ambiguous_reference" });
    expect(row.candidates).toBe(2);
    expect(report.summary.conflict).toBe(1);
  });

  it("flags link / reference disagreement, missing targets and slot collisions", () => {
    const report = buildRefAudit(
      graph({
        panel: [{ id: "p1", panel_id: "PNL-FS-NE" }],
        jbox: [{ id: "j1", jbox_id: "JB-001" }],
        raceway: [
          {
            id: "c1",
            conduit_id: "CON-034",
            source_panel_uuid: "p1",
            source_endpoint_ref: "PNL-FS-NW",
          },
          { id: "c2", conduit_id: "CON-035", dest_jbox_uuid: "missing" },
          {
            id: "c3",
            conduit_id: "CON-036",
            source_panel_uuid: "p1",
            source_jbox_uuid: "j1",
          },
        ],
      }),
    );
    const byRecord = (stableId: string, fk: string) =>
      report.rows.find((r) => r.stableId === stableId && r.fkColumn === fk)!;
    expect(byRecord("CON-034", "source_panel_uuid").reason).toBe("fk_reference_disagreement");
    expect(byRecord("CON-035", "dest_jbox_uuid").reason).toBe("fk_target_missing");
    expect(byRecord("CON-036", "source_panel_uuid").reason).toBe("slot_collision");
    expect(byRecord("CON-036", "source_jbox_uuid").reason).toBe("slot_collision");
  });

  it("audits load and circuit group relations", () => {
    const report = buildRefAudit(
      graph({
        panel: [{ id: "p1", panel_id: "PNL-FS-CRIT" }],
        circuit_group: [
          { id: "g1", circuit_group_id: "D1", suggested_panel: "PNL-FS-CRIT" },
        ],
        load: [{ id: "l1", load_id: "FS-097", circuit_group_ref: "D1" }],
      }),
    );
    expect(report.rows.find((r) => r.stableId === "FS-097")!).toMatchObject({
      targetKind: "circuit_group",
      disposition: "null_fk",
      reason: "exact_match_available_not_linked",
    });
    expect(report.rows.find((r) => r.stableId === "D1")!.targetKind).toBe("panel");
  });

  it("records slots with nothing to migrate without flagging them", () => {
    const report = buildRefAudit(graph({ load: [{ id: "l1", load_id: "FS-001" }] }));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      disposition: "null_fk",
      reason: "no_reference_present",
    });
  });

  it("exports deterministic CSV and a markdown report", () => {
    const data = graph({
      panel: [{ id: "p1", panel_id: "PNL-FS-CRIT" }],
      raceway: [
        {
          id: "c1",
          conduit_id: "CON-030",
          source_panel_uuid: "p1",
          source_endpoint_ref: "PNL-FS-CRIT",
        },
      ],
    });
    const csv = refAuditToCsv(buildRefAudit(data));
    expect(csv).toBe(refAuditToCsv(buildRefAudit(data)));
    expect(csv.split("\n")[0]).toContain("record_kind,stable_id,relationship");
    expect(csv).toContain("CON-030");

    const md = refAuditToMarkdown(buildRefAudit(data), "2026-08-29T00:00:00.000Z");
    expect(md).toContain("# Electrical reference migration audit");
    expect(md).toContain("Generated: 2026-08-29T00:00:00.000Z");
    expect(md).toContain("## Conflicts (0)");
    expect(md).toContain("PNL-FS-CRIT");
  });
});
