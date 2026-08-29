// Server functions for the Electrical Infrastructure add-on.
// Every handler gates on the `electrical` entitlement before touching data.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireAddon } from "@/lib/addons.server";
import {
  ENTITIES,
  ENTITY_KINDS,
  coerceValue,
  writableColumns,
} from "@/lib/electrical-entities";
import {
  checkStableId,
  completionFromStatus,
  farmShopWalkOrder,
  findBreakerConflicts,
  INSTALL_STATUSES,
  nextStableId,
  sortByPanelExit,
  type ElectricalEntityKind,
} from "@/lib/electrical";

type LooseDb = { from: (table: string) => any };

const kindSchema = z.enum(ENTITY_KINDS as [ElectricalEntityKind, ...ElectricalEntityKind[]]);

/** DB rows for electrical tables are flat scalars, so they cross the RPC boundary as-is. */
export type ElectricalValue = string | number | boolean | null;
export interface ElectricalRow {
  id: string;
  [key: string]: ElectricalValue;
}

/** List rows for one entity kind, optionally filtered. */
export const listElectrical = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: kindSchema,
        search: z.string().trim().max(120).optional(),
        environment: z.string().trim().max(40).optional(),
        status: z.string().trim().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ElectricalRow[]> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const def = ENTITIES[data.kind];
    let q = (context.supabase as unknown as LooseDb)
      .from(def.table)
      .select("*")
      .order(def.stableIdField);
    if (data.environment) q = q.eq("environment", data.environment);
    if (data.status) q = q.eq("install_status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let out = (rows ?? []) as unknown as ElectricalRow[];
    if (data.search) {
      const needle = data.search.toLowerCase();
      out = out.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(needle)),
      );
    }
    if (data.kind === "raceway") out = sortByPanelExit(out as never) as ElectricalRow[];
    return out;
  });

/** Create or update one record. Stable IDs are validated, never auto-renamed. */
export const saveElectrical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: kindSchema,
        id: z.string().uuid().optional(),
        values: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const def = ENTITIES[data.kind];
    const allowed = new Set(writableColumns(data.kind));

    const patch: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(data.values)) {
      if (!allowed.has(key)) continue;
      if (key === def.stableIdField) {
        patch[key] = String(raw ?? "").trim();
        continue;
      }
      const field = def.fields.find((f) => f.key === key)!;
      patch[key] = coerceValue(field, raw);
    }

    const stableId = String(patch[def.stableIdField] ?? "").trim();
    if (!data.id || stableId) {
      const check = checkStableId(data.kind, stableId);
      if (!check.ok) throw new Error(check.error ?? "Invalid stable ID.");
    }

    if (typeof patch["install_status"] === "string" && patch["completion_percent"] == null) {
      patch["completion_percent"] = completionFromStatus(patch["install_status"] as string);
    }

    const db = context.supabase as unknown as LooseDb;
    if (data.id) {
      const { error } = await db.from(def.table).update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await db
      .from(def.table)
      .insert({ ...patch, user_id: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (inserted as { id: string }).id };
  });

export const deleteElectrical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kind: kindSchema, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const { error } = await (context.supabase as unknown as LooseDb)
      .from(ENTITIES[data.kind].table)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Suggest the next sequential ID for CON-/JB-/BR- style records. */
export const suggestStableId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kind: kindSchema }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const def = ENTITIES[data.kind];
    const { data: rows, error } = await (context.supabase as unknown as LooseDb)
      .from(def.table)
      .select(def.stableIdField);
    if (error) throw new Error(error.message);
    const ids = ((rows ?? []) as Record<string, string>[]).map((r) => r[def.stableIdField]);
    return { suggestion: nextStableId(data.kind, ids) };
  });

/** Waypoints describe bends and turns along one raceway — never fake J-boxes. */
export const listWaypoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ raceway_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const { data: rows, error } = await (context.supabase as unknown as LooseDb)
      .from("electrical_raceway_waypoints")
      .select("*")
      .eq("raceway_id", data.raceway_id)
      .order("sequence");
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as ElectricalRow[];
  });

export const saveWaypoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        raceway_id: z.string().uuid(),
        sequence: z.number().int().min(1).max(999),
        grid: z.string().trim().max(40).optional(),
        direction: z.string().trim().max(80).optional(),
        notes: z.string().trim().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const row = {
      raceway_id: data.raceway_id,
      sequence: data.sequence,
      grid: data.grid?.trim() || null,
      direction: data.direction?.trim() || null,
      notes: data.notes?.trim() || null,
    };
    if (data.id) {
      const { error } = await db.from("electrical_raceway_waypoints").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("electrical_raceway_waypoints")
        .insert({ ...row, user_id: context.userId });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteWaypoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const { error } = await (context.supabase as unknown as LooseDb)
      .from("electrical_raceway_waypoints")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const naming_standards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const { data, error } = await (context.supabase as unknown as LooseDb)
      .from("electrical_naming_standards")
      .select("*")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ElectricalRow[];
  });

export interface ElectricalOverview {
  counts: Record<string, number>;
  byStatus: { status: string; count: number }[];
  fieldWalk: string[];
  issues: { severity: "error" | "warning"; message: string }[];
  worklist: {
    kind: ElectricalEntityKind;
    stable_id: string;
    description: string;
    install_status: string;
  }[];
}

/**
 * Dashboard payload: counts, status rollup, Farm Shop walk order, validation
 * issues (duplicate breakers, orphan references, missing endpoints) and the
 * open field worklist.
 */
export const electricalOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ElectricalOverview> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;

    const [panels, groups, loads, raceways, jboxes, branches] = await Promise.all(
      (["panel", "circuit_group", "load", "raceway", "jbox", "branch"] as ElectricalEntityKind[]).map(
        async (kind) => {
          const { data, error } = await db.from(ENTITIES[kind].table).select("*");
          if (error) throw new Error(error.message);
          return (data ?? []) as unknown as ElectricalRow[];
        },
      ),
    );

    const counts: Record<string, number> = {
      panel: panels.length,
      circuit_group: groups.length,
      load: loads.length,
      raceway: raceways.length,
      jbox: jboxes.length,
      branch: branches.length,
    };

    const all = [
      ...panels.map((r) => ({ kind: "panel" as const, row: r })),
      ...groups.map((r) => ({ kind: "circuit_group" as const, row: r })),
      ...loads.map((r) => ({ kind: "load" as const, row: r })),
      ...raceways.map((r) => ({ kind: "raceway" as const, row: r })),
      ...jboxes.map((r) => ({ kind: "jbox" as const, row: r })),
      ...branches.map((r) => ({ kind: "branch" as const, row: r })),
    ];

    const byStatus = INSTALL_STATUSES.map((status) => ({
      status,
      count: all.filter(({ row }) => row["install_status"] === status).length,
    })).filter((s) => s.count > 0);

    const issues: ElectricalOverview["issues"] = [];

    for (const c of findBreakerConflicts(
      groups.map((g) => ({
        circuit_group_id: String(g["circuit_group_id"] ?? ""),
        panel_uuid: (g["panel_uuid"] as string | null) ?? null,
        breaker_number: (g["breaker_number"] as number | null) ?? null,
      })),
    )) {
      const panel = panels.find((p) => p["id"] === c.panel_uuid);
      issues.push({
        severity: "error",
        message: `Breaker ${c.breaker_number} in ${String(panel?.["panel_id"] ?? "panel")} is claimed by ${c.ids.join(", ")}.`,
      });
    }

    const groupIds = new Set(groups.map((g) => String(g["circuit_group_id"] ?? "")));
    for (const l of loads) {
      const ref = String(l["circuit_group_ref"] ?? "").trim();
      if (ref && !groupIds.has(ref)) {
        issues.push({
          severity: "warning",
          message: `Load ${String(l["load_id"])} references unknown circuit group ${ref}.`,
        });
      }
    }
    for (const r of raceways) {
      if (!String(r["source_endpoint_ref"] ?? "").trim() || !String(r["dest_endpoint_ref"] ?? "").trim()) {
        issues.push({
          severity: "warning",
          message: `Raceway ${String(r["conduit_id"])} is missing a source or destination endpoint.`,
        });
      }
    }
    for (const b of branches) {
      if (!String(b["dest_endpoint_ref"] ?? "").trim()) {
        issues.push({
          severity: "warning",
          message: `Branch run ${String(b["branch_id"])} has no destination endpoint.`,
        });
      }
    }

    const fieldWalk = farmShopWalkOrder(
      loads
        .filter((l) => String(l["load_id"] ?? "").startsWith("FS-"))
        .map((l) => (l["grid"] as string | null) ?? null),
    );

    const openStatuses = new Set<string>(["complete", "as_built_verified"]);
    const worklist = all
      .filter(({ row }) => !openStatuses.has(String(row["install_status"] ?? "planned")))
      .map(({ kind, row }) => ({
        kind,
        stable_id: String(row[ENTITIES[kind].stableIdField] ?? ""),
        description: String(row["description"] ?? row["dest_endpoint_ref"] ?? ""),
        install_status: String(row["install_status"] ?? "planned"),
      }))
      .sort((a, b) => a.stable_id.localeCompare(b.stable_id));

    return { counts, byStatus, fieldWalk, issues, worklist };
  });

/** Linked topology for one record: what it connects to in both directions. */
export const electricalTopology = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kind: kindSchema, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const def = ENTITIES[data.kind];

    const { data: row, error } = await db.from(def.table).select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const record = row as unknown as ElectricalRow;
    const stableId = String(record[def.stableIdField] ?? "");

    const related: { kind: ElectricalEntityKind; stable_id: string; label: string; relation: string }[] = [];
    const push = async (
      kind: ElectricalEntityKind,
      column: string,
      value: string,
      relation: string,
    ) => {
      if (!value) return;
      const target = ENTITIES[kind];
      const { data: rows } = await db.from(target.table).select("*").eq(column, value);
      for (const r of (rows ?? []) as unknown as ElectricalRow[]) {
        related.push({
          kind,
          stable_id: String(r[target.stableIdField] ?? ""),
          label: String(r["description"] ?? r["dest_endpoint_ref"] ?? ""),
          relation,
        });
      }
    };

    if (data.kind === "panel") {
      await push("circuit_group", "suggested_panel", stableId, "circuit on this panel");
      await push("raceway", "source_endpoint_ref", stableId, "raceway leaving panel");
      await push("raceway", "dest_endpoint_ref", stableId, "raceway entering panel");
    } else if (data.kind === "circuit_group") {
      await push("load", "circuit_group_ref", stableId, "load on this circuit");
      await push("panel", "panel_id", String(record["suggested_panel"] ?? ""), "panel");
    } else if (data.kind === "load") {
      await push("circuit_group", "circuit_group_id", String(record["circuit_group_ref"] ?? ""), "circuit group");
      await push("branch", "dest_endpoint_ref", stableId, "branch run feeding load");
    } else if (data.kind === "raceway") {
      for (const ref of [record["source_endpoint_ref"], record["dest_endpoint_ref"]]) {
        const value = String(ref ?? "");
        if (value.startsWith("PNL-")) await push("panel", "panel_id", value, "endpoint");
        if (value.startsWith("JB-")) await push("jbox", "jbox_id", value, "endpoint");
      }
    } else if (data.kind === "jbox") {
      await push("raceway", "source_endpoint_ref", stableId, "raceway leaving box");
      await push("raceway", "dest_endpoint_ref", stableId, "raceway entering box");
      await push("branch", "source_endpoint_ref", stableId, "branch run from box");
    } else if (data.kind === "branch") {
      for (const ref of [record["source_endpoint_ref"], record["dest_endpoint_ref"]]) {
        const value = String(ref ?? "");
        if (value.startsWith("PNL-")) await push("panel", "panel_id", value, "endpoint");
        if (value.startsWith("JB-")) await push("jbox", "jbox_id", value, "endpoint");
        if (/^(FS|PH|BL)-/.test(value)) await push("load", "load_id", value, "endpoint");
      }
    }

    return { record, related };
  });
