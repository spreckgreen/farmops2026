import { describe, expect, it } from "vitest";
import {
  QUICK_STAGES,
  STAGE_ORDER,
  UNASSIGNED_GROUP,
  buildAuditSheet,
  nextStage,
} from "@/lib/electrical-audit-sheet";
import type { InstallProgressSnapshot } from "@/lib/electrical-install-progress.functions";

const snapshot: InstallProgressSnapshot = {
  panels: [
    {
      id: "p1",
      panel_id: "PNL-FS-NW",
      description: "Farm Shop northwest",
      building: "Farm Shop",
      install_status: "complete",
      completion_percent: 100,
      label_status: "installed",
      spaces: 40,
      notes: null,
    },
  ],
  circuits: [
    {
      id: "c1",
      circuit_group_id: "CG-FS-001",
      description: "Garage Doors",
      panel_uuid: "p1",
      breaker_number: 40,
      circuit_rating_amps: 20,
      voltage: 120,
      install_status: "conductors_installed",
      completion_percent: 60,
      notes: null,
    },
    {
      id: "c2",
      circuit_group_id: "CG-XX-999",
      description: "Orphan",
      panel_uuid: null,
      breaker_number: null,
      circuit_rating_amps: null,
      voltage: null,
      install_status: "planned",
      completion_percent: null,
      notes: null,
    },
  ],
  positions: [
    {
      id: "b1",
      panel_uuid: "p1",
      side: "Left",
      position: 1,
      poles: 1,
      breaker_number: 40,
      ocp_amps: 20,
      label: "Garage Doors",
      circuit_group_uuid: "c1",
      install_status: "tested",
      notes: null,
    },
  ],
  loads: [
    {
      id: "l1",
      load_id: "FS-054",
      description: "Garage door opener",
      area: "Farm Shop",
      suggested_panel: "PNL-FS-NW",
      circuit_group_uuid: "c1",
      install_status: "as_built_verified",
    },
    {
      id: "l2",
      load_id: "FS-999",
      description: "No home yet",
      area: null,
      suggested_panel: null,
      circuit_group_uuid: null,
      install_status: "planned",
    },
  ],
};

describe("audit sheet", () => {
  it("groups rows by panel in walk order and keeps unassigned rows visible", () => {
    const sheet = buildAuditSheet(snapshot);
    expect(sheet.groups.map((g) => g.panelId)).toEqual(["PNL-FS-NW", UNASSIGNED_GROUP]);
    const first = sheet.groups[0]!;
    expect(first.rows.map((r) => r.kind)).toEqual(["panel", "position", "circuit", "load"]);
    expect(first.rows[1]!.ref).toBe("PNL-FS-NW-B40");
    expect(sheet.groups[1]!.rows.map((r) => r.ref)).toEqual(["CG-XX-999", "FS-999"]);
  });

  it("scores progress from the stage scheme and counts finished rows", () => {
    const sheet = buildAuditSheet(snapshot);
    const p = sheet.groups[0]!.progress;
    expect(p.total).toBe(4);
    expect(p.done).toBe(2);
    expect(p.percent).toBeGreaterThan(0);
    expect(p.offScheme).toBe(0);
    expect(sheet.overall.total).toBe(6);
  });

  it("reports gaps instead of guessing a relationship", () => {
    const sheet = buildAuditSheet(snapshot);
    expect(sheet.groups[1]!.rows[1]!.subtitle).toContain("no circuit link");
    expect(sheet.groups[1]!.rows[0]!.subtitle).toContain("no breaker recorded");
  });

  it("filters by panel, kind, search text and finished state", () => {
    expect(buildAuditSheet(snapshot, { kinds: ["load"] }).rowCount).toBe(2);
    expect(buildAuditSheet(snapshot, { panelId: "PNL-FS-NW" }).rowCount).toBe(4);
    expect(buildAuditSheet(snapshot, { hideDone: true }).rowCount).toBe(4);
    expect(buildAuditSheet(snapshot, { query: "garage" }).rowCount).toBe(3);
  });

  it("advances one stage at a time and stops at the end of the scheme", () => {
    expect(nextStage("planned")).toBe(STAGE_ORDER[1]);
    expect(nextStage("as_built_verified")).toBeNull();
    expect(nextStage("bogus")).toBeNull();
    for (const s of QUICK_STAGES) expect(STAGE_ORDER).toContain(s);
  });
});
