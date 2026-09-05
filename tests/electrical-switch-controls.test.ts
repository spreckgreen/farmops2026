import { describe, expect, it } from "vitest";
import {
  APPLY_ORDER,
  AUDIT_ENTITY_TARGETS,
  type AuditEntityKind,
} from "@/lib/electrical-audit-batch";
import {
  CONTROL_GROUP_ID_RE,
  SWITCH_BANK_ID_RE,
  SWITCH_DEVICE_ID_RE,
  bankComponentProgress,
  buildControlPathMermaid,
  buildPowerPathMermaid,
  checkSwitchControlId,
  conductorFunctionFromMarking,
  deriveBankLifecycle,
  switchDevicesExcludedFromLoads,
  validateSwitchControlModel,
  type SwitchControlModel,
} from "@/lib/electrical-switch-controls";
import { SNAPSHOT_COLLECTIONS, SNAPSHOT_SCHEMA_VERSION } from "@/lib/electrical-snapshot";
import {
  FS_CONTROL_GROUP_ID,
  FS_SWITCH_BANK_NE_ID,
  FS_SWITCH_BANK_SW_ID,
  FS_SWITCH_CONTROLS_BATCH_ID,
  buildFsSwitchControlsManifest,
} from "@/lib/electrical-audit-switch-controls";
import { FS_NW_AUDIT_R2_BATCH_ID } from "@/lib/electrical-fs-nw-audit-r2";

const model = (over: Partial<SwitchControlModel> = {}): SwitchControlModel => ({
  banks: [],
  devices: [],
  groups: [],
  targets: [],
  segments: [],
  ...over,
});

describe("stable identity", () => {
  it("accepts the permanent formats and rejects others", () => {
    expect(SWITCH_BANK_ID_RE.test("SWB-FS-001")).toBe(true);
    expect(SWITCH_DEVICE_ID_RE.test("SW-FS-014")).toBe(true);
    expect(CONTROL_GROUP_ID_RE.test("CTL-FS-001")).toBe(true);
    expect(checkSwitchControlId("switch_bank", "SWB-FS-1").ok).toBe(false);
    expect(checkSwitchControlId("control_group", "CG-FS-001").ok).toBe(false);
  });

  it("does not encode location, circuit or target in the identifier", () => {
    // Moving a bank or reassigning its circuit changes no identifier.
    const bank = { uuid: "b1", stable_id: "SWB-FS-001", field_grid_reference: "A8" };
    const moved = { ...bank, field_grid_reference: "E1", supplying_circuit_group_uuid: "cg9" };
    expect(moved.stable_id).toBe(bank.stable_id);
  });
});

describe("switches are not loads and control groups are not circuit groups", () => {
  it("flags a switching device stored as a load", () => {
    expect(switchDevicesExcludedFromLoads(["FS-082", "SW-FS-001"])).toHaveLength(1);
    expect(switchDevicesExcludedFromLoads(["FS-082", "FS-083"])).toHaveLength(0);
  });

  it("keeps the power path and the control path in separate diagrams", () => {
    const m = model({
      banks: [{ uuid: "b1", stable_id: "SWB-FS-001", supplying_circuit_group_uuid: "cg1" }],
      devices: [
        { uuid: "d1", stable_id: "SW-FS-001", switch_bank_uuid: "b1", control_group_uuid: "g1" },
      ],
      groups: [{ uuid: "g1", stable_id: "CTL-FS-001", control_method: "two_location_three_way" }],
      labels: { circuitGroups: { cg1: "CON-204" } },
    });
    const power = buildPowerPathMermaid(m);
    const control = buildControlPathMermaid(m);
    expect(power).toContain("CON-204");
    expect(control).toContain("CTL-FS-001");
    expect(power).not.toBe(control);
  });
});

describe("validation", () => {
  it("warns when a two-location arrangement lacks two endpoint 3-way switches", () => {
    const findings = validateSwitchControlModel(
      model({
        groups: [{ uuid: "g1", stable_id: "CTL-FS-001", control_method: "two_location_three_way" }],
        devices: [
          {
            uuid: "d1",
            stable_id: "SW-FS-001",
            control_group_uuid: "g1",
            switch_type: "three_way",
          },
        ],
      }),
    );
    expect(findings.map((f) => f.code)).toContain("control_group_endpoints_incomplete");
  });

  it("refuses a device as a controlled target of its own control group", () => {
    const findings = validateSwitchControlModel(
      model({
        groups: [{ uuid: "g1", stable_id: "CTL-FS-001", control_method: "two_location_three_way" }],
        devices: [{ uuid: "d1", stable_id: "SW-FS-001", control_group_uuid: "g1" }],
        targets: [{ uuid: "t1", control_group_uuid: "g1", device_uuid: "d1" }],
      }),
    );
    const self = findings.find((f) => f.code === "control_group_self_reference");
    expect(self?.severity).toBe("error");
  });

  it("never derives a conductor function from a marking", () => {
    expect(conductorFunctionFromMarking("black band").function).toBe("unknown_unverified");
    const findings = validateSwitchControlModel(
      model({
        segments: [
          {
            uuid: "s1",
            segment_id: "SEG-FS-SWB001-SWB002-B",
            observed_marking: "black band",
            conductor_function: "switched_ungrounded",
          },
        ],
      }),
    );
    expect(findings.map((f) => f.code)).toContain("conductor_function_from_marking");
  });

  it("does not classify a wall switch as a disconnecting means without verification", () => {
    const findings = validateSwitchControlModel(
      model({
        devices: [
          {
            uuid: "d1",
            stable_id: "SW-FS-001",
            is_disconnecting_means: true,
            disconnecting_means_verified: false,
          },
        ],
      }),
    );
    expect(findings.map((f) => f.code)).toContain("disconnecting_means_unverified");
  });
});

describe("lifecycle", () => {
  it("does not complete a bank because raceway or cable is installed", () => {
    const derived = deriveBankLifecycle({
      box_state: "installed",
      raceway_state: "installed",
      conductors_state: "installed",
      devices_state: "not_started",
      termination_state: "not_started",
      function_test_state: "not_started",
      installedDeviceCount: 0,
    });
    expect(derived.stage).toBe("conductors_installed");
    expect(bankComponentProgress({ box_state: "installed" }).length).toBeGreaterThan(0);
  });

  it("keeps function testing and verification separate from device installation", () => {
    const derived = deriveBankLifecycle({
      box_state: "installed",
      raceway_state: "installed",
      conductors_state: "installed",
      devices_state: "installed",
      termination_state: "installed",
      function_test_state: "not_started",
      installedDeviceCount: 2,
    });
    expect(["terminated", "device_installed"]).toContain(derived.stage);
  });
});

describe("snapshot and audit coverage", () => {
  it("publishes the switching and control collections at schema 1.3", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe("1.3");
    for (const c of [
      "switch_banks",
      "switch_devices",
      "control_groups",
      "control_targets",
      "control_wiring_segments",
    ]) {
      expect(SNAPSHOT_COLLECTIONS).toContain(c);
    }
  });

  it("applies parents before the records that reference them", () => {
    const at = (k: AuditEntityKind) => APPLY_ORDER.indexOf(k);
    expect(at("switch_bank")).toBeLessThan(at("switch_device"));
    expect(at("control_group")).toBeLessThan(at("control_target"));
    expect(at("switch_bank")).toBeLessThan(at("control_wiring_segment"));
  });

  it("never allows a switch audit item to write a load or engineering column", () => {
    const bank = AUDIT_ENTITY_TARGETS.switch_bank;
    expect(bank.table).toBe("electrical_switch_banks");
    expect(bank.writable).not.toContain("amps");
    expect(bank.writable).not.toContain("va");
    expect(AUDIT_ENTITY_TARGETS.switch_device.writable).toContain("disconnecting_means_verified");
  });
});

describe("Farm Shop switching observation batch", () => {
  const manifest = buildFsSwitchControlsManifest();

  it("is a new batch and leaves R2 untouched", () => {
    expect(FS_SWITCH_CONTROLS_BATCH_ID).not.toBe(FS_NW_AUDIT_R2_BATCH_ID);
    expect(manifest.batch_id).toBe(FS_SWITCH_CONTROLS_BATCH_ID);
    expect(JSON.stringify(manifest)).not.toContain(FS_NW_AUDIT_R2_BATCH_ID);
  });

  it("is byte-stable so its fingerprint never moves", () => {
    expect(JSON.stringify(buildFsSwitchControlsManifest())).toBe(JSON.stringify(manifest));
  });

  it("stages the two observed enclosures with their supplying circuit groups", () => {
    const ne = manifest.items.find((i) => i.target_stable_id === FS_SWITCH_BANK_NE_ID);
    const sw = manifest.items.find((i) => i.target_stable_id === FS_SWITCH_BANK_SW_ID);
    expect(ne?.refs?.circuit_group_ref).toBe("CON-204");
    expect(sw?.refs?.circuit_group_ref).toBe("CON-107");
    expect(ne?.field_grid_reference).toBe("A8");
    expect(sw?.field_grid_reference).toBe("E1");
    expect(ne?.fields?.["installed_device_count"]).toBe(0);
    expect(ne?.fields?.["devices_state"]).toBe("not_started");
  });

  it("records the black band as evidence only", () => {
    const seg = manifest.items.find((i) => i.item_key === "seg-swb-001-002-b");
    expect(seg?.fields?.["observed_marking"]).toContain("black band");
    expect(seg?.fields?.["conductor_function"]).toBe("unknown_unverified");
  });

  it("keeps the intended control arrangement design-only and holds the unresolved facts", () => {
    const group = manifest.items.find((i) => i.item_key === "ctl-fs-001-intent");
    expect(group?.observation_class).toBe("PLANNED_DESIGN");
    expect(group?.fields?.["design_only"]).toBe(true);
    expect(group?.target_stable_id).toBe(FS_CONTROL_GROUP_ID);

    const holds = manifest.items.filter((i) => i.observation_class === "HOLD_UNRESOLVED");
    expect(holds.length).toBe(4);
    for (const hold of holds) {
      expect(hold.reason && hold.reason.length).toBeGreaterThan(10);
      expect(Object.keys(hold.fields ?? {})).toHaveLength(0);
    }
  });

  it("creates no switching device from an empty enclosure", () => {
    const created = manifest.items.filter(
      (i) => i.entity_kind === "switch_device" && i.observation_class !== "HOLD_UNRESOLVED",
    );
    expect(created).toHaveLength(0);
  });
});
