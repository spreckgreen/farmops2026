// Phase 4.4b — read-only load rows for the final semantic adjudication report.
// SELECT only: no updates, no inserts, no apply path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  ADJUDICATED_LOAD_IDS,
} from "@/lib/electrical-load-adjudication";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

export const listAdjudicatedLoads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FarmOpsLoadRow[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const { data, error } = await context.supabase
      .from("electrical_loads")
      .select(
        "id, load_id, description, equipment_model, volts, amps, connected_va, demand_va, source_circuit, circuit_group_ref, source_reference, notes",
      )
      .in("load_id", [...ADJUDICATED_LOAD_IDS]);
    if (error) throw new Error(error.message);
    return (data ?? []) as FarmOpsLoadRow[];
  });
