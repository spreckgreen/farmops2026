// Read-only server function backing /electrical/panel-diagram.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PanelDiagram } from "@/lib/electrical-panel-diagram";

export const loadPanelDiagram = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PanelDiagram> => {
    const { requireElectricalAccess } = await import("@/lib/addons.server");
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
    const { buildPanelDiagram } = await import("@/lib/electrical-panel-diagram");
    const snap = await collectSnapshot(context.supabase);
    return buildPanelDiagram({
      panels: snap.panels as Record<string, unknown>[],
      feeders: snap.feeders as Record<string, unknown>[],
      circuitGroups: snap.circuit_groups as Record<string, unknown>[],
      loads: snap.loads as Record<string, unknown>[],
      positions: snap.panel_breaker_positions as Record<string, unknown>[],
    });
  });
