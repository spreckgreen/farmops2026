// Resolve FA-FS-2026-09-03-PM-R3-OUTLET-METADATA from live records.
//
// Read-only: it reads the current values of the 18 audited receptacle outlets
// and the 9 unaudited candidate records, then returns the metadata-only manifest
// with exact before/after values plus the read-only candidate report. It writes
// nothing; every item still needs individual owner approval.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  R3_OUTLET_AUDITED_LOADS,
  R3_OUTLET_CANDIDATE_LOADS,
  R3_OUTLET_METADATA_BATCH_ID,
  buildOutletMetadataR3,
  type OutletCandidateReport,
  type OutletCorrection,
  type OutletLoadRow,
} from "@/lib/electrical-outlet-metadata-r3";

type LooseDb = { from: (table: string) => any };

const COLUMNS =
  "load_id,dedicated,dedicated_shared,amps,connected_va,amps_semantic,amps_semantic_provenance,circuit_group_uuid";

export interface OutletMetadataResolution {
  batch_id: string;
  manifest_text: string;
  corrections: OutletCorrection[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
  candidates: OutletCandidateReport[];
  itemCount: number;
}

export const resolveOutletMetadataR3 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OutletMetadataResolution> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const [audited, candidates] = await Promise.all([
      db.from("electrical_loads").select(COLUMNS).in("load_id", [...R3_OUTLET_AUDITED_LOADS]),
      db.from("electrical_loads").select(COLUMNS).in("load_id", [...R3_OUTLET_CANDIDATE_LOADS]),
    ]);
    for (const r of [audited, candidates]) if (r.error) throw new Error(r.error.message);

    const built = buildOutletMetadataR3({
      audited: (audited.data ?? []) as OutletLoadRow[],
      candidates: (candidates.data ?? []) as OutletLoadRow[],
    });

    return {
      batch_id: R3_OUTLET_METADATA_BATCH_ID,
      manifest_text: JSON.stringify(built.manifest, null, 2),
      corrections: built.corrections,
      loadsNotFound: built.loadsNotFound,
      alreadyCorrect: built.alreadyCorrect,
      candidates: built.candidates,
      itemCount: built.manifest.items.length,
    };
  });
