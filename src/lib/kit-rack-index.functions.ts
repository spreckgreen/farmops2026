// Every kit and rack build-out in one list.
//
// A kit is an inventory record typed as a kit (e.g. "Ham Radio Field Deployment
// Kit"); a rack build-out is a kit that an equipment rack points at through
// electrical_racks.build_kit_item_id (e.g. RACK-FS-HAM-01). Nothing is invented
// here — parts, heights and positions are read exactly as recorded.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDb = { from: (table: string) => any };

export interface KitRackPart {
  id: string;
  componentItemId: string;
  name: string;
  quantity: number;
  unit: string | null;
  /** Height in rack spaces, from the placement or the item itself. */
  rackUnits: number | null;
  /** Lowest rack space occupied, counted from the bottom. */
  positionU: number | null;
}

export interface KitRackBuildout {
  kitId: string;
  kitName: string;
  sku: string | null;
  location: string | null;
  onHand: number;
  parts: KitRackPart[];
  /** Set when an equipment rack is built out by this kit. */
  rack: { id: string; stableId: string; description: string | null; sizeU: number | null } | null;
}

/** All kits, with rack build-outs first. */
export const listKitRackBuildouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KitRackBuildout[]> => {
    const { KIT_ITEM_TYPES } = await import("@/lib/asset-types");
    const db = context.supabase as unknown as LooseDb;
    const userId = context.userId;

    const { data: kits, error } = await db
      .from("inventory_items")
      .select("id, name, sku, location, quantity")
      .eq("user_id", userId)
      .in("item_type", KIT_ITEM_TYPES)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const kitIds = (kits ?? []).map((k: { id: string }) => String(k.id));
    if (kitIds.length === 0) return [];

    const { data: rows, error: cErr } = await db
      .from("inventory_components")
      .select(
        "id, parent_item_id, component_item_id, quantity, unit, sort_order, rack_units, rack_position_u",
      )
      .eq("user_id", userId)
      .in("parent_item_id", kitIds)
      .order("sort_order", { ascending: true });
    if (cErr) throw new Error(cErr.message);

    const componentIds = [
      ...new Set((rows ?? []).map((r: { component_item_id: string }) => String(r.component_item_id))),
    ];
    const items = new Map<string, { name: string; unit: string | null; rackUnits: number | null }>();
    if (componentIds.length > 0) {
      const { data: comps, error: iErr } = await db
        .from("inventory_items")
        .select("id, name, sku, unit, rack_units")
        .eq("user_id", userId)
        .in("id", componentIds);
      if (iErr) throw new Error(iErr.message);
      for (const it of comps ?? []) {
        items.set(String(it.id), {
          name: String(it.name ?? it.sku ?? "(unnamed part)"),
          unit: it.unit ?? null,
          rackUnits: it.rack_units == null ? null : Number(it.rack_units),
        });
      }
    }

    // Racks are gated behind the electrical module; without access the kits are
    // still listed, just without their rack.
    const racks = new Map<string, KitRackBuildout["rack"]>();
    try {
      const { data: rackRows } = await db
        .from("electrical_racks")
        .select("id, rack_id, description, rack_size_u, build_kit_item_id")
        .in("build_kit_item_id", kitIds);
      for (const r of rackRows ?? []) {
        racks.set(String(r.build_kit_item_id), {
          id: String(r.id),
          stableId: String(r.rack_id ?? ""),
          description: r.description ?? null,
          sizeU: r.rack_size_u == null ? null : Number(r.rack_size_u),
        });
      }
    } catch {
      // no electrical access — leave racks empty
    }

    const out: KitRackBuildout[] = (kits ?? []).map(
      (k: {
        id: string;
        name: string | null;
        sku: string | null;
        location: string | null;
        quantity: number | null;
      }) => {
        const kitId = String(k.id);
        const parts: KitRackPart[] = (rows ?? [])
          .filter((r: { parent_item_id: string }) => String(r.parent_item_id) === kitId)
          .map(
            (r: {
              id: string;
              component_item_id: string;
              quantity: number | string;
              unit: string | null;
              rack_units: number | null;
              rack_position_u: number | null;
            }) => {
              const item = items.get(String(r.component_item_id));
              return {
                id: String(r.id),
                componentItemId: String(r.component_item_id),
                name: item?.name ?? "(missing inventory item)",
                quantity: Number(r.quantity ?? 0),
                unit: r.unit ?? item?.unit ?? null,
                rackUnits: r.rack_units == null ? (item?.rackUnits ?? null) : Number(r.rack_units),
                positionU: r.rack_position_u == null ? null : Number(r.rack_position_u),
              };
            },
          );
        return {
          kitId,
          kitName: String(k.name ?? k.sku ?? "(unnamed kit)"),
          sku: k.sku ?? null,
          location: k.location ?? null,
          onHand: Number(k.quantity ?? 0),
          parts,
          rack: racks.get(kitId) ?? null,
        };
      },
    );

    // Rack build-outs first, then the rest, each alphabetical.
    return out.sort((a, b) => {
      if (Boolean(a.rack) !== Boolean(b.rack)) return a.rack ? -1 : 1;
      return a.kitName.localeCompare(b.kitName);
    });
  });
