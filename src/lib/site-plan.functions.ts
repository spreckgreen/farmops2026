// Server functions for site outlines traced from aerial imagery.
//
// Address lookup goes through the Google Maps connector gateway; nothing calls
// Google directly from the browser except the map tiles themselves. Rows are
// owner-scoped by RLS as well as by the explicit user_id written here.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ExistingStructure, LatLng } from "@/lib/site-plan";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const SITE_COLUMNS =
  "id, site_name, address, formatted_address, latitude, longitude, imagery_source, notes, created_at, updated_at";
const BUILDING_COLUMNS =
  "id, site_plan_id, temp_name, building_name, size_rank, outline, origin_latitude, origin_longitude, footprint_sqft, perimeter_ft, fit_length_ft, fit_width_ft, orientation_degrees, grid_cell_ft, grid_rows, grid_columns, grid_row_labels, grid_column_labels, mapped_structure, mapped_confidence, building_role, parent_building_id, trace_method, notes, updated_at";

/**
 * Footprints the app already holds as frozen, approved geometry. Only these are
 * offered as size-based matches; every other existing name is name-only.
 */
const KNOWN_FOOTPRINTS: Record<string, { lengthFt: number; widthFt: number }> = {
  "Farm Shop": { lengthFt: 60, widthFt: 40 },
};

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface GeocodedSite {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
}

/** Look up an address so the map can open over the right roof. */
export const geocodeSiteAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) => {
    const address = clean(input?.address);
    if (!address) throw new Error("Enter the site address.");
    if (address.length > 300) throw new Error("That address is too long.");
    return { address };
  })
  .handler(async ({ data }): Promise<GeocodedSite> => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    // A second linked map connection is exposed with a `_1` suffix, so accept both.
    const connectionKey =
      process.env["GOOGLE_MAPS_API_KEY"] ?? process.env["GOOGLE_MAPS_API_KEY_1"];
    if (!connectionKey) {
      throw new Error("Map lookup is not configured for this project yet.");
    }
    // Hosted installs route through the connector gateway. Self-hosted installs
    // have no gateway key, so the server key calls Google directly.
    const viaGateway = Boolean(lovableKey);
    const response = viaGateway
      ? await fetch(
          `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(data.address)}`,
          {
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": connectionKey,
            },
          },
        )
      : await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
            data.address,
          )}&key=${encodeURIComponent(connectionKey)}`,
        );
    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403) {
        throw new Error(
          `Address lookup was denied (403). Check the map key restrictions. ${body}`,
        );
      }
      throw new Error(`Address lookup failed [${response.status}]: ${body}`);
    }
    const payload = (await response.json()) as {
      status?: string;
      error_message?: string;
      results?: Array<{
        formatted_address?: string;
        place_id?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    const first = payload.results?.[0];
    const lat = num(first?.geometry?.location?.lat);
    const lng = num(first?.geometry?.location?.lng);
    if (payload.status !== "OK" || !first || lat === null || lng === null) {
      throw new Error(
        `No location found for that address${payload.error_message ? `: ${payload.error_message}` : "."}`,
      );
    }
    return {
      formattedAddress: first.formatted_address ?? data.address,
      latitude: lat,
      longitude: lng,
      placeId: first.place_id ?? null,
    };
  });

/**
 * Structure names the app already uses for this account, so a traced outline can
 * be mapped onto an existing building instead of inventing a new one.
 */
export const listExistingStructures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ structures: ExistingStructure[] }> => {
    const { supabase } = context as { supabase: any };
    const counts = new Map<string, { panels: number; loads: number; cameras: number }>();
    const bump = (name: string | null, key: "panels" | "loads" | "cameras") => {
      const trimmed = (name ?? "").trim();
      if (!trimmed) return;
      const entry = counts.get(trimmed) ?? { panels: 0, loads: 0, cameras: 0 };
      entry[key] += 1;
      counts.set(trimmed, entry);
    };

    const [panels, loads, cameras] = await Promise.all([
      supabase.from("electrical_panels").select("building"),
      supabase.from("electrical_loads").select("building"),
      supabase.from("cameras").select("building"),
    ]);
    for (const row of panels.data ?? []) bump(row.building, "panels");
    for (const row of loads.data ?? []) bump(row.building, "loads");
    for (const row of cameras.data ?? []) bump(row.building, "cameras");

    const structures: ExistingStructure[] = [...counts.entries()]
      .map(([name, entry]) => {
        const parts: string[] = [];
        if (entry.panels) parts.push(`${entry.panels} panel(s)`);
        if (entry.loads) parts.push(`${entry.loads} load(s)`);
        if (entry.cameras) parts.push(`${entry.cameras} camera(s)`);
        const known = KNOWN_FOOTPRINTS[name] ?? null;
        return {
          name,
          usedBy: parts.join(", ") || "referenced in records",
          knownLengthFt: known?.lengthFt ?? null,
          knownWidthFt: known?.widthFt ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { structures };
  });

export interface SaveBuildingInput {
  id?: string | null;
  temp_name: string;
  size_rank: number;
  outline: LatLng[];
  origin_latitude: number | null;
  origin_longitude: number | null;
  footprint_sqft: number | null;
  perimeter_ft: number | null;
  fit_length_ft: number | null;
  fit_width_ft: number | null;
  orientation_degrees: number | null;
  grid_cell_ft: number;
  grid_rows: number | null;
  grid_columns: number | null;
  grid_row_labels: string | null;
  grid_column_labels: string | null;
  mapped_structure?: string | null;
  mapped_confidence?: string | null;
  notes?: string | null;
}

export interface SaveSitePlanInput {
  id?: string | null;
  site_name: string;
  address: string;
  formatted_address?: string | null;
  latitude: number | null;
  longitude: number | null;
  notes?: string | null;
  buildings: SaveBuildingInput[];
}

function validateSite(input: SaveSitePlanInput): SaveSitePlanInput {
  const siteName = clean(input?.site_name);
  const address = clean(input?.address);
  if (!siteName) throw new Error("Give the site a name.");
  if (!address) throw new Error("The site address is required.");
  const buildings = Array.isArray(input?.buildings) ? input.buildings : [];
  if (buildings.length === 0) throw new Error("Trace at least one building before saving.");
  for (const building of buildings) {
    if (!clean(building.temp_name)) throw new Error("Every building needs a name.");
    if (!Array.isArray(building.outline) || building.outline.length < 3) {
      throw new Error(`${building.temp_name} needs at least three traced corners.`);
    }
  }
  return {
    id: clean(input.id),
    site_name: siteName,
    address,
    formatted_address: clean(input.formatted_address),
    latitude: num(input.latitude),
    longitude: num(input.longitude),
    notes: clean(input.notes),
    buildings,
  };
}

/** Save the site and replace its traced buildings in one step. */
export const saveSitePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateSite)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    let siteId = data.id ?? null;
    const siteFields = {
      user_id: userId,
      site_name: data.site_name,
      address: data.address,
      formatted_address: data.formatted_address,
      latitude: data.latitude,
      longitude: data.longitude,
      notes: data.notes,
    };

    if (siteId) {
      const { error } = await supabase.from("site_plans").update(siteFields).eq("id", siteId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await supabase
        .from("site_plans")
        .insert(siteFields)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row?.id) throw new Error("The site could not be saved.");
      siteId = row.id as string;
    }

    const { error: clearError } = await supabase
      .from("site_buildings")
      .delete()
      .eq("site_plan_id", siteId);
    if (clearError) throw new Error(clearError.message);

    const rows = data.buildings.map((building) => ({
      site_plan_id: siteId,
      user_id: userId,
      temp_name: String(building.temp_name).trim(),
      size_rank: Number(building.size_rank) || 1,
      outline: building.outline,
      origin_latitude: num(building.origin_latitude),
      origin_longitude: num(building.origin_longitude),
      footprint_sqft: num(building.footprint_sqft),
      perimeter_ft: num(building.perimeter_ft),
      fit_length_ft: num(building.fit_length_ft),
      fit_width_ft: num(building.fit_width_ft),
      orientation_degrees: num(building.orientation_degrees),
      grid_cell_ft: num(building.grid_cell_ft) ?? 8,
      grid_rows: num(building.grid_rows),
      grid_columns: num(building.grid_columns),
      grid_row_labels: clean(building.grid_row_labels),
      grid_column_labels: clean(building.grid_column_labels),
      mapped_structure: clean(building.mapped_structure),
      mapped_confidence: clean(building.mapped_confidence),
      trace_method: "TRACED_CORNERS",
      notes: clean(building.notes),
    }));

    const { error: insertError } = await supabase.from("site_buildings").insert(rows);
    if (insertError) throw new Error(insertError.message);

    return { id: siteId, buildings: rows.length };
  });

/** Every saved site for the signed-in account, with its traced buildings. */
export const listSitePlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as { supabase: any };
    const { data: sites, error } = await supabase
      .from("site_plans")
      .select(SITE_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (sites ?? []).map((s: { id: string }) => s.id);
    let buildings: any[] = [];
    if (ids.length > 0) {
      const { data: rows, error: buildingError } = await supabase
        .from("site_buildings")
        .select(BUILDING_COLUMNS)
        .in("site_plan_id", ids)
        .order("size_rank", { ascending: true });
      if (buildingError) throw new Error(buildingError.message);
      buildings = rows ?? [];
    }
    return { sites: sites ?? [], buildings };
  });

export const deleteSitePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input?.id);
    if (!id) throw new Error("A site is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { error } = await supabase.from("site_plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Naming and grouping
//
// Renaming and regrouping never touches measured geometry: outlines, footprints,
// orientation and derived grids are left exactly as recorded.
// ---------------------------------------------------------------------------

/** Rename a site and/or correct its address without touching its buildings. */
export const updateSitePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; site_name: string; address?: string | null }) => {
    const id = clean(input?.id);
    const siteName = clean(input?.site_name);
    if (!id) throw new Error("A site is required.");
    if (!siteName) throw new Error("Give the site a name.");
    return { id, site_name: siteName, address: clean(input?.address) };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const fields: Record<string, unknown> = { site_name: data.site_name };
    if (data.address) fields["address"] = data.address;
    const { error } = await supabase.from("site_plans").update(fields).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface UpdateSiteBuildingInput {
  id: string;
  building_name?: string | null;
  temp_name?: string | null;
  building_role?: string | null;
  parent_building_id?: string | null;
  mapped_structure?: string | null;
}

/** Edit one building's names, its role on the site, and which building it belongs to. */
export const updateSiteBuilding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateSiteBuildingInput) => {
    const id = clean(input?.id);
    if (!id) throw new Error("A building is required.");
    const role = clean(input?.building_role);
    if (role && role !== "PRIMARY" && role !== "OUTBUILDING") {
      throw new Error("A building is either the main building or an outbuilding.");
    }
    const tempName = clean(input?.temp_name);
    if (tempName && tempName.length > 60) throw new Error("That reference is too long.");
    return {
      id,
      building_name: input?.building_name === undefined ? undefined : clean(input.building_name),
      temp_name: tempName ?? undefined,
      building_role: input?.building_role === undefined ? undefined : role,
      parent_building_id:
        input?.parent_building_id === undefined ? undefined : clean(input.parent_building_id),
      mapped_structure:
        input?.mapped_structure === undefined ? undefined : clean(input.mapped_structure),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const fields: Record<string, unknown> = {};
    if (data.building_name !== undefined) fields["building_name"] = data.building_name;
    if (data.temp_name !== undefined) fields["temp_name"] = data.temp_name;
    if (data.building_role !== undefined) fields["building_role"] = data.building_role;
    if (data.parent_building_id !== undefined) {
      if (data.parent_building_id === data.id) {
        throw new Error("A building cannot belong to itself.");
      }
      fields["parent_building_id"] = data.parent_building_id;
    }
    if (data.mapped_structure !== undefined) fields["mapped_structure"] = data.mapped_structure;
    if (Object.keys(fields).length === 0) return { ok: true };
    const { error } = await supabase.from("site_buildings").update(fields).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Move every building from the source sites onto one keeper site, then remove the
 * emptied site records. Duplicate BLDG-n references are renumbered largest to
 * smallest so no two buildings on the site share a reference.
 */
export const mergeSitePlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { keep_id: string; merge_ids: string[] }) => {
    const keepId = clean(input?.keep_id);
    if (!keepId) throw new Error("Choose which site to keep.");
    const mergeIds = (Array.isArray(input?.merge_ids) ? input.merge_ids : [])
      .map((value) => clean(value))
      .filter((value): value is string => Boolean(value) && value !== keepId);
    if (mergeIds.length === 0) throw new Error("Choose at least one other site to fold in.");
    return { keep_id: keepId, merge_ids: [...new Set(mergeIds)] };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };

    const { error: moveError } = await supabase
      .from("site_buildings")
      .update({ site_plan_id: data.keep_id, parent_building_id: null })
      .in("site_plan_id", data.merge_ids);
    if (moveError) throw new Error(moveError.message);

    const { error: deleteError } = await supabase
      .from("site_plans")
      .delete()
      .in("id", data.merge_ids);
    if (deleteError) throw new Error(deleteError.message);

    const renumbered = await resequenceReferences(supabase, data.keep_id);
    return { ok: true, moved_sites: data.merge_ids.length, renumbered };
  });

/**
 * Give every building on one site a unique BLDG-n reference, largest footprint
 * first. Buildings already carrying a hand-typed reference keep it.
 */
async function resequenceReferences(supabase: any, siteId: string): Promise<number> {
  const { data: rows, error } = await supabase
    .from("site_buildings")
    .select("id, temp_name, footprint_sqft")
    .eq("site_plan_id", siteId);
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as Array<{
    id: string;
    temp_name: string;
    footprint_sqft: number | null;
  }>;
  const auto = list
    .filter((row) => /^BLDG-\d+$/i.test(String(row.temp_name ?? "").trim()))
    .sort((a, b) => Number(b.footprint_sqft ?? 0) - Number(a.footprint_sqft ?? 0));
  const taken = new Set(
    list
      .filter((row) => !/^BLDG-\d+$/i.test(String(row.temp_name ?? "").trim()))
      .map((row) => String(row.temp_name ?? "").trim().toUpperCase()),
  );
  let next = 1;
  let changed = 0;
  for (const row of auto) {
    let candidate = `BLDG-${next}`;
    while (taken.has(candidate.toUpperCase())) {
      next += 1;
      candidate = `BLDG-${next}`;
    }
    taken.add(candidate.toUpperCase());
    next += 1;
    if (candidate !== row.temp_name) {
      const { error: updateError } = await supabase
        .from("site_buildings")
        .update({ temp_name: candidate })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      changed += 1;
    }
  }
  return changed;
}

/** Renumber duplicate references on one site without moving anything. */
export const resequenceSiteReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { site_id: string }) => {
    const siteId = clean(input?.site_id);
    if (!siteId) throw new Error("A site is required.");
    return { site_id: siteId };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const renumbered = await resequenceReferences(supabase, data.site_id);
    return { ok: true, renumbered };
  });
