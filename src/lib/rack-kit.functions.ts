// Rack build kits. An equipment rack is usually populated with gear that is
// screwed down and stays there, so the rack's contents are described by a kit
// parts list (bill of materials) on an inventory kit item — e.g.
// RACK-FS-NET-01 → 1 × UniFi switch, 1 × patch panel, 2 × rack shelf.
//
// The kit is an ordinary inventory kit record (item_type 32_kits) linked to the
// rack through the existing rack asset link, so nothing about the rack's stable
// ID or topology changes.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";

const KIT_ITEM_TYPE = "32_kits";

const RackInput = z.object({ rackId: z.string().uuid() });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDb = { from: (table: string) => any };

export interface RackKitView {
  rackStableId: string;
  rackDescription: string | null;
  /** The linked kit item, when the rack's asset link points at a kit. */
  kit: { id: string; name: string; componentCount: number } | null;
  /** A linked asset that is not a kit — never silently replaced. */
  linkedNonKitAsset: { id: string; name: string } | null;
}

async function readRackKit(db: LooseDb, userId: string, rackId: string): Promise<RackKitView> {
  const { data: rack, error } = await db
    .from("electrical_racks")
    .select("id, rack_id, description, asset_uuid")
    .eq("id", rackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rack) throw new Error("Equipment rack not found.");

  const view: RackKitView = {
    rackStableId: String(rack.rack_id ?? ""),
    rackDescription: rack.description ?? null,
    kit: null,
    linkedNonKitAsset: null,
  };
  if (!rack.asset_uuid) return view;

  const { data: asset, error: aErr } = await db
    .from("inventory_items")
    .select("id, name, item_type")
    .eq("user_id", userId)
    .eq("id", rack.asset_uuid)
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!asset) return view;

  if (String(asset.item_type ?? "") !== KIT_ITEM_TYPE) {
    view.linkedNonKitAsset = { id: asset.id, name: String(asset.name ?? "") };
    return view;
  }

  const { count } = await db
    .from("inventory_components")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("parent_item_id", asset.id);

  view.kit = { id: asset.id, name: String(asset.name ?? ""), componentCount: count ?? 0 };
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
    if (existing.linkedNonKitAsset) {
      throw new Error(
        `This rack is already linked to the asset "${existing.linkedNonKitAsset.name}". Clear that link on the rack first, then create the kit.`,
      );
    }

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
      .update({ asset_uuid: kit.id, asset_ref: kit.name })
      .eq("id", data.rackId);
    if (linkErr) throw new Error(linkErr.message);

    await recordElectricalChange(context.supabase, context.userId, {
      section: "entities",
      entityKind: "rack",
      action: "update",
      entityUuid: data.rackId,
      entityRef: existing.rackStableId || null,
      summary: `Created rack build kit "${kit.name}" for rack ${existing.rackStableId}`,
      patch: { asset_uuid: kit.id, asset_ref: kit.name },
    });

    return {
      ...existing,
      kit: { id: kit.id, name: String(kit.name ?? name), componentCount: 0 },
    };
  });
