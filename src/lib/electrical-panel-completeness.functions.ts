// Held / conflicting audit items for a panel. Read-only: holds are reported
// beside a panel's progress, never folded into a percentage.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  satisfyingCircuitGroup,
  type PermanentCircuitGroup,
} from "@/lib/electrical-hold-reconciliation";

type LooseDb = { from: (table: string) => any };

export interface PanelHoldRow {
  batch_id: string;
  panel_ref: string | null;
  ref: string;
  reason: string;
  kind: "hold" | "conflict";
  /** Explicitly observed location on the held item, when the audit supplied one. */
  location: string | null;
}

/** Every hold/conflict recorded on this owner's audit batches. */
export const loadAuditHolds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PanelHoldRow[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;
    const batches = await db
      .from("electrical_audit_batches")
      .select("id,batch_id")
      .eq("created_by", context.userId);
    if (batches.error) throw new Error(batches.error.message);
    const byUuid = new Map<string, string>(
      ((batches.data ?? []) as { id: string; batch_id: string }[]).map((b) => [
        b.id,
        b.batch_id,
      ]),
    );
    if (!byUuid.size) return [];
    const items = await db
      .from("electrical_audit_batch_items")
      .select("batch_uuid,item_key,entity_kind,target_stable_id,disposition,payload")
      .in("batch_uuid", [...byUuid.keys()])
      .in("disposition", ["hold", "conflict"]);
    if (items.error) throw new Error(items.error.message);

    // Permanent circuit groups already carry stable identities. A membership
    // hold whose identity now exists is satisfied and no longer active.
    const groupRows = await db
      .from("electrical_circuit_groups")
      .select("circuit_group_id,breaker_number,description,electrical_panels(panel_id)");
    if (groupRows.error) throw new Error(groupRows.error.message);
    const groups: PermanentCircuitGroup[] = ((groupRows.data ?? []) as Record<string, any>[]).map(
      (g) => ({
        circuit_group_id: String(g["circuit_group_id"] ?? ""),
        panel_id: (g["electrical_panels"]?.["panel_id"] as string | null) ?? null,
        breaker_number:
          g["breaker_number"] == null ? null : Number(g["breaker_number"]),
        description: (g["description"] as string | null) ?? null,
      }),
    );

    return ((items.data ?? []) as Record<string, any>[])
      .filter((r) => {
        const payload = (r["payload"] ?? {}) as Record<string, any>;
        const breaker = payload["fields"]?.["breaker_number"];
        return !satisfyingCircuitGroup(
          {
            item_key: String(r["item_key"] ?? ""),
            entity_kind: String(r["entity_kind"] ?? ""),
            panel_ref: (payload["refs"]?.["panel_ref"] as string | null) ?? null,
            breaker_number: breaker == null ? null : Number(breaker),
            observed_label: (payload["observed_label"] as string | null) ?? null,
          },
          groups,
        );
      })
      .map((r) => {
      const payload = (r["payload"] ?? {}) as Record<string, any>;
      const pole = payload["pole"] as Record<string, any> | null;
      const grid = payload["field_grid_reference"] as string | null;
      const location = [grid, pole?.["pole_ref_start"]].filter(Boolean).join(" / ") || null;
      return {
        batch_id: byUuid.get(String(r["batch_uuid"])) ?? "",
        panel_ref: (payload["refs"]?.["panel_ref"] as string | null) ?? null,
        ref: String(r["target_stable_id"] ?? r["item_key"] ?? ""),
        reason: String(payload["reason"] ?? payload["notes"] ?? "Held pending resolution."),
        kind: r["disposition"] === "conflict" ? "conflict" : "hold",
        location,
      };
    });
  });
