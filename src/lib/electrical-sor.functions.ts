// Read-only SOR status endpoint. It reads the same snapshot the reconciliation
// export produces, so the authority banner can never disagree with the data
// FarmOps hands to BosteadFarmsBuildDocs. No writes; the canonical ODS is never
// touched.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { collectSnapshot } from "@/lib/electrical-snapshot.functions";
import { SNAPSHOT_COLLECTIONS } from "@/lib/electrical-snapshot";
import { buildSorStatus, latestChange, type SorStatus } from "@/lib/electrical-sor";

export const electricalSorStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SorStatus> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const snapshot = await collectSnapshot(context.supabase);
    return buildSorStatus({
      counts: snapshot.counts,
      lastRecordChange: latestChange(SNAPSHOT_COLLECTIONS.map((c) => snapshot[c])),
      lastReconciliation: snapshot.generated_at,
      qa: { errors: snapshot.qa.errors, warnings: snapshot.qa.warnings },
    });
  });
