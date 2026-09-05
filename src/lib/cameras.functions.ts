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

const CAMERA_COLUMNS =
  "id, camera_id, name, area, building, mount, stream_kind, stream_url, snapshot_url, x_feet, y_feet, heading_degrees, fov_degrees, range_feet, electrical_load_ref, status, last_seen_at, last_check_at, last_check_detail, notes, updated_at";

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

/**
 * Reachability check. The server requests the snapshot (preferred) or feed
 * address and records exactly what came back: no response is ever interpreted
 * as "probably fine".
 */
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

    const target = (camera.snapshot_url ?? camera.stream_url ?? "").trim();
    const checkedAt = new Date().toISOString();
    let ok = false;
    let httpStatus: number | null = null;
    let latency: number | null = null;
    let detail = "No feed or snapshot address is recorded, so the camera cannot be checked.";

    if (target) {
      const started = Date.now();
      try {
        const response = await fetch(target, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        latency = Date.now() - started;
        httpStatus = response.status;
        ok = response.ok;
        detail = ok
          ? `Answered with ${response.status} in ${latency} ms.`
          : `Answered with ${response.status}.`;
      } catch (error) {
        latency = Date.now() - started;
        detail = error instanceof Error ? `No answer: ${error.message}` : "No answer from the camera.";
      }
    }

    const { error: checkError } = await supabase.from("camera_status_checks").insert({
      user_id: userId,
      camera_uuid: camera.id,
      checked_at: checkedAt,
      ok,
      http_status: httpStatus,
      latency_ms: latency,
      detail,
    });
    if (checkError) throw new Error(checkError.message);

    const patch = {
      status: target ? (ok ? "online" : "offline") : "unknown",
      last_check_at: checkedAt,
      last_check_detail: detail,
      ...(ok ? { last_seen_at: checkedAt } : {}),
    };
    const { data: row, error: updateError } = await supabase
      .from("cameras")
      .update(patch)
      .eq("id", camera.id)
      .select(CAMERA_COLUMNS)
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    return { camera: row as unknown as CameraRow, ok, detail };
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
