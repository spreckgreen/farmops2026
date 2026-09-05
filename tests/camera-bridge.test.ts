import { describe, expect, it } from "vitest";
import {
  bridgeBaseProblem,
  buildBridgePlan,
  go2rtcHlsUrl,
  go2rtcSnapshotUrl,
  mixedContentWarning,
  normalizeBridgeBase,
  streamSlug,
} from "@/lib/camera-bridge";

describe("bridge address", () => {
  it("trims trailing slashes and whitespace", () => {
    expect(normalizeBridgeBase("  http://192.168.1.50:1984/ ")).toBe("http://192.168.1.50:1984");
  });

  it("rejects a blank, RTSP or path-bearing address", () => {
    expect(bridgeBaseProblem("")).toContain("Enter the address");
    expect(bridgeBaseProblem("rtsp://192.168.1.50:8554/front")).toContain("RTSP");
    expect(bridgeBaseProblem("http://192.168.1.50:1984/api/stream.m3u8")).toContain("host and port");
    expect(bridgeBaseProblem("http://192.168.1.50:1984")).toBeNull();
    expect(bridgeBaseProblem("https://bridge.example.com")).toBeNull();
  });

  it("warns about a plain-http bridge on an https page only", () => {
    expect(mixedContentWarning("http://192.168.1.50:1984", "https:")).toContain("HTTPS");
    expect(mixedContentWarning("https://bridge.example.com", "https:")).toBeNull();
    expect(mixedContentWarning("http://192.168.1.50:1984", "http:")).toBeNull();
  });
});

describe("derived addresses", () => {
  it("builds go2rtc HLS and snapshot addresses", () => {
    expect(go2rtcHlsUrl("http://192.168.1.50:1984", "ring_front")).toBe(
      "http://192.168.1.50:1984/api/stream.m3u8?src=ring_front",
    );
    expect(go2rtcSnapshotUrl("http://192.168.1.50:1984/", "ring front")).toBe(
      "http://192.168.1.50:1984/api/frame.jpeg?src=ring%20front",
    );
  });

  it("suggests a stream name from a camera name", () => {
    expect(streamSlug("Front Door")).toBe("front_door");
    expect(streamSlug("  Garage — Side ")).toBe("garage_side");
  });
});

describe("bridge plan", () => {
  const cameras = [
    { id: "1", camera_id: "CAM-001", name: "Front Door", streamName: "ring_front" },
    { id: "2", camera_id: "CAM-002", name: "Back Door", streamName: "" },
    { id: "3", camera_id: "CAM-003", name: "Driveway", streamName: "ring_front" },
  ];

  it("skips cameras with no stream name instead of guessing", () => {
    const plan = buildBridgePlan("http://192.168.1.50:1984", cameras);
    expect(plan.assignments.map((a) => a.camera_id)).toEqual(["CAM-001", "CAM-003"]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.camera_id).toBe("CAM-002");
  });

  it("reports two cameras sharing one stream name", () => {
    const plan = buildBridgePlan("http://192.168.1.50:1984", cameras);
    expect(plan.duplicateStreamNames).toEqual(["ring_front"]);
  });

  it("records HLS and snapshot addresses per camera", () => {
    const plan = buildBridgePlan("http://192.168.1.50:1984", [cameras[0]!]);
    expect(plan.assignments[0]!.streamUrl).toContain("/api/stream.m3u8?src=ring_front");
    expect(plan.assignments[0]!.snapshotUrl).toContain("/api/frame.jpeg?src=ring_front");
    expect(plan.duplicateStreamNames).toEqual([]);
  });
});
