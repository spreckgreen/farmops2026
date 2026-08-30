import { describe, it, expect } from "vitest";
import {
  checkStableId,
  FARMOPS_NATIVE_KINDS,
  nextScopedId,
  POWER_ASSET_TYPES,
} from "@/lib/electrical";
import { ENTITIES, ENTITY_KINDS, writableColumns } from "@/lib/electrical-entities";
import { relationsFor, applyRelations } from "@/lib/electrical-relations";
import {
  buildElectricalSnapshot,
  COLLECTION_FOR_KIND,
  ownershipMap,
  SNAPSHOT_COLLECTIONS,
  type RawRow,
} from "@/lib/electrical-snapshot";
import { buildDiagram, type ElectricalGraphData } from "@/lib/electrical-mermaid";
import type { ElectricalEntityKind } from "@/lib/electrical";

describe("reusable rack / power asset / device entities", () => {
  it("registers all three as first-class entity kinds", () => {
    for (const kind of ["rack", "power_asset", "device"] as ElectricalEntityKind[]) {
      expect(ENTITY_KINDS).toContain(kind);
      expect(ENTITIES[kind].table).toMatch(/^electrical_/);
      expect(SNAPSHOT_COLLECTIONS).toContain(COLLECTION_FOR_KIND[kind]);
      expect(FARMOPS_NATIVE_KINDS.has(kind)).toBe(true);
    }
  });

  it("keeps the power asset type as data, not architecture", () => {
    const field = ENTITIES.power_asset.fields.find((f) => f.key === "asset_type")!;
    expect(field.options).toEqual(POWER_ASSET_TYPES);
    // One table serves every type.
    expect(ENTITIES.power_asset.table).toBe("electrical_power_assets");
  });

  it("accepts the documented stable-ID conventions", () => {
    expect(checkStableId("rack", "RACK-FS-NET-01").ok).toBe(true);
    expect(checkStableId("rack", "RACK-FS-HAM-01").ok).toBe(true);
    expect(checkStableId("rack", "RACK-FS").ok).toBe(false);
    expect(checkStableId("power_asset", "PSU-FS-HAM-01").ok).toBe(true);
    expect(checkStableId("power_asset", "UPS-FS-NET-01").ok).toBe(true);
    expect(checkStableId("power_asset", "PDU-FS-NET-01").ok).toBe(true);
    expect(checkStableId("device", "NET-SW-FS-01").ok).toBe(true);
  });

  it("numbers scoped IDs sequentially", () => {
    expect(nextScopedId("RACK", "FS", "NET", [])).toBe("RACK-FS-NET-01");
    expect(nextScopedId("RACK", "FS", "NET", ["RACK-FS-NET-01"])).toBe("RACK-FS-NET-02");
    expect(nextScopedId("PSU", "FS", "HAM", ["PSU-FS-HAM-03"])).toBe("PSU-FS-HAM-04");
  });

  it("preserves both the immediate power source and the upstream electrical source", () => {
    const deviceRelations = relationsFor("device").map((r) => r.fkColumn);
    expect(deviceRelations).toEqual(
      expect.arrayContaining([
        "rack_uuid",
        "power_asset_uuid",
        "circuit_group_uuid",
        "load_uuid",
        "uplink_device_uuid",
      ]),
    );
    const out = applyRelations(
      "device",
      { power_asset_uuid: "pa1", circuit_group_uuid: "cg1" },
      {
        power_asset_uuid: { id: "pa1", kind: "power_asset", stableId: "PSU-FS-HAM-01" },
        circuit_group_uuid: { id: "cg1", kind: "circuit_group", stableId: "CG-11" },
      },
    );
    expect(out.errors).toEqual([]);
    expect(out.derived["power_asset_ref"]).toBe("PSU-FS-HAM-01");
    expect(out.derived["circuit_group_ref"]).toBe("CG-11");
  });

  it("lets many devices share one power asset without touching the branch circuit", () => {
    const graph = emptyGraph();
    graph.power_asset = [
      {
        id: "pa1",
        power_asset_id: "PSU-FS-HAM-01",
        asset_type: "AC_DC_POWER_SUPPLY",
        source_circuit_group_ref: "CG-11",
        install_status: "planned",
      },
    ];
    graph.circuit_group = [{ id: "cg1", circuit_group_id: "CG-11", install_status: "planned" }];
    graph.device = [
      { id: "d1", device_id: "HAM-RIG-FS-01", power_asset_ref: "PSU-FS-HAM-01" },
      { id: "d2", device_id: "HAM-RIG-FS-02", power_asset_ref: "PSU-FS-HAM-01" },
    ];
    const out = buildDiagram(graph, { type: "power_dependency" });
    const key = (stableId: string) => out.nodes.find((n) => n.stableId === stableId)?.key;
    const psu = key("PSU-FS-HAM-01")!;
    expect(out.edges.some((e) => e.from === psu && e.to === key("HAM-RIG-FS-01"))).toBe(true);
    expect(out.edges.some((e) => e.from === psu && e.to === key("HAM-RIG-FS-02"))).toBe(true);
    // The circuit feeds the PSU, never the individual radios.
    expect(out.edges.some((e) => e.from === key("CG-11") && e.to === psu)).toBe(true);
    expect(out.edges.some((e) => e.from === key("CG-11") && e.to === key("HAM-RIG-FS-01"))).toBe(false);
  });

  it("keeps rack, network and power-dependency views separate", () => {
    const graph = emptyGraph();
    graph.rack = [{ id: "rk1", rack_id: "RACK-FS-NET-01", rack_role: "NET" }];
    graph.power_asset = [
      { id: "pa1", power_asset_id: "UPS-FS-NET-01", asset_type: "UPS", rack_ref: "RACK-FS-NET-01" },
    ];
    graph.device = [
      {
        id: "d1",
        device_id: "NET-SW-FS-01",
        device_role: "NETWORK",
        rack_ref: "RACK-FS-NET-01",
        power_asset_ref: "UPS-FS-NET-01",
      },
      {
        id: "d2",
        device_id: "NET-AP-FS-01",
        device_role: "NETWORK",
        uplink_device_ref: "NET-SW-FS-01",
      },
    ];

    const rack = buildDiagram(graph, { type: "rack" });
    expect(rack.nodes.map((n) => n.stableId)).toEqual(
      expect.arrayContaining(["RACK-FS-NET-01", "UPS-FS-NET-01", "NET-SW-FS-01"]),
    );

    const net = buildDiagram(graph, { type: "network" });
    expect(net.nodes.some((n) => n.stableId === "NET-AP-FS-01")).toBe(true);
    // Network view must not pull the power asset in.
    expect(net.nodes.some((n) => n.stableId === "UPS-FS-NET-01")).toBe(false);

    const power = buildDiagram(graph, { type: "power_dependency" });
    expect(power.nodes.some((n) => n.stableId === "UPS-FS-NET-01")).toBe(true);
    expect(power.nodes.some((n) => n.klass === "rack")).toBe(false);
  });

  it("is deterministic and links infrastructure nodes to detail pages", () => {
    const graph = emptyGraph();
    graph.rack = [{ id: "rk1", rack_id: "RACK-FS-HAM-01" }];
    const a = buildDiagram(graph, { type: "rack" });
    const b = buildDiagram(graph, { type: "rack" });
    expect(a.mermaid).toBe(b.mermaid);
    expect(a.mermaid).toContain('href "/electrical/item/rack/rk1"');
  });

  it("exports FarmOps-native collections owned entirely by FarmOps", () => {
    const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
    for (const kind of ENTITY_KINDS) rows[kind] = [];
    rows.rack = [{ id: "rk1", rack_id: "RACK-FS-HAM-01", rack_role: "HAM" }];
    const snap = buildElectricalSnapshot({
      generatedAt: "2026-09-01T00:00:00.000Z",
      rows,
      waypoints: [],
    });
    expect(snap.equipment_racks).toHaveLength(1);
    expect(snap.power_assets).toEqual([]);
    expect(snap.devices).toEqual([]);
    expect(snap.counts.equipment_racks).toBe(1);
    for (const own of Object.values(ownershipMap("power_asset"))) {
      expect(own).toBe("farmops_as_built");
    }
  });

  it("never exposes derived reference columns as writable", () => {
    expect(writableColumns("device")).not.toContain("power_asset_ref");
    expect(writableColumns("power_asset")).not.toContain("rack_ref");
    expect(writableColumns("device")).toContain("power_asset_uuid");
  });
});

function emptyGraph(): ElectricalGraphData {
  return {
    panel: [],
    circuit_group: [],
    load: [],
    raceway: [],
    jbox: [],
    branch: [],
    waypoint: [],
    rack: [],
    power_asset: [],
    device: [],
  };
}

// Phase 4.4a — infrastructure asset integration. Infrastructure entities carry
// a role and topology plus an optional link to the authoritative FarmOps
// Inventory/Asset record; they never re-implement inventory.
describe("infrastructure → FarmOps Asset integration", () => {
  it("gives every physical-equipment kind an optional asset link", () => {
    for (const kind of ["rack", "power_asset", "device"] as ElectricalEntityKind[]) {
      const link = assetLinkField(kind);
      expect(link, kind).toBeDefined();
      expect(link!.key).toBe("asset_uuid");
      expect(link!.kind).toBe("asset");
      // Optional: planned infrastructure and passive structures have no asset.
      expect(link!.required).not.toBe(true);
      const ref = ENTITIES[kind].fields.find((f) => f.key === "asset_ref");
      expect(ref?.readOnly, kind).toBe(true);
    }
  });

  it("treats Inventory/Asset as the authority for equipment identity", () => {
    for (const kind of ["power_asset", "device"] as ElectricalEntityKind[]) {
      for (const key of ["manufacturer", "model"]) {
        const f = ENTITIES[kind].fields.find((x) => x.key === key);
        // Historical values stay visible, but are no longer editable here.
        expect(f?.readOnly, `${kind}.${key}`).toBe(true);
      }
      // Lifecycle/cost/warranty/service fields must not be duplicated at all.
      for (const key of ["serial_number", "cost", "warranty_expires", "purchase_date"]) {
        expect(ENTITIES[kind].fields.some((x) => x.key === key)).toBe(false);
      }
    }
  });

  it("never imports the asset link from a workbook column", () => {
    for (const kind of ["rack", "power_asset", "device"] as ElectricalEntityKind[]) {
      expect(importColumns(kind)).not.toContain("asset_uuid");
    }
  });

  it("keeps the asset link out of canonical-ODS field comparison", () => {
    const link = assetLinkField("device")!;
    expect(ownershipFor(link)).toBe("farmops_as_built");
  });
});
