// Rooms, areas and their circuits inside a defined building grid.
//
// Every row is owner-scoped by RLS and by the explicit user_id written here.
// A room/area belongs to one building on a site plan (Site Grids), so the grid
// cells it names are the same A1-style references the building grid derives.
// Circuit links are relationships only: nothing here writes engineering values,
// renames a stable ID, or creates electrical records.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const AREA_KINDS = [
  { value: "ROOM", label: "Room" },
  { value: "AREA", label: "Area" },
  { value: "BAY", label: "Bay" },
  { value: "EXTERIOR", label: "Exterior" },
  { value: "MECHANICAL", label: "Mechanical" },
  { value: "STORAGE", label: "Storage" },
  { value: "OTHER", label: "Other" },
] as const;

export const ASSIGNMENT_BASES = [
  { value: "DESIGN", label: "Planned (design)" },
  { value: "FIELD_OBSERVED", label: "Observed in the field" },
] as const;

const KINDS = new Set(AREA_KINDS.map((k) => k.value as string));
const BASES = new Set(ASSIGNMENT_BASES.map((b) => b.value as string));

const AREA_COLUMNS =
  "id, site_building_id, area_name, area_kind, floor_level, grid_cells, start_cell, end_cell, notes, created_at, updated_at";
const CIRCUIT_COLUMNS =
  "id, building_area_id, circuit_group_uuid, circuit_group_ref, panel_ref, breaker_number, load_ref, assignment_basis, notes, created_at, updated_at";

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export interface SaveBuildingAreaInput {
  id?: string | null;
  site_building_id: string;
  area_name: string;
  area_kind: string;
  floor_level?: string | null;
  grid_cells?: string | null;
  start_cell?: string | null;
  end_cell?: string | null;
  notes?: string | null;
}

/** Buildings from Site Grids, with their rooms/areas and circuit links. */
export const listBuildingAreas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as { supabase: any };

    const { data: sites, error: siteError } = await supabase
      .from("site_plans")
      .select("id, site_name, address, formatted_address")
      .order("created_at", { ascending: false });
    if (siteError) throw new Error(siteError.message);

    const siteIds = (sites ?? []).map((s: { id: string }) => s.id);
    let buildings: any[] = [];
    if (siteIds.length > 0) {
      const { data, error } = await supabase
        .from("site_buildings")
        .select(
          "id, site_plan_id, building_name, temp_name, footprint_sqft, fit_length_ft, fit_width_ft, grid_cell_ft, grid_rows, grid_columns, grid_row_labels, grid_column_labels, mapped_structure",
        )
        .in("site_plan_id", siteIds)
        .order("size_rank", { ascending: true });
      if (error) throw new Error(error.message);
      buildings = data ?? [];
    }

    const { data: areas, error: areaError } = await supabase
      .from("building_areas")
      .select(AREA_COLUMNS)
      .order("area_name", { ascending: true });
    if (areaError) throw new Error(areaError.message);

    const { data: circuits, error: circuitError } = await supabase
      .from("building_area_circuits")
      .select(CIRCUIT_COLUMNS)
      .order("created_at", { ascending: true });
    if (circuitError) throw new Error(circuitError.message);

    const { data: groups, error: groupError } = await supabase
      .from("electrical_circuit_groups")
      .select("id, circuit_group_id, description, suggested_panel, breaker_number, install_status")
      .order("circuit_group_id", { ascending: true });
    if (groupError) throw new Error(groupError.message);

    return {
      sites: sites ?? [],
      buildings,
      areas: areas ?? [],
      circuits: circuits ?? [],
      circuitGroups: groups ?? [],
    };
  });

/** Create or update one room/area inside a building. */
export const saveBuildingArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveBuildingAreaInput) => {
    const building = clean(input?.site_building_id);
    if (!building) throw new Error("Choose which building this room or area is in.");
    const name = clean(input?.area_name);
    if (!name) throw new Error("Give the room or area a name, for example Kitchen.");
    const kind = clean(input?.area_kind) ?? "ROOM";
    if (!KINDS.has(kind)) throw new Error("Unknown kind of room or area.");
    return {
      id: clean(input?.id),
      site_building_id: building,
      area_name: name,
      area_kind: kind,
      floor_level: clean(input?.floor_level),
      grid_cells: clean(input?.grid_cells),
      start_cell: clean(input?.start_cell),
      end_cell: clean(input?.end_cell),
      notes: clean(input?.notes),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: building, error: buildingError } = await supabase
      .from("site_buildings")
      .select("id")
      .eq("id", data.site_building_id)
      .maybeSingle();
    if (buildingError) throw new Error(buildingError.message);
    if (!building) throw new Error("That building is not on record for this account.");

    const fields = {
      user_id: userId,
      site_building_id: data.site_building_id,
      area_name: data.area_name,
      area_kind: data.area_kind,
      floor_level: data.floor_level,
      grid_cells: data.grid_cells,
      start_cell: data.start_cell,
      end_cell: data.end_cell,
      notes: data.notes,
    };

    if (data.id) {
      const { error } = await supabase.from("building_areas").update(fields).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("building_areas")
      .insert(fields)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row?.id ?? null };
  });

export const deleteBuildingArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input?.id);
    if (!id) throw new Error("A room or area is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { error } = await supabase.from("building_areas").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface SaveAreaCircuitInput {
  id?: string | null;
  building_area_id: string;
  circuit_group_uuid?: string | null;
  circuit_group_ref?: string | null;
  panel_ref?: string | null;
  breaker_number?: number | string | null;
  load_ref?: string | null;
  assignment_basis: string;
  notes?: string | null;
}

/** Link a circuit to a room/area. Relationship only — no engineering values. */
export const saveAreaCircuit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveAreaCircuitInput) => {
    const area = clean(input?.building_area_id);
    if (!area) throw new Error("Choose the room or area this circuit serves.");
    const basis = clean(input?.assignment_basis) ?? "DESIGN";
    if (!BASES.has(basis)) throw new Error("Say whether this is planned or observed in the field.");
    const breaker = intOrNull(input?.breaker_number);
    if (breaker !== null && (breaker < 1 || breaker > 200)) {
      throw new Error("Breaker number must be between 1 and 200.");
    }
    const groupUuid = clean(input?.circuit_group_uuid);
    const groupRef = clean(input?.circuit_group_ref);
    if (!groupUuid && !groupRef && !breaker) {
      throw new Error("Pick an existing circuit, or type a circuit reference or breaker number.");
    }
    return {
      id: clean(input?.id),
      building_area_id: area,
      circuit_group_uuid: groupUuid,
      circuit_group_ref: groupRef,
      panel_ref: clean(input?.panel_ref),
      breaker_number: breaker,
      load_ref: clean(input?.load_ref),
      assignment_basis: basis,
      notes: clean(input?.notes),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: area, error: areaError } = await supabase
      .from("building_areas")
      .select("id")
      .eq("id", data.building_area_id)
      .maybeSingle();
    if (areaError) throw new Error(areaError.message);
    if (!area) throw new Error("That room or area is not on record for this account.");

    // Only accept a circuit group this account can actually read.
    let groupUuid = data.circuit_group_uuid;
    let groupRef = data.circuit_group_ref;
    let panelRef = data.panel_ref;
    if (groupUuid) {
      const { data: group, error } = await supabase
        .from("electrical_circuit_groups")
        .select("id, circuit_group_id, suggested_panel, breaker_number")
        .eq("id", groupUuid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!group) throw new Error("That circuit is not on record for this account.");
      groupRef = groupRef ?? group.circuit_group_id ?? null;
      panelRef = panelRef ?? group.suggested_panel ?? null;
    }

    const fields = {
      user_id: userId,
      building_area_id: data.building_area_id,
      circuit_group_uuid: groupUuid,
      circuit_group_ref: groupRef,
      panel_ref: panelRef,
      breaker_number: data.breaker_number,
      load_ref: data.load_ref,
      assignment_basis: data.assignment_basis,
      notes: data.notes,
    };

    if (data.id) {
      const { error } = await supabase
        .from("building_area_circuits")
        .update(fields)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("building_area_circuits")
      .insert(fields)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row?.id ?? null };
  });

export const deleteAreaCircuit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input?.id);
    if (!id) throw new Error("A circuit link is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { error } = await supabase.from("building_area_circuits").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
