import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryUploadedPortTemplates } from "@/components/inventory-uploaded-port-templates";

const { fromMock, getUserMock, insertMock, toastSuccessMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  insertMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: fromMock,
    auth: { getUser: getUserMock },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

type QueryResult = { data: any[]; error: null };

function createQuery(result: QueryResult) {
  const promise = Promise.resolve(result);
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    insert: (payload: any) => {
      insertMock(payload);
      return promise;
    },
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return chain;
}

describe("InventoryUploadedPortTemplates", () => {
  beforeEach(() => {
    fromMock.mockReset();
    getUserMock.mockReset();
    insertMock.mockReset();
    toastSuccessMock.mockReset();

    const tableResults: Record<string, QueryResult> = {
      inventory_device_port_templates: {
        data: [
          {
            id: "port-10",
            source_name: "HamConnectors080624.xlsx",
            device_name: "RPI5",
            inventory_item_type: "23_3_compute",
            port_name: "USB 1",
            direction: "bidirectional",
            signal_type: "data",
            connector_type_id: "usb-a",
            connector_gender: "receptacle",
            polarity: "not_applicable",
            protocol: "USB 2.0",
            impedance_ohms: null,
            notes: null,
            sort_order: 10,
          },
          {
            id: "port-20",
            source_name: "HamConnectors080624.xlsx",
            device_name: "RPI5",
            inventory_item_type: "23_3_compute",
            port_name: "USB 2",
            direction: "bidirectional",
            signal_type: "data",
            connector_type_id: "usb-a",
            connector_gender: "receptacle",
            polarity: "not_applicable",
            protocol: "USB 2.0",
            impedance_ohms: null,
            notes: null,
            sort_order: 20,
          },
          {
            id: "port-30",
            source_name: "HamConnectors080624.xlsx",
            device_name: "RPI5",
            inventory_item_type: "23_3_compute",
            port_name: "USB 3",
            direction: "bidirectional",
            signal_type: "data",
            connector_type_id: "usb-a",
            connector_gender: "receptacle",
            polarity: "not_applicable",
            protocol: "USB 3.x",
            impedance_ohms: null,
            notes: null,
            sort_order: 30,
          },
        ],
        error: null,
      },
      inventory_device_ports: { data: [], error: null },
    };

    fromMock.mockImplementation((table: string) => createQuery(tableResults[table] ?? { data: [], error: null }));
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("inserts selected template ports in template sort order relative to the next slot", async () => {
    const onCreated = vi.fn().mockResolvedValue(undefined);

    render(
      <InventoryUploadedPortTemplates
        itemId="item-1"
        itemName="RPI5"
        existingPortNames={["USB 1"]}
        nextSortOrder={100}
        onCreated={onCreated}
      />,
    );

    await screen.findByText("USB 1");
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).toBeDisabled();
    if (!checkboxes[1].checked) fireEvent.click(checkboxes[1]);
    if (!checkboxes[2].checked) fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByRole("button", { name: /apply selected connectors/i }));

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(
      insertMock.mock.calls[0][0].map((row: { name: string; sort_order: number }) => ({
        name: row.name,
        sort_order: row.sort_order,
      })),
    ).toEqual([
      { name: "USB 2", sort_order: 100 },
      { name: "USB 3", sort_order: 110 },
    ]);
    expect(toastSuccessMock).toHaveBeenCalledWith("2 uploaded connectors applied");
    expect(onCreated).toHaveBeenCalled();
  });
});
