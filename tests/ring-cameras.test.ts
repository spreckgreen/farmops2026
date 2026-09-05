import { describe, expect, it } from "vitest";
import {
  aimSideMembers,
  cameraPlacement,
  nextSideSlot,
  ringModel,
  type GridAwareCamera,
} from "@/lib/ring-cameras";

const base = (over: Partial<GridAwareCamera>): GridAwareCamera => ({
  camera_id: "CAM-001",
  building: "House",
  x_feet: null,
  y_feet: null,
  compass_side: null,
  side_slot: null,
  ring_model: null,
  ...over,
});

describe("Ring model figures", () => {
  it("uses Ring's published view width", () => {
    expect(ringModel("spotlight-cam")?.fovDegrees).toBe(140);
    expect(ringModel("stick-up-cam")?.fovDegrees).toBe(110);
    expect(ringModel("nope")).toBeNull();
  });
});

describe("sharing one side", () => {
  it("aims a lone camera straight out from its side", () => {
    const aims = aimSideMembers("E", [
      { cameraId: "CAM-001", slot: 1, ringModelId: "stick-up-cam", fovDegrees: null },
    ]);
    expect(aims.get("CAM-001")).toMatchObject({ headingDegrees: 90, fovDegrees: 110 });
  });

  it("splits a side between two cameras and keeps each Ring view width", () => {
    const aims = aimSideMembers("N", [
      { cameraId: "CAM-001", slot: 1, ringModelId: "spotlight-cam", fovDegrees: null },
      { cameraId: "CAM-002", slot: 2, ringModelId: "stick-up-cam", fovDegrees: null },
    ]);
    expect(aims.get("CAM-001")).toMatchObject({ headingDegrees: 337.5, fovDegrees: 140 });
    expect(aims.get("CAM-002")).toMatchObject({ headingDegrees: 22.5, fovDegrees: 110 });
  });

  it("leaves a camera unaimed when it has no slot on a shared side", () => {
    const aims = aimSideMembers("S", [
      { cameraId: "CAM-001", slot: 1, ringModelId: "stick-up-cam", fovDegrees: null },
      { cameraId: "CAM-002", slot: 0, ringModelId: "stick-up-cam", fovDegrees: null },
    ]);
    expect(aims.has("CAM-002")).toBe(false);
  });

  it("prefers a recorded view width over the model figure", () => {
    const aims = aimSideMembers("W", [
      { cameraId: "CAM-001", slot: 1, ringModelId: "stick-up-cam", fovDegrees: 95 },
    ]);
    expect(aims.get("CAM-001")?.fovDegrees).toBe(95);
  });
});

describe("placement never invents a position", () => {
  it("waits for a grid when only a side is known", () => {
    const placement = cameraPlacement(base({ compass_side: "N" }), false);
    expect(placement.state).toBe("compass_only");
    expect(placement.label).toBe("Waiting for a building grid");
  });

  it("invites a measurement once the building has a grid", () => {
    const placement = cameraPlacement(base({ compass_side: "N" }), true);
    expect(placement.state).toBe("compass_only");
    expect(placement.label).toBe("Side only — ready to measure");
  });

  it("only reaches the plan with measured feet", () => {
    expect(cameraPlacement(base({ compass_side: "N", x_feet: 10, y_feet: 0 }), true).state).toBe(
      "on_plan",
    );
  });

  it("reports a missing side plainly", () => {
    expect(cameraPlacement(base({}), true).state).toBe("awaiting_side");
  });
});

describe("side slots stay unique", () => {
  it("hands out the next free slot per building side", () => {
    const rows = [
      base({ camera_id: "CAM-001", compass_side: "N", side_slot: 1 }),
      base({ camera_id: "CAM-002", compass_side: "N", side_slot: 2 }),
      base({ camera_id: "CAM-003", compass_side: "E", side_slot: 1 }),
      base({ camera_id: "CAM-004", building: "Farm Shop", compass_side: "N", side_slot: 7 }),
    ];
    expect(nextSideSlot(rows, "House", "N")).toBe(3);
    expect(nextSideSlot(rows, "House", "E")).toBe(2);
    expect(nextSideSlot(rows, "House", "S")).toBe(1);
  });
});
