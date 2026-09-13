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
  /** Height in rack spaces for this placement (falls back to the item's own height). */
  rackUnits: number | null;
  /** Height recorded on the inventory item itself, when any. */
  itemRackUnits: number | null;
  /** Lowest rack space occupied, counted from the bottom. NULL when not placed. */
  positionU: number | null;
  /** Horizontal portion of the rack face occupied by this device. */
  rackLane: "full" | "left" | "right";
  /** Item description, used when drawing the front-panel picture. */
  description: string | null;
  /** Short-lived link to the stored front-panel picture, when one exists. */
  faceImageUrl: string | null;
  /** When the front-panel picture was drawn. */
  faceGeneratedAt: string | null;
}

export interface RackKitView {
  rackStableId: string;
  rackDescription: string | null;
  /** Rack height in spaces, as recorded on the rack. */
  rackSizeU: number | null;
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
    .select("id, rack_id, description, rack_size_u, asset_uuid, asset_ref, build_kit_item_id")
    .eq("id", rackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rack) throw new Error("Equipment rack not found.");

  const view: RackKitView = {
    rackStableId: String(rack.rack_id ?? ""),
    rackDescription: rack.description ?? null,
    rackSizeU: rack.rack_size_u == null ? null : Number(rack.rack_size_u),
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
    .select("id, component_item_id, quantity, unit, notes, sort_order, rack_units, rack_position_u, rack_lane")
    .eq("user_id", userId)
    .eq("parent_item_id", kit.id)
    .order("sort_order", { ascending: true });
  if (cErr) throw new Error(cErr.message);

  const componentIds = (rows ?? []).map((r: { component_item_id: string }) => r.component_item_id);
  const byId = new Map<
    string,
    {
      name: string;
      item_type: string | null;
      location: string | null;
      unit: string | null;
      rack_units: number | null;
      description: string | null;
      rack_face_image_url: string | null;
      rack_face_generated_at: string | null;
    }
  >();
  if (componentIds.length > 0) {
    const { data: items, error: iErr } = await db
      .from("inventory_items")
      .select(
        "id, name, item_type, location, unit, rack_units, description, rack_face_image_url, rack_face_generated_at",
      )
      .eq("user_id", userId)
      .in("id", componentIds);
    if (iErr) throw new Error(iErr.message);
    for (const it of items ?? []) {
      byId.set(String(it.id), {
        name: String(it.name ?? ""),
        item_type: it.item_type ?? null,
        location: it.location ?? null,
        unit: it.unit ?? null,
        rack_units: it.rack_units == null ? null : Number(it.rack_units),
        description: it.description ?? null,
        rack_face_image_url: it.rack_face_image_url ?? null,
        rack_face_generated_at: it.rack_face_generated_at ?? null,
      });
    }
  }

  // Stored pictures are private; hand out short-lived links instead.
  const facePaths = [...byId.values()]
    .map((v) => v.rack_face_image_url)
    .filter((p): p is string => !!p);
  let signed = new Map<string, string>();
  if (facePaths.length > 0) {
    const { signFacePaths } = await import("@/lib/rack-face.server");
    signed = await signFacePaths(facePaths);
  }

  view.parts = (rows ?? []).map(
    (r: {
      id: string;
      component_item_id: string;
      quantity: number | string;
      unit: string | null;
      notes: string | null;
      rack_units: number | null;
      rack_position_u: number | null;
      rack_lane: "full" | "left" | "right" | null;
    }) => {
      const item = byId.get(String(r.component_item_id));
      const itemRackUnits = item?.rack_units ?? null;
      const facePath = item?.rack_face_image_url ?? null;
      return {
        id: String(r.id),
        componentItemId: String(r.component_item_id),
        name: item?.name ?? "(missing inventory item)",
        itemType: item?.item_type ?? null,
        quantity: Number(r.quantity),
        unit: r.unit ?? item?.unit ?? null,
        location: item?.location ?? null,
        notes: r.notes ?? null,
        rackUnits: r.rack_units == null ? itemRackUnits : Number(r.rack_units),
        itemRackUnits,
        positionU: r.rack_position_u == null ? null : Number(r.rack_position_u),
        rackLane: r.rack_lane ?? "full",
        description: item?.description ?? null,
        faceImageUrl: facePath ? (signed.get(facePath) ?? null) : null,
        faceGeneratedAt: item?.rack_face_generated_at ?? null,
      };
    },
  );

  return view;
}


const PlacementInput = z.object({
  rackId: z.string().uuid(),
  componentRowId: z.string().uuid(),
  /** Height in rack spaces; null clears it and leaves the item's own height. */
  rackUnits: z.number().int().positive().max(100).nullable(),
  /** Lowest space occupied; null unplaces the part. */
  positionU: z.number().int().positive().max(100).nullable(),
  /** Horizontal portion of the rack face used by this placement. */
  rackLane: z.enum(["full", "left", "right"]).default("full"),
  /** Also store the height on the inventory item, so it is remembered elsewhere. */
  applyToItem: z.boolean().optional(),
});


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

/**
 * Record a part's shelf size and where it sits in the rack. Positions are
 * checked against the other placed parts and the rack's own height, so gear
 * cannot double-book a space or hang out of the top of the rack.
 */
export const setRackPartPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlacementInput.parse(d))
  .handler(async ({ context, data }): Promise<RackKitView> => {
    await requireElectricalAccess(context.supabase, context.userId, "field_write");
    const db = context.supabase as unknown as LooseDb;
    const before = await readRackKit(db, context.userId, data.rackId);
    const row = before.parts.find((p) => p.id === data.componentRowId);
    if (!row) throw new Error("That part is not on this rack's build kit.");

    const height = data.rackUnits ?? row.itemRackUnits;
    if (data.positionU != null) {
      if (height == null) {
        throw new Error(
          "Record how many rack spaces this part takes before giving it a position.",
        );
      }
      const top = data.positionU + height - 1;
      if (before.rackSizeU != null && top > before.rackSizeU) {
        throw new Error(
          `${height} spaces starting at U${data.positionU} runs past the top of this ${before.rackSizeU}-space rack.`,
        );
      }
      for (const other of before.parts) {
        if (other.id === row.id) continue;
        if (other.positionU == null || other.rackUnits == null) continue;
        const otherTop = other.positionU + other.rackUnits - 1;
        const verticalOverlap =
          data.positionU <= otherTop && other.positionU <= top;
        const otherLane = other.rackLane ?? "full";
        const horizontalOverlap =
          data.rackLane === "full" ||
          otherLane === "full" ||
          data.rackLane === otherLane;
        if (verticalOverlap && horizontalOverlap) {
          throw new Error(
            `U${data.positionU}${top === data.positionU ? "" : `–U${top}`} ${data.rackLane === "full" ? "full width" : `${data.rackLane} half`} is already taken by ${other.name}.`,
          );
        }
      }
    }

    const { error } = await db
      .from("inventory_components")
      .update({
        rack_units: data.rackUnits,
        rack_position_u: data.positionU,
        rack_lane: data.rackLane,
      })
      .eq("id", data.componentRowId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    if (data.applyToItem && data.rackUnits != null) {
      const { error: iErr } = await db
        .from("inventory_items")
        .update({ rack_units: data.rackUnits })
        .eq("id", row.componentItemId)
        .eq("user_id", context.userId);
      if (iErr) throw new Error(iErr.message);
    }

    await recordElectricalChange(context.supabase, context.userId, {
      section: "entities",
      entityKind: "rack",
      action: "update",
      entityUuid: data.rackId,
      entityRef: before.rackStableId || null,
      summary:
        data.positionU == null
          ? `Removed rack position for "${row.name}" in ${before.rackStableId}`
          : `Placed "${row.name}" at U${data.positionU} (${height}U, ${data.rackLane}) in ${before.rackStableId}`,
      patch: {
        rack_units: data.rackUnits,
        rack_position_u: data.positionU,
        rack_lane: data.rackLane,
      },
    });

    return readRackKit(db, context.userId, data.rackId);
  });

const FaceInput = z.object({
  rackId: z.string().uuid(),
  componentRowId: z.string().uuid(),
});

/**
 * Draw a front-panel picture for one part with Lovable AI, sized to the number
 * of rack spaces the part occupies, and keep it on the inventory item so every
 * rack that uses the same gear shows the same picture.
 */
export const generateRackPartFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FaceInput.parse(d))
  .handler(async ({ context, data }): Promise<RackKitView> => {
    await requireElectricalAccess(context.supabase, context.userId, "field_write");
    const db = context.supabase as unknown as LooseDb;
    const before = await readRackKit(db, context.userId, data.rackId);
    const row = before.parts.find((p) => p.id === data.componentRowId);
    if (!row) throw new Error("That part is not on this rack's build kit.");

    const rackUnits = row.rackUnits;
    if (rackUnits == null) {
      throw new Error(
        "Record how many rack spaces this part takes first, so the picture is drawn to the right size.",
      );
    }

    const { buildFacePrompt, renderFaceImage, storeFaceImage } = await import(
      "@/lib/rack-face.server"
    );
    const prompt = buildFacePrompt({
      name: row.name,
      description: row.description,
      itemType: row.itemType,
      rackUnits,
    });
    const b64 = await renderFaceImage(prompt);
    const path = await storeFaceImage(context.userId, row.componentItemId, b64);

    const { error } = await db
      .from("inventory_items")
      .update({
        rack_face_image_url: path,
        rack_face_prompt: prompt,
        rack_face_generated_at: new Date().toISOString(),
      })
      .eq("id", row.componentItemId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    await recordElectricalChange(context.supabase, context.userId, {
      section: "entities",
      entityKind: "rack",
      action: "update",
      entityUuid: data.rackId,
      entityRef: before.rackStableId || null,
      summary: `Generated a ${rackUnits}U front-panel picture for "${row.name}" in ${before.rackStableId}`,
      patch: { component_item_id: row.componentItemId, rack_face_image_url: path },
    });

    return readRackKit(db, context.userId, data.rackId);
  });
