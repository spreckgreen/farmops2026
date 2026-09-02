// Read-only FarmOps provenance signals for the FS-084 amp trace.
// SELECT-only: this module never writes to any table.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FS084_PEER_IDS,
  FS084_STABLE_ID,
  type Fs084FarmOpsProvenance,
} from "@/lib/electrical-fs084-amp-provenance";

const TRACED_IDS = [FS084_STABLE_ID, ...FS084_PEER_IDS];

const Input = z
  .object({ stable_ids: z.array(z.string().min(1)).max(12).optional() })
  .optional();

/** Rows created within the same second are treated as one bulk batch. */
function batchKey(ts: string | null): string {
  return ts ? ts.slice(0, 19) : "";
}

export const fetchFs084Provenance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<Fs084FarmOpsProvenance[]> => {
    const ids = data?.stable_ids?.length ? data.stable_ids : TRACED_IDS;
    const supabase = context.supabase;

    const { data: loads, error } = await supabase
      .from("electrical_loads")
      .select("*")
      .in("load_id", ids);
    if (error) throw new Error(`Unable to read electrical_loads: ${error.message}`);
    const rows = loads ?? [];
    if (!rows.length) return [];

    // Bulk-batch sizing: how many loads share each creation second.
    const { data: allCreated } = await supabase.from("electrical_loads").select("created_at");
    const batchCounts = new Map<string, number>();
    for (const r of allCreated ?? []) {
      const k = batchKey((r as { created_at: string | null }).created_at);
      if (!k) continue;
      batchCounts.set(k, (batchCounts.get(k) ?? 0) + 1);
    }

    const uuids = rows.map((r) => (r as { id: string }).id);

    // Field-level audit entries touching amps.
    const { data: audit } = await supabase
      .from("electrical_change_audit")
      .select("record_id, field_name, entity_table")
      .in("record_id", uuids);

    // Breaker positions referencing these loads.
    const { data: breakers } = await supabase
      .from("electrical_breaker_positions")
      .select("load_uuid, label, ocp_amps, poles, breaker_amps")
      .in("load_uuid", uuids);

    // Branch runs referencing these loads.
    const { data: branches } = await supabase
      .from("electrical_branch_runs")
      .select("branch_id, load_uuid")
      .in("load_uuid", uuids);

    // Import snapshots that could establish an explicit value.
    const { data: snapshots } = await supabase
      .from("inventory_import_snapshots")
      .select("id")
      .limit(1);

    return rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      const uuid = String(r["id"] ?? "");
      const created = (r["created_at"] as string | null) ?? null;
      const ampsAudit = (audit ?? []).filter(
        (a) =>
          (a as { record_id: string }).record_id === uuid &&
          String((a as { field_name: string | null }).field_name ?? "")
            .toLowerCase()
            .includes("amp"),
      ).length;
      const breakerLinks = (breakers ?? [])
        .filter((b) => (b as { load_uuid: string | null }).load_uuid === uuid)
        .map((b) => {
          const row = b as Record<string, unknown>;
          const ocp = row["ocp_amps"] ?? row["breaker_amps"];
          return {
            label: (row["label"] as string | null) ?? null,
            ocp_amps: typeof ocp === "number" ? ocp : null,
            poles: typeof row["poles"] === "number" ? (row["poles"] as number) : 1,
          };
        });
      const circuitLinks = (branches ?? [])
        .filter((b) => (b as { load_uuid: string | null }).load_uuid === uuid)
        .map((b) => String((b as { branch_id: string }).branch_id));

      const numOrNull = (k: string) => {
        const v = r[k];
        return typeof v === "number" ? v : v === null || v === undefined ? null : Number(v) || null;
      };
      const strOrNull = (k: string) => {
        const v = r[k];
        return typeof v === "string" && v.trim() ? v : null;
      };

      return {
        load_id: String(r["load_id"] ?? ""),
        uuid: uuid || null,
        amps: numOrNull("amps"),
        volts: numOrNull("volts"),
        connected_va: numOrNull("connected_va"),
        demand_va: numOrNull("demand_va"),
        demand_basis: strOrNull("demand_basis"),
        notes: strOrNull("notes"),
        source_reference: strOrNull("source_reference"),
        source_circuit: strOrNull("source_circuit"),
        circuit_group_ref: strOrNull("circuit_group_ref") ?? strOrNull("group_id"),
        equipment_model: strOrNull("equipment_model") ?? strOrNull("model"),
        ods_extras: strOrNull("ods_extras") ?? strOrNull("extra_fields"),
        created_at: created,
        updated_at: strOrNull("updated_at"),
        creation_batch_size: batchCounts.get(batchKey(created)) ?? (created ? 1 : 0),
        amps_audit_entries: ampsAudit,
        breaker_links: breakerLinks,
        circuit_links: circuitLinks,
        import_snapshot: Boolean(snapshots?.length),
      } satisfies Fs084FarmOpsProvenance;
    });
  });
