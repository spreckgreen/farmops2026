import { describe, expect, it } from "vitest";
import {
  cameraCoverageSummary,
  coverageWedgeFeet,
  headingLabel,
  nextCameraId,
  streamUrlProblem,
  suggestStreamKind,
  type CameraRow,
} from "@/lib/cameras";

function camera(overrides: Partial<CameraRow> = {}): CameraRow {
  return {
    id: overrides.id ?? "uuid-1",
    camera_id: overrides.camera_id ?? "CAM-001",
    name: "NE corner",
    area: "Exterior",
    building: "Farm Shop",
    mount: "Soffit",
    stream_kind: "hls",
    stream_url: "https://cam.local/live.m3u8",
    snapshot_url: null,
    x_feet: 10,
    y_feet: 5,
    heading_degrees: 90,
    fov_degrees: 90,
    range_feet: 30,
    electrical_load_ref: "FS-002",
    status: "online",
    last_seen_at: null,
    last_check_at: null,
    last_check_detail: null,
    notes: null,
    ...overrides,
  };
}

describe("camera coverage", () => {
  it("draws no wedge when the facing direction is not recorded", () => {
    expect(coverageWedgeFeet(camera({ heading_degrees: null }))).toBeNull();
  });

  it("draws a wedge from the recorded position outward", () => {
    const wedge = coverageWedgeFeet(camera())!;
    expect(wedge[0]).toEqual({ xFt: 10, yFt: 5 });
    // Facing east: the wedge centre line reaches x = 10 + 30 ft.
    const far = wedge[Math.floor(wedge.length / 2)]!;
    expect(far.xFt).toBeGreaterThan(30);
  });

  it("reports every missing fact instead of guessing", () => {
    const summary = cameraCoverageSummary([
      camera(),
      camera({ id: "uuid-2", camera_id: "CAM-002", x_feet: null, y_feet: null, stream_url: null, stream_kind: "none", status: "unknown" }),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.placed).toBe(1);
    expect(summary.withFeed).toBe(1);
    expect(summary.gaps.map((g) => g.cameraId)).toContain("CAM-002");
  });
});

describe("camera details", () => {
  it("rejects an RTSP address a browser cannot play", () => {
    expect(streamUrlProblem("rtsp://cam/live")).toMatch(/RTSP/);
    expect(streamUrlProblem("https://cam/live.m3u8")).toBeNull();
  });

  it("suggests a feed type from the address only as a prefill", () => {
    expect(suggestStreamKind("https://cam/live.m3u8")).toBe("hls");
    expect(suggestStreamKind("https://cam/video.mp4")).toBe("mp4");
    expect(suggestStreamKind("")).toBe("none");
  });

  it("never reuses a stable camera identifier", () => {
    expect(nextCameraId([{ camera_id: "CAM-001" }, { camera_id: "CAM-004" }])).toBe("CAM-005");
  });

  it("labels a heading with its compass direction", () => {
    expect(headingLabel(90)).toBe("90° E");
    expect(headingLabel(null)).toBeNull();
  });
});
