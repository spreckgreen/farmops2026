// Resolve FA-FS-2026-09-05-CAMERA-LOAD-SHED-GROUP from live records.
//
// Read-only: reads the current load-shedding group of the two affected exterior
// camera records and returns the single-field manifest with exact before/after
// values. It writes nothing; every item still needs individual owner approval.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  LOAD_SHED_GROUP_BATCH_ID,
  LOAD_SHED_GROUP_LOADS,
  buildLoadShedGroupR5,
  type LoadShedGroupLoadRow,
  type LoadShedGroupRow,
} from "@/lib/electrical-load-shed-group-r5";

type LooseDb = { from: (table: string) => any };

const COLUMNS = "load_id,load_shed_group,suggested_panel,logical_panel_ref,resilience_class";

export interface LoadShedGroupResolution {
  batch_id: string;
  manifest_text: string;
  rows: LoadShedGroupRow[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
  held: string[];
  itemCount: number;
}

export const resolveLoadShedGroupR5 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LoadShedGroupResolution> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const res = await db
      .from("electrical_loads")
      .select(COLUMNS)
      .in("load_id", [...LOAD_SHED_GROUP_LOADS]);
    if (res.error) throw new Error(res.error.message);

    const built = buildLoadShedGroupR5({
      loads: (res.data ?? []) as LoadShedGroupLoadRow[],
    });

    return {
      batch_id: LOAD_SHED_GROUP_BATCH_ID,
      manifest_text: JSON.stringify(built.manifest, null, 2),
      rows: built.rows,
      loadsNotFound: built.loadsNotFound,
      alreadyCorrect: built.alreadyCorrect,
      held: built.held,
      itemCount: built.manifest.items.length,
    };
  });
