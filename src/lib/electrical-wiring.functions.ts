// Read-only server function backing /electrical/wiring.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WiringSchedule } from "@/lib/electrical-wiring";

export const loadWiringSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WiringSchedule> => {
    const { requireElectricalAccess } = await import("@/lib/addons.server");
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
    const { buildWiringSchedule } = await import("@/lib/electrical-wiring");
    const snap = await collectSnapshot(context.supabase);
    return buildWiringSchedule({
      panels: snap.panels as Record<string, unknown>[],
      circuitGroups: snap.circuit_groups as Record<string, unknown>[],
      loads: snap.loads as Record<string, unknown>[],
      positions: snap.panel_breaker_positions as Record<string, unknown>[],
    });
  });
