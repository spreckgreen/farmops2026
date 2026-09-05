// Administrator-only scoped data cleaning and restore.
//
// Flow, deliberately in this order:
//   1. targets  — what sites, locations and modules exist, with row counts
//   2. preview  — exactly which rows a scope would remove, and what it leaves
//   3. clear    — write the backup FIRST, then delete only the previewed ids
//   4. restore  — refuse unless the scope is empty, then put the rows back
//
// Reads use the caller's own token (RLS scopes them to the owner). Deletes and
// inserts use the service role, restricted to ids the scoped preview produced.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import { computeIntegrity } from "@/lib/snapshot-integrity";
import {
  CLEANING_MODULES,
  clearOrder,
  decideRow,
  moduleByKey,
  moduleKeysForScope,
  modulesForScope,
  normalizeLocation,
  restoreOrder,
  scopeLabel,
  withheldNote,
  type ScopeDefinition,
  type ScopeKind,
  type TablePlan,
  type TableSpec,
} from "@/lib/data-cleaning";

const PAGE_SIZE = 1000;
const CHUNK = 200;

type AnyRow = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

async function readAll(reader: Client, table: string): Promise<{ rows: AnyRow[]; error?: string }> {
  const rows: AnyRow[] = [];
  let from = 0;
  for (let page = 0; page < 500; page += 1) {
    const { data, error } = await reader.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (error) return { rows: [], error: error.message };
    const batch = (data as AnyRow[]) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { rows };
}

async function loadSites(reader: Client, userId: string) {
  const { data: sites, error } = await reader
    .from("site_plans")
    .select("id, site_name, address, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const ids = (sites ?? []).map((s: AnyRow) => String(s.id));
  let buildings: AnyRow[] = [];
  if (ids.length > 0) {
    const { data, error: buildingError } = await reader
      .from("site_buildings")
      .select("id, site_plan_id, building_name, temp_name")
      .in("site_plan_id", ids);
    if (buildingError) throw new Error(buildingError.message);
    buildings = data ?? [];
  }
  return { sites: (sites ?? []) as AnyRow[], buildings };
}

function locationsForSite(buildings: AnyRow[], sitePlanId: string): string[] {
  const names = buildings
    .filter((b) => String(b.site_plan_id) === sitePlanId)
    .map((b) => clean(b.building_name) ?? clean(b.temp_name))
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names));
}

async function buildScope(
  reader: Client,
  userId: string,
  input: { kind: ScopeKind; site_plan_id: string; module_key?: string | null; location_label?: string | null },
): Promise<ScopeDefinition> {
  const { sites, buildings } = await loadSites(reader, userId);
  const site = sites.find((s) => String(s.id) === input.site_plan_id);
  if (!site) throw new Error("Choose one of your sites first.");
  const siteLocations = locationsForSite(buildings, String(site.id));
  const locationLabel = clean(input.location_label);
  if (input.kind === "LOCATION" && !locationLabel) {
    throw new Error("Choose the location on the site that should be cleared.");
  }
  if (
    input.kind === "LOCATION" &&
    locationLabel &&
    !siteLocations.some((name) => normalizeLocation(name) === normalizeLocation(locationLabel))
  ) {
    throw new Error(`${locationLabel} is not a location on ${site.site_name}.`);
  }
  return {
    kind: input.kind,
    moduleKey: clean(input.module_key),
    siteName: String(site.site_name ?? "Site"),
    siteLocations,
    locationLabel: input.kind === "LOCATION" ? locationLabel : null,
    singleSite: sites.length === 1,
  };
}

async function planScope(reader: Client, userId: string, scope: ScopeDefinition) {
  const moduleKeys = moduleKeysForScope(scope);
  const specs = clearOrder(moduleKeys);
  const tables: TablePlan[] = [];
  const withheldNotes: string[] = [];
  const rowsByTable = new Map<string, AnyRow[]>();
  const parentIds = new Map<string, Set<string>>();
  let totalRows = 0;

  for (const { module, spec } of specs) {
    const { rows, error } = await readAll(reader, spec.table);
    if (error) {
      withheldNotes.push(`${spec.table}: could not be read (${error}); nothing was cleared from it.`);
      tables.push({ table: spec.table, module, ids: [], count: 0, withheld: 0 });
      continue;
    }
    const owned = rows.filter((row) => String(row[spec.owner] ?? "") === userId || spec.parent);
    const parentSet = spec.parent ? parentIds.get(spec.parent.table) : undefined;

    const keep: AnyRow[] = [];
    const withheldCounts = new Map<string, number>();
    for (const row of owned) {
      const decision = decideRow(row, spec, scope, parentSet);
      if (decision.inScope) keep.push(row);
      else withheldCounts.set(decision.reason, (withheldCounts.get(decision.reason) ?? 0) + 1);
    }

    parentIds.set(spec.table, new Set(keep.map((row) => String(row.id))));
    rowsByTable.set(spec.table, keep);
    const withheld = [...withheldCounts.values()].reduce((sum, n) => sum + n, 0);
    const worstReason = [...withheldCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worstReason && worstReason[1] > 0) {
      withheldNotes.push(withheldNote(spec, worstReason[0] as never, worstReason[1]));
    }
    tables.push({
      table: spec.table,
      module,
      ids: keep.map((row) => String(row.id)),
      count: keep.length,
      withheld,
      withheldReason: worstReason ? (worstReason[0] as never) : undefined,
    });
    totalRows += keep.length;
  }

  return { scope, label: scopeLabel(scope), tables, totalRows, withheldNotes, rowsByTable };
}

const scopeValidator = (input: {
  kind: ScopeKind;
  site_plan_id: string;
  module_key?: string | null;
  location_label?: string | null;
}) => {
  const kind = String(input?.kind ?? "");
  if (!["WHOLE_SITE", "MODULE", "LOCATION"].includes(kind)) throw new Error("Unknown kind of clear.");
  const site = clean(input?.site_plan_id);
  if (!site) throw new Error("Choose a site.");
  const moduleKey = clean(input?.module_key);
  if (kind === "MODULE" && !moduleKey) throw new Error("Choose the module to clear.");
  if (moduleKey && !moduleByKey(moduleKey)) throw new Error("Unknown module.");
  if (kind !== "WHOLE_SITE" && moduleKey === "site") {
    throw new Error("The site and building grids can only be cleared by an entire-site clear.");
  }
  return {
    kind: kind as ScopeKind,
    site_plan_id: site,
    module_key: moduleKey,
    location_label: clean(input?.location_label),
  };
};

/** Sites, their locations and the modules available to clear. */
export const listCleaningTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: Client; userId: string };
    await requireAdminRole(supabase, userId);
    const { sites, buildings } = await loadSites(supabase, userId);
    return {
      sites: sites.map((site) => ({
        id: String(site.id),
        site_name: String(site.site_name ?? "Site"),
        address: clean(site.address),
        locations: locationsForSite(buildings, String(site.id)),
      })),
      single_site: sites.length === 1,
      modules: CLEANING_MODULES.map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description,
        paid: m.paid,
        table_count: m.tables.length,
        location_aware: m.tables.some((t) => Boolean(t.locationColumn)),
      })),
      module_keys_by_scope: {
        WHOLE_SITE: modulesForScope("WHOLE_SITE").map((m) => m.key),
        MODULE: modulesForScope("MODULE").map((m) => m.key),
        LOCATION: modulesForScope("LOCATION").map((m) => m.key),
      },
    };
  });

/** Exactly what a clear would remove and what it would leave behind. */
export const previewDataClean = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(scopeValidator)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Client; userId: string };
    await requireAdminRole(supabase, userId);
    const scope = await buildScope(supabase, userId, data);
    const plan = await planScope(supabase, userId, scope);
    return {
      label: plan.label,
      scope: {
        kind: scope.kind,
        module_key: scope.moduleKey,
        site_name: scope.siteName,
        location_label: scope.locationLabel,
        single_site: scope.singleSite,
      },
      total_rows: plan.totalRows,
      tables: plan.tables
        .filter((t) => t.count > 0 || t.withheld > 0)
        .map(({ table, module, count, withheld }) => ({ table, module, count, withheld })),
      withheld_notes: plan.withheldNotes,
    };
  });

/** Back up the scope, then clear it. The backup is written before any delete. */
export const runDataClean = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Parameters<typeof scopeValidator>[0] & { confirm_site_name: string }) => {
    const scoped = scopeValidator(input);
    const confirm = clean((input as { confirm_site_name?: string })?.confirm_site_name);
    if (!confirm) throw new Error("Type the site name to confirm the clear.");
    return { ...scoped, confirm_site_name: confirm };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Client; userId: string };
    await requireAdminRole(supabase, userId);

    const scope = await buildScope(supabase, userId, data);
    if (normalizeLocation(data.confirm_site_name) !== normalizeLocation(scope.siteName)) {
      throw new Error(`Type the site name exactly — "${scope.siteName}" — to confirm this clear.`);
    }

    const plan = await planScope(supabase, userId, scope);
    if (plan.totalRows === 0) {
      throw new Error("There is nothing to clear in this scope, so no backup was taken.");
    }

    // 1. Backup first. A clear cannot start until its backup row exists.
    const payloadTables = plan.tables
      .filter((t) => t.count > 0)
      .map((t) => ({ table: t.table, rows: plan.rowsByTable.get(t.table) ?? [] }));
    const integrity = await computeIntegrity({
      app: "bostead" as const,
      version: 1 as const,
      tables: payloadTables,
    });
    const counts: Record<string, number> = {};
    for (const t of plan.tables) if (t.count > 0) counts[t.table] = t.count;

    const { data: backup, error: backupError } = await supabase
      .from("data_clean_backups")
      .insert({
        user_id: userId,
        scope_kind: scope.kind,
        module_key: scope.moduleKey,
        site_plan_id: data.site_plan_id,
        site_name: scope.siteName,
        location_label: scope.locationLabel,
        label: plan.label,
        table_counts: counts,
        total_rows: plan.totalRows,
        payload: { app: "bostead", version: 1, tables: payloadTables, integrity },
        integrity_digest: integrity.value,
        withheld_notes: plan.withheldNotes,
      })
      .select("id, created_at")
      .single();
    if (backupError) throw new Error(`The backup could not be written, so nothing was cleared: ${backupError.message}`);

    // 2. Delete only the ids the preview produced, children before parents.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: { table: string; deleted: number; error?: string }[] = [];
    for (const table of plan.tables) {
      if (table.ids.length === 0) continue;
      let deleted = 0;
      let failure: string | undefined;
      for (let i = 0; i < table.ids.length; i += CHUNK) {
        const chunk = table.ids.slice(i, i + CHUNK);
        const { error, count } = await (supabaseAdmin as Client)
          .from(table.table)
          .delete({ count: "exact" })
          .in("id", chunk);
        if (error) {
          failure = error.message;
          break;
        }
        deleted += count ?? chunk.length;
      }
      results.push({ table: table.table, deleted, error: failure });
    }

    return {
      ok: results.every((r) => !r.error),
      backup_id: String(backup.id),
      label: plan.label,
      total_rows: plan.totalRows,
      results,
      withheld_notes: plan.withheldNotes,
    };
  });

/** Backups of previous clears, newest first. Payload is not included. */
export const listCleanBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: Client; userId: string };
    await requireAdminRole(supabase, userId);
    const { data, error } = await supabase
      .from("data_clean_backups")
      .select(
        "id, scope_kind, module_key, site_plan_id, site_name, location_label, label, table_counts, total_rows, integrity_digest, withheld_notes, cleared_at, restored_at, restore_report",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { backups: data ?? [] };
  });

/** The full backup contents, for saving off-site. */
export const downloadCleanBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = clean(input?.id);
    if (!id) throw new Error("Choose a backup.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Client; userId: string };
    await requireAdminRole(supabase, userId);
    const { data: row, error } = await supabase
      .from("data_clean_backups")
      .select("id, label, scope_kind, module_key, site_name, location_label, total_rows, cleared_at, integrity_digest, payload")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That backup could not be found.");
    return row;
  });

/**
 * Put a backup back. Refuses unless the scope it covers is empty, so an
 * existing record is never overwritten by an older copy of itself.
 */
export const restoreCleanBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; confirm_site_name: string; dry_run?: boolean }) => {
    const id = clean(input?.id);
    if (!id) throw new Error("Choose a backup.");
    const confirm = clean(input?.confirm_site_name);
    if (!confirm && !input?.dry_run) throw new Error("Type the site name to confirm the restore.");
    return { id, confirm_site_name: confirm ?? "", dry_run: Boolean(input?.dry_run) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: Client; userId: string };
    await requireAdminRole(supabase, userId);

    const { data: row, error } = await supabase
      .from("data_clean_backups")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That backup could not be found.");
    if (row.restored_at) throw new Error("This backup has already been restored.");

    if (!data.dry_run && normalizeLocation(data.confirm_site_name) !== normalizeLocation(String(row.site_name ?? ""))) {
      throw new Error(`Type the site name exactly — "${row.site_name}" — to confirm this restore.`);
    }

    // The scope has to be empty, checked the same way the clear defined it.
    const scope = await buildScope(supabase, userId, {
      kind: row.scope_kind as ScopeKind,
      site_plan_id: String(row.site_plan_id ?? ""),
      module_key: row.module_key,
      location_label: row.location_label,
    }).catch(() => null);

    const blocking: { table: string; count: number }[] = [];
    if (scope) {
      const plan = await planScope(supabase, userId, scope);
      for (const table of plan.tables) if (table.count > 0) blocking.push({ table: table.table, count: table.count });
    } else {
      blocking.push({ table: "site_plans", count: 0 });
    }

    const payloadTables = (row.payload?.tables ?? []) as { table: string; rows: AnyRow[] }[];
    const byTable = new Map(payloadTables.map((t) => [t.table, t.rows ?? []]));
    const moduleKeys = moduleKeysForScope(
      scope ?? {
        kind: row.scope_kind as ScopeKind,
        moduleKey: row.module_key,
        siteName: String(row.site_name ?? ""),
        siteLocations: [],
        locationLabel: row.location_label,
        singleSite: true,
      },
    );
    const order: TableSpec[] = restoreOrder(moduleKeys);
    const planned = order
      .map((spec) => ({ table: spec.table, rows: byTable.get(spec.table) ?? [] }))
      .filter((entry) => entry.rows.length > 0);

    if (data.dry_run) {
      return {
        ok: blocking.length === 0,
        dry_run: true as const,
        label: String(row.label),
        blocking,
        would_restore: planned.map((p) => ({ table: p.table, rows: p.rows.length })),
        total_rows: planned.reduce((sum, p) => sum + p.rows.length, 0),
      };
    }

    if (blocking.length > 0) {
      throw new Error(
        `${row.label} still holds records (${blocking
          .map((b) => `${b.table}: ${b.count}`)
          .join(", ")}). Clear that scope first — a restore never writes over records that are already there.`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: { table: string; attempted: number; inserted: number; error?: string }[] = [];
    for (const entry of planned) {
      const rows = entry.rows.map((r) => ("user_id" in r ? { ...r, user_id: userId } : r));
      let inserted = 0;
      let failure: string | undefined;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error: insertError } = await (supabaseAdmin as Client).from(entry.table).insert(chunk);
        if (insertError) {
          failure = insertError.message;
          break;
        }
        inserted += chunk.length;
      }
      results.push({ table: entry.table, attempted: rows.length, inserted, error: failure });
    }

    const ok = results.every((r) => !r.error);
    await supabase
      .from("data_clean_backups")
      .update({
        restored_at: new Date().toISOString(),
        restored_by: userId,
        restore_report: { ok, results },
      })
      .eq("id", data.id)
      .eq("user_id", userId);

    return { ok, dry_run: false as const, label: String(row.label), results, blocking: [] as typeof blocking };
  });
