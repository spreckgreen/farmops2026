// Read-only server function for the electrical reference migration audit.
// It loads the current records and classifies every relationship slot; it never
// writes, so running the audit can never change or reconstruct a record.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { ENTITIES } from "@/lib/electrical-entities";
import { buildRefAudit, type RefAuditReport } from "@/lib/electrical-ref-audit";
import type { ElectricalEntityKind } from "@/lib/electrical";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";

type LooseDb = { from: (table: string) => any };

export interface RefAuditPayload extends RefAuditReport {
  generatedAt: string;
}

export const electricalRefAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RefAuditPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;
    const kinds: ElectricalEntityKind[] = [
      "panel",
      "circuit_group",
      "load",
      "raceway",
      "jbox",
      "branch",
    ];
    const fetched = await Promise.all(
      kinds.map(async (kind) => {
        const { data, error } = await db.from(ENTITIES[kind].table).select("*");
        if (error) throw new Error(error.message);
        return (data ?? []) as Row[];
      }),
    );
    const graph: ElectricalGraphData = {
      panel: fetched[0]!,
      circuit_group: fetched[1]!,
      load: fetched[2]!,
      raceway: fetched[3]!,
      jbox: fetched[4]!,
      branch: fetched[5]!,
    };
    return { ...buildRefAudit(graph), generatedAt: new Date().toISOString() };
  });
