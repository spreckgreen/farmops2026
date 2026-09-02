// Phase 4.4b — read-only FarmOps provenance for connected_va zero-origin review.
// SELECT only: no updates, no inserts, no apply path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import type { LoadProvenanceRow } from "@/lib/electrical-zero-origin-provenance";

interface RawLoad {
  id: string;
  load_id: string;
  connected_va: number | null;
  volts: number | null;
  amps: number | null;
  source_reference: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const listConnectedVaProvenance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LoadProvenanceRow[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");

    const { data, error } = await context.supabase
      .from("electrical_loads")
      .select("id, load_id, connected_va, volts, amps, source_reference, notes, created_at, updated_at");
    if (error) throw new Error(error.message);
    const loads = (data ?? []) as RawLoad[];

    // Bulk-creation evidence: how many rows share the same creation second.
    const batch = new Map<string, number>();
    for (const l of loads) {
      const k = (l.created_at ?? "").slice(0, 19);
      batch.set(k, (batch.get(k) ?? 0) + 1);
    }

    // Field-level audit entries touching connected_va, if any survive.
    const audits = new Map<string, number>();
    const { data: auditRows } = await context.supabase
      .from("electrical_change_audit")
      .select("record_id, stable_id, changed_fields")
      .eq("entity_kind", "load");
    for (const a of (auditRows ?? []) as {
      record_id: string | null;
      stable_id: string | null;
      changed_fields: unknown;
    }[]) {
      const fields = a.changed_fields as Record<string, unknown> | null;
      if (!fields || !("connected_va" in fields)) continue;
      const key = a.stable_id ?? a.record_id ?? "";
      if (key) audits.set(key, (audits.get(key) ?? 0) + 1);
    }

    return loads.map((l) => ({
      load_id: l.load_id,
      connected_va: l.connected_va,
      volts: l.volts,
      amps: l.amps,
      source_reference: l.source_reference,
      notes: l.notes,
      created_at: l.created_at,
      updated_at: l.updated_at,
      audit_entries: audits.get(l.load_id) ?? audits.get(l.id) ?? 0,
      import_snapshot: false,
      creation_batch_size: batch.get((l.created_at ?? "").slice(0, 19)) ?? 1,
    }));
  });
