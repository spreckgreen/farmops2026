// Read-only load rows for the Load_Master business-rule views.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RuleLoadRow {
  load_id: string | null;
  description: string | null;
  area: string | null;
  location: string | null;
  critical: boolean | null;
  future: boolean | null;
  continuous_load: boolean | null;
  backup_priority: string | null;
  backup_panel: string | null;
  suggested_panel: string | null;
  dedicated: boolean | null;
  dedicated_shared: string | null;
  circuit_group_ref: string | null;
  demand_basis: string | null;
  demand_va: number | null;
  connected_va: number | null;
  phase: string | null;
  volts: number | null;
  amps: number | null;
  installed_ocp_rating: number | null;
  design_circuit_ampacity: number | null;
  install_status: string | null;
  load_shed_group: string | null;
}

export const loadRuleLoads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RuleLoadRow[]> => {
    const { requireElectricalAccess } = await import("@/lib/addons.server");
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const { data, error } = await context.supabase
      .from("electrical_loads")
      .select(
        "load_id,description,area,location,critical,future,continuous_load,backup_priority,backup_panel,suggested_panel,dedicated,dedicated_shared,circuit_group_ref,demand_basis,demand_va,connected_va,phase,volts,amps,installed_ocp_rating,design_circuit_ampacity,install_status,load_shed_group",
      )
      .order("load_id", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as RuleLoadRow[];
  });
