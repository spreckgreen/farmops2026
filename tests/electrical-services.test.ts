import { describe, it, expect } from "vitest";
import {
  checkIntertieId,
  checkServiceId,
  currentIntertieConfiguration,
  currentServiceConfiguration,
  futureServiceConfigurations,
  groupByParent,
  planCommissionIntertieConfiguration,
  planCommissionServiceConfiguration,
  validateServiceState,
  type Row,
} from "@/lib/electrical-services";

// Fixture mirroring the documented current state: identity is permanent,
// ampacity and panel topology live in configuration revisions.
const HOUSE = { id: "svc-house", service_id: "SVC-HOUSE", name: "House service" };
const FS = { id: "svc-fs", service_id: "SVC-FS", name: "Farm Shop service" };

const houseExisting: Row = {
  id: "cfg-house-200",
  service_uuid: "svc-house",
  service_ref: "SVC-HOUSE",
  lifecycle_state: "existing",
  is_current: true,
  revision_label: "As-built 200 A",
  ampacity_amps: 200,
  voltage: "120/240",
  phase: "single",
  service_equipment: "Meter socket + 200 A main breaker panel",
  commissioned_date: "2015-06-01",
};

const housePanels: Row[] = [
  { id: "sp-1", service_config_uuid: "cfg-house-200", panel_ref: "PNL-HSE-MAIN", role: "primary", sequence: 1 },
  { id: "sp-2", service_config_uuid: "cfg-house-200", panel_ref: "PNL-HSE-SUB", role: "subpanel", sequence: 2 },
];

const fsExisting: Row = {
  id: "cfg-fs-400",
  service_uuid: "svc-fs",
  lifecycle_state: "existing",
  is_current: true,
  ampacity_amps: 400,
  voltage: "120/240",
  phase: "single",
  commissioned_date: "2021-04-01",
};

const houseProposed400: Row = {
  id: "cfg-house-400",
  service_uuid: "svc-house",
  service_ref: "SVC-HOUSE",
  lifecycle_state: "planned",
  is_current: false,
  revision_label: "Proposed 400 A upgrade",
  ampacity_amps: 400,
  voltage: "120/240",
  phase: "single",
  service_equipment: "400 A meter main with 2x200 A distribution",
  effective_date: "2027-01-01",
};

// A redesigned panel arrangement attached to the PLANNED revision only.
const proposedPanels: Row[] = [
  { id: "sp-3", service_config_uuid: "cfg-house-400", panel_ref: "PNL-HSE-MM", role: "service_entrance", sequence: 1 },
  { id: "sp-4", service_config_uuid: "cfg-house-400", panel_ref: "PNL-HSE-A", role: "primary", sequence: 2 },
  { id: "sp-5", service_config_uuid: "cfg-house-400", panel_ref: "PNL-HSE-B", role: "primary", sequence: 3 },
];

describe("service identity is independent of configuration", () => {
  it("accepts logical service IDs and rejects configuration encoded in the identity", () => {
    expect(checkServiceId("SVC-HOUSE").ok).toBe(true);
    expect(checkServiceId("SVC-FS").ok).toBe(true);
    for (const bad of ["SVC-HOUSE-200A", "SVC-HOUSE-400AMP", "SVC-FS-240V", "SVC-HOUSE-2PNL"]) {
      const check = checkServiceId(bad);
      expect(check.ok).toBe(false);
      expect(check.error).toMatch(/configuration|format/i);
    }
  });

  it("keeps one identity across an ampacity upgrade", () => {
    const configs = [houseExisting, houseProposed400];
    expect(new Set(configs.map((c) => c["service_ref"])).size).toBe(1);
    expect(currentServiceConfiguration(configs)!["ampacity_amps"]).toBe(200);
  });

  it("does not treat a stored proposal as energized", () => {
    const configs = [houseExisting, houseProposed400];
    expect(futureServiceConfigurations(configs).map((c) => c["id"])).toEqual(["cfg-house-400"]);
    const findings = validateServiceState({ services: [HOUSE, FS], configs: [...configs, fsExisting] });
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(findings.some((f) => f.code === "future_configuration_recorded")).toBe(true);
  });

  it("evaluates current-state QA at 200 A until the upgrade is commissioned", () => {
    const configs = [houseExisting, houseProposed400];
    expect(currentServiceConfiguration(configs)!["id"]).toBe("cfg-house-200");

    const patches = planCommissionServiceConfiguration(configs, "cfg-house-400", { date: "2027-03-15" });
    const applied = configs.map((c) => {
      const p = patches.find((x) => x.id === c["id"]);
      return p ? { ...c, ...p.patch } : c;
    });
    const now = currentServiceConfiguration(applied)!;
    expect(now["id"]).toBe("cfg-house-400");
    expect(now["ampacity_amps"]).toBe(400);
    expect(now["lifecycle_state"]).toBe("existing");
    // The superseded revision is retired, not deleted or renamed.
    const old = applied.find((c) => c["id"] === "cfg-house-200")!;
    expect(old["lifecycle_state"]).toBe("retired");
    expect(old["retired_date"]).toBe("2027-03-15");
    // Identity untouched by the transition.
    expect(applied.every((c) => c["service_uuid"] === "svc-house")).toBe(true);
    expect(
      validateServiceState({ services: [HOUSE], configs: applied }).filter((f) => f.severity === "error"),
    ).toEqual([]);
  });

  it("lets panel topology be redesigned per revision without touching the identity", () => {
    const links = groupByParent([...housePanels, ...proposedPanels], "service_config_uuid");
    expect(links.get("cfg-house-200")!.map((r) => r["panel_ref"])).toEqual([
      "PNL-HSE-MAIN",
      "PNL-HSE-SUB",
    ]);
    expect(links.get("cfg-house-400")!.map((r) => r["panel_ref"])).toEqual([
      "PNL-HSE-MM",
      "PNL-HSE-A",
      "PNL-HSE-B",
    ]);
    // Current topology stays the as-built pair while the redesign is stored.
    const current = currentServiceConfiguration([houseExisting, houseProposed400])!;
    expect(links.get(String(current["id"]))!.length).toBe(2);
  });

  it("flags two simultaneously energized configurations as an error", () => {
    const findings = validateServiceState({
      services: [HOUSE],
      configs: [houseExisting, { ...houseProposed400, lifecycle_state: "existing" }],
    });
    expect(findings.some((f) => f.code === "multiple_current_configurations")).toBe(true);
  });
});

describe("intertie configuration is mutable engineering data", () => {
  const tie = { id: "tie-1", intertie_id: "ITIE-HOUSE-FS", name: "House / Farm Shop intertie" };
  const concept: Row = {
    id: "tcfg-1",
    intertie_uuid: "tie-1",
    lifecycle_state: "concept",
    is_current: false,
    capacity_amps: 100,
    endpoint_a_service_uuid: "svc-house",
    endpoint_b_service_uuid: "svc-fs",
    created_at: "2026-01-01",
  };
  const redesign: Row = {
    ...concept,
    id: "tcfg-2",
    lifecycle_state: "engineered",
    revision_label: "Post-400 A House redesign",
    capacity_amps: 200,
    transfer_method: "Interlocked transfer switch",
    isolation_method: "Kirk-key interlock",
    normal_state: "Open — Farm Shop on its own service",
    permitted_states: "Open (normal); Closed to Farm Shop source during House outage",
    created_at: "2026-06-01",
  };

  it("stores concept/engineered revisions without being energized", () => {
    expect(currentIntertieConfiguration([concept, redesign])).toBeNull();
    const findings = validateServiceState({
      services: [HOUSE, FS],
      configs: [houseExisting, fsExisting],
      interties: [tie],
      intertieConfigs: [concept, redesign],
    });
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(findings.some((f) => f.code === "intertie_not_energized")).toBe(true);
  });

  it("becomes the current arrangement only after an explicit commission", () => {
    const patches = planCommissionIntertieConfiguration([concept, redesign], "tcfg-2", {
      date: "2027-04-01",
    });
    const applied = [concept, redesign].map((c) => {
      const p = patches.find((x) => x.id === c["id"]);
      return p ? { ...c, ...p.patch } : c;
    });
    const now = currentIntertieConfiguration(applied)!;
    expect(now["id"]).toBe("tcfg-2");
    expect(now["capacity_amps"]).toBe(200);
    expect(
      validateServiceState({
        services: [HOUSE, FS],
        configs: [houseExisting, fsExisting],
        interties: [tie],
        intertieConfigs: applied,
      }).filter((f) => f.severity === "error"),
    ).toEqual([]);
  });

  it("rejects capacity encoded in the intertie identity", () => {
    expect(checkIntertieId("ITIE-HOUSE-FS").ok).toBe(true);
    expect(checkIntertieId("ITIE-HOUSE-100A").ok).toBe(false);
  });
});
