import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryConnectivityEditor } from "@/components/inventory-connectivity-editor";

const { fromMock, getUserMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: fromMock,
    auth: { getUser: getUserMock },
  },
}));

vi.mock("@/components/inventory-equipment-port-discovery", () => ({
  InventoryEquipmentPortDiscovery: () => null,
}));

vi.mock("@/components/inventory-uploaded-port-templates", () => ({
  InventoryUploadedPortTemplates: () => null,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

type QueryResult = { data: any[]; error: null };

function createQuery(result: QueryResult) {
  const promise = Promise.resolve(result);
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    insert: () => promise,
    upsert: () => promise,
    delete: () => chain,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return chain;
}

describe("InventoryConnectivityEditor", () => {
  beforeEach(() => {
    fromMock.mockReset();
    getUserMock.mockReset();

    const tableResults: Record<string, QueryResult> = {
      connector_types: {
        data: [
          {
            id: "uhf",
            family: "rf_coax",
            display_name: "UHF (PL-259 / SO-239)",
            description: "",
            aliases: ["PL-259", "SO-239"],
            mating_key: "uhf",
          },
        ],
        error: null,
      },
      inventory_device_ports: {
        data: [
          {
            id: "port-1",
            inventory_item_id: "radio-1",
            name: "Antenna",
            direction: "bidirectional",
            signal_type: "rf",
            connector_type_id: "uhf",
            connector_gender: "female",
            polarity: "standard",
            impedance_ohms: 50,
            sort_order: 20,
          },
        ],
        error: null,
      },
      inventory_cable_specs: {
        data: [
          {
            inventory_item_id: "cable-ham",
            cable_type: "RG-8X",
            impedance_ohms: 50,
            signal_types: ["rf"],
            supported_domains: ["ham_radio"],
          },
          {
            inventory_item_id: "cable-network",
            cable_type: "RG-8X",
            impedance_ohms: 50,
            signal_types: ["rf"],
            supported_domains: ["network"],
          },
        ],
        error: null,
      },
      inventory_cable_ends: {
        data: [
          {
            cable_item_id: "cable-ham",
            end_label: "A",
            connector_type_id: "uhf",
            connector_gender: "male",
            polarity: "standard",
          },
          {
            cable_item_id: "cable-ham",
            end_label: "B",
            connector_type_id: "uhf",
            connector_gender: "male",
            polarity: "standard",
          },
          {
            cable_item_id: "cable-network",
            end_label: "A",
            connector_type_id: "uhf",
            connector_gender: "male",
            polarity: "standard",
          },
          {
            cable_item_id: "cable-network",
            end_label: "B",
            connector_type_id: "uhf",
            connector_gender: "male",
            polarity: "standard",
          },
        ],
        error: null,
      },
      inventory_items: {
        data: [
          { id: "cable-ham", name: "Ham Cable", sku: null },
          { id: "cable-network", name: "Network Cable", sku: null },
        ],
        error: null,
      },
    };

    fromMock.mockImplementation((table: string) => createQuery(tableResults[table] ?? { data: [], error: null }));
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("only shows compatible cables for the inventory item's cable domain", async () => {
    render(
      <InventoryConnectivityEditor
        itemId="radio-1"
        itemName="Base Station"
        itemType="23_2_ham_radio"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /connections and compatible cables/i }));
    fireEvent.click(await screen.findByRole("button", { name: /antenna/i }));

    expect(await screen.findByText("Ham Cable")).toBeInTheDocument();
    expect(screen.queryByText("Network Cable")).not.toBeInTheDocument();
  });
});
