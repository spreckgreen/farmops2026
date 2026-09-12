import { describe, expect, it } from "vitest";
import {
  CABLE_DOMAINS,
  cableCompatibility,
  inventoryTypeCableDomain,
  type CableSpec,
  type ConnectorRef,
  type DevicePort,
} from "@/lib/inventory-connectors";
import { INVENTORY_TYPES } from "@/lib/obsidian-layout";

const usbC: ConnectorRef = {
  id: "usb-c",
  family: "usb",
  display_name: "USB Type-C",
  description: "",
  aliases: ["USB-C"],
  mating_key: "usb-c",
};

const computePort: DevicePort = {
  id: "p1",
  inventory_item_id: "rpi5",
  name: "Power",
  direction: "input",
  signal_type: "power",
  connector_type_id: "usb-c",
  connector_gender: "receptacle",
  polarity: "not_applicable",
};

const cable: CableSpec = {
  inventory_item_id: "c1",
  signal_types: ["power"],
  supported_domains: ["communications", "compute", "network"],
  ends: [
    {
      end_label: "A",
      connector_type_id: "usb-c",
      connector_gender: "plug",
      polarity: "not_applicable",
    },
    {
      end_label: "B",
      connector_type_id: "usb-c",
      connector_gender: "plug",
      polarity: "not_applicable",
    },
  ],
};

describe("inventory cable domains", () => {
  it("contains all requested independently selectable domains", () => {
    expect(CABLE_DOMAINS.map((domain) => domain.value)).toEqual([
      "ham_radio",
      "communications",
      "compute",
      "network",
    ]);
  });

  it("maps the new Compute inventory category", () => {
    expect(inventoryTypeCableDomain("23_3_compute")).toBe("compute");
    expect(INVENTORY_TYPES).toContainEqual(
      expect.objectContaining({ value: "23_3_compute", label: "23.3 Compute" }),
    );
  });

  it("allows one cable to support multiple domains", () => {
    expect(cableCompatibility(computePort, cable, [usbC], "compute").compatible).toBe(true);
    expect(cableCompatibility(computePort, cable, [usbC], "network").compatible).toBe(true);
  });

  it("rejects a cable explicitly classified outside the device domain", () => {
    const hamOnly: CableSpec = { ...cable, supported_domains: ["ham_radio"] };
    const result = cableCompatibility(computePort, hamOnly, [usbC], "compute");
    expect(result.compatible).toBe(false);
    expect(result.blockers.join(" ")).toContain("not classified for Compute");
  });
});
