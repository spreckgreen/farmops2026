import { describe, expect, it } from "vitest";

import { INSTALL_STATE_TO_FARMOPS, classifyItem, fieldsAllowed } from "@/lib/electrical-audit-batch";
import { deriveCircuitGroupState } from "@/lib/electrical-circuit-group-state";
import {
  DEFAULT_AS_BUILT_STAGING_MODE,
  stageAsBuiltLoadObservation,
} from "@/lib/electrical-audit-as-built";
import {
  FS_NW_AUDITED_LOADS,
  buildFsNwAuditManifestR2,
} from "@/lib/electrical-fs-nw-audit-r1";
import { buildFsNwAuditManifestR3 } from "@/lib/electrical-fs-nw-audit-r3";

const auditedIds = Array.from(
  new Set(Object.values(FS_NW_AUDITED_LOADS).flat().map((v) => v.toUpperCase())),
);
const groups = Object.keys(FS_NW_AUDITED_LOADS).map((breaker, i) => ({
  breaker_reference: breaker,
  circuit_group_id: `CG-FS-${String(i + 1).padStart(3, "0")}`,
}));

describe("as-built staging", () => {
  it("defaults to full consequence staging", () => {
    expect(DEFAULT_AS_BUILT_STAGING_MODE).toBe("FULL_AS_BUILT");
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-044",
      circuit_group_ref: "CG-FS-003",
      group_load_ids: ["FS-044", "FS-075"],
      building_from_relationship: "Farm Shop",
      physically_installed: true,
      evidence: "traced",
    });
    expect(s.errors).toEqual([]);
    expect(s.mode).toBe("FULL_AS_BUILT");
    expect(s.install_state).toBe("installed");
    expect(s.sharing).toBe("S");
    expect(s.item.fields["dedicated_shared"]).toBe("S");
    expect(s.item.fields["location"]).toBe("Farm Shop");
    expect(s.affected_fields).toContain("install_status");
    expect(s.affected_fields).toContain("circuit_group_uuid");
  });

  it("marks a single-load group dedicated", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-039",
      circuit_group_ref: "CG-FS-007",
      group_load_ids: ["FS-039"],
      physically_installed: true,
      evidence: "traced",
    });
    expect(s.sharing).toBe("D");
    expect(s.item.fields["dedicated"]).toBe(true);
  });

  it("never stages grid or post without an explicit observation", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-044",
      circuit_group_ref: "CG-FS-003",
      group_load_ids: ["FS-044"],
      physically_installed: true,
      evidence: "traced",
    });
    expect(s.item.field_grid_reference).toBeNull();
    expect(s.item.pole).toBeNull();
    expect(s.gaps.join(" ")).toMatch(/never inferred/i);
  });

  it("stages an explicitly observed grid and post", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-055",
      circuit_group_ref: "CG-FS-001",
      group_load_ids: ["FS-054", "FS-055"],
      physically_installed: true,
      observed_grid_reference: "F9",
      observed_pole: { pole_location_kind: "AT_POST", pole_ref_start: "06SE" },
      evidence: "traced",
    });
    expect(s.errors).toEqual([]);
    expect(s.item.field_grid_reference).toBe("F9");
    expect(s.affected_fields).toContain("pole_ref_start");
  });

  it("never rewrites label or notes unless explicitly observed", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-055",
      circuit_group_ref: "CG-FS-001",
      group_load_ids: ["FS-055"],
      physically_installed: true,
      evidence: "traced",
    });
    expect(s.item.observed_label).toBeNull();
    expect(s.item.notes).toBeNull();
  });

  it("requires a written reason for the exceptional relationship-only mode", () => {
    const bad = stageAsBuiltLoadObservation({
      load_id: "FS-055",
      circuit_group_ref: "CG-FS-001",
      group_load_ids: ["FS-055"],
      physically_installed: true,
      evidence: "traced",
      mode: "RELATIONSHIP_ONLY",
    });
    expect(bad.errors.join(" ")).toMatch(/exceptional/i);

    const ok = stageAsBuiltLoadObservation({
      load_id: "FS-055",
      circuit_group_ref: "CG-FS-001",
      group_load_ids: ["FS-055"],
      physically_installed: true,
      evidence: "traced",
      mode: "RELATIONSHIP_ONLY",
      relationship_only_reason: "Install state disputed; relationship confirmed.",
    });
    expect(ok.errors).toEqual([]);
    expect(Object.keys(ok.item.fields)).toEqual(["circuit_group_ref"]);
    expect(ok.install_state).toBeNull();
  });

  it("reserves the metadata consequence columns for FIELD_AS_BUILT loads", () => {
    expect(fieldsAllowed("load", "FIELD_AS_BUILT")).toContain("dedicated_shared");
    expect(fieldsAllowed("load", "PLANNED_DESIGN")).not.toContain("dedicated_shared");
    expect(fieldsAllowed("load", "ROUGH_IN")).not.toContain("location");
  });

  it("previews every affected field before approval", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-044",
      circuit_group_ref: "CG-FS-003",
      group_load_ids: ["FS-044", "FS-075"],
      building_from_relationship: "Farm Shop",
      physically_installed: true,
      evidence: "traced",
    });
    const classified = classifyItem(s.item, {
      target: { load_id: "FS-044", install_status: "planned", updated_at: "now" },
      resolved: new Map([["circuit_group|CG-FS-003", "11111111-1111-1111-1111-111111111111"]]),
    });
    expect(classified.disposition).toBe("ready");
    expect(Object.keys(classified.patch)).toContain("circuit_group_uuid");
    for (const f of ["dedicated_shared", "location", "install_status"]) {
      expect(Object.keys(classified.patch)).toContain(f);
    }
  });
});

describe("R3 metadata reconciliation", () => {
  it("keeps R2 relationship-only and unchanged", () => {
    const r2 = buildFsNwAuditManifestR2();
    const links = r2.items.filter((i) => i.entity_kind === "load" && i.operation === "LINK");
    expect(links).toHaveLength(20);
    for (const i of links) expect(i.fields).toEqual({});
  });

  it("stages all 20 audited loads with full consequences", () => {
    const built = buildFsNwAuditManifestR3({
      groups,
      knownLoadIds: auditedIds,
      buildingFromPanel: "Farm Shop",
    });
    expect(built.reconciled).toHaveLength(20);
    expect(built.groupsNotApproved).toEqual([]);
    expect(built.manifest.batch_id).toBe("FA-FS-2026-09-03-PM-R3");
    expect(built.manifest.compensates_batch_id).toBeNull();
    for (const s of built.staged) {
      expect(s.install_state).toBe("installed");
      expect(s.item.fields["location"]).toBe("Farm Shop");
      expect(s.item.field_grid_reference).toBeNull();
    }
    expect(built.sharedCircuitLoads.length + built.dedicatedCircuitLoads.length).toBe(20);
    // B39 feeds only FS-076 and B29 only FS-039 → dedicated; the rest are shared.
    expect(built.dedicatedCircuitLoads.sort()).toEqual(["FS-039", "FS-076"]);
  });

  it("holds instead of guessing when a group or load is missing", () => {
    const built = buildFsNwAuditManifestR3({ groups: [], knownLoadIds: [] });
    expect(built.reconciled).toEqual([]);
    expect(built.groupsNotApproved.length).toBeGreaterThan(0);
    expect(
      built.manifest.items.every((i) => i.observation_class === "HOLD_UNRESOLVED"),
    ).toBe(true);
  });

  it("is deterministic", () => {
    const a = buildFsNwAuditManifestR3({ groups, knownLoadIds: auditedIds, buildingFromPanel: "Farm Shop" });
    const b = buildFsNwAuditManifestR3({ groups, knownLoadIds: auditedIds, buildingFromPanel: "Farm Shop" });
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });
});

describe("direct completion and circuit-group state", () => {
  it("advances a traced load straight to complete without intermediate stages", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-044",
      circuit_group_ref: "CG-FS-003",
      group_load_ids: ["FS-044"],
      physically_installed: true,
      evidence: "traced",
    });
    expect(s.install_state).toBe("installed");
    expect(INSTALL_STATE_TO_FARMOPS[s.install_state!]).toBe("complete");
    expect(s.as_built_verified).toBe(false);
  });

  it("marks as-built verified when location evidence is accepted too", () => {
    const s = stageAsBuiltLoadObservation({
      load_id: "FS-055",
      circuit_group_ref: "CG-FS-001",
      group_load_ids: ["FS-055"],
      physically_installed: true,
      observed_grid_reference: "F9",
      evidence: "traced",
    });
    expect(s.as_built_verified).toBe(true);
    expect(INSTALL_STATE_TO_FARMOPS[s.install_state!]).toBe("as_built_verified");
  });

  it("shows a circuit group complete only with a complete breaker and complete audited loads", () => {
    const complete = deriveCircuitGroupState({
      breaker_assigned: true,
      breaker_install_status: "complete",
      loads: [{ load_id: "FS-044", install_status: "complete", field_audited: true }],
    });
    expect(complete.state).toBe("complete");

    const partial = deriveCircuitGroupState({
      breaker_assigned: true,
      breaker_install_status: "complete",
      loads: [
        { load_id: "FS-044", install_status: "complete", field_audited: true },
        { load_id: "FS-075", install_status: "tested", field_audited: true },
      ],
    });
    expect(partial.state).toBe("partially_complete");
  });

  it("never cascades completion from a planned assignment alone", () => {
    const r = deriveCircuitGroupState({
      breaker_assigned: true,
      breaker_install_status: "planned",
      loads: [{ load_id: "FS-090", install_status: "planned", field_audited: false }],
    });
    expect(r.state).toBe("configured");
    expect(r.unauditedAssigned).toBe(1);
  });

  it("R3 corrects all 20 R2 loads to complete", () => {
    const built = buildFsNwAuditManifestR3({
      groups,
      knownLoadIds: auditedIds,
      buildingFromPanel: "Farm Shop",
    });
    expect(built.completeLoads.length + built.verifiedLoads.length).toBe(20);
  });
});
