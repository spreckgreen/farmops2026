// Save tenant-defined building grids.
//
// A defined grid is one building row on a site plan: named by the tenant, with
// its outline stored in feet, its orientation to north, its cell size and its
// walk-around route. Rows are owner-scoped by RLS and by the user_id written
// here. Saving one building never touches the other buildings on the site.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PointFt } from "@/lib/site-plan";

const DEFINITION_METHODS = new Set([
  "ENTERED_DIMENSIONS",
  "STANDARD_SHAPE",
  "CORNER_LIST",
  "SVG_IMPORT",
  "DXF_IMPORT",
  "TRACED_PDF",
]);
const WALK_PATTERNS = new Set(["CLOCKWISE", "COUNTERCLOCKWISE", "SERPENTINE_ROWS", "ROW_MAJOR"]);

const BUILDING_COLUMNS =
  "id, site_plan_id, building_name, temp_name, size_rank, definition_method, shape_template, height_ft, outline_local, footprint_sqft, perimeter_ft, fit_length_ft, fit_width_ft, orientation_degrees, north_offset_degrees, grid_cell_ft, grid_rows, grid_columns, grid_row_labels, grid_column_labels, walk_start_cell, walk_finish_cell, walk_pattern, source_file_name, source_scale_note, mapped_structure, notes, updated_at";

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface SaveBuildingGridInput {
  id?: string | null;
  site_plan_id?: string | null;
  /** Used when no site is chosen yet — a site is created with this name. */
  new_site_name?: string | null;
  new_site_address?: string | null;
  building_name: string;
  definition_method: string;
  shape_template?: string | null;
  height_ft?: number | null;
  outline_ft: PointFt[];
  footprint_sqft: number | null;
  perimeter_ft: number | null;
  fit_length_ft: number | null;
  fit_width_ft: number | null;
  north_offset_degrees: number | null;
  grid_cell_ft: number;
  grid_rows: number | null;
  grid_columns: number | null;
  grid_row_labels: string | null;
  grid_column_labels: string | null;
  walk_start_cell?: string | null;
  walk_finish_cell?: string | null;
  walk_pattern?: string | null;
  source_file_name?: string | null;
  source_scale_note?: string | null;
  mapped_structure?: string | null;
  notes?: string | null;
}

function validate(input: SaveBuildingGridInput): SaveBuildingGridInput {
  const name = clean(input?.building_name);
  if (!name) throw new Error("Give the building a name, for example Pump House.");
  const method = clean(input?.definition_method) ?? "";
  if (!DEFINITION_METHODS.has(method)) throw new Error("Unknown way of defining this building.");
  const outline = Array.isArray(input?.outline_ft) ? input.outline_ft : [];
  if (outline.length < 3) throw new Error(`${name} needs at least three corners in feet.`);
  for (const point of outline) {
    if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) {
      throw new Error(`${name} has a corner that is not a number.`);
    }
  }
  const cell = num(input?.grid_cell_ft);
  if (!cell || cell <= 0) throw new Error("Grid cell size must be a positive number of feet.");
  if (!clean(input?.site_plan_id) && !clean(input?.new_site_name)) {
    throw new Error("Choose an existing site or give the new site a name.");
  }
  const pattern = clean(input?.walk_pattern);
  if (pattern && !WALK_PATTERNS.has(pattern)) throw new Error("Unknown walk-around pattern.");

  return {
    ...input,
    id: clean(input.id),
    site_plan_id: clean(input.site_plan_id),
    new_site_name: clean(input.new_site_name),
    new_site_address: clean(input.new_site_address),
    building_name: name,
    definition_method: method,
    shape_template: clean(input.shape_template),
    outline_ft: outline.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    grid_cell_ft: cell,
    walk_pattern: pattern,
  };
}

/** Create or update one named building grid, leaving every other building alone. */
export const saveBuildingGrid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    let siteId = data.site_plan_id ?? null;
    if (!siteId) {
      const { data: row, error } = await supabase
        .from("site_plans")
        .insert({
          user_id: userId,
          site_name: data.new_site_name,
          address: data.new_site_address,
          imagery_source: "tenant_defined",
        })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row?.id) throw new Error("The site could not be created.");
      siteId = row.id as string;
    }

    const fields = {
      site_plan_id: siteId,
      user_id: userId,
      building_name: data.building_name,
      temp_name: data.building_name,
      definition_method: data.definition_method,
      shape_template: data.shape_template,
      height_ft: num(data.height_ft),
      outline: [],
      outline_local: data.outline_ft,
      footprint_sqft: num(data.footprint_sqft),
      perimeter_ft: num(data.perimeter_ft),
      fit_length_ft: num(data.fit_length_ft),
      fit_width_ft: num(data.fit_width_ft),
      north_offset_degrees: num(data.north_offset_degrees),
      grid_cell_ft: data.grid_cell_ft,
      grid_rows: num(data.grid_rows),
      grid_columns: num(data.grid_columns),
      grid_row_labels: clean(data.grid_row_labels),
      grid_column_labels: clean(data.grid_column_labels),
      walk_start_cell: clean(data.walk_start_cell),
      walk_finish_cell: clean(data.walk_finish_cell),
      walk_pattern: data.walk_pattern,
      source_file_name: clean(data.source_file_name),
      source_scale_note: clean(data.source_scale_note),
      mapped_structure: clean(data.mapped_structure),
      trace_method: data.definition_method,
      notes: clean(data.notes),
    };

    if (data.id) {
      const { error } = await supabase.from("site_buildings").update(fields).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id, site_plan_id: siteId };
    }

    const { count } = await supabase
      .from("site_buildings")
      .select("id", { count: "exact", head: true })
      .eq("site_plan_id", siteId);
    const { data: row, error } = await supabase
      .from("site_buildings")
      .insert({ ...fields, size_rank: (Number(count) || 0) + 1 })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row?.id ?? null, site_plan_id: siteId };
  });

/** Sites and their defined building grids for the signed-in account. */
export const listBuildingGrids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as { supabase: any };
    const { data: sites, error } = await supabase
      .from("site_plans")
      .select("id, site_name, address, formatted_address, imagery_source, created_at")
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

export const deleteBuildingGrid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input?.id);
    if (!id) throw new Error("A building is required.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { error } = await supabase.from("site_buildings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
