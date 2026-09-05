// Create a house camera as an electrical object, and link it to its camera row.
//
// What this writes is deliberately tiny: a stable ID, a description, and the
// side of the house it is on. No panel, no circuit, no breaker, no voltage, no
// amps, no position in feet — none of that is known from a camera record, and
// none of it is invented here. Those fields stay empty until they are observed
// in the field and recorded through the normal field-audit path.
//
// Every create is previewed first and only written when the caller confirms,
// and every write is recorded in the electrical change history.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { COMPASS_SIDE_LABEL, isCompassSide, ringModelLabel } from "@/lib/ring-cameras";

/** Stable-ID prefix for house objects. HS-### is permanent once issued. */
export const HOUSE_PREFIX = "HS";

export interface HouseCameraPreview {
  loadId: string;
  description: string;
  location: string;
  grid: string;
  /** Fields left empty on purpose, so nothing looks accidentally missing. */
  withheld: string[];
  cameraId: string;
}

interface CreateInput {
  cameraUuid: string;
  confirm?: boolean;
}

function nextHouseId(existing: readonly string[]): string {
  let max = 0;
  for (const value of existing) {
    const m = new RegExp(`^${HOUSE_PREFIX}-(\\d{3,})$`).exec(String(value ?? "").trim().toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${HOUSE_PREFIX}-${String(max + 1).padStart(3, "0")}`;
}

export const createHouseCameraElectricalObject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateInput) => {
    const cameraUuid = String(input.cameraUuid ?? "").trim();
    if (!cameraUuid) throw new Error("A camera is required.");
    return { cameraUuid, confirm: Boolean(input.confirm) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context as unknown as {
      supabase: { from: (t: string) => any };
      userId: string;
      claims?: { email?: string };
    };
    await requireElectricalAccess(supabase, userId, "field_write");

    const { data: camera, error: cameraError } = await supabase
      .from("cameras")
      .select("id, camera_id, name, building, mount, compass_side, side_slot, ring_model, electrical_load_ref")
      .eq("id", data.cameraUuid)
      .maybeSingle();
    if (cameraError) throw new Error(cameraError.message);
    if (!camera) throw new Error("That camera was not found.");
    if (camera.electrical_load_ref) {
      throw new Error(
        `${camera.camera_id} is already linked to electrical record ${camera.electrical_load_ref}.`,
      );
    }
    const side = camera.compass_side as string;
    if (!isCompassSide(side)) {
      throw new Error(
        `Record which side of the building ${camera.camera_id} is on before creating its electrical record.`,
      );
    }

    const { data: existing, error: listError } = await supabase
      .from("electrical_loads")
      .select("load_id");
    if (listError) throw new Error(listError.message);
    const loadId = nextHouseId((existing ?? []).map((r: { load_id: string }) => r.load_id));

    const model = ringModelLabel(camera.ring_model);
    const sideLabel = COMPASS_SIDE_LABEL[side];
    const description = `Camera — ${model ?? "Ring camera"}${camera.mount ? ` (${camera.mount})` : ""}`;
    const location = `${camera.building ?? "House"} exterior, ${sideLabel.toLowerCase()}${
      camera.side_slot ? `, share ${camera.side_slot} of that side` : ""
    } — side recorded from the camera record; no measured position on record`;

    const preview: HouseCameraPreview = {
      loadId,
      description,
      location,
      grid: HOUSE_PREFIX,
      cameraId: camera.camera_id,
      withheld: [
        "panel, circuit and breaker — not observed",
        "voltage, amps, VA and any other engineering value — not observed",
        "position in feet and grid reference — this building has no measured grid yet",
      ],
    };
    if (!data.confirm) return { preview, applied: false as const };

    const { data: created, error: insertError } = await supabase
      .from("electrical_loads")
      .insert({
        user_id: userId,
        load_id: loadId,
        description,
        location,
        grid: HOUSE_PREFIX,
        install_status: "planned",
      })
      .select("id, load_id")
      .maybeSingle();
    if (insertError) throw new Error(insertError.message);
    if (!created) throw new Error("The electrical record could not be created.");

    const { error: linkError } = await supabase
      .from("cameras")
      .update({ electrical_load_ref: loadId })
      .eq("id", camera.id);
    if (linkError) throw new Error(linkError.message);

    await supabase.from("electrical_change_audit").insert({
      user_id: userId,
      actor_email: claims?.email ?? null,
      section: "cameras",
      entity_kind: "electrical_load",
      entity_uuid: created.id,
      entity_ref: loadId,
      action: "create",
      summary: `${loadId} created from camera ${camera.camera_id} (${sideLabel}). Description and side only; no panel, circuit or engineering value recorded.`,
      changes: {
        camera_id: camera.camera_id,
        description,
        location,
        ring_model: camera.ring_model ?? null,
        compass_side: side,
        side_slot: camera.side_slot ?? null,
        withheld: preview.withheld,
      },
      access_basis: "electrical field_write",
    });

    return { preview, applied: true as const, loadId };
  });
