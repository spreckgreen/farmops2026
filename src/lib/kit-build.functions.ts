// Kit build-outs for any inventory kit — the same workspace the equipment racks
// use, but keyed off the kit itself instead of a rack. A kit is an inventory
// record typed as a kit (e.g. "Ham Radio Field Deployment Kit"); its parts list
// lives in public.inventory_components, and each part can record how many rack
// spaces it takes and which space it starts at.
//
// When the kit happens to build out an equipment rack (electrical_racks
// .build_kit_item_id), the rack's recorded height is used as the capacity so the
// stack drawn here matches the rack detail screen exactly.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDb = { from: (table: string) => any };

const KitInput = z.object({ kitItemId: z.string().uuid() });

export interface KitBuildPart {
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
  itemRackUnits: number | null;
  /** Lowest space occupied, counted from the bottom. NULL when not placed. */
  positionU: number | null;
  /** Horizontal portion of the rack face occupied by this device. */
  rackLane: "full" | "left" | "right";
  description: string | null;
  faceImageUrl: string | null;
  faceGeneratedAt: string | null;
}

export interface KitBuildView {
  kit: { id: string; name: string; sku: string | null; location: string | null; onHand: number };
  /** Capacity in spaces: the linked rack's height, or the kit's own recorded height. */
  sizeU: number | null;
  /** Set when this kit builds out an equipment rack. */
  rack: { id: string; stableId: string; description: string | null } | null;
  parts: KitBuildPart[];
}

async function readKitBuild(db: LooseDb, userId: string, kitItemId: string): Promise<KitBuildView> {
  const { data: kit, error } = await db
    .from("inventory_items")
    .select("id, name, sku, location, quantity, rack_units")
    .eq("user_id", userId)
    .eq("id", kitItemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!kit) throw new Error("Kit not found.");

  // The rack link is optional and lives behind the electrical module.
  let rack: KitBuildView["rack"] = null;
  let rackSizeU: number | null = null;
  try {
    const { data: rackRows } = await db
      .from("electrical_racks")
      .select("id, rack_id, description, rack_size_u")
      .eq("build_kit_item_id", kitItemId)
      .limit(1);
    const r = (rackRows ?? [])[0];
    if (r) {
      rack = {
        id: String(r.id),
        stableId: String(r.rack_id ?? ""),
        description: r.description ?? null,
      };
      rackSizeU = r.rack_size_u == null ? null : Number(r.rack_size_u);
    }
  } catch {
    // no electrical access — the kit still builds out fine
  }

  const { data: rows, error: cErr } = await db
    .from("inventory_components")
    .select("id, component_item_id, quantity, unit, notes, sort_order, rack_units, rack_position_u, rack_lane")
    .eq("user_id", userId)
    .eq("parent_item_id", kitItemId)
    .order("sort_order", { ascending: true });
  if (cErr) throw new Error(cErr.message);

  const componentIds = [
    ...new Set((rows ?? []).map((r: { component_item_id: string }) => String(r.component_item_id))),
  ];
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

  const parts: KitBuildPart[] = (rows ?? []).map(
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
        quantity: Number(r.quantity ?? 0),
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

  return {
    kit: {
      id: String(kit.id),
      name: String(kit.name ?? kit.sku ?? "(unnamed kit)"),
      sku: kit.sku ?? null,
      location: kit.location ?? null,
      onHand: Number(kit.quantity ?? 0),
    },
    sizeU: rackSizeU ?? (kit.rack_units == null ? null : Number(kit.rack_units)),
    rack,
    parts,
  };
}

export const getKitBuild = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => KitInput.parse(d))
  .handler(async ({ context, data }): Promise<KitBuildView> =>
    readKitBuild(context.supabase as unknown as LooseDb, context.userId, data.kitItemId),
  );

const SizeInput = z.object({
  kitItemId: z.string().uuid(),
  /** Capacity in rack spaces; null clears it. */
  sizeU: z.number().int().positive().max(100).nullable(),
});

/** Record how many spaces the kit's frame or rack has, so a stack can be drawn. */
export const setKitSize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SizeInput.parse(d))
  .handler(async ({ context, data }): Promise<KitBuildView> => {
    const db = context.supabase as unknown as LooseDb;
    const { error } = await db
      .from("inventory_items")
      .update({ rack_units: data.sizeU })
      .eq("id", data.kitItemId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return readKitBuild(db, context.userId, data.kitItemId);
  });

const PlacementInput = z.object({
  kitItemId: z.string().uuid(),
  componentRowId: z.string().uuid(),
  rackUnits: z.number().int().positive().max(100).nullable(),
  positionU: z.number().int().positive().max(100).nullable(),
  rackLane: z.enum(["full", "left", "right"]).default("full"),
  applyToItem: z.boolean().optional(),
});

/**
 * Record a part's size and where it sits in the kit's stack. Positions are
 * checked against the other placed parts and the recorded capacity, so nothing
 * double-books a space or hangs out of the top.
 */
export const setKitPartPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlacementInput.parse(d))
  .handler(async ({ context, data }): Promise<KitBuildView> => {
    const db = context.supabase as unknown as LooseDb;
    const before = await readKitBuild(db, context.userId, data.kitItemId);
    const row = before.parts.find((p) => p.id === data.componentRowId);
    if (!row) throw new Error("That part is not on this kit's list.");

    const height = data.rackUnits ?? row.itemRackUnits;
    if (data.positionU != null) {
      if (height == null) {
        throw new Error("Record how many spaces this part takes before giving it a position.");
      }
      const top = data.positionU + height - 1;
      if (before.sizeU != null && top > before.sizeU) {
        throw new Error(
          `${height} spaces starting at U${data.positionU} runs past the top of this ${before.sizeU}-space build.`,
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

    return readKitBuild(db, context.userId, data.kitItemId);
  });

const FaceInput = z.object({
  kitItemId: z.string().uuid(),
  componentRowId: z.string().uuid(),
});

/** Draw a front-panel picture for one part, sized to the spaces it occupies. */
export const generateKitPartFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FaceInput.parse(d))
  .handler(async ({ context, data }): Promise<KitBuildView> => {
    const db = context.supabase as unknown as LooseDb;
    const before = await readKitBuild(db, context.userId, data.kitItemId);
    const row = before.parts.find((p) => p.id === data.componentRowId);
    if (!row) throw new Error("That part is not on this kit's list.");
    if (row.rackUnits == null) {
      throw new Error(
        "Record how many spaces this part takes first, so the picture is drawn to the right size.",
      );
    }

    const { buildFacePrompt, renderFaceImage, storeFaceImage } = await import(
      "@/lib/rack-face.server"
    );
    const prompt = buildFacePrompt({
      name: row.name,
      description: row.description,
      itemType: row.itemType,
      rackUnits: row.rackUnits,
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

    return readKitBuild(db, context.userId, data.kitItemId);
  });
