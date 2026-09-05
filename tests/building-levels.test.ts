import { describe, it, expect } from "vitest";
import {
  ALL_LEVELS,
  allLevelsMarkers,
  compactLevelRef,
  countOnce,
  displayForContext,
  displayLevelRef,
  filterByLevel,
  gridRefScopeKey,
  levelApiPayload,
  levelReconciliationReport,
  levelStableId,
  moveToLevel,
  overlapsInFilteredView,
  planLevelMigration,
  resolveLevelLocation,
  sameGridRefScope,
  sortLevels,
  verticalSegment,
  verticalSegments,
  type BuildingLevel,
  type LocatedObject,
} from "@/lib/building-levels";

const HOUSE = "bldg-house";

function level(part: Partial<BuildingLevel> & { id: string; short_code: string }): BuildingLevel {
  return {
    site_building_id: HOUSE,
    level_stable_id: levelStableId("HS", part.short_code),
    display_name: part.short_code,
    sort_order: 0,
    grid_scheme_uuid: `scheme-${part.id}`,
    ...part,
  } as BuildingLevel;
}

const ground = level({
  id: "lvl-1",
  short_code: "L01",
  display_name: "Ground Floor",
  sort_order: 0,
  elevation_ft: 0,
});
const second = level({
  id: "lvl-2",
  short_code: "L02",
  display_name: "Level 2",
  sort_order: 100,
  elevation_ft: 10,
});
const LEVELS = [ground, second];

describe("level-qualified locations", () => {
  it("keeps the same grid reference on two levels as distinct locations", () => {
    const a: LocatedObject = {
      stable_id: "HS-001",
      site_building_uuid: HOUSE,
      building_level_uuid: ground.id,
      grid_scheme_uuid: ground.grid_scheme_uuid,
      grid_reference: "A1",
    };
    const b: LocatedObject = { ...a, stable_id: "HS-002", building_level_uuid: second.id, grid_scheme_uuid: second.grid_scheme_uuid };
    expect(gridRefScopeKey(a)).not.toBe(gridRefScopeKey(b));
    expect(sameGridRefScope(a, b)).toBe(false);
    expect(overlapsInFilteredView(a, b)).toBe(false);
    // Same cell on the same level is an overlap.
    expect(overlapsInFilteredView(a, { ...a, stable_id: "HS-003" })).toBe(true);
  });

  it("derives display references without storing a concatenated string", () => {
    expect(displayLevelRef("House", second, "c4")).toBe("House / Level 2 / C4");
    expect(compactLevelRef("hs", second, "c4")).toBe("HS-L02-C4");
    // Single-level structures keep their existing, level-free display.
    expect(displayForContext("Farm Shop", "FS", ground, "B3", { levelCount: 1 })).toBe(
      "Farm Shop / B3",
    );
    expect(
      displayForContext("House", "HS", second, "C4", { levelCount: 2, compact: true }),
    ).toBe("HS-L02-C4");
  });

  it("never overlays objects from other levels in a level-filtered view", () => {
    const rows: LocatedObject[] = [
      { stable_id: "HS-001", building_level_uuid: ground.id, grid_reference: "A1" },
      { stable_id: "HS-002", building_level_uuid: second.id, grid_reference: "A1" },
    ];
    const groundOnly = filterByLevel(rows, ground.id);
    expect(groundOnly.map((r) => r.stable_id)).toEqual(["HS-001"]);
    for (const a of groundOnly)
      for (const b of groundOnly) expect(overlapsInFilteredView(a, b)).toBe(false);

    const markers = allLevelsMarkers(filterByLevel(rows, ALL_LEVELS), LEVELS);
    expect(new Set(markers.map((m) => m.key)).size).toBe(2);
    expect(markers.map((m) => m.level?.display_name)).toEqual(["Ground Floor", "Level 2"]);
  });

  it("counts each object once in an all-level view", () => {
    const rows: LocatedObject[] = [
      { stable_id: "HS-001", building_level_uuid: ground.id },
      { stable_id: "HS-001", building_level_uuid: second.id },
      { stable_id: "HS-002", building_level_uuid: second.id },
    ];
    expect(countOnce(rows)).toHaveLength(2);
  });

  it("moving an object between levels does not change its stable ID", () => {
    const record = {
      stable_id: "HS-004",
      site_building_uuid: HOUSE,
      building_level_uuid: ground.id,
      grid_scheme_uuid: ground.grid_scheme_uuid,
      grid_reference: "C4",
      x_ft: 12,
      y_ft: 8,
    };
    const moved = moveToLevel(record, { level: second });
    expect(moved.record.stable_id).toBe("HS-004");
    expect(moved.stable_id_changed).toBe(false);
    expect(moved.after.building_level_uuid).toBe(second.id);
    expect(moved.after.grid_scheme_uuid).toBe(second.grid_scheme_uuid);
    // Coordinates carry over unless explicitly restated.
    expect(moved.after.x_ft).toBe(12);
    expect(moved.before.building_level_uuid).toBe(ground.id);
  });
});

describe("precedence applied per level", () => {
  it("lets a level-qualified observation beat an unqualified legacy grid assignment", () => {
    const out = resolveLevelLocation(
      [
        {
          id: "legacy",
          source: "ORIGINAL_GRID",
          building_level_uuid: null,
          grid_reference: "A1",
        },
        {
          id: "observed",
          source: "FIELD_OBSERVED_LEVEL_GRID",
          building_level_uuid: second.id,
          grid_reference: "C4",
          accepted: true,
        },
      ],
      { site_building_uuid: HOUSE, levels: LEVELS },
    );
    expect(out.winner?.id).toBe("observed");
    expect(out.location.building_level_uuid).toBe(second.id);
    expect(out.location.grid_reference).toBe("C4");
    expect(out.location.grid_scheme_uuid).toBe(second.grid_scheme_uuid);
    expect(out.flags.some((f) => f.code === "UNQUALIFIED_LEVEL_WITHHELD")).toBe(true);
    // Superseded evidence is preserved verbatim.
    expect(out.preserved.map((s) => s.id)).toEqual(["legacy", "observed"]);
  });

  it("flags an unqualified location instead of silently placing it", () => {
    const out = resolveLevelLocation(
      [{ id: "legacy", source: "ORIGINAL_GRID", building_level_uuid: null, grid_reference: "A1" }],
      { site_building_uuid: HOUSE, levels: LEVELS },
    );
    expect(out.winner).toBeNull();
    expect(out.location.building_level_uuid).toBeNull();
    expect(out.flags[0]?.code).toBe("UNQUALIFIED_LEVEL_ONLY_STATEMENT");
  });

  it("attributes an unqualified location to the only level of a single-level building", () => {
    const out = resolveLevelLocation(
      [{ source: "ORIGINAL_GRID", building_level_uuid: null, grid_reference: "B3" }],
      { site_building_uuid: HOUSE, levels: [ground] },
    );
    expect(out.location.building_level_uuid).toBe(ground.id);
    expect(out.location.location_precision).toBe("fallback");
  });

  it("ranks design X/Y above remapped and original grid on the same level", () => {
    const out = resolveLevelLocation(
      [
        { id: "orig", source: "ORIGINAL_GRID", building_level_uuid: ground.id, grid_reference: "A1" },
        { id: "remap", source: "LEVEL_GRID_REMAPPED", building_level_uuid: ground.id, grid_reference: "B2" },
        { id: "design", source: "APPROVED_DESIGN_XY", building_level_uuid: ground.id, x_ft: 4, y_ft: 6 },
      ],
      { site_building_uuid: HOUSE, levels: LEVELS },
    );
    expect(out.winner?.id).toBe("design");
    expect(out.ranked.map((s) => s.id)).toEqual(["design", "remap", "orig"]);
  });

  it("ignores pole alignment for a non-perimeter object and unaccepted observations", () => {
    const out = resolveLevelLocation(
      [
        { id: "pole", source: "FIELD_OBSERVED_POLE_ALIGNMENT", building_level_uuid: ground.id, perimeter: false },
        { id: "pending", source: "FIELD_OBSERVED_LEVEL_GRID", building_level_uuid: ground.id, accepted: false },
        { id: "orig", source: "ORIGINAL_GRID", building_level_uuid: ground.id, grid_reference: "A1" },
      ],
      { site_building_uuid: HOUSE, levels: LEVELS },
    );
    expect(out.winner?.id).toBe("orig");
    expect(out.flags.map((f) => f.code)).toEqual(
      expect.arrayContaining(["POLE_ALIGNMENT_NOT_PERIMETER", "OBSERVATION_NOT_ACCEPTED"]),
    );
  });
});

describe("vertical runs between levels", () => {
  it("connects the correct endpoints and keeps one circuit group", () => {
    const seg = verticalSegment(
      {
        stable_id: "EMT-201",
        source_building_level_uuid: ground.id,
        dest_building_level_uuid: second.id,
        source_level_grid_reference: "c4",
        dest_level_grid_reference: "c4",
        circuit_group_ref: "CG-11",
      },
      LEVELS,
    )!;
    expect(seg.from_level?.id).toBe(ground.id);
    expect(seg.to_level?.id).toBe(second.id);
    expect(seg.direction).toBe("UP");
    expect(seg.kind).toBe("RISER");
    expect(seg.rise_ft).toBe(10);
    expect(seg.edge_label).toBe("up to Level 2");
    // Crossing a level boundary does not create another circuit group.
    expect(seg.circuit_group_ref).toBe("CG-11");
    expect(seg.from_grid_reference).toBe("C4");
  });

  it("reports a downward run and skips same-level runs", () => {
    const segs = verticalSegments(
      [
        { stable_id: "EMT-202", source_building_level_uuid: second.id, dest_building_level_uuid: ground.id },
        { stable_id: "EMT-203", source_building_level_uuid: ground.id, dest_building_level_uuid: ground.id },
      ],
      LEVELS,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]!.direction).toBe("DOWN");
    expect(segs[0]!.kind).toBe("DROP");
  });
});

describe("migration and reconciliation", () => {
  const shop = level({
    id: "lvl-fs",
    short_code: "L01",
    display_name: "Ground Floor",
    is_default: true,
  });

  it("migrates single-level Farm Shop locations without coordinate drift", () => {
    const rows: LocatedObject[] = [
      { stable_id: "FS-056", grid_reference: "C4", x_ft: 24, y_ft: 12 },
      { stable_id: "PNL-FS-NW", grid_reference: "A1", x_ft: 0, y_ft: 0 },
    ];
    const plan = planLevelMigration(rows, { confirmedSingleLevel: true, defaultLevel: shop });
    expect(plan.attach_count).toBe(2);
    expect(plan.withheld_count).toBe(0);
    for (const row of plan.rows) {
      expect(row.action).toBe("ATTACH_TO_DEFAULT_LEVEL");
      expect(row.after!.building_level_uuid).toBe(shop.id);
      expect(row.after!.x_ft).toBe(row.before.x_ft);
      expect(row.after!.y_ft).toBe(row.before.y_ft);
      expect(row.after!.grid_reference).toBe(row.before.grid_reference);
      expect(row.coordinates_unchanged).toBe(true);
    }
    // Stable IDs are untouched by migration.
    expect(plan.rows.map((r) => r.stable_id)).toEqual(["FS-056", "PNL-FS-NW"]);
  });

  it("withholds ambiguous records in a multistory structure", () => {
    const plan = planLevelMigration([{ stable_id: "HS-001", grid_reference: "A1" }], {
      confirmedSingleLevel: false,
      defaultLevel: ground,
    });
    expect(plan.rows[0]!.action).toBe("WITHHOLD_AMBIGUOUS");
    expect(plan.rows[0]!.after).toBeNull();
  });

  it("reports unlevelled and duplicate-cell legacy locations read-only", () => {
    const report = levelReconciliationReport(
      [
        { stable_id: "HS-001", grid_reference: "A1" },
        { stable_id: "HS-002", building_level_uuid: "lvl-missing", grid_reference: "A1" },
        { stable_id: "HS-003", building_level_uuid: ground.id, grid_reference: "B2", site_building_uuid: HOUSE, grid_scheme_uuid: ground.grid_scheme_uuid },
        { stable_id: "HS-004", building_level_uuid: ground.id, grid_reference: "b2", site_building_uuid: HOUSE, grid_scheme_uuid: ground.grid_scheme_uuid },
      ],
      LEVELS,
    );
    expect(report.map((r) => r.issue)).toEqual([
      "NO_LEVEL",
      "LEVEL_UNKNOWN_TO_BUILDING",
      "DUPLICATE_CELL_ON_LEVEL",
    ]);
  });

  it("returns structured level data for the API and sorts levels bottom-up", () => {
    expect(sortLevels([second, ground]).map((l) => l.short_code)).toEqual(["L01", "L02"]);
    const payload = levelApiPayload(second, {
      site_building_uuid: HOUSE,
      building_level_uuid: second.id,
      grid_scheme_uuid: second.grid_scheme_uuid,
      grid_reference: "C4",
      location_source: "FIELD_OBSERVED_LEVEL_GRID",
    }, { buildingName: "House", buildingCode: "HS", levelCount: 2 });
    expect(payload["building_level_code"]).toBe("L02");
    expect(payload["building_level_stable_id"]).toBe("LVL-HS-L02");
    expect(payload["display_reference"]).toBe("House / Level 2 / C4");
    expect(payload["compact_reference"]).toBe("HS-L02-C4");
    expect(payload["elevation_ft"]).toBe(10);
  });
});
