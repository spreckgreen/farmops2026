// Server functions for the Cameras module.
//
// Every function is authenticated and gated on the paid `cameras` add-on (an
// administrator always passes). Rows are owner-scoped by RLS as well, so the
// gate here and the database policy both have to agree before anything is read
// or written.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminRole } from "@/lib/admin-role.server";
import { hasAddon } from "@/lib/addons.server";
import { ADDON_NOT_ENABLED } from "@/lib/addons";
import {
  CAMERA_STREAM_KINDS,
  streamUrlProblem,
  type CameraCheckRow,
  type CameraRow,
} from "@/lib/cameras";
import { isCompassSide } from "@/lib/ring-cameras";

const CAMERA_COLUMNS =
  "id, camera_id, name, area, building, mount, stream_kind, stream_url, snapshot_url, x_feet, y_feet, heading_degrees, fov_degrees, range_feet, electrical_load_ref, ring_model, compass_side, side_slot, status, last_seen_at, last_check_at, last_check_detail, notes, updated_at";

async function requireCameras(supabase: unknown, userId: string): Promise<void> {
  if (await isAdminRole(supabase, userId)) return;
  if (await hasAddon(supabase, userId, "cameras")) return;
  throw new Error(ADDON_NOT_ENABLED);
}

interface CameraInput {
  id?: string | null;
  camera_id: string;
  name: string;
  area?: string | null;
  building?: string | null;
  mount?: string | null;
  stream_kind: string;
  stream_url?: string | null;
  snapshot_url?: string | null;
  x_feet?: number | null;
  y_feet?: number | null;
  heading_degrees?: number | null;
  fov_degrees?: number | null;
  range_feet?: number | null;
  electrical_load_ref?: string | null;
  notes?: string | null;
  ring_model?: string | null;
  compass_side?: string | null;
  side_slot?: number | null;
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface CameraFields {
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
  notes: string | null;
  ring_model: string | null;
  compass_side: string | null;
  side_slot: number | null;
}

function validateCamera(input: CameraInput): CameraFields & { id: string | null } {
  const cameraId = clean(input.camera_id);
  if (!cameraId) throw new Error("A camera identifier is required.");
  const name = clean(input.name);
  if (!name) throw new Error("A camera name is required.");
  if (!(CAMERA_STREAM_KINDS as readonly string[]).includes(String(input.stream_kind))) {
    throw new Error("Unknown feed type.");
  }
  const problem = streamUrlProblem(input.stream_url);
  if (problem) throw new Error(problem);
  const fov = num(input.fov_degrees) ?? 90;
  if (fov <= 0 || fov > 360) throw new Error("The field of view must be between 1 and 360 degrees.");
  const range = num(input.range_feet) ?? 30;
  if (range <= 0) throw new Error("The coverage distance must be greater than zero.");
  const side = clean(input.compass_side);
  if (side !== null && !isCompassSide(side)) throw new Error("Unknown building side.");
  const slot = num(input.side_slot);
  if (slot !== null && (!Number.isInteger(slot) || slot < 1)) {
    throw new Error("The share number on a side must be a whole number of 1 or more.");
  }
  const heading = num(input.heading_degrees);
  if (heading !== null && (heading < 0 || heading >= 360)) {
    throw new Error("The facing direction must be between 0 and 359 degrees.");
  }
  return {
    id: clean(input.id),
    camera_id: cameraId.toUpperCase(),
    name,
    area: clean(input.area),
    building: clean(input.building),
    mount: clean(input.mount),
    stream_kind: String(input.stream_kind),
    stream_url: clean(input.stream_url),
    snapshot_url: clean(input.snapshot_url),
    x_feet: num(input.x_feet),
    y_feet: num(input.y_feet),
    heading_degrees: heading,
    fov_degrees: fov,
    range_feet: range,
    electrical_load_ref: clean(input.electrical_load_ref),
    notes: clean(input.notes),
    ring_model: clean(input.ring_model),
    compass_side: side,
    side_slot: slot,
  };
}

export const listCameras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);
    const { data, error } = await supabase
      .from("cameras")
      .select(CAMERA_COLUMNS)
      .order("area", { ascending: true })
      .order("camera_id", { ascending: true });
    if (error) throw new Error(error.message);
    return { cameras: (data ?? []) as unknown as CameraRow[] };
  });

export const saveCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CameraInput) => validateCamera(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);
    const { id, ...fields } = data;
    if (id) {
      const { data: row, error } = await supabase
        .from("cameras")
        .update(fields)
        .eq("id", id)
        .select(CAMERA_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("That camera was not found.");
      return { camera: row as unknown as CameraRow };
    }
    const { data: row, error } = await supabase
      .from("cameras")
      .insert({ ...fields, user_id: userId })
      .select(CAMERA_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { camera: row as unknown as CameraRow };
  });

export const deleteCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input.id);
    if (!id) throw new Error("A camera is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);
    const { error } = await supabase.from("cameras").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

interface ProbeResult {
  ok: boolean;
  httpStatus: number | null;
  latency: number | null;
  detail: string;
  hadTarget: boolean;
}

/**
 * Request a camera's snapshot (preferred) or feed address once and report
 * exactly what came back. No response is ever interpreted as "probably fine",
 * and a camera with no address is reported as uncheckable rather than offline.
 */
async function probeCamera(camera: {
  snapshot_url: string | null;
  stream_url: string | null;
}): Promise<ProbeResult> {
  const target = (camera.snapshot_url ?? camera.stream_url ?? "").trim();
  if (!target) {
    return {
      ok: false,
      httpStatus: null,
      latency: null,
      hadTarget: false,
      detail: "No feed or snapshot address is recorded, so the camera cannot be checked.",
    };
  }
  const started = Date.now();
  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - started;
    return {
      ok: response.ok,
      httpStatus: response.status,
      latency,
      hadTarget: true,
      detail: response.ok
        ? `Answered with ${response.status} in ${latency} ms.`
        : `Answered with ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      latency: Date.now() - started,
      hadTarget: true,
      detail:
        error instanceof Error ? `No answer: ${error.message}` : "No answer from the camera.",
    };
  }
}

/** Record one probe result: a check row plus the camera's current state. */
async function recordProbe(
  supabase: any,
  userId: string,
  cameraUuid: string,
  probe: ProbeResult,
): Promise<CameraRow> {
  const checkedAt = new Date().toISOString();
  const { error: checkError } = await supabase.from("camera_status_checks").insert({
    user_id: userId,
    camera_uuid: cameraUuid,
    checked_at: checkedAt,
    ok: probe.ok,
    http_status: probe.httpStatus,
    latency_ms: probe.latency,
    detail: probe.detail,
  });
  if (checkError) throw new Error(checkError.message);

  const patch = {
    status: probe.hadTarget ? (probe.ok ? "online" : "offline") : "unknown",
    last_check_at: checkedAt,
    last_check_detail: probe.detail,
    ...(probe.ok ? { last_seen_at: checkedAt } : {}),
  };
  const { data: row, error: updateError } = await supabase
    .from("cameras")
    .update(patch)
    .eq("id", cameraUuid)
    .select(CAMERA_COLUMNS)
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  return row as unknown as CameraRow;
}

export const checkCameraStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input.id);
    if (!id) throw new Error("A camera is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);
    const { data: camera, error: readError } = await supabase
      .from("cameras")
      .select("id, snapshot_url, stream_url")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!camera) throw new Error("That camera was not found.");

    const probe = await probeCamera(camera);
    const row = await recordProbe(supabase, userId, camera.id, probe);
    return { camera: row, ok: probe.ok, detail: probe.detail };
  });

/**
 * Check every camera that has an address, so the live views and the coverage
 * map show a current on/off state rather than a stale one. Cameras with no
 * address are counted separately and left as "not checked".
 */
export const checkAllCameraStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);
    const { data: list, error: readError } = await supabase
      .from("cameras")
      .select("id, snapshot_url, stream_url");
    if (readError) throw new Error(readError.message);
    const cameras = (list ?? []) as { id: string; snapshot_url: string | null; stream_url: string | null }[];

    const checkable = cameras.filter((c) => (c.snapshot_url ?? c.stream_url ?? "").trim() !== "");
    const rows: CameraRow[] = [];
    let online = 0;
    let offline = 0;
    // Probed in small batches so one slow camera cannot stall the whole sweep
    // and the request stays inside the server function time budget.
    for (let i = 0; i < checkable.length; i += 4) {
      const batch = checkable.slice(i, i + 4);
      const probes = await Promise.all(batch.map((camera) => probeCamera(camera)));
      for (let n = 0; n < batch.length; n += 1) {
        const camera = batch[n]!;
        const probe = probes[n]!;
        rows.push(await recordProbe(supabase, userId, camera.id, probe));
        if (probe.ok) online += 1;
        else offline += 1;
      }
    }

    return {
      cameras: rows,
      checked: checkable.length,
      online,
      offline,
      skipped: cameras.length - checkable.length,
    };
  });

export const listCameraChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input.id);
    if (!id) throw new Error("A camera is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);
    const { data: rows, error } = await supabase
      .from("camera_status_checks")
      .select("id, camera_uuid, checked_at, ok, http_status, latency_ms, detail")
      .eq("camera_uuid", data.id)
      .order("checked_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return { checks: (rows ?? []) as unknown as CameraCheckRow[] };
  });

/**
 * Record bridge feed addresses for several cameras at once.
 *
 * Only the feed fields are written: nothing about a camera's position, aim,
 * Ring model or electrical link is touched. Cameras without a stream name are
 * left exactly as they were.
 */
export const applyBridgeFeeds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { base_url: string; assignments: { id: string; stream_name: string }[] }) => {
      const baseProblem = bridgeBaseProblem(input?.base_url);
      if (baseProblem) throw new Error(baseProblem);
      const base = normalizeBridgeBase(input.base_url);
      const rawAssignments = Array.isArray(input?.assignments) ? input.assignments : [];
      const assignments = rawAssignments
        .map((entry) => ({
          id: clean(entry?.id) ?? "",
          stream_name: clean(entry?.stream_name) ?? "",
        }))
        .filter((entry) => entry.id !== "" && entry.stream_name !== "");
      if (assignments.length === 0) {
        throw new Error("Enter the bridge stream name for at least one camera.");
      }
      return { base_url: base, assignments };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireCameras(supabase, userId);

    const results: { id: string; camera_id: string; stream_url: string; error?: string }[] = [];
    for (const entry of data.assignments) {
      const streamUrl = go2rtcHlsUrl(data.base_url, entry.stream_name);
      const snapshotUrl = go2rtcSnapshotUrl(data.base_url, entry.stream_name);
      const problem = streamUrlProblem(streamUrl);
      if (problem) {
        results.push({ id: entry.id, camera_id: entry.id, stream_url: streamUrl, error: problem });
        continue;
      }
      const { data: row, error } = await supabase
        .from("cameras")
        .update({ stream_kind: "hls", stream_url: streamUrl, snapshot_url: snapshotUrl })
        .eq("id", entry.id)
        .select("id, camera_id")
        .maybeSingle();
      if (error) {
        results.push({ id: entry.id, camera_id: entry.id, stream_url: streamUrl, error: error.message });
        continue;
      }
      if (!row) {
        results.push({
          id: entry.id,
          camera_id: entry.id,
          stream_url: streamUrl,
          error: "That camera was not found.",
        });
        continue;
      }
      results.push({ id: entry.id, camera_id: String(row.camera_id), stream_url: streamUrl });
    }

    const { data: list, error: listError } = await supabase
      .from("cameras")
      .select(CAMERA_COLUMNS)
      .order("area", { ascending: true })
      .order("camera_id", { ascending: true });
    if (listError) throw new Error(listError.message);

    return {
      ok: results.every((r) => !r.error),
      updated: results.filter((r) => !r.error).length,
      results,
      cameras: (list ?? []) as unknown as CameraRow[],
    };
  });

