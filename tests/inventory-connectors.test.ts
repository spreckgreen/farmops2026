import { describe, expect, it } from "vitest";
import {
  cableCompatibility,
  connectorSearchText,
  type CableSpec,
  type ConnectorRef,
  type DevicePort,
} from "@/lib/inventory-connectors";

const connectors: ConnectorRef[] = [
  {
    id: "uhf",
    family: "rf_coax",
    display_name: "UHF (PL-259 / SO-239)",
    description: "",
    aliases: ["PL-259", "PL2059", "SO-239"],
    mating_key: "uhf",
  },
  {
    id: "usb-c",
    family: "usb",
    display_name: "USB Type-C",
    description: "",
    aliases: ["USB-C"],
    mating_key: "usb-c",
  },
];

const port: DevicePort = {
  id: "port-1",
  inventory_item_id: "radio-1",
  name: "Antenna",
  direction: "bidirectional",
  signal_type: "rf",
  connector_type_id: "uhf",
  connector_gender: "female",
  polarity: "standard",
  impedance_ohms: 50,
  max_frequency_hz: 30_000_000,
};

const cable: CableSpec = {
  inventory_item_id: "cable-1",
  cable_type: "RG-8X",
  impedance_ohms: 50,
  signal_types: ["rf"],
  max_frequency_hz: 150_000_000,
  ends: [
    {
      end_label: "A",
      connector_type_id: "uhf",
      connector_gender: "male",
      polarity: "standard",
    },
    {
      end_label: "B",
      connector_type_id: "uhf",
      connector_gender: "male",
      polarity: "standard",
    },
  ],
};

describe("inventory connector compatibility", () => {
  it("finds a compatible cable regardless of which end is presented", () => {
    expect(cableCompatibility(port, cable, connectors)).toMatchObject({
      compatible: true,
      orientation: "A-to-port",
      blockers: [],
    });
  });

  it("rejects physically fitting RF cable with the wrong impedance", () => {
    const result = cableCompatibility(port, { ...cable, impedance_ohms: 75 }, connectors);
    expect(result.compatible).toBe(false);
    expect(result.blockers.join(" ")).toContain("Impedance differs");
  });

  it("does not treat connector shape as protocol compatibility", () => {
    const usbPort: DevicePort = {
      ...port,
      connector_type_id: "usb-c",
      connector_gender: "receptacle",
      signal_type: "data",
      protocol: "USB 10 Gbps",
    };
    const usbCable: CableSpec = {
      ...cable,
      impedance_ohms: null,
      signal_types: ["data"],
      protocol: "USB 2.0",
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
    expect(cableCompatibility(usbPort, usbCable, connectors).compatible).toBe(false);
  });

  it("searches connector aliases including the user's PL2059 spelling", () => {
    expect(connectorSearchText(connectors[0])).toContain("pl2059");
  });
});
