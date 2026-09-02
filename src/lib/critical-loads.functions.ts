// Read-only master-load feed for the PNL-FS-CRIT critical-load study.
// SELECT only: no writes, no apply path, canonical ODS untouched.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MasterLoadRow } from "@/lib/electrical-critical-loads";

export interface CriticalLoadFeed {
  generated_at: string;
  loads: MasterLoadRow[];
  /** PNL-FS-CRIT as recorded today, or null when the panel row is absent. */
  panel: {
    panel_id: string;
    description: string | null;
    building: string | null;
    bus_rating_amps: number | null;
    voltage: number | null;
    phase: string | null;
    spaces: number | null;
    feeder_source: string | null;
    install_status: string | null;
    notes: string | null;
  } | null;
}

export const CRITICAL_PANEL_ID = "PNL-FS-CRIT";

export const loadCriticalLoadFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CriticalLoadFeed> => {
    const { requireElectricalAccess } = await import("@/lib/addons.server");
    await requireElectricalAccess(context.supabase, context.userId, "read");

    const { data: loads, error } = await context.supabase
      .from("electrical_loads")
      .select(
        "load_id, description, area, grid, count, volts, amps, connected_va, demand_va, phase, critical, future, continuous_load, backup_eligible, backup_priority, backup_panel, load_shed_group, suggested_panel, install_status, notes",
      )
      .order("load_id", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: panels, error: panelError } = await context.supabase
      .from("electrical_panels")
      .select(
        "panel_id, description, building, bus_rating_amps, voltage, phase, spaces, feeder_source, install_status, notes",
      )
      .eq("panel_id", CRITICAL_PANEL_ID)
      .limit(1);
    if (panelError) throw new Error(panelError.message);

    return {
      generated_at: new Date().toISOString(),
      loads: (loads ?? []) as unknown as MasterLoadRow[],
      panel: (panels?.[0] ?? null) as CriticalLoadFeed["panel"],
    };
  });
