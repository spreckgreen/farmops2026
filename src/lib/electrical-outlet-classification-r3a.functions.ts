// Resolve FA-FS-2026-09-03-PM-R3A-OUTLET-CLASSIFICATION from live records.
//
// Read-only: reads the current dedicated/shared classification of the two
// audited receptacle outlets and returns the classification-only manifest with
// exact before/after values. It writes nothing; every item still needs
// individual owner approval.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  R3A_OUTLET_CLASSIFICATION_BATCH_ID,
  R3A_OUTLET_LOADS,
  buildOutletClassificationR3A,
  type R3AClassificationRow,
} from "@/lib/electrical-outlet-classification-r3a";
import type { OutletLoadRow } from "@/lib/electrical-outlet-metadata-r3";

type LooseDb = { from: (table: string) => any };

const COLUMNS = "load_id,dedicated,dedicated_shared,circuit_group_uuid";

export interface OutletClassificationResolution {
  batch_id: string;
  manifest_text: string;
  rows: R3AClassificationRow[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
  itemCount: number;
}

export const resolveOutletClassificationR3A = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutletClassificationResolution> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const res = await db
      .from("electrical_loads")
      .select(COLUMNS)
      .in("load_id", [...R3A_OUTLET_LOADS]);
    if (res.error) throw new Error(res.error.message);

    const built = buildOutletClassificationR3A({
      loads: (res.data ?? []) as OutletLoadRow[],
    });

    return {
      batch_id: R3A_OUTLET_CLASSIFICATION_BATCH_ID,
      manifest_text: JSON.stringify(built.manifest, null, 2),
      rows: built.rows,
      loadsNotFound: built.loadsNotFound,
      alreadyCorrect: built.alreadyCorrect,
      itemCount: built.manifest.items.length,
    };
  });
