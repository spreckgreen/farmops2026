// Read and write the site's own grid geometry (grid lines, posts, intervals).
//
// The read path is used by every plot resolver so records plot from the site
// definition instead of the frozen design drawing. The write path replaces the
// definition's geometry wholesale and is audited.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import {
  normalizeGridDefinition,
  validateGridGeometry,
  type GridGeometry,
} from "@/lib/electrical-grid-definition";

type LooseDb = { from: (table: string) => any };

const DEFS = "electrical_grid_definitions";
const LINES = "electrical_grid_definition_lines";
const POSTS = "electrical_grid_definition_posts";
const INTERVALS = "electrical_grid_definition_intervals";

export interface GridDefinitionPayload {
  uuid: string | null;
  geometry: GridGeometry;
  issues: string[];
}

async function readActive(db: LooseDb): Promise<GridDefinitionPayload> {
  const def = await db.from(DEFS).select("*").eq("is_active", true).maybeSingle();
  if (def.error) throw new Error(def.error.message);
  if (!def.data) return { uuid: null, geometry: normalizeGridDefinition({}), issues: [] };
  const uuid = String(def.data.id);
  const [lines, posts, intervals] = await Promise.all([
    db.from(LINES).select("axis,label,offset_ft,notes").eq("definition_uuid", uuid),
    db.from(POSTS).select("post_ref,wall,is_corner,x_ft,y_ft,notes").eq("definition_uuid", uuid),
    db.from(INTERVALS).select("interval_ref,kind,from_ref,to_ref,notes").eq("definition_uuid", uuid),
  ]);
  for (const r of [lines, posts, intervals]) if (r.error) throw new Error(r.error.message);
  const geometry = normalizeGridDefinition({
    ...def.data,
    lines: lines.data ?? [],
    posts: posts.data ?? [],
    intervals: intervals.data ?? [],
  });
  return { uuid, geometry, issues: validateGridGeometry(geometry) };
}

/** Server-side helper for other server functions that need the active geometry. */
export async function loadActiveGridGeometry(supabase: unknown): Promise<GridDefinitionPayload> {
  return readActive(supabase as LooseDb);
}

export const getGridDefinition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GridDefinitionPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    return readActive(context.supabase as unknown as LooseDb);
  });

const lineSchema = z.object({
  axis: z.enum(["ROW", "COLUMN"]),
  label: z.string().trim().min(1).max(8),
  offset_ft: z.number().finite().min(0).max(10000),
  notes: z.string().trim().max(500).nullable().optional(),
});

const postSchema = z.object({
  post_ref: z.string().trim().min(1).max(32),
  wall: z.enum(["north", "east", "south", "west"]).nullable().optional(),
  is_corner: z.boolean().optional(),
  x_ft: z.number().finite().min(-10000).max(10000),
  y_ft: z.number().finite().min(-10000).max(10000),
  notes: z.string().trim().max(500).nullable().optional(),
});

const intervalSchema = z.object({
  interval_ref: z.string().trim().min(1).max(48),
  kind: z.enum(["POST_SPAN", "LINE_SPAN"]),
  from_ref: z.string().trim().min(1).max(32),
  to_ref: z.string().trim().min(1).max(32),
  notes: z.string().trim().max(500).nullable().optional(),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope_note: z.string().trim().max(200).nullable().optional(),
  envelope_width_ft: z.number().finite().positive().max(10000),
  envelope_depth_ft: z.number().finite().positive().max(10000),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(lineSchema).max(200),
  posts: z.array(postSchema).max(500),
  intervals: z.array(intervalSchema).max(500),
});

export const saveGridDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<GridDefinitionPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "field_write");
    const db = context.supabase as unknown as LooseDb;

    const candidate = normalizeGridDefinition({
      definition_id: "GRID-01",
      ...data,
    });
    const issues = validateGridGeometry(candidate);
    const blocking = issues.filter((i) => !i.startsWith("Interval"));
    if (blocking.length) throw new Error(`Grid definition is not usable: ${blocking.join(" ")}`);

    const existing = await db.from(DEFS).select("id,definition_id").eq("is_active", true).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let uuid: string;
    if (existing.data) {
      uuid = String(existing.data.id);
      const upd = await db
        .from(DEFS)
        .update({
          name: data.name,
          scope_note: data.scope_note ?? null,
          envelope_width_ft: data.envelope_width_ft,
          envelope_depth_ft: data.envelope_depth_ft,
          notes: data.notes ?? null,
        })
        .eq("id", uuid);
      if (upd.error) throw new Error(upd.error.message);
    } else {
      const ins = await db
        .from(DEFS)
        .insert({
          definition_id: `GRID-${new Date().toISOString().slice(0, 10)}`,
          name: data.name,
          scope_note: data.scope_note ?? null,
          envelope_width_ft: data.envelope_width_ft,
          envelope_depth_ft: data.envelope_depth_ft,
          notes: data.notes ?? null,
          is_active: true,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);
      uuid = String(ins.data.id);
    }

    for (const table of [LINES, POSTS, INTERVALS]) {
      const del = await db.from(table).delete().eq("definition_uuid", uuid);
      if (del.error) throw new Error(del.error.message);
    }

    const inserts: [string, Record<string, unknown>[]][] = [
      [LINES, data.lines.map((l) => ({ ...l, definition_uuid: uuid, notes: l.notes ?? null }))],
      [
        POSTS,
        data.posts.map((p) => ({
          ...p,
          wall: p.wall ?? null,
          is_corner: p.is_corner ?? false,
          notes: p.notes ?? null,
          definition_uuid: uuid,
        })),
      ],
      [
        INTERVALS,
        data.intervals.map((i) => ({ ...i, notes: i.notes ?? null, definition_uuid: uuid })),
      ],
    ];
    for (const [table, rows] of inserts) {
      if (!rows.length) continue;
      const ins = await db.from(table).insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    await recordElectricalChange(context.supabase, context.userId, {
      section: "mapping",
      entityKind: "grid_definition",
      action: existing.data ? "update" : "create",
      entityUuid: uuid,
      entityRef: candidate.definitionId,
      summary: `Site grid definition saved: ${data.lines.length} grid lines, ${data.posts.length} posts, ${data.intervals.length} named intervals, ${data.envelope_width_ft} x ${data.envelope_depth_ft} ft envelope. Records now plot from this geometry.`,
    });

    return readActive(db);
  });

/** One saved grid map the reader can choose to print. */
export interface GridDefinitionSummary {
  uuid: string;
  name: string;
  scopeNote: string | null;
  isActive: boolean;
  geometry: GridGeometry;
}

/**
 * Every saved grid map, so a printed sheet can name the exact map it came from.
 * Read-only; the active map is listed first.
 */
export const listGridDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GridDefinitionSummary[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;
    const defs = await db.from(DEFS).select("*").order("is_active", { ascending: false });
    if (defs.error) throw new Error(defs.error.message);
    const rows = (defs.data ?? []) as any[];
    const out: GridDefinitionSummary[] = [];
    for (const row of rows) {
      const uuid = String(row.id);
      const [lines, posts, intervals] = await Promise.all([
        db.from(LINES).select("axis,label,offset_ft,notes").eq("definition_uuid", uuid),
        db.from(POSTS).select("post_ref,wall,is_corner,x_ft,y_ft,notes").eq("definition_uuid", uuid),
        db
          .from(INTERVALS)
          .select("interval_ref,kind,from_ref,to_ref,notes")
          .eq("definition_uuid", uuid),
      ]);
      for (const r of [lines, posts, intervals]) if (r.error) throw new Error(r.error.message);
      out.push({
        uuid,
        name: String(row.name ?? "Unnamed grid map"),
        scopeNote: row.scope_note ?? null,
        isActive: Boolean(row.is_active),
        geometry: normalizeGridDefinition({
          ...row,
          lines: lines.data ?? [],
          posts: posts.data ?? [],
          intervals: intervals.data ?? [],
        }),
      });
    }
    return out;
  });
