// Building levels (floors) — authenticated server functions.
//
// Levels are owner-scoped. Level assignment for existing records always runs
// through preview → approval → apply: nothing here bulk-writes coordinates,
// renames a stable ID, or guesses a floor for an ambiguous legacy record.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  levelStableId,
  levelReconciliationReport,
  planLevelMigration,
  sortLevels,
  type BuildingLevel,
  type LocatedObject,
} from "@/lib/building-levels";

const LEVEL_COLUMNS =
  "id, site_building_id, level_stable_id, display_name, short_code, sort_order, elevation_ft, grid_rows, grid_columns, grid_cell_ft, grid_scheme_uuid, lifecycle_state, evidence_ref, evidence_observed_at, is_default, notes";

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Buildings on record with their levels, bottom floor first. */
export const listBuildingLevels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as { supabase: any };

    const { data: buildings, error: buildingError } = await supabase
      .from("site_buildings")
      .select(
        "id, site_plan_id, building_name, temp_name, grid_cell_ft, grid_rows, grid_columns, fit_length_ft, fit_width_ft",
      )
      .order("size_rank", { ascending: true });
    if (buildingError) throw new Error(buildingError.message);

    const { data: levels, error: levelError } = await supabase
      .from("building_levels")
      .select(LEVEL_COLUMNS)
      .order("sort_order", { ascending: true });
    if (levelError) throw new Error(levelError.message);

    return {
      buildings: buildings ?? [],
      levels: sortLevels((levels ?? []) as BuildingLevel[]),
    };
  });

export interface SaveBuildingLevelInput {
  id?: string | null;
  site_building_id: string;
  display_name: string;
  short_code: string;
  sort_order?: number | null;
  elevation_ft?: number | null;
  grid_rows?: number | null;
  grid_columns?: number | null;
  grid_cell_ft?: number | null;
  lifecycle_state?: string | null;
  evidence_ref?: string | null;
  is_default?: boolean | null;
  notes?: string | null;
}

/**
 * Create or rename a level. The permanent level stable ID is written once on
 * create and never recomputed, so renaming a floor cannot renumber it.
 */
export const saveBuildingLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveBuildingLevelInput) => {
    const building = clean(input?.site_building_id);
    if (!building) throw new Error("Choose which building this level belongs to.");
    const name = clean(input?.display_name);
    if (!name) throw new Error("Give the level a name, for example Ground Floor.");
    const code = clean(input?.short_code)?.toUpperCase();
    if (!code) throw new Error("Give the level a short code, for example L01.");
    return {
      id: clean(input?.id),
      site_building_id: building,
      display_name: name,
      short_code: code,
      sort_order: num(input?.sort_order) ?? 0,
      elevation_ft: num(input?.elevation_ft),
      grid_rows: num(input?.grid_rows),
      grid_columns: num(input?.grid_columns),
      grid_cell_ft: num(input?.grid_cell_ft),
      lifecycle_state: clean(input?.lifecycle_state) ?? "planned",
      evidence_ref: clean(input?.evidence_ref),
      is_default: input?.is_default === true,
      notes: clean(input?.notes),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: building, error: buildingError } = await supabase
      .from("site_buildings")
      .select("id, building_name, temp_name")
      .eq("id", data.site_building_id)
      .maybeSingle();
    if (buildingError) throw new Error(buildingError.message);
    if (!building) throw new Error("That building is not on record for this account.");

    const fields: Record<string, unknown> = {
      user_id: userId,
      site_building_id: data.site_building_id,
      display_name: data.display_name,
      short_code: data.short_code,
      sort_order: data.sort_order,
      elevation_ft: data.elevation_ft,
      grid_rows: data.grid_rows,
      grid_columns: data.grid_columns,
      grid_cell_ft: data.grid_cell_ft,
      lifecycle_state: data.lifecycle_state,
      evidence_ref: data.evidence_ref,
      is_default: data.is_default,
      notes: data.notes,
    };

    if (data.id) {
      // level_stable_id is deliberately absent: it is permanent.
      const { error } = await supabase.from("building_levels").update(fields).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const code = String(building.building_name ?? building.temp_name ?? "BLDG")
      .split(/\s+/)
      .map((w: string) => w[0] ?? "")
      .join("");
    const { data: row, error } = await supabase
      .from("building_levels")
      .insert({ ...fields, level_stable_id: levelStableId(code, data.short_code) })
      .select("id, level_stable_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row?.id ?? null, level_stable_id: row?.level_stable_id ?? null };
  });

const LEVEL_TABLES: { table: string; idField: string; label: string }[] = [
  { table: "electrical_panels", idField: "panel_id", label: "Panels" },
  { table: "electrical_circuit_groups", idField: "circuit_group_id", label: "Circuits" },
  { table: "electrical_loads", idField: "load_id", label: "Loads" },
  { table: "electrical_junction_boxes", idField: "jbox_id", label: "Junction boxes" },
  { table: "electrical_switch_banks", idField: "switch_bank_id", label: "Switch banks" },
  { table: "electrical_switch_devices", idField: "switch_device_id", label: "Switch devices" },
  { table: "electrical_power_assets", idField: "power_asset_id", label: "Power assets" },
  { table: "electrical_racks", idField: "rack_id", label: "Racks" },
  { table: "electrical_devices", idField: "device_id", label: "Devices" },
];

async function collectLocated(
  supabase: any,
): Promise<{ table: string; label: string; rows: LocatedObject[] }[]> {
  const out: { table: string; label: string; rows: LocatedObject[] }[] = [];
  for (const t of LEVEL_TABLES) {
    const { data, error } = await supabase
      .from(t.table)
      .select(
        `${t.idField}, site_building_uuid, building_level_uuid, grid_scheme_uuid, level_grid_reference, location_x_ft, location_y_ft, location_z_ft, location_source, location_precision`,
      );
    if (error) throw new Error(error.message);
    out.push({
      table: t.table,
      label: t.label,
      rows: (data ?? []).map((r: Record<string, unknown>) => ({
        stable_id: String(r[t.idField] ?? ""),
        site_building_uuid: (r["site_building_uuid"] as string) ?? null,
        building_level_uuid: (r["building_level_uuid"] as string) ?? null,
        grid_scheme_uuid: (r["grid_scheme_uuid"] as string) ?? null,
        grid_reference: (r["level_grid_reference"] as string) ?? null,
        x_ft: (r["location_x_ft"] as number) ?? null,
        y_ft: (r["location_y_ft"] as number) ?? null,
        z_ft: (r["location_z_ft"] as number) ?? null,
        location_source: (r["location_source"] as never) ?? null,
        location_precision: (r["location_precision"] as string) ?? null,
      })),
    });
  }
  return out;
}

/**
 * Preview-only level migration for one building. Nothing is written. For a
 * confirmed single-level building every record is attached to its default level
 * with coordinates untouched; anything ambiguous is withheld.
 */
export const previewLevelMigration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { site_building_id?: string | null; confirmed_single_level?: boolean }) => ({
    site_building_id: clean(input?.site_building_id),
    confirmed_single_level: input?.confirmed_single_level === true,
  }))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };

    const { data: levelRows, error } = await supabase
      .from("building_levels")
      .select(LEVEL_COLUMNS)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const levels = sortLevels((levelRows ?? []) as BuildingLevel[]).filter(
      (l) => !data.site_building_id || l.site_building_id === data.site_building_id,
    );
    const defaultLevel = levels.find((l) => l.is_default === true) ?? levels[0] ?? null;
    const confirmedSingleLevel = data.confirmed_single_level && levels.length === 1;

    const groups = await collectLocated(supabase);
    return {
      generated_at: new Date().toISOString(),
      levels,
      default_level: defaultLevel,
      confirmed_single_level: confirmedSingleLevel,
      groups: groups.map((g) => ({
        table: g.table,
        label: g.label,
        plan: planLevelMigration(g.rows, { confirmedSingleLevel, defaultLevel }),
        reconciliation: levelReconciliationReport(g.rows, levels),
      })),
    };
  });

export interface ApplyLevelAssignmentInput {
  table: string;
  stable_id: string;
  building_level_uuid: string;
  grid_reference?: string | null;
  x_ft?: number | null;
  y_ft?: number | null;
  z_ft?: number | null;
  location_source?: string | null;
  evidence_ref?: string | null;
  /** Explicit per-record approval. Nothing is written without it. */
  approved: boolean;
}

/**
 * Apply one approved level assignment. Only location components change: the
 * stable ID and every engineering value are left exactly as recorded, and the
 * previous location is written to the change audit as superseded evidence.
 */
export const applyLevelAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ApplyLevelAssignmentInput) => {
    const table = clean(input?.table);
    const known = LEVEL_TABLES.find((t) => t.table === table);
    if (!known) throw new Error("That kind of record cannot carry a building level.");
    const stableId = clean(input?.stable_id);
    if (!stableId) throw new Error("Which record is being placed?");
    const level = clean(input?.building_level_uuid);
    if (!level) throw new Error("Choose the building level.");
    if (input?.approved !== true) throw new Error("This change needs your explicit approval first.");
    return {
      table: known.table,
      idField: known.idField,
      stable_id: stableId,
      building_level_uuid: level,
      grid_reference: clean(input?.grid_reference)?.toUpperCase() ?? null,
      x_ft: num(input?.x_ft),
      y_ft: num(input?.y_ft),
      z_ft: num(input?.z_ft),
      location_source: clean(input?.location_source) ?? "FIELD_OBSERVED_LEVEL_GRID",
      evidence_ref: clean(input?.evidence_ref),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: level, error: levelError } = await supabase
      .from("building_levels")
      .select(LEVEL_COLUMNS)
      .eq("id", data.building_level_uuid)
      .maybeSingle();
    if (levelError) throw new Error(levelError.message);
    if (!level) throw new Error("That building level is not on record for this account.");

    const selection = `id, ${data.idField}, site_building_uuid, building_level_uuid, grid_scheme_uuid, level_grid_reference, location_x_ft, location_y_ft, location_z_ft, location_source, location_precision`;
    const { data: before, error: beforeError } = await supabase
      .from(data.table)
      .select(selection)
      .eq(data.idField, data.stable_id)
      .maybeSingle();
    if (beforeError) throw new Error(beforeError.message);
    if (!before) throw new Error("That record is not on record for this account.");

    const after = {
      site_building_uuid: level.site_building_id,
      building_level_uuid: level.id,
      grid_scheme_uuid: level.grid_scheme_uuid,
      level_grid_reference: data.grid_reference ?? before.level_grid_reference ?? null,
      location_x_ft: data.x_ft ?? before.location_x_ft ?? null,
      location_y_ft: data.y_ft ?? before.location_y_ft ?? null,
      location_z_ft: data.z_ft ?? before.location_z_ft ?? null,
      location_source: data.location_source,
      location_precision: data.location_source.startsWith("FIELD_OBSERVED")
        ? "field verified"
        : "approved design, not field verified",
    };

    const { error: updateError } = await supabase
      .from(data.table)
      .update(after)
      .eq(data.idField, data.stable_id);
    if (updateError) throw new Error(updateError.message);

    // Superseded evidence is preserved, never overwritten in place.
    await supabase.from("electrical_change_audit").insert({
      user_id: userId,
      section: "building_levels",
      entity_kind: data.table,
      entity_uuid: before.id ?? null,
      entity_ref: data.stable_id,
      action: "level_assignment",
      summary: `${data.stable_id} placed on ${level.display_name} (${level.short_code}). Location components only; stable ID and engineering values unchanged.`,
      changes: { before, after, evidence_ref: data.evidence_ref },
    });

    return { stable_id: data.stable_id, before, after, stable_id_changed: false };
  });
