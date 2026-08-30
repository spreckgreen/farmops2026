import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_COLLECTIONS,
  SNAPSHOT_SCHEMA_VERSION,
  buildElectricalSnapshot,
  modifiedSince,
  ownershipMap,
  relationStableIdKey,
  serializeSnapshot,
  snapshotFilename,
  type RawRow,
} from "@/lib/electrical-snapshot";
import type { ElectricalEntityKind } from "@/lib/electrical";

const PANEL_ID = "11111111-1111-4111-8111-111111111111";
const JBOX_ID = "22222222-2222-4222-8222-222222222222";
const RACEWAY_ID = "33333333-3333-4333-8333-333333333333";
const LOAD_ID = "44444444-4444-4444-8444-444444444444";

function input(overrides: Partial<Record<ElectricalEntityKind, RawRow[]>> = {}) {
  const rows: Record<ElectricalEntityKind, RawRow[]> = {
    panel: [
      {
        id: PANEL_ID,
        panel_id: "PNL-FS-CRIT",
        description: "Farm Shop critical",
        building: "Farm Shop",
        spaces: 24,
        install_status: "planned",
        completion_percent: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
      },
    ],
    raceway: [
      {
        id: RACEWAY_ID,
        conduit_id: "CON-030",
        from_label: "Farm Shop NE wall",
        to_label: "Pump House",
        source_panel_uuid: PANEL_ID,
        source_endpoint_ref: "PNL-FS-CRIT",
        // Destination topology has not been established yet.
        dest_panel_uuid: null,
        dest_jbox_uuid: null,
        environment: "SITE_UNDERGROUND",
        install_status: "planned",
        completion_percent: 0,
        spare: false,
        updated_at: "2026-03-01T00:00:00Z",
      },
    ],
    jbox: [{ id: JBOX_ID, jbox_id: "JB-014", install_status: "planned" }],
    branch: [],
    load: [
      {
        id: LOAD_ID,
        load_id: "FS-097",
        description: "Welder receptacle",
        grid: "A6",
        circuit_group_uuid: null,
        install_status: "planned",
      },
    ],
    circuit_group: [],
    feeder: [],
    ...overrides,
  };
  return {
    generatedAt: "2026-08-29T16:23:45.123Z",
    rows,
    waypoints: [
      { id: "55555555-5555-4555-8555-555555555555", raceway_id: RACEWAY_ID, sequence: 2, label: "Bend at B4" },
      { id: "66666666-6666-4666-8666-666666666666", raceway_id: RACEWAY_ID, sequence: 1, label: "Trench exit" },
    ] as RawRow[],
    qa: [
      { code: "incomplete_topology", severity: "warning" as const, stable_id: "CON-030", message: "No destination endpoint." },
    ],
  };
}

describe("electrical reconciliation snapshot", () => {
  it("is versioned and always contains every collection", () => {
    const snap = buildElectricalSnapshot(input());
    expect(snap.schema_version).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.source).toBe("FarmOps");
    expect(snap.engineering_system_of_record).toBe("PremoFarmElectrical.ods");
    for (const collection of SNAPSHOT_COLLECTIONS) {
      expect(Array.isArray(snap[collection])).toBe(true);
      expect(snap.counts[collection]).toBe(snap[collection].length);
    }
    expect(snap.counts.branch_runs).toBe(0);
    expect(snap.counts.circuit_groups).toBe(0);
    // Phase 4.2: feeders are a first-class collection, present even when empty.
    expect(snap.counts.feeders).toBe(0);
    expect(snap.feeders).toEqual([]);
  });

  it("exports UUID and stable ID for every record", () => {
    const snap = buildElectricalSnapshot(input());
    expect(snap.panels[0]!["uuid"]).toBe(PANEL_ID);
    expect(snap.panels[0]!["stable_id"]).toBe("PNL-FS-CRIT");
    expect(snap.loads[0]!["stable_id"]).toBe("FS-097");
  });

  it("exports each relationship as an explicit uuid + stable id pair", () => {
    const snap = buildElectricalSnapshot(input());
    const raceway = snap.raceways[0]!;
    expect(relationStableIdKey("source_panel_uuid")).toBe("source_panel_stable_id");
    expect(raceway["source_panel_uuid"]).toBe(PANEL_ID);
    expect(raceway["source_panel_stable_id"]).toBe("PNL-FS-CRIT");
  });

  it("leaves unestablished topology null instead of guessing", () => {
    const snap = buildElectricalSnapshot(input());
    const raceway = snap.raceways[0]!;
    expect(raceway["dest_panel_uuid"]).toBeNull();
    expect(raceway["dest_panel_stable_id"]).toBeNull();
    expect(raceway["dest_jbox_stable_id"]).toBeNull();
    // Legacy ODS design text is preserved verbatim beside the null FKs.
    expect(raceway["to_label"]).toBe("Pump House");
    expect(snap.loads[0]!["circuit_group_stable_id"]).toBeNull();
  });

  it("classifies field ownership per collection", () => {
    const snap = buildElectricalSnapshot(input());
    const panels = snap.field_ownership.panels;
    expect(panels["completion_percent"]).toBe("farmops_as_built");
    expect(panels["description"]).toBe("engineering_design");
    const raceways = snap.field_ownership.raceways;
    expect(raceways["from_label"]).toBe("imported_legacy");
    expect(Object.values(ownershipMap("panel")).every((v) => v !== undefined)).toBe(true);
    expect(snap.metadata_fields).toContain("updated_at");
  });

  it("reports QA findings without blocking the export", () => {
    const snap = buildElectricalSnapshot(input());
    expect(snap.qa.warnings).toBe(1);
    expect(snap.qa.errors).toBe(0);
    expect(snap.raceways).toHaveLength(1);
  });

  it("is deterministic: identical data yields byte-identical JSON", () => {
    const a = serializeSnapshot(buildElectricalSnapshot(input()));
    const shuffled = input();
    shuffled.waypoints = [...shuffled.waypoints].reverse();
    const b = serializeSnapshot(buildElectricalSnapshot(shuffled));
    expect(a).toBe(b);
  });

  it("orders waypoints by raceway then sequence and never invents a stable id", () => {
    const snap = buildElectricalSnapshot(input());
    expect(snap.raceway_waypoints.map((w) => w["sequence"])).toEqual([1, 2]);
    expect(snap.raceway_waypoints[0]!["raceway_stable_id"]).toBe("CON-030");
    expect(snap.raceway_waypoints[0]!["stable_id"]).toBeNull();
  });

  it("derives a timestamped filename and change counts", () => {
    const snap = buildElectricalSnapshot(input());
    expect(snapshotFilename(snap.generated_at)).toBe(
      "farmops-electrical-snapshot-2026-08-29T162345.json",
    );
    expect(modifiedSince(snap, "2026-02-15T00:00:00Z").raceways).toBe(1);
    expect(modifiedSince(snap, "2026-02-15T00:00:00Z").panels).toBe(0);
    expect(modifiedSince(snap, null).panels).toBe(0);
  });
});
