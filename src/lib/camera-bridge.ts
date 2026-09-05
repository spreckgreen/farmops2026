// Helpers for wiring cameras to a local bridge (Home Assistant + go2rtc, or
// Scrypted + go2rtc) that restreams them as browser-playable HLS.
//
// Ring gives no public live-video API, so the bridge is the supported path: it
// pulls the camera and republishes it. This file only *derives* addresses from a
// bridge address the owner enters plus the stream name they confirm — it never
// invents a host, a port or a stream name.

export const BRIDGE_KINDS = ["go2rtc", "custom"] as const;
export type BridgeKind = (typeof BRIDGE_KINDS)[number];

export const BRIDGE_KIND_LABEL: Record<BridgeKind, string> = {
  go2rtc: "Home Assistant / Scrypted with go2rtc",
  custom: "Another bridge (I will paste each address)",
};

/** Trim a bridge address to `scheme://host:port` with no trailing slash. */
export function normalizeBridgeBase(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\/+$/, "");
}

export function bridgeBaseProblem(value: string | null | undefined): string | null {
  const base = normalizeBridgeBase(value);
  if (base === "") return "Enter the address of your bridge, for example http://192.168.1.50:1984";
  if (/^rtsp:/i.test(base)) {
    return "Enter the bridge's web address (http:// or https://), not an RTSP address — the bridge is what turns RTSP into a stream a browser can play.";
  }
  if (!/^https?:\/\/[^/?#\s]+$/i.test(base)) {
    return "The bridge address should look like http://192.168.1.50:1984 — host and port only, with no path.";
  }
  return null;
}

/**
 * A page served over HTTPS cannot load a plain-HTTP stream: the browser blocks
 * it as mixed content. Worth saying plainly, because the address is still
 * correct — it just needs HTTPS or a LAN-hosted page to play.
 */
export function mixedContentWarning(base: string, pageProtocol: string): string | null {
  if (!pageProtocol.startsWith("https")) return null;
  if (!/^http:\/\//i.test(normalizeBridgeBase(base))) return null;
  return "This page is served over HTTPS, so the browser will refuse to play a plain http:// stream. The addresses are still recorded and status checks still run from the server; to watch live here, put the bridge behind HTTPS or open the app from your local network.";
}

/** Turn a camera name into the kind of stream name a bridge normally uses. */
export function streamSlug(name: string | null | undefined): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function go2rtcHlsUrl(base: string, streamName: string): string {
  const src = encodeURIComponent(streamName.trim());
  return `${normalizeBridgeBase(base)}/api/stream.m3u8?src=${src}`;
}

export function go2rtcSnapshotUrl(base: string, streamName: string): string {
  const src = encodeURIComponent(streamName.trim());
  return `${normalizeBridgeBase(base)}/api/frame.jpeg?src=${src}`;
}

export interface BridgeAssignmentInput {
  id: string;
  camera_id: string;
  name: string;
  /** Stream name on the bridge; blank means "leave this camera alone". */
  streamName: string;
}

export interface BridgeAssignmentPlan {
  id: string;
  camera_id: string;
  name: string;
  streamName: string;
  streamUrl: string;
  snapshotUrl: string;
}

export interface BridgePlan {
  base: string;
  assignments: BridgeAssignmentPlan[];
  /** Cameras deliberately left without an address, with the reason. */
  skipped: { camera_id: string; name: string; reason: string }[];
  duplicateStreamNames: string[];
}

/**
 * Build the addresses that would be recorded. A blank stream name is skipped
 * rather than guessed, and the same stream name on two cameras is reported —
 * two cameras never share one feed by accident.
 */
export function buildBridgePlan(base: string, inputs: BridgeAssignmentInput[]): BridgePlan {
  const normalized = normalizeBridgeBase(base);
  const assignments: BridgeAssignmentPlan[] = [];
  const skipped: BridgePlan["skipped"] = [];
  const seen = new Map<string, number>();

  for (const input of inputs) {
    const streamName = String(input.streamName ?? "").trim();
    if (streamName === "") {
      skipped.push({
        camera_id: input.camera_id,
        name: input.name,
        reason: "No stream name entered, so no address was recorded for it.",
      });
      continue;
    }
    seen.set(streamName.toLowerCase(), (seen.get(streamName.toLowerCase()) ?? 0) + 1);
    assignments.push({
      id: input.id,
      camera_id: input.camera_id,
      name: input.name,
      streamName,
      streamUrl: go2rtcHlsUrl(normalized, streamName),
      snapshotUrl: go2rtcSnapshotUrl(normalized, streamName),
    });
  }

  const duplicateStreamNames = [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  return { base: normalized, assignments, skipped, duplicateStreamNames };
}
