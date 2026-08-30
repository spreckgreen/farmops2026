import { describe, expect, it } from "vitest";
import {
  DEVICE_CLASS_CODES,
  INFRASTRUCTURE_ID_STANDARDS,
  INFRA_ROLE_CODES,
  NETWORK_DEVICE_TYPES,
  POWER_ASSET_ID_TYPES,
  SITE_CODES,
  buildNetworkDeviceId,
  buildPowerAssetId,
  buildPoweredDeviceId,
  buildRackId,
  checkInfrastructureId,
  describeInfrastructureId,
  type InfrastructureKind,
} from "@/lib/electrical-infrastructure-standards";
import { checkStableId } from "@/lib/electrical";
import { INFRASTRUCTURE_ID_REFERENCE, infrastructureIdStandardsBody } from "@/lib/electrical-standards";

const KINDS: InfrastructureKind[] = ["rack", "power_asset", "device"];

describe("Phase 4.4b standards validation — valid new IDs", () => {
  it("accepts canonical RACK / PWR / NET / DEV IDs at creation", () => {
    const cases: [InfrastructureKind, string][] = [
      ["rack", "RACK-FS-NET-01"],
      ["rack", "RACK-PH-HAM-02"],
      ["power_asset", "PWR-PDU-FS-NET-01"],
      ["power_asset", "PWR-PSU-FS-HAM-01"],
      ["power_asset", "PWR-UPS-BLR-NET-03"],
      ["device", "NET-SW-PH-01"],
      ["device", "NET-AP-HSE-02"],
      ["device", "DEV-HAM-RADIO-FS-01"],
      ["device", "DEV-NET-NVR-FS-02"],
    ];
    for (const [kind, id] of cases) {
      const check = checkStableId(kind, id, { mode: "create" });
      expect(check.ok, `${id}: ${check.error ?? ""}`).toBe(true);
      expect(check.warning, id).toBeUndefined();
    }
  });
});

describe("Phase 4.4b standards validation — rejections name the offending token", () => {
  it("rejects an invalid prefix", () => {
    for (const [kind, id] of [
      ["rack", "CAB-FS-NET-01"],
      ["power_asset", "POWER-PDU-FS-NET-01"],
      ["device", "NETWORK-SW-FS-01"],
    ] as [InfrastructureKind, string][]) {
      const check = checkInfrastructureId(kind, id, { mode: "create" });
      expect(check.ok, id).toBe(false);
      // Either "does not match the required format" or an explicit
      // invalid-prefix diagnosis — both name the canonical shape and refuse
      // creation. Devices have no legacy compatibility matcher.
      expect(check.error).toMatch(/does not match the required|invalid prefix/);
      expect(check.error).toContain(INFRASTRUCTURE_ID_STANDARDS[kind].formats[0].shape);
      // Every failure shows a compliant example, never bare "invalid ID".
      expect(check.error).toContain(INFRASTRUCTURE_ID_STANDARDS[kind].formats[0].examples[0]);
    }
  });

  it("rejects an invalid SITE token and identifies it", () => {
    const rack = checkInfrastructureId("rack", "RACK-ZZ-NET-01", { mode: "create" });
    expect(rack.ok).toBe(false);
    expect(rack.error).toContain('"ZZ"');
    expect(rack.error).toContain("<SITE>");

    const net = checkInfrastructureId("device", "NET-SW-ZZ-01", { mode: "create" });
    expect(net.ok).toBe(false);
    expect(net.error).toContain('"ZZ"');
    expect(net.error).toContain("<SITE>");
  });

  it("rejects an invalid ROLE / TYPE / CLASS token and identifies it", () => {
    const role = checkInfrastructureId("rack", "RACK-FS-WIDGET-01", { mode: "create" });
    expect(role.ok).toBe(false);
    expect(role.error).toContain('"WIDGET"');
    expect(role.error).toContain("<ROLE>");

    const netType = checkInfrastructureId("device", "NET-XX-FS-01", { mode: "create" });
    expect(netType.ok).toBe(false);
    expect(netType.error).toContain('"XX"');
    expect(netType.error).toContain("<TYPE>");

    const pwrType = checkInfrastructureId("power_asset", "PWR-XYZ-FS-NET-01", { mode: "create" });
    expect(pwrType.ok).toBe(false);
    expect(pwrType.error).toContain('"XYZ"');
    expect(pwrType.error).toContain("<TYPE>");

    const devClass = checkInfrastructureId("device", "DEV-NOPE-RADIO-FS-01", { mode: "create" });
    expect(devClass.ok).toBe(false);
    expect(devClass.error).toContain('"NOPE"');
    expect(devClass.error).toContain("<CLASS>");
  });

  it("requires a conforming two-digit sequence", () => {
    for (const id of ["RACK-FS-NET-1", "RACK-FS-NET-001", "RACK-FS-NET", "RACK-FS-NET-0A"]) {
      expect(checkInfrastructureId("rack", id, { mode: "create" }).ok, id).toBe(false);
    }
    expect(checkInfrastructureId("device", "NET-SW-FS-1", { mode: "create" }).ok).toBe(false);
    expect(checkInfrastructureId("power_asset", "PWR-PSU-FS-HAM-1", { mode: "create" }).ok).toBe(false);
    expect(checkInfrastructureId("device", "DEV-HAM-RADIO-FS-1", { mode: "create" }).ok).toBe(false);
  });
});

describe("Phase 4.4b standards validation — generation and legacy handling", () => {
  it("generated IDs pass the same validator that guards creation", () => {
    const generated: [InfrastructureKind, string][] = [
      ["rack", buildRackId("fs", "net", [])],
      ["rack", buildRackId("PH", "HAM", ["RACK-PH-HAM-01"])],
      ["device", buildNetworkDeviceId("SW", "PH", ["NET-SW-PH-01"])],
      ["device", buildPoweredDeviceId("HAM", "RADIO", "FS", [])],
      ["power_asset", buildPowerAssetId("PSU", "FS", "HAM", [])],
      ["power_asset", buildPowerAssetId("UPS", "BLR", "NET", ["PWR-UPS-BLR-NET-01"])],
    ];
    for (const [kind, id] of generated) {
      const check = checkStableId(kind, id, { mode: "create" });
      expect(check.ok, `${id}: ${check.error ?? ""}`).toBe(true);
    }
    expect(buildRackId("fs", "net", [])).toBe("RACK-FS-NET-01");
    expect(buildNetworkDeviceId("SW", "PH", ["NET-SW-PH-01"])).toBe("NET-SW-PH-02");
  });

  it("keeps legacy IDs valid while editing an existing record", () => {
    const legacy = checkStableId("power_asset", "PSU-FS-HAM-01", { mode: "existing" });
    expect(legacy.ok).toBe(true);
    expect(legacy.warning).toBeTruthy();
  });

  it("refuses the legacy format when creating a new record", () => {
    const created = checkStableId("power_asset", "PSU-FS-HAM-01", { mode: "create" });
    expect(created.ok).toBe(false);
    expect(created.error).toContain("PWR-<TYPE>-<SITE>-<ROLE>-##");
  });
});

describe("Phase 4.4b standards validation — helper text and Standards page agreement", () => {
  it("every helper-text example is itself accepted by the validator", () => {
    for (const kind of KINDS) {
      const std = INFRASTRUCTURE_ID_STANDARDS[kind];
      for (const format of std.formats) {
        for (const example of format.examples) {
          const check = checkStableId(kind, example, { mode: "create" });
          expect(check.ok, `${example}: ${check.error ?? ""}`).toBe(true);
          expect(describeInfrastructureId(kind, example), example).toBeTruthy();
        }
      }
      for (const legacy of std.legacyFormats ?? []) {
        for (const example of legacy.examples) {
          expect(checkStableId(kind, example, { mode: "existing" }).ok, example).toBe(true);
        }
      }
    }
  });

  it("Standards page reference rows come from the shared standards module", () => {
    const shapes = INFRASTRUCTURE_ID_REFERENCE.map((r) => r.format);
    for (const kind of KINDS) {
      for (const format of INFRASTRUCTURE_ID_STANDARDS[kind].formats) {
        expect(shapes).toContain(format.shape);
        const row = INFRASTRUCTURE_ID_REFERENCE.find((r) => r.format === format.shape)!;
        expect(checkStableId(kind, row.example, { mode: "create" }).ok, row.example).toBe(true);
      }
    }
  });

  it("every controlled vocabulary displayed by Standards is accepted by validation", () => {
    const body = infrastructureIdStandardsBody();
    for (const site of Object.keys(SITE_CODES)) {
      expect(body).toContain(site);
      expect(checkStableId("rack", `RACK-${site}-NET-01`, { mode: "create" }).ok, site).toBe(true);
    }
    for (const role of Object.keys(INFRA_ROLE_CODES)) {
      expect(body).toContain(role);
      expect(checkStableId("rack", `RACK-FS-${role}-01`, { mode: "create" }).ok, role).toBe(true);
      expect(
        checkStableId("power_asset", `PWR-PSU-FS-${role}-01`, { mode: "create" }).ok,
        role,
      ).toBe(true);
    }
    for (const type of Object.keys(NETWORK_DEVICE_TYPES)) {
      expect(body).toContain(type);
      expect(checkStableId("device", `NET-${type}-FS-01`, { mode: "create" }).ok, type).toBe(true);
    }
    for (const type of Object.keys(POWER_ASSET_ID_TYPES)) {
      expect(body).toContain(type);
      expect(
        checkStableId("power_asset", `PWR-${type}-FS-NET-01`, { mode: "create" }).ok,
        type,
      ).toBe(true);
    }
    for (const cls of Object.keys(DEVICE_CLASS_CODES)) {
      expect(body).toContain(cls);
      expect(checkStableId("device", `DEV-${cls}-RADIO-FS-01`, { mode: "create" }).ok, cls).toBe(
        true,
      );
    }
  });

  it("Standards body is generated, not duplicated prose", () => {
    const body = infrastructureIdStandardsBody();
    for (const kind of KINDS) {
      const std = INFRASTRUCTURE_ID_STANDARDS[kind];
      expect(body).toContain(std.stabilityNote);
      for (const format of std.formats) expect(body).toContain(format.shape);
    }
  });
});
