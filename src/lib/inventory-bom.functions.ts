// Server functions for inventory part dependencies (bill of materials).
// Thin wrappers only — the math and cycle checks live in @/lib/inventory-bom.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { BomComponentRow, BomRollup } from "@/lib/inventory-bom";

export interface BomView {
  parent: {
    id: string;
    name: string;
    sku: string | null;
    unit: string | null;
    onHand: number;
  };
  components: BomComponentRow[];
  rollup: BomRollup;
  /** Parents that consume this item, so you can see what a shortage blocks. */
  usedIn: Array<{ parentItemId: string; name: string; quantity: number }>;
}

const IdInput = z.object({ parentItemId: z.string().uuid() });

export const getInventoryBom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ context, data }): Promise<BomView> => {
    const { rollupBom } = await import("@/lib/inventory-bom");
    const { supabase, userId } = context;

    const { data: parent, error: pErr } = await supabase
      .from("inventory_items")
      .select("id, name, sku, unit, quantity")
      .eq("user_id", userId)
      .eq("id", data.parentItemId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!parent) throw new Error("Inventory item not found.");

    const { data: rows, error } = await supabase
      .from("inventory_components")
      .select(
        "id, component_item_id, quantity, unit, notes, sort_order, " +
          "component:inventory_items!inventory_components_component_item_id_fkey(name, sku, unit, quantity, unit_cost, primary_container_item_id)",
      )
      .eq("user_id", userId)
      .eq("parent_item_id", data.parentItemId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const components: BomComponentRow[] = (
      (rows ?? []) as unknown as Array<{
        id: string;
        component_item_id: string;
        quantity: number;
        unit: string | null;
        notes: string | null;
        component: {
          name: string | null;
          sku: string | null;
          unit: string | null;
          quantity: number | null;
          unit_cost: number | null;
          primary_container_item_id: string | null;
        } | null;
      }>
    ).map((r) => ({
      id: r.id,
      componentItemId: r.component_item_id,
      name: r.component?.name || r.component?.sku || "(unnamed part)",
      sku: r.component?.sku ?? null,
      unit: r.unit ?? r.component?.unit ?? null,
      quantity: Number(r.quantity ?? 0),
      onHand: Number(r.component?.quantity ?? 0),
      unitCost:
        r.component?.unit_cost == null ? null : Number(r.component.unit_cost),
      notes: r.notes ?? null,
      primaryContainerItemId: r.component?.primary_container_item_id ?? null,
    }));

    const { data: usedRows } = await supabase
      .from("inventory_components")
      .select(
        "parent_item_id, quantity, " +
          "parent:inventory_items!inventory_components_parent_item_id_fkey(name, sku)",
      )
      .eq("user_id", userId)
      .eq("component_item_id", data.parentItemId)
      .limit(50);

    const usedIn = (
      (usedRows ?? []) as unknown as Array<{
        parent_item_id: string;
        quantity: number;
        parent: { name: string | null; sku: string | null } | null;
      }>
    ).map((r) => ({
      parentItemId: r.parent_item_id,
      name: r.parent?.name || r.parent?.sku || "(unnamed item)",
      quantity: Number(r.quantity ?? 0),
    }));

    const p = parent as {
      id: string;
      name: string | null;
      sku: string | null;
      unit: string | null;
      quantity: number | null;
    };
    return {
      parent: {
        id: p.id,
        name: p.name || p.sku || "(unnamed item)",
        sku: p.sku ?? null,
        unit: p.unit ?? null,
        onHand: Number(p.quantity ?? 0),
      },
      components,
      rollup: rollupBom(components),
      usedIn,
    };
  });

/** Items selectable as components: everything the user owns except the parent. */
export const listBomCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("inventory_items")
      .select("id, name, sku, unit, quantity, unit_cost, primary_container_item_id")
      .eq("user_id", context.userId)
      .neq("id", data.parentItemId)
      .order("name", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);

    const typedRows = (rows ?? []) as Array<{
      id: string;
      name: string | null;
      sku: string | null;
      unit: string | null;
      quantity: number | null;
      unit_cost: number | null;
      primary_container_item_id: string | null;
    }>;
    const containerIds = [
      ...new Set(
        typedRows
          .map((row) => row.primary_container_item_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const containerNames = new Map<string, string>();
    if (containerIds.length > 0) {
      const { data: containers, error: containerError } = await context.supabase
        .from("inventory_items")
        .select("id, name, sku")
        .eq("user_id", context.userId)
        .in("id", containerIds);
      if (containerError) throw new Error(containerError.message);
      for (const container of (containers ?? []) as Array<{
        id: string;
        name: string | null;
        sku: string | null;
      }>) {
        containerNames.set(
          container.id,
          container.name || container.sku || "(unnamed bag or kit)",
        );
      }
    }

    return typedRows.map((r) => {
      const assignedElsewhere =
        Boolean(r.primary_container_item_id) &&
        r.primary_container_item_id !== data.parentItemId;
      return {
        id: r.id,
        name: r.name || r.sku || "(unnamed item)",
        sku: r.sku ?? null,
        unit: r.unit ?? null,
        onHand: Number(r.quantity ?? 0),
        unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
        primaryContainerItemId: r.primary_container_item_id,
        assignmentStatus: assignedElsewhere
          ? ("assigned_elsewhere" as const)
          : ("available" as const),
        assignedContainerName: assignedElsewhere
          ? containerNames.get(r.primary_container_item_id!) ?? "another bag or kit"
          : null,
      };
    });
  });

const AddInput = z.object({
  parentItemId: z.string().uuid(),
  componentItemId: z.string().uuid(),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const addBomComponent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddInput.parse(d))
  .handler(async ({ context, data }) => {
    const { createsCycle } = await import("@/lib/inventory-bom");
    const { supabase, userId } = context;
    if (data.parentItemId === data.componentItemId) {
      throw new Error("An item cannot be a part of itself.");
    }

    // Ownership check for both ends before writing.
    const { data: owned, error: ownErr } = await supabase
      .from("inventory_items")
      .select("id")
      .eq("user_id", userId)
      .in("id", [data.parentItemId, data.componentItemId]);
    if (ownErr) throw new Error(ownErr.message);
    if ((owned ?? []).length !== 2)
      throw new Error("Inventory item not found.");

    // Cycle guard: build the existing parent -> components graph.
    const { data: allEdges } = await supabase
      .from("inventory_components")
      .select("parent_item_id, component_item_id")
      .eq("user_id", userId);
    const edges = new Map<string, string[]>();
    for (const e of (allEdges ?? []) as Array<{
      parent_item_id: string;
      component_item_id: string;
    }>) {
      const list = edges.get(e.parent_item_id) ?? [];
      list.push(e.component_item_id);
      edges.set(e.parent_item_id, list);
    }
    if (createsCycle(edges, data.parentItemId, data.componentItemId)) {
      throw new Error(
        "That would create a circular part dependency — this item is already used (directly or indirectly) inside the part you picked.",
      );
    }

    const { error } = await supabase.from("inventory_components").insert({
      user_id: userId,
      parent_item_id: data.parentItemId,
      component_item_id: data.componentItemId,
      quantity: data.quantity,
      unit: data.unit ?? null,
      notes: data.notes ?? null,
    });
    if (error) {
      if (/unique/i.test(error.message)) {
        throw new Error(
          "That part is already listed — edit its quantity instead.",
        );
      }
      throw new Error(error.message);
    }

    // The BOM edge is a logical membership and may exist in several kits. The
    // first physical-container assignment becomes the part's primary/home
    // assignment; later memberships never overwrite it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: parent } = await db
      .from("inventory_items")
      .select("container_kind")
      .eq("user_id", userId)
      .eq("id", data.parentItemId)
      .maybeSingle();
    if (
      parent &&
      (parent.container_kind === "kit" || parent.container_kind === "bag")
    ) {
      const { error: assignmentError } = await db
        .from("inventory_items")
        .update({
          primary_container_item_id: data.parentItemId,
          current_container_item_id: data.parentItemId,
        })
        .eq("user_id", userId)
        .eq("id", data.componentItemId)
        .is("primary_container_item_id", null);
      if (assignmentError) {
        await db
          .from("inventory_components")
          .delete()
          .eq("user_id", userId)
          .eq("parent_item_id", data.parentItemId)
          .eq("component_item_id", data.componentItemId);
        throw new Error(assignmentError.message);
      }
    }
    return { ok: true as const };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  quantity: z.number().positive().max(1_000_000).optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const updateBomComponent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateInput.parse(d))
  .handler(async ({ context, data }) => {
    const patch: {
      quantity?: number;
      unit?: string | null;
      notes?: string | null;
    } = {};
    if (data.quantity !== undefined) patch.quantity = data.quantity;
    if (data.unit !== undefined) patch.unit = data.unit;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (Object.keys(patch).length === 0) return { ok: true as const };

    const { error } = await context.supabase
      .from("inventory_components")
      .update(patch)
      .eq("user_id", context.userId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const PrimaryContainerInput = z.object({
  parentItemId: z.string().uuid(),
  componentItemId: z.string().uuid(),
});

/** Choose which one of a part's logical memberships is its physical home. */
export const setPrimaryBomContainer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PrimaryContainerInput.parse(d))
  .handler(async ({ context, data }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: membership, error: membershipError } = await db
      .from("inventory_components")
      .select("id")
      .eq("user_id", context.userId)
      .eq("parent_item_id", data.parentItemId)
      .eq("component_item_id", data.componentItemId)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership)
      throw new Error("That item is not assigned to this kit or bag.");

    const { data: parent, error: parentError } = await db
      .from("inventory_items")
      .select("container_kind")
      .eq("user_id", context.userId)
      .eq("id", data.parentItemId)
      .maybeSingle();
    if (parentError) throw new Error(parentError.message);
    if (!parent || !["kit", "bag"].includes(parent.container_kind)) {
      throw new Error("Only a kit or bag can be a primary physical home.");
    }

    const { data: movement } = await db
      .from("inventory_container_movements")
      .select("id")
      .eq("user_id", context.userId)
      .eq("item_id", data.componentItemId)
      .is("restored_at", null)
      .limit(1)
      .maybeSingle();
    if (movement)
      throw new Error("Check this item in before changing its primary home.");

    const { error } = await db
      .from("inventory_items")
      .update({
        primary_container_item_id: data.parentItemId,
        current_container_item_id: data.parentItemId,
      })
      .eq("user_id", context.userId)
      .eq("id", data.componentItemId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removeBomComponent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: membership, error: readError } = await db
      .from("inventory_components")
      .select("parent_item_id, component_item_id")
      .eq("user_id", context.userId)
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!membership) throw new Error("Part assignment not found.");

    const { error } = await db
      .from("inventory_components")
      .delete()
      .eq("user_id", context.userId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const { data: movement } = await db
      .from("inventory_container_movements")
      .select("id")
      .eq("user_id", context.userId)
      .eq("item_id", membership.component_item_id)
      .is("restored_at", null)
      .limit(1)
      .maybeSingle();
    if (!movement) {
      const { error: clearError } = await db
        .from("inventory_items")
        .update({
          primary_container_item_id: null,
          current_container_item_id: null,
        })
        .eq("user_id", context.userId)
        .eq("id", membership.component_item_id)
        .eq("primary_container_item_id", membership.parent_item_id);
      if (clearError) throw new Error(clearError.message);
    }
    return { ok: true as const };
  });
