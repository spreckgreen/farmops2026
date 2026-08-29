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
  applyRelations,
  relationsFor,
  type RelationTarget,
} from "@/lib/electrical-relations";
import { runIntegrityChecks, integritySummary, type IntegrityFinding } from "@/lib/electrical-integrity";
import { collectTopology, topologyLookups } from "@/lib/electrical-topology";
import {
  topologyGapSummary,
  topologyGaps,
  type TopologyGap,
} from "@/lib/electrical-topology-resolve";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";
import {
  checkControlledValue,
  checkStableId,
  completionFromStatus,
  farmShopWalkOrder,
  findBreakerConflicts,
  INSTALL_STATUSES,
  mergeLegacyStatusNote,
  nextPanelExitOrder,
  nextStableId,
  normalizeInstallStatus,
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
    const db = context.supabase as unknown as LooseDb;

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

    // Controlled vocabularies are enforced here as well as in the database, so
    // the user gets a readable message instead of a trigger error.
    for (const [key, value] of Object.entries(patch)) {
      const problem = checkControlledValue(key, value);
      if (problem) throw new Error(problem);
    }

    if (typeof patch["install_status"] === "string" && patch["completion_percent"] == null) {
      patch["completion_percent"] = completionFromStatus(patch["install_status"] as string);
    }

    // Duplicate stable IDs are rejected before the write so the message names
    // the conflicting record rather than surfacing a unique-index violation.
    if (stableId) {
      const { data: clash } = await db
        .from(def.table)
        .select("id")
        .eq(def.stableIdField, stableId)
        .limit(2);
      const others = ((clash ?? []) as { id: string }[]).filter((r) => r.id !== data.id);
      if (others.length) throw new Error(`${def.stableIdLabel} ${stableId} is already in use.`);
    }

    // Resolve every FK selection to its target so the legacy reference columns
    // can be derived and impossible topology rejected.
    let existing: Record<string, unknown> = {};
    if (data.id) {
      const { data: row } = await db.from(def.table).select("*").eq("id", data.id).single();
      existing = (row ?? {}) as Record<string, unknown>;
    }
    const merged = { ...existing, ...patch };
    const targets: Record<string, RelationTarget | null> = {};
    for (const spec of relationsFor(data.kind)) {
      const value = merged[spec.fkColumn];
      if (value == null || !String(value)) continue;
      const target = ENTITIES[spec.targetKind];
      const { data: row } = await db
        .from(target.table)
        .select(`id, ${target.stableIdField}`)
        .eq("id", String(value))
        .maybeSingle();
      targets[spec.fkColumn] = row
        ? {
            id: (row as Record<string, string>)["id"]!,
            kind: spec.targetKind,
            stableId: String((row as Record<string, string>)[target.stableIdField] ?? ""),
          }
        : null;
    }
    const relations = applyRelations(data.kind, merged, targets, {
      id: data.id ?? null,
      stableId: stableId || String(existing[def.stableIdField] ?? ""),
    });
    if (relations.errors.length) throw new Error(relations.errors.join(" "));
    Object.assign(patch, relations.derived);

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


/**
 * List every record that references this one, grouped by referencing entity
 * and field, so the UI can show an actionable dependency breakdown with links.
 */
export const electricalDependents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kind: kindSchema, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<DependencyReport> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const groups: DependentGroup[] = [];

    for (const spec of dependentSpecs(data.kind)) {
      const { data: rows } = await db
        .from(spec.table)
        .select(`id, ${spec.stableIdField}, description`)
        .eq(spec.fkColumn, data.id)
        .order(spec.stableIdField);
      const list = ((rows ?? []) as Record<string, string | null>[]).map((r) => ({
        id: String(r["id"]),
        stableId: String(r[spec.stableIdField] ?? ""),
        description: (r["description"] as string | null) ?? null,
      }));
      if (!list.length) continue;
      groups.push({
        kind: spec.kind,
        title: ENTITIES[spec.kind].title,
        fkColumn: spec.fkColumn,
        fieldLabel: spec.fieldLabel,
        rows: list,
      });
    }

    const children: DependentChildGroup[] = [];
    if (data.kind === "raceway") {
      const { data: wps } = await db
        .from("electrical_raceway_waypoints")
        .select("id")
        .eq("raceway_uuid", data.id);
      const count = ((wps ?? []) as unknown[]).length;
      if (count) {
        children.push({
          title: "Waypoints",
          count,
          hint: "Remove the waypoints from this raceway's detail page first.",
        });
      }
    }

    const total =
      groups.reduce((n, g) => n + g.rows.length, 0) +
      children.reduce((n, c) => n + c.count, 0);
    return { kind: data.kind, total, groups, children };
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
    if (error) {
      // A record still referenced by other topology must not be silently
      // orphaned — name exactly what still points at it.
      if (/foreign key|violates/i.test(error.message)) {
        throw new Error(
          `This ${ENTITIES[data.kind].singular} is still referenced by other electrical records. Open the dependency breakdown, clear each reference, then delete it.`,
        );
      }
      throw new Error(error.message);
    }
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

/**
 * Linked topology for one record: what it connects to in both directions.
 *
 * The record itself is the only hard requirement. Every relationship lookup is
 * executed independently and a failure (missing relationship table/column in an
 * older deployment, or an unreadable related table) is reported as a warning —
 * an incomplete or unavailable topology never prevents the record from opening.
 */
export const electricalTopology = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kind: kindSchema, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const def = ENTITIES[data.kind];

    const { data: row, error } = await db
      .from(def.table)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(`This ${def.singular} record is not available to your account.`);
    const record = row as unknown as ElectricalRow;
    const stableId = String(record[def.stableIdField] ?? "");

    const plan = topologyLookups(
      data.kind,
      record as unknown as Record<string, unknown>,
      stableId,
    );
    const { related, warnings } = await collectTopology(plan, async (lookup) => {
      const { data: rows, error: lookupError } = await db
        .from(ENTITIES[lookup.kind].table)
        .select("*")
        .eq(lookup.column, lookup.value);
      if (lookupError) throw new Error(lookupError.message);
      return (rows ?? []) as Record<string, unknown>[];
    });

    return { record, related, warnings };
  });


export interface EntityOption {
  id: string;
  stableId: string;
  label: string;
  context: string;
  installStatus: string;
}

/**
 * Selector data for the relationship pickers: stable ID plus enough context
 * (description, building, grid) that the right record is obvious in the field.
 */
export const electricalEntityOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ kinds: z.array(kindSchema).min(1).max(6) }).parse(d))
  .handler(async ({ context, data }): Promise<Record<string, EntityOption[]>> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const out: Record<string, EntityOption[]> = {};
    for (const kind of [...new Set(data.kinds)]) {
      const def = ENTITIES[kind];
      const { data: rows, error } = await db.from(def.table).select("*").order(def.stableIdField);
      if (error) throw new Error(error.message);
      out[kind] = ((rows ?? []) as unknown as ElectricalRow[]).map((r) => ({
        id: String(r["id"]),
        stableId: String(r[def.stableIdField] ?? ""),
        label: String(r["description"] ?? r["area"] ?? ""),
        context: [r["building"], r["grid"], r["area"], r["location"]]
          .map((v) => String(v ?? "").trim())
          .filter(Boolean)
          .join(" · "),
        installStatus: String(r["install_status"] ?? ""),
      }));
    }
    return out;
  });

/** Next free physical exit order for a panel (lower-right, then counterclockwise). */
export const suggestPanelExitOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ panel_uuid: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const { data: rows, error } = await (context.supabase as unknown as LooseDb)
      .from("electrical_raceways")
      .select("exit_order")
      .eq("source_panel_uuid", data.panel_uuid);
    if (error) throw new Error(error.message);
    const used = ((rows ?? []) as { exit_order: number | null }[]).map((r) => r.exit_order);
    return { suggestion: nextPanelExitOrder(used) };
  });

export interface IntegrityReport {
  findings: IntegrityFinding[];
  summary: ReturnType<typeof integritySummary>;
  /** Raceways whose as-built topology is not fully established yet. */
  gaps: TopologyGap[];
  gapSummary: ReturnType<typeof topologyGapSummary>;
}


/**
 * Electrical QA: duplicate/malformed IDs, invalid controlled values, orphans,
 * FK/reference disagreement, breaker conflicts and incomplete topology.
 * Report only — it never rewrites records.
 */
export const electricalIntegrityReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrityReport> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const kinds: ElectricalEntityKind[] = [
      "panel",
      "circuit_group",
      "load",
      "raceway",
      "jbox",
      "branch",
    ];
    const fetched = await Promise.all(
      kinds.map(async (kind) => {
        const { data, error } = await db.from(ENTITIES[kind].table).select("*");
        if (error) throw new Error(error.message);
        return (data ?? []) as Row[];
      }),
    );
    const { data: waypoints } = await db.from("electrical_raceway_waypoints").select("*");
    const graph: ElectricalGraphData = {
      panel: fetched[0]!,
      circuit_group: fetched[1]!,
      load: fetched[2]!,
      raceway: fetched[3]!,
      jbox: fetched[4]!,
      branch: fetched[5]!,
      waypoint: (waypoints ?? []) as Row[],
    };
    const findings = runIntegrityChecks(graph);
    const records = kinds.reduce((n, k) => n + (graph[k] ?? []).length, 0);
    const gaps = topologyGaps(graph);
    return {
      findings,
      summary: integritySummary(findings, records),
      gaps,
      gapSummary: topologyGapSummary(gaps),
    };
  });

/**
 * Repair legacy records whose install_status holds engineering design text
 * ("Design Basis", "Planning Assumption", …). The database rejects those values
 * on every later write, so the record can be listed but never edited. The text
 * is preserved in notes; no record is deleted or recreated and no engineering
 * value is changed.
 */
export const normalizeLegacyStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ apply: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    // Dry run by default: engineering-owned values are never rewritten without
    // the operator seeing the exact before/after first.
    const proposed: {
      kind: ElectricalEntityKind;
      stable_id: string;
      was: string;
      now: string;
      notes_preview: string;
    }[] = [];
    const fixed: { kind: ElectricalEntityKind; stable_id: string; was: string }[] = [];
    const errors: { stable_id: string; message: string }[] = [];

    for (const kind of ENTITY_KINDS) {
      const def = ENTITIES[kind];
      const { data: rows, error } = await db.from(def.table).select("*");
      if (error) throw new Error(error.message);
      for (const row of (rows ?? []) as Row[]) {
        const norm = normalizeInstallStatus(row["install_status"]);
        if (!norm.legacy) continue;
        const notes = mergeLegacyStatusNote(row["notes"], norm.legacy);
        const stableId = String(row[def.stableIdField] ?? "");
        proposed.push({
          kind,
          stable_id: stableId,
          was: norm.legacy,
          now: norm.status,
          notes_preview: notes ?? "",
        });
        if (!data.apply) continue;
        const { error: writeError } = await db
          .from(def.table)
          .update({ install_status: norm.status, notes })
          .eq("id", String(row["id"]));
        if (writeError) errors.push({ stable_id: stableId, message: writeError.message });
        else fixed.push({ kind, stable_id: stableId, was: norm.legacy });
      }
    }
    return { applied: data.apply, proposed, fixed, errors };
  });

