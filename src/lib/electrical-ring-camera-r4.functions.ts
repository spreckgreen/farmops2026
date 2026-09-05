// Resolve FA-FS-2026-09-05-RING-CAMERA-DESIGN from live records.
//
// Read-only: reads the current location, design, panel and classification values
// of FS-002…FS-010 and returns the approved-planned-design manifest with exact
// before/after values. It writes nothing; every item still needs individual
// owner approval before anything is applied.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  RING_CAMERA_HELD_LOAD,
  RING_CAMERA_LOADS,
  RING_CAMERA_LOGICAL_PANEL_TOKEN,
} from "@/lib/electrical-ring-camera-design";
import {
  RING_CAMERA_BATCH_ID,
  buildRingCameraDesignBatch,
  type RingCameraLoadRow,
  type RingCameraRow,
} from "@/lib/electrical-ring-camera-r4";

type LooseDb = { from: (table: string) => any };

const COLUMNS = [
  "load_id",
  "description",
  "location",
  "design_location_source",
  "corner_reference",
  "mounting_wall_face",
  "coverage_direction",
  "mounting_classification",
  "mounting_height_ft",
  "design_x_ft",
  "design_y_ft",
  "design_grid",
  "suggested_panel",
  "backup_panel",
  "load_shed_group",
  "resilience_class",
  "load_shed_capable",
  "dedicated",
  "dedicated_shared",
  "install_status",
  "logical_panel_ref",
  "logical_panel_uuid",
  "updated_at",
].join(",");

export interface RingCameraResolution {
  batch_id: string;
  manifest_text: string;
  rows: RingCameraRow[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
  itemCount: number;
}

export const resolveRingCameraDesign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RingCameraResolution> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const res = await db
      .from("electrical_loads")
      .select(COLUMNS)
      .in("load_id", [...RING_CAMERA_LOADS, RING_CAMERA_HELD_LOAD]);
    if (res.error) throw new Error(res.error.message);

    // The logical panel is looked up, never invented: PNL-FS-CRIT must already
    // be on record AND classified logical before it can be assigned.
    const lp = await db
      .from("electrical_panels")
      .select("id,panel_id,panel_kind")
      .eq("panel_id", RING_CAMERA_LOGICAL_PANEL_TOKEN)
      .maybeSingle();
    const logicalPanelUuid =
      !lp.error && lp.data && String(lp.data.panel_kind) === "logical"
        ? String(lp.data.id)
        : null;

    const built = buildRingCameraDesignBatch({
      loads: (res.data ?? []) as RingCameraLoadRow[],
      logicalPanelUuid,
    });

    return {
      batch_id: RING_CAMERA_BATCH_ID,
      manifest_text: JSON.stringify(built.manifest, null, 2),
      rows: built.rows,
      loadsNotFound: built.loadsNotFound,
      alreadyCorrect: built.alreadyCorrect,
      itemCount: built.manifest.items.length,
    };
  });
