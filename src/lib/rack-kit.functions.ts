// Rack build kits. An equipment rack is usually populated with gear that is
// screwed down and stays there, so the rack's contents are described by a kit
// parts list (bill of materials) on an inventory kit item — e.g.
// RACK-FS-HAM-01 → 1 × Kenwood TS-480 SAT, 1 × rack shelf, 1 × power strip.
//
// The kit is an ordinary inventory kit record (item_type 32_kits) linked to the
// rack through electrical_racks.build_kit_item_id. That link is deliberately
// separate from asset_uuid, so recording the rack's contents never disturbs the
// asset already recorded on the rack, its stable ID, or its topology.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";

const KIT_ITEM_TYPE = "32_kits";

const RackInput = z.object({ rackId: z.string().uuid() });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDb = { from: (table: string) => any };

export interface RackKitPart {
  id: string;
  componentItemId: string;
  name: string;
  itemType: string | null;
  quantity: number;
  unit: string | null;
  location: string | null;
  notes: string | null;
}

export interface RackKitView {
  rackStableId: string;
  rackDescription: string | null;
  /** The kit whose parts list describes what is installed in this rack. */
  kit: { id: string; name: string } | null;
  /** Parts recorded on that kit, in the kit's own order. */
  parts: RackKitPart[];
  /** The rack's own asset link, shown for context — never changed here. */
  linkedAsset: { id: string; name: string } | null;
}

async function readRackKit(db: LooseDb, userId: string, rackId: string): Promise<RackKitView> {
  const { data: rack, error } = await db
    .from("electrical_racks")
    .select("id, rack_id, description, asset_uuid, asset_ref, build_kit_item_id")
    .eq("id", rackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rack) throw new Error("Equipment rack not found.");

  const view: RackKitView = {
    rackStableId: String(rack.rack_id ?? ""),
    rackDescription: rack.description ?? null,
    kit: null,
    parts: [],
    linkedAsset: rack.asset_uuid
      ? { id: String(rack.asset_uuid), name: String(rack.asset_ref ?? "") }
      : null,
  };
  if (!rack.build_kit_item_id) return view;

  const { data: kit, error: kErr } = await db
    .from("inventory_items")
    .select("id, name")
    .eq("user_id", userId)
    .eq("id", rack.build_kit_item_id)
    .maybeSingle();
  if (kErr) throw new Error(kErr.message);
  if (!kit) return view;
  view.kit = { id: String(kit.id), name: String(kit.name ?? "") };

  const { data: rows, error: cErr } = await db
    .from("inventory_components")
    .select("id, component_item_id, quantity, unit, notes, sort_order")
    .eq("user_id", userId)
    .eq("parent_item_id", kit.id)
    .order("sort_order", { ascending: true });
  if (cErr) throw new Error(cErr.message);

  const componentIds = (rows ?? []).map((r: { component_item_id: string }) => r.component_item_id);
  const byId = new Map<string, { name: string; item_type: string | null; location: string | null; unit: string | null }>();
  if (componentIds.length > 0) {
    const { data: items, error: iErr } = await db
      .from("inventory_items")
      .select("id, name, item_type, location, unit")
      .eq("user_id", userId)
      .in("id", componentIds);
    if (iErr) throw new Error(iErr.message);
    for (const it of items ?? []) {
      byId.set(String(it.id), {
        name: String(it.name ?? ""),
        item_type: it.item_type ?? null,
        location: it.location ?? null,
        unit: it.unit ?? null,
      });
    }
  }

  view.parts = (rows ?? []).map(
    (r: {
      id: string;
      component_item_id: string;
      quantity: number | string;
      unit: string | null;
      notes: string | null;
    }) => {
      const item = byId.get(String(r.component_item_id));
      return {
        id: String(r.id),
        componentItemId: String(r.component_item_id),
        name: item?.name ?? "(missing inventory item)",
        itemType: item?.item_type ?? null,
        quantity: Number(r.quantity),
        unit: r.unit ?? item?.unit ?? null,
        location: item?.location ?? null,
        notes: r.notes ?? null,
      };
    },
  );

  return view;
}

export const getRackKit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RackInput.parse(d))
  .handler(async ({ context, data }): Promise<RackKitView> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    return readRackKit(context.supabase as unknown as LooseDb, context.userId, data.rackId);
  });

export const createRackKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RackInput.parse(d))
  .handler(async ({ context, data }): Promise<RackKitView> => {
    await requireElectricalAccess(context.supabase, context.userId, "field_write");
    const db = context.supabase as unknown as LooseDb;
    const existing = await readRackKit(db, context.userId, data.rackId);
    // Already built out — never create a second kit for the same rack.
    if (existing.kit) return existing;

    const name = existing.rackStableId
      ? `${existing.rackStableId} rack build kit`
      : "Rack build kit";
    const { data: kit, error } = await db
      .from("inventory_items")
      .insert({
        user_id: context.userId,
        name,
        item_type: KIT_ITEM_TYPE,
        category: "Equipment rack",
        quantity: 1,
        unit: "kit",
        status: "available",
        description: existing.rackDescription,
        notes: existing.rackStableId
          ? `Components installed in equipment rack ${existing.rackStableId}.`
          : null,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);

    const { error: linkErr } = await db
      .from("electrical_racks")
      .update({ build_kit_item_id: kit.id })
      .eq("id", data.rackId);
    if (linkErr) throw new Error(linkErr.message);

    await recordElectricalChange(context.supabase, context.userId, {
      section: "entities",
      entityKind: "rack",
      action: "update",
      entityUuid: data.rackId,
      entityRef: existing.rackStableId || null,
      summary: `Created rack build kit "${kit.name}" for rack ${existing.rackStableId}`,
      patch: { build_kit_item_id: kit.id },
    });

    return { ...existing, kit: { id: String(kit.id), name: String(kit.name ?? name) }, parts: [] };
  });
