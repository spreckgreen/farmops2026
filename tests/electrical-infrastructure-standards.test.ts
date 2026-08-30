import { describe, expect, it } from "vitest";
import {
  buildNetworkDeviceId,
  buildPowerAssetId,
  buildPoweredDeviceId,
  buildRackId,
  checkInfrastructureId,
  describeInfrastructureId,
  infrastructureShape,
} from "@/lib/electrical-infrastructure-standards";
import { checkStableId, HIERARCHICAL_ID_SHAPES } from "@/lib/electrical";

describe("infrastructure ID standards", () => {
  it("accepts the canonical rack IDs", () => {
    for (const id of ["RACK-FS-NET-01", "RACK-FS-HAM-01", "RACK-PH-NET-01", "RACK-BLR-NET-01", "RACK-HSE-NET-01"]) {
      expect(checkStableId("rack", id).ok, id).toBe(true);
    }
  });

  it("accepts the canonical network + powered device IDs", () => {
    for (const id of ["NET-SW-FS-01", "NET-SW-PH-01", "NET-SW-BLR-01", "NET-SW-HSE-01", "DEV-HAM-RADIO-FS-01", "DEV-NET-SERVER-FS-01", "DEV-NET-NVR-FS-01"]) {
      expect(checkStableId("device", id).ok, id).toBe(true);
    }
  });

  it("accepts the canonical power asset IDs", () => {
    for (const id of ["PWR-PDU-FS-NET-01", "PWR-PSU-FS-HAM-01", "PWR-UPS-FS-NET-01"]) {
      expect(checkStableId("power_asset", id).ok, id).toBe(true);
    }
  });

  it("rejects unapproved tokens with an actionable message and example", () => {
    const check = checkInfrastructureId("device", "NET-XX-FS-01");
    expect(check.ok).toBe(false);
    expect(check.error).toContain("XX");
    expect(check.error).toContain("SW");
    expect(check.error).toContain("NET-SW-FS-01");
  });

  it("rejects a malformed rack ID with the required pattern and an example", () => {
    const check = checkInfrastructureId("rack", "RACK-FS-NET");
    expect(check.ok).toBe(false);
    expect(check.error).toContain("RACK-<SITE>-<ROLE>-##");
    expect(check.error).toContain("RACK-FS-NET-01");
  });

  it("keeps pre-standard power asset IDs valid on existing records only", () => {
    const existing = checkInfrastructureId("power_asset", "PSU-FS-HAM-01", { mode: "existing" });
    expect(existing.ok).toBe(true);
    expect(existing.warning).toContain("PWR-PDU-FS-NET-01");
    const created = checkInfrastructureId("power_asset", "PSU-FS-HAM-01", { mode: "create" });
    expect(created.ok).toBe(false);
  });

  it("has no legacy powered device matcher — an inventory of real records found none", () => {
    expect(INFRASTRUCTURE_ID_STANDARDS.device.legacyFormats ?? []).toEqual([]);
    // Even a plausible-looking legacy shape is rejected outright in both modes.
    for (const mode of ["create", "existing"] as const) {
      const check = checkInfrastructureId("device", "SW-FS-1", { mode });
      expect(check.ok).toBe(false);
      expect(check.error).toContain("invalid prefix");
    }
  });

  it("rejects an arbitrary device prefix as invalid, not compatibility-only", () => {
    for (const id of ["NETWORK-SW-FS-01", "RTR-FS-1", "AP-HSE-2"]) {
      const check = checkInfrastructureId("device", id, { mode: "existing" });
      expect(check.ok, id).toBe(false);
      expect(check.error, id).toContain("invalid prefix");
      expect(check.error, id).not.toContain("predates");
    }
  });

  it("still accepts canonical DEV- and NET- IDs after narrowing the legacy matcher", () => {
    for (const id of ["NET-SW-FS-01", "DEV-HAM-RADIO-FS-01"]) {
      expect(checkInfrastructureId("device", id).ok, id).toBe(true);
      expect(checkInfrastructureId("device", id, { mode: "existing" }).ok, id).toBe(true);
    }
  });

  it("explains what each token means for helper text", () => {
    expect(describeInfrastructureId("device", "NET-SW-PH-01")).toBe(
      "Switch, Pump House, sequence 01",
    );
    expect(describeInfrastructureId("rack", "RACK-FS-HAM-01")).toContain("Amateur (ham) radio");
  });

  it("generates the next sequence per site/role", () => {
    expect(buildRackId("fs", "net", ["RACK-FS-NET-01"])).toBe("RACK-FS-NET-02");
    expect(buildNetworkDeviceId("SW", "PH", [])).toBe("NET-SW-PH-01");
    expect(buildPoweredDeviceId("HAM", "RADIO", "FS", ["DEV-HAM-RADIO-FS-01"])).toBe(
      "DEV-HAM-RADIO-FS-02",
    );
    expect(buildPowerAssetId("PSU", "FS", "HAM", [])).toBe("PWR-PSU-FS-HAM-01");
  });

  it("shares one shape definition with the validators", () => {
    expect(HIERARCHICAL_ID_SHAPES["rack"]).toBe(infrastructureShape("rack"));
    expect(HIERARCHICAL_ID_SHAPES["power_asset"]).toBe(infrastructureShape("power_asset"));
    expect(HIERARCHICAL_ID_SHAPES["device"]).toBe(infrastructureShape("device"));
  });
});
