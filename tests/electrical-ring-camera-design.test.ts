// FARMOPS-ELEC-RING-CAMERA-DESIGN-V1 — pure-logic coverage.
import { describe, expect, it } from "vitest";

import { effectiveLocationForRecord, resolveEffectiveLocation } from "@/lib/electrical-effective-location";
import {
  CORNER_FEET,
  RING_CAMERA_DESIGN,
  RING_CAMERA_HELD_LOAD,
  RING_CAMERA_LOADS,
  RING_CAMERA_MOUNT_HEIGHT_FT,
  ringCameraDesignFields,
} from "@/lib/electrical-ring-camera-design";
import {
  buildRingCameraDesignBatch,
  type RingCameraLoadRow,
} from "@/lib/electrical-ring-camera-r4";

const liveRow = (load_id: string): RingCameraLoadRow => ({
  load_id,
  description: "Outside light / Ring Camera (8’ height)",
  location: "Outside corners",
  dedicated: true,
  install_status: "planned",
  backup_panel: "PNL-FS-CRIT",
});

const build = () =>
  buildRingCameraDesignBatch({
    loads: [...RING_CAMERA_LOADS, RING_CAMERA_HELD_LOAD].map(liveRow),
  });

describe("corner/face camera design", () => {
  it("assigns eight cameras clockwise from the north-east corner", () => {
    expect(RING_CAMERA_LOADS).toEqual([
      "FS-002",
      "FS-003",
      "FS-004",
      "FS-005",
      "FS-006",
      "FS-007",
      "FS-008",
      "FS-009",
    ]);
    expect(RING_CAMERA_DESIGN.map((d) => `${d.corner}/${d.wallFace}`)).toEqual([
      "NE/north",
      "NE/east",
      "SE/east",
      "SE/south",
      "SW/south",
      "SW/west",
      "NW/west",
      "NW/north",
    ]);
  });

  it("shares one corner coordinate per pair while keeping distinct faces", () => {
    for (const corner of ["NE", "SE", "SW", "NW"] as const) {
      const pair = RING_CAMERA_DESIGN.filter((d) => d.corner === corner);
      expect(pair).toHaveLength(2);
      expect(pair[0]!.xFt).toBe(CORNER_FEET[corner].xFt);
      expect(pair[1]!.xFt).toBe(CORNER_FEET[corner].xFt);
      expect(pair[0]!.yFt).toBe(pair[1]!.yFt);
      expect(pair[0]!.wallFace).not.toBe(pair[1]!.wallFace);
      expect(pair[0]!.coverageDirection).not.toBe(pair[1]!.coverageDirection);
    }
  });

  it("records exterior mounting and the 8 ft planned height", () => {
    const f = ringCameraDesignFields(RING_CAMERA_DESIGN[0]!);
    expect(f["mounting_classification"]).toBe("EXTERIOR_WALL_MOUNT");
    expect(f["mounting_height_ft"]).toBe(RING_CAMERA_MOUNT_HEIGHT_FT);
    expect(f["design_location_source"]).toBe("APPROVED_DESIGN_CORNER_FACE");
  });
});

describe("preview-only batch", () => {
  it("stages the planned location, panel and resilience fields with exact diffs", () => {
    const { manifest, rows } = build();
    const fs002 = rows.find((r) => r.load_id === "FS-002")!;
    const cols = fs002.changes.map((c) => c.column);
    expect(cols).toContain("location");
    expect(cols).toContain("suggested_panel");
    expect(cols).toContain("resilience_class");
    expect(cols).toContain("load_shed_capable");
    expect(fs002.changes.find((c) => c.column === "suggested_panel")!.after).toBe("PNL-FS-NE");
    expect(fs002.changes.find((c) => c.column === "location")!.before).toBe("Outside corners");
    // Planned design only: no lifecycle, verification, breaker or group fields.
    for (const item of manifest.items) {
      for (const key of Object.keys(item.fields)) {
        expect([
          "install_status",
          "field_verification_status",
          "verified_at",
          "circuit_group_uuid",
          "circuit_group_ref",
          "description",
          "load_id",
          "volts",
          "equipment_model",
        ]).not.toContain(key);
      }
    }
  });

  it("never claims field verification and keeps the equipment description", () => {
    const { manifest } = build();
    const staged = manifest.items.filter((i) => i.observation_class === "APPROVED_PLANNED_DESIGN");
    expect(staged).toHaveLength(8);
    for (const item of staged) {
      expect(item.install_state ?? null).toBeNull();
      expect(item.fields["description"]).toBeUndefined();
    }
  });

  it("stops marking the cameras dedicated when the circuit group is unknown", () => {
    const { rows } = build();
    for (const id of RING_CAMERA_LOADS) {
      const r = rows.find((x) => x.load_id === id)!;
      expect(r.changes.find((c) => c.column === "dedicated")!.after).toBe(false);
      expect(r.changes.some((c) => c.column === "dedicated_shared")).toBe(false);
    }
  });

  it("reports a logical critical grouping sitting in a physical panel field", () => {
    const { rows } = build();
    expect(rows[0]!.logical_panel_warning).toMatch(/PNL-FS-CRIT/);
    expect(rows[0]!.logical_panel_warning).toMatch(/PNL-FS-NE/);
  });

  it("holds FS-010 instead of assigning a duplicate corner location", () => {
    const { manifest, rows } = build();
    const held = manifest.items.find((i) => i.target_stable_id === RING_CAMERA_HELD_LOAD)!;
    expect(held.observation_class).toBe("HOLD_UNRESOLVED");
    expect(held.fields).toEqual({});
    const row = rows.find((r) => r.load_id === RING_CAMERA_HELD_LOAD)!;
    expect(row.changes).toEqual([]);
    expect(row.corner).toBeNull();
  });

  it("is deterministic", () => {
    expect(JSON.stringify(build().manifest)).toBe(JSON.stringify(build().manifest));
  });
});

describe("effective-location precedence", () => {
  const cornerFace = {
    source: "APPROVED_DESIGN_CORNER_FACE" as const,
    id: "cf",
    cornerReference: "NE",
    wallFace: "north",
    coverageDirection: "north",
    designXFt: CORNER_FEET.NE.xFt,
    designYFt: CORNER_FEET.NE.yFt,
  };

  it("wins over remapped and original grid values", () => {
    const r = resolveEffectiveLocation({
      statements: [
        cornerFace,
        { source: "GRID_REMAPPED", value: "E4" },
        { source: "ORIGINAL_GRID", value: "C7" },
      ],
    });
    expect(r.effective?.source).toBe("APPROVED_DESIGN_CORNER_FACE");
    expect(r.effective?.xFt).toBe(CORNER_FEET.NE.xFt);
    expect(r.provenance).toMatch(/approved design corner\/face/);
    expect(r.provenance).toMatch(/not field verified/);
    expect(r.statements.map((s) => s.source)).toContain("ORIGINAL_GRID");
  });

  it("loses to an accepted field observation, which is preserved alongside it", () => {
    const r = resolveEffectiveLocation({
      statements: [cornerFace, { source: "FIELD_OBSERVED_GRID", value: "A8", accepted: true }],
    });
    expect(r.effective?.source).toBe("FIELD_OBSERVED_GRID");
    expect(r.statements.some((s) => s.source === "APPROVED_DESIGN_CORNER_FACE" && s.valid)).toBe(true);
  });

  it("falls through with a warning when the face is missing", () => {
    const r = resolveEffectiveLocation({
      statements: [
        { ...cornerFace, wallFace: null },
        { source: "GRID_REMAPPED", value: "E4" },
      ],
    });
    expect(r.effective?.source).toBe("GRID_REMAPPED");
    expect(r.warnings.some((w) => w.source === "APPROVED_DESIGN_CORNER_FACE")).toBe(true);
  });

  it("resolves a camera record straight from its stored design fields", () => {
    const d = RING_CAMERA_DESIGN[0]!;
    const r = effectiveLocationForRecord({
      stableId: d.load_id,
      designLocationSource: "APPROVED_DESIGN_CORNER_FACE",
      cornerReference: d.corner,
      mountingWallFace: d.wallFace,
      coverageDirection: d.coverageDirection,
      designXFt: d.xFt,
      designYFt: d.yFt,
      originalGrid: "A6",
    });
    expect(r.effective?.source).toBe("APPROVED_DESIGN_CORNER_FACE");
    expect(r.effective?.label).toMatch(/NE corner north face/);
  });
});
