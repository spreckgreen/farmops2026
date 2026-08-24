// Server functions for kit check-out / check-in.
// Thin wrappers only — math lives in @/lib/kit-deploy.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Deployment } from "@/lib/kit-deploy";

const KitInput = z.object({ kitItemId: z.string().uuid() });

const CheckoutInput = z.object({
  kitItemId: z.string().uuid(),
  units: z.number().positive().max(10_000),
  label: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Allow the check-out even when stock is short (stock can go negative). */
  allowShort: z.boolean().optional(),
});

const CheckinInput = z.object({
  deploymentId: z.string().uuid(),
  /** Omit to return everything still outstanding. */
  lines: z
    .array(z.object({ lineId: z.string().uuid(), quantity: z.number().min(0).max(1_000_000) }))
    .optional(),
  notes: z.string().trim().max(2000).optional(),
});

interface DeploymentRow {
  id: string;
  kit_item_id: string;
  label: string | null;
  units: number | null;
  status: string;
  checked_out_at: string;
  returned_at: string | null;
  notes: string | null;
  kit: { name: string | null; sku: string | null } | null;
  lines: Array<{
    id: string;
    component_item_id: string | null;
    component_name: string | null;
    unit: string | null;
    quantity_out: number | null;
    quantity_returned: number | null;
  }> | null;
}

const SELECT =
  "id, kit_item_id, label, units, status, checked_out_at, returned_at, notes, " +
  "kit:inventory_items!kit_deployments_kit_item_id_fkey(name, sku), " +
  "lines:kit_deployment_lines(id, component_item_id, component_name, unit, quantity_out, quantity_returned)";

function toDeployment(r: DeploymentRow): Deployment {
  return {
    id: r.id,
    kitItemId: r.kit_item_id,
    kitName: r.kit?.name || r.kit?.sku || "(unnamed kit)",
    label: r.label ?? "",
    units: Number(r.units ?? 1),
    status: r.status === "returned" ? "returned" : "open",
    checkedOutAt: r.checked_out_at,
    returnedAt: r.returned_at,
    notes: r.notes,
    lines: (r.lines ?? [])
      .map((l) => ({
        id: l.id,
        componentItemId: l.component_item_id,
        name: l.component_name || "(part)",
        unit: l.unit,
        quantityOut: Number(l.quantity_out ?? 0),
        quantityReturned: Number(l.quantity_returned ?? 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Deployment history for one kit, newest first. */
export const listKitDeployments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => KitInput.parse(d))
  .handler(async ({ context, data }): Promise<Deployment[]> => {
    const { data: rows, error } = await context.supabase
      .from("kit_deployments")
      .select(SELECT)
      .eq("user_id", context.userId)
      .eq("kit_item_id", data.kitItemId)
      .order("checked_out_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown as DeploymentRow[]).map(toDeployment);
  });

/** Every kit that still has parts in the field, newest first. */
export const listOpenKitDeployments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Deployment[]> => {
    const { data: rows, error } = await context.supabase
      .from("kit_deployments")
      .select(SELECT)
      .eq("user_id", context.userId)
      .eq("status", "open")
      .order("checked_out_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown as DeploymentRow[]).map(toDeployment);
  });

/** Pull a kit's parts out of stock and record the deployment. */
export const checkOutKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CheckoutInput.parse(d))
  .handler(async ({ context, data }) => {
    const { planKitCheckout } = await import("@/lib/kit-deploy");
    const { supabase, userId } = context;

    const { data: kit, error: kErr } = await supabase
      .from("inventory_items")
      .select("id, name")
      .eq("user_id", userId)
      .eq("id", data.kitItemId)
      .maybeSingle();
    if (kErr) throw new Error(kErr.message);
    if (!kit) throw new Error("Kit not found.");

    const { data: rows, error: cErr } = await supabase
      .from("inventory_components")
      .select(
        "component_item_id, quantity, unit, " +
          "component:inventory_items!inventory_components_component_item_id_fkey(name, sku, unit, quantity)",
      )
      .eq("user_id", userId)
      .eq("parent_item_id", data.kitItemId);
    if (cErr) throw new Error(cErr.message);

    const components = (
      (rows ?? []) as unknown as Array<{
        component_item_id: string;
        quantity: number;
        unit: string | null;
        component: { name: string | null; sku: string | null; unit: string | null; quantity: number | null } | null;
      }>
    ).map((r) => ({
      id: r.component_item_id,
      componentItemId: r.component_item_id,
      name: r.component?.name || r.component?.sku || "(unnamed part)",
      sku: r.component?.sku ?? null,
      unit: r.unit ?? r.component?.unit ?? null,
      quantity: Number(r.quantity ?? 0),
      onHand: Number(r.component?.quantity ?? 0),
      unitCost: null,
      notes: null,
    }));

    if (components.length === 0) {
      throw new Error(
        "This kit has no parts listed yet — add its contents under Parts before checking it out.",
      );
    }

    const plan = planKitCheckout(components, data.units);
    const short = plan.filter((p) => p.short > 0);
    if (short.length > 0 && !data.allowShort) {
      throw new Error(
        `Not enough stock for: ${short
          .map((s) => `${s.name} (need ${s.quantityOut}, have ${s.onHand})`)
          .join("; ")}`,
      );
    }

    const { data: created, error: dErr } = await supabase
      .from("kit_deployments")
      .insert({
        user_id: userId,
        kit_item_id: data.kitItemId,
        label: data.label ?? "",
        units: data.units,
        status: "open",
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (dErr) throw new Error(dErr.message);
    const deploymentId = (created as { id: string }).id;

    const { error: lErr } = await supabase.from("kit_deployment_lines").insert(
      plan.map((p) => ({
        user_id: userId,
        deployment_id: deploymentId,
        component_item_id: p.componentItemId,
        component_name: p.name,
        unit: p.unit,
        quantity_out: p.quantityOut,
        quantity_returned: 0,
      })),
    );
    if (lErr) {
      await supabase.from("kit_deployments").delete().eq("id", deploymentId).eq("user_id", userId);
      throw new Error(lErr.message);
    }

    // Decrement stock for each component.
    for (const p of plan) {
      const current = components.find((c) => c.componentItemId === p.componentItemId)?.onHand ?? 0;
      const next = Number((current - p.quantityOut).toFixed(4));
      const { error } = await supabase
        .from("inventory_items")
        .update({ quantity: next })
        .eq("user_id", userId)
        .eq("id", p.componentItemId);
      if (error) throw new Error(error.message);
    }

    return { ok: true as const, deploymentId, lines: plan.length, short: short.length };
  });

/** Put returned parts back on the shelf. Partial returns are supported. */
export const checkInKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CheckinInput.parse(d))
  .handler(async ({ context, data }) => {
    const { clampReturn, isFullyReturned } = await import("@/lib/kit-deploy");
    const { supabase, userId } = context;

    const { data: row, error } = await supabase
      .from("kit_deployments")
      .select(SELECT)
      .eq("user_id", userId)
      .eq("id", data.deploymentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Deployment not found.");

    const { toDeploymentLines } = { toDeploymentLines: null } as { toDeploymentLines: null };
    void toDeploymentLines;
    const deployment = toDeployment(row as unknown as DeploymentRow);
    if (deployment.status === "returned") {
      throw new Error("This deployment is already checked in.");
    }

    const requested = new Map(data.lines?.map((l) => [l.lineId, l.quantity]) ?? []);
    let restored = 0;

    for (const line of deployment.lines) {
      const want = data.lines ? (requested.get(line.id) ?? 0) : line.quantityOut - line.quantityReturned;
      const qty = clampReturn(line, want);
      if (qty <= 0) continue;

      const { error: uErr } = await supabase
        .from("kit_deployment_lines")
        .update({ quantity_returned: Number((line.quantityReturned + qty).toFixed(4)) })
        .eq("user_id", userId)
        .eq("id", line.id);
      if (uErr) throw new Error(uErr.message);
      line.quantityReturned = Number((line.quantityReturned + qty).toFixed(4));

      if (line.componentItemId) {
        const { data: item } = await supabase
          .from("inventory_items")
          .select("quantity")
          .eq("user_id", userId)
          .eq("id", line.componentItemId)
          .maybeSingle();
        const current = Number((item as { quantity: number | null } | null)?.quantity ?? 0);
        const { error: sErr } = await supabase
          .from("inventory_items")
          .update({ quantity: Number((current + qty).toFixed(4)) })
          .eq("user_id", userId)
          .eq("id", line.componentItemId);
        if (sErr) throw new Error(sErr.message);
      }
      restored += 1;
    }

    const complete = isFullyReturned(deployment.lines);
    const { error: fErr } = await supabase
      .from("kit_deployments")
      .update({
        status: complete ? "returned" : "open",
        returned_at: complete ? new Date().toISOString() : null,
        ...(data.notes ? { notes: data.notes } : {}),
      })
      .eq("user_id", userId)
      .eq("id", deployment.id);
    if (fErr) throw new Error(fErr.message);

    return { ok: true as const, restoredLines: restored, complete };
  });
