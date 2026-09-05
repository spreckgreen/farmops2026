// Pure helpers for the Cameras module: shared by the browser UI and the
// server functions, so a coverage wedge, a status label or a stream decision is
// computed exactly once.
//
// The module records what is KNOWN about a camera. It never infers a position,
// a facing direction or an online state: an unplaced camera stays off the
// coverage map, and an unchecked camera stays "unknown".

export const CAMERA_STREAM_KINDS = ["none", "hls", "mp4", "mjpeg", "embed"] as const;
export type CameraStreamKind = (typeof CAMERA_STREAM_KINDS)[number];

export const CAMERA_STATUSES = ["online", "offline", "unknown"] as const;
export type CameraStatus = (typeof CAMERA_STATUSES)[number];

export const CAMERA_STREAM_KIND_LABEL: Record<CameraStreamKind, string> = {
  none: "No feed recorded",
  hls: "Live stream (HLS)",
  mp4: "Video file / stream (MP4)",
  mjpeg: "Motion JPEG",
  embed: "Embedded player page",
};

export const CAMERA_STATUS_LABEL: Record<CameraStatus, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Not checked",
};

/** Tailwind classes for a status pill; tokens only, no hardcoded colours. */
export const CAMERA_STATUS_CLASS: Record<CameraStatus, string> = {
  online: "border-primary/40 bg-primary/10 text-primary",
  offline: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted text-muted-foreground",
};

export interface CameraRow {
  id: string;
  camera_id: string;
  name: string;
  area: string | null;
  building: string | null;
  mount: string | null;
  stream_kind: string;
  stream_url: string | null;
  snapshot_url: string | null;
  x_feet: number | null;
  y_feet: number | null;
  heading_degrees: number | null;
  fov_degrees: number;
  range_feet: number;
  electrical_load_ref: string | null;
  status: string;
  last_seen_at: string | null;
  last_check_at: string | null;
  last_check_detail: string | null;
  notes: string | null;
  ring_model: string | null;
  compass_side: string | null;
  side_slot: number | null;
  updated_at?: string | null;
}

export interface CameraCheckRow {
  id: string;
  camera_uuid: string;
  checked_at: string;
  ok: boolean;
  http_status: number | null;
  latency_ms: number | null;
  detail: string | null;
}

export function cameraStreamKind(row: Pick<CameraRow, "stream_kind">): CameraStreamKind {
  const value = String(row.stream_kind ?? "none");
  return (CAMERA_STREAM_KINDS as readonly string[]).includes(value)
    ? (value as CameraStreamKind)
    : "none";
}

export function cameraStatus(row: Pick<CameraRow, "status">): CameraStatus {
  const value = String(row.status ?? "unknown");
  return (CAMERA_STATUSES as readonly string[]).includes(value)
    ? (value as CameraStatus)
    : "unknown";
}

/**
 * Suggest a stream kind from an address. Only used to prefill the form — the
 * recorded value always wins, because a proxy can serve any format on any path.
 */
export function suggestStreamKind(url: string | null | undefined): CameraStreamKind {
  const value = String(url ?? "").trim().toLowerCase();
  if (!value) return "none";
  if (value.includes(".m3u8")) return "hls";
  if (value.endsWith(".mp4") || value.includes(".mp4?")) return "mp4";
  if (value.includes("mjpeg") || value.includes("mjpg") || value.endsWith(".cgi")) return "mjpeg";
  return "embed";
}

/** True when a browser can play this feed without extra plugins or keys. */
export function isPlayableInBrowser(row: Pick<CameraRow, "stream_kind" | "stream_url">): boolean {
  const kind = cameraStreamKind(row);
  if (kind === "none") return false;
  return Boolean(String(row.stream_url ?? "").trim());
}

/**
 * A recorded feed address must be http(s). RTSP cannot play in a browser and
 * must be restreamed first, so it is reported instead of silently accepted.
 */
export function streamUrlProblem(url: string | null | undefined): string | null {
  const value = String(url ?? "").trim();
  if (!value) return null;
  if (/^rtsp:/i.test(value)) {
    return "A browser cannot play an RTSP address directly. Restream it as HLS (.m3u8) and record that address here.";
  }
  if (!/^https?:\/\//i.test(value)) return "The feed address must start with http:// or https://";
  return null;
}

export function isPlaced(row: Pick<CameraRow, "x_feet" | "y_feet">): boolean {
  return row.x_feet !== null && row.y_feet !== null;
}

export function hasCoverageDirection(
  row: Pick<CameraRow, "x_feet" | "y_feet" | "heading_degrees">,
): boolean {
  return isPlaced(row) && row.heading_degrees !== null;
}

/**
 * Coverage wedge in FEET, as points for an SVG polygon after conversion.
 * Heading is compass-style: 0 = north (up / decreasing Y), 90 = east.
 * Returns null when direction or position is not recorded — an unknown aim is
 * never drawn as a guess.
 */
export function coverageWedgeFeet(
  row: Pick<CameraRow, "x_feet" | "y_feet" | "heading_degrees" | "fov_degrees" | "range_feet">,
  steps = 16,
): { xFt: number; yFt: number }[] | null {
  if (!hasCoverageDirection(row)) return null;
  const cx = Number(row.x_feet);
  const cy = Number(row.y_feet);
  const heading = Number(row.heading_degrees);
  const fov = Math.min(360, Math.max(1, Number(row.fov_degrees) || 90));
  const range = Math.max(0.5, Number(row.range_feet) || 1);
  const start = heading - fov / 2;
  const points: { xFt: number; yFt: number }[] = [{ xFt: cx, yFt: cy }];
  for (let i = 0; i <= steps; i += 1) {
    const deg = start + (fov * i) / steps;
    const rad = (deg * Math.PI) / 180;
    points.push({
      xFt: cx + Math.sin(rad) * range,
      yFt: cy - Math.cos(rad) * range,
    });
  }
  return points;
}

/** Compass label for a recorded heading, or null when it is not recorded. */
export function headingLabel(heading: number | null | undefined): string | null {
  if (heading === null || heading === undefined || String(heading).trim() === "") return null;
  const deg = ((Number(heading) % 360) + 360) % 360;
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(deg / 22.5) % 16;
  return `${Math.round(deg)}° ${names[idx]}`;
}

export interface CameraCoverageSummary {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  withFeed: number;
  placed: number;
  aimed: number;
  /** Cameras that cannot be drawn on the coverage map, and why. */
  gaps: { cameraId: string; reason: string }[];
}

export function cameraCoverageSummary(rows: readonly CameraRow[]): CameraCoverageSummary {
  const gaps: { cameraId: string; reason: string }[] = [];
  let online = 0;
  let offline = 0;
  let unknown = 0;
  let withFeed = 0;
  let placed = 0;
  let aimed = 0;
  for (const row of rows) {
    const status = cameraStatus(row);
    if (status === "online") online += 1;
    else if (status === "offline") offline += 1;
    else unknown += 1;
    if (isPlayableInBrowser(row)) withFeed += 1;
    else gaps.push({ cameraId: row.camera_id, reason: "No playable feed address recorded" });
    if (isPlaced(row)) placed += 1;
    else gaps.push({ cameraId: row.camera_id, reason: "No plan position recorded (X/Y in feet)" });
    if (hasCoverageDirection(row)) aimed += 1;
    else if (isPlaced(row)) {
      gaps.push({ cameraId: row.camera_id, reason: "No facing direction recorded — plotted as a point only" });
    }
  }
  return { total: rows.length, online, offline, unknown, withFeed, placed, aimed, gaps };
}

/** Stable walk order: area, then camera ID. */
export function sortCameras(rows: readonly CameraRow[]): CameraRow[] {
  return [...rows].sort(
    (a, b) =>
      String(a.area ?? "").localeCompare(String(b.area ?? "")) ||
      a.camera_id.localeCompare(b.camera_id),
  );
}

/** Next free CAM-### identifier for this account. Stable IDs are never reused. */
export function nextCameraId(rows: readonly Pick<CameraRow, "camera_id">[]): string {
  let max = 0;
  for (const row of rows) {
    const m = /^CAM-(\d{3,})$/.exec(String(row.camera_id ?? "").trim().toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CAM-${String(max + 1).padStart(3, "0")}`;
}

/** Relative age of the last successful contact, for the status column. */
export function lastSeenLabel(row: Pick<CameraRow, "last_seen_at">, now: Date = new Date()): string {
  const at = row.last_seen_at ? new Date(row.last_seen_at) : null;
  if (!at || Number.isNaN(at.getTime())) return "Never seen";
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  if (mins < 1) return "Seen just now";
  if (mins < 60) return `Seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Seen ${hours} h ago`;
  return `Seen ${Math.round(hours / 24)} d ago`;
}
