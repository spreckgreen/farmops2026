// Scoped data cleaning for FarmOps O/S.
//
// A shipping build has to be able to hand a clean instance to a new customer,
// and an existing customer has to be able to wipe one module, one location, or
// a whole site without touching anything else. Every clear takes a backup of
// exactly what it removed, and every backup restores through the same scope
// definition, so the two operations are always mirror images.
//
// Rules kept deliberately conservative:
//   * Accounts, roles, profiles, subscriptions, entitlements and the secrets
//     vault are NEVER part of a clear.
//   * A row is only cleared when this file can prove it is in scope. Rows that
//     cannot be tied to a location are withheld and reported, never guessed.
//   * A restore refuses to run unless the scope it targets is empty.

export type ScopeKind = "WHOLE_SITE" | "MODULE" | "LOCATION";

export type LocationColumn = "building" | "location";

export interface TableSpec {
  table: string;
  /** Column carrying the owning user. */
  owner: "user_id" | "created_by";
  /** Text column naming the building/location this row sits in, when it has one. */
  locationColumn?: LocationColumn;
  /** Rows owned through a parent row rather than their own owner column. */
  parent?: { table: string; column: string };
  /** Shown when the table has to be withheld from a location-scoped clear. */
  note?: string;
}

export interface ModuleSpec {
  key: string;
  label: string;
  description: string;
  /** Paid module in the FarmOps O/S line-up; procedures and core are free. */
  paid: boolean;
  /** Delete order — children before parents. Restore uses the reverse. */
  tables: TableSpec[];
}

/**
 * Module registry. `tables` is in delete order (children first), so restore
 * simply walks it backwards and parents land before their children.
 */
export const CLEANING_MODULES: ModuleSpec[] = [
  {
    key: "core",
    label: "Work records",
    description: "Tasks, projects, daily notes, reports and the activity trail.",
    paid: false,
    tables: [
      { table: "activity_log", owner: "user_id" },
      { table: "summaries", owner: "user_id" },
      { table: "daily_notes", owner: "user_id" },
      { table: "tasks", owner: "user_id" },
      { table: "project_design_elements", owner: "user_id" },
      { table: "projects", owner: "user_id" },
    ],
  },
  {
    key: "procedures",
    label: "Procedures",
    description: "Written procedures and the things they are linked to.",
    paid: false,
    tables: [
      { table: "procedure_links", owner: "user_id" },
      { table: "procedures", owner: "user_id" },
    ],
  },
  {
    key: "maintenance",
    label: "Maintenance",
    description: "Maintenance records and equipment usage readings.",
    paid: true,
    tables: [
      { table: "asset_usage_snapshots", owner: "user_id" },
      { table: "maintenance_records", owner: "user_id" },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Stocked items, consumables, kits and import snapshots.",
    paid: true,
    tables: [
      { table: "kit_deployment_lines", owner: "user_id" },
      { table: "kit_deployments", owner: "user_id" },
      { table: "inventory_components", owner: "user_id" },
      { table: "inventory_import_snapshots", owner: "user_id" },
      { table: "inventory_items", owner: "user_id", locationColumn: "location" },
      { table: "consumables", owner: "user_id" },
    ],
  },
  {
    key: "growing",
    label: "Growing and livestock",
    description: "Plantings, harvests, plots, trees, seasons and animals.",
    paid: false,
    tables: [
      { table: "crop_harvests", owner: "user_id" },
      { table: "crop_plantings", owner: "user_id" },
      { table: "garden_plots", owner: "user_id" },
      { table: "orchard_trees", owner: "user_id", locationColumn: "location" },
      { table: "plant_seasons", owner: "user_id" },
      { table: "livestock_animals", owner: "user_id", locationColumn: "location" },
    ],
  },
  {
    key: "food",
    label: "Food planning and storage",
    description: "Food plans, people, prices and stored food.",
    paid: false,
    tables: [
      { table: "food_plan_entries", owner: "user_id" },
      { table: "food_price_history", owner: "user_id" },
      { table: "food_plan_foods", owner: "user_id" },
      { table: "food_plan_people", owner: "user_id" },
      { table: "food_storage_items", owner: "user_id", locationColumn: "location" },
      { table: "food_storage_plan", owner: "user_id" },
    ],
  },
  {
    key: "security",
    label: "Security cameras",
    description: "Cameras and their status history.",
    paid: true,
    tables: [
      { table: "camera_status_checks", owner: "user_id" },
      { table: "cameras", owner: "user_id", locationColumn: "building" },
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    description:
      "Panels, circuits, loads, raceways, switches, controls, field observations and audit batches.",
    paid: true,
    tables: [
      { table: "electrical_change_audit", owner: "user_id" },
      { table: "electrical_field_observations", owner: "user_id" },
      {
        table: "electrical_audit_batch_items",
        owner: "created_by",
        parent: { table: "electrical_audit_batches", column: "batch_uuid" },
        note: "Audit batch items follow their batch.",
      },
      { table: "electrical_audit_batches", owner: "created_by", locationColumn: "building" },
      { table: "electrical_control_wiring_segments", owner: "user_id" },
      { table: "electrical_control_targets", owner: "user_id" },
      { table: "electrical_control_groups", owner: "user_id", locationColumn: "building" },
      { table: "electrical_switch_devices", owner: "user_id" },
      { table: "electrical_switch_banks", owner: "user_id", locationColumn: "building" },
      { table: "electrical_breaker_positions", owner: "user_id" },
      { table: "electrical_branch_runs", owner: "user_id" },
      { table: "electrical_raceway_waypoints", owner: "user_id" },
      { table: "electrical_raceways", owner: "user_id" },
      { table: "electrical_junction_boxes", owner: "user_id", locationColumn: "building" },
      { table: "electrical_panel_exits", owner: "user_id" },
      { table: "electrical_post_grid_overrides", owner: "user_id" },
      { table: "electrical_labels", owner: "user_id" },
      { table: "electrical_loads", owner: "user_id", locationColumn: "location" },
      { table: "electrical_circuit_groups", owner: "user_id" },
      { table: "electrical_devices", owner: "user_id", locationColumn: "building" },
      { table: "electrical_power_assets", owner: "user_id", locationColumn: "building" },
      { table: "electrical_racks", owner: "user_id", locationColumn: "building" },
      { table: "electrical_feeders", owner: "user_id" },
      { table: "electrical_service_panels", owner: "user_id" },
      { table: "electrical_service_configurations", owner: "user_id" },
      { table: "electrical_services", owner: "user_id", locationColumn: "building" },
      { table: "electrical_intertie_configurations", owner: "user_id" },
      { table: "electrical_interties", owner: "user_id" },
      { table: "electrical_panels", owner: "user_id", locationColumn: "building" },
    ],
  },
  {
    key: "site",
    label: "Site and building grids",
    description: "The site itself plus every building outline and location grid on it.",
    paid: false,
    tables: [
      { table: "site_buildings", owner: "user_id" },
      { table: "site_plans", owner: "user_id" },
    ],
  },
];

/** Tables that are never cleared, whatever scope is chosen. */
export const NEVER_CLEARED = [
  "profiles",
  "user_roles",
  "app_subscriptions",
  "app_entitlements",
  "app_addons",
  "vault_secrets",
  "vault_key_wrap_credentials",
  "vault_key_export_audit",
  "data_clean_backups",
] as const;

export function moduleByKey(key: string): ModuleSpec | null {
  return CLEANING_MODULES.find((m) => m.key === key) ?? null;
}

/** The site module only makes sense in a whole-site clear. */
export function modulesForScope(scope: ScopeKind): ModuleSpec[] {
  if (scope === "WHOLE_SITE") return CLEANING_MODULES;
  return CLEANING_MODULES.filter((m) => m.key !== "site");
}

export function normalizeLocation(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

export interface ScopeDefinition {
  kind: ScopeKind;
  /** null means "every module in scope". */
  moduleKey: string | null;
  siteName: string;
  /** Building/location names that belong to the selected site. */
  siteLocations: string[];
  /** Set for LOCATION scope: the one location being cleared. */
  locationLabel: string | null;
  /**
   * True when the signed-in owner has exactly one site, which is the only case
   * where rows that carry no location can be attributed to that site.
   */
  singleSite: boolean;
}

export type RowDecision =
  | { inScope: true; reason: "LOCATION_MATCH" | "SITE_MATCH" | "UNLOCATED_SINGLE_SITE" | "PARENT_IN_SCOPE" }
  | { inScope: false; reason: "OTHER_LOCATION" | "UNLOCATED_MULTI_SITE" | "NO_LOCATION_COLUMN" | "PARENT_OUT_OF_SCOPE" };

/**
 * Decide whether one row is inside the scope. Nothing is inferred: a row with
 * no location on a site that has siblings is left alone and reported.
 */
export function decideRow(
  row: Record<string, unknown>,
  spec: TableSpec,
  scope: ScopeDefinition,
  parentIdsInScope?: Set<string>,
): RowDecision {
  if (spec.parent) {
    const parentId = String(row[spec.parent.column] ?? "");
    return parentIdsInScope?.has(parentId)
      ? { inScope: true, reason: "PARENT_IN_SCOPE" }
      : { inScope: false, reason: "PARENT_OUT_OF_SCOPE" };
  }

  if (!spec.locationColumn) {
    if (scope.kind === "LOCATION") return { inScope: false, reason: "NO_LOCATION_COLUMN" };
    if (scope.singleSite) return { inScope: true, reason: "UNLOCATED_SINGLE_SITE" };
    return { inScope: false, reason: "UNLOCATED_MULTI_SITE" };
  }

  const value = normalizeLocation(row[spec.locationColumn]);
  if (value === "") {
    if (scope.kind === "LOCATION") return { inScope: false, reason: "NO_LOCATION_COLUMN" };
    if (scope.singleSite) return { inScope: true, reason: "UNLOCATED_SINGLE_SITE" };
    return { inScope: false, reason: "UNLOCATED_MULTI_SITE" };
  }

  if (scope.kind === "LOCATION") {
    return normalizeLocation(scope.locationLabel) === value
      ? { inScope: true, reason: "LOCATION_MATCH" }
      : { inScope: false, reason: "OTHER_LOCATION" };
  }

  const siteMatch = scope.siteLocations.some((name) => normalizeLocation(name) === value);
  if (siteMatch) return { inScope: true, reason: "SITE_MATCH" };
  if (scope.singleSite) return { inScope: true, reason: "UNLOCATED_SINGLE_SITE" };
  return { inScope: false, reason: "OTHER_LOCATION" };
}

export interface TablePlan {
  table: string;
  module: string;
  /** Rows this clear would remove. */
  ids: string[];
  count: number;
  /** Rows deliberately left alone, with the reason. */
  withheld: number;
  withheldReason?: RowDecision["reason"];
}

export interface ScopePlan {
  scope: ScopeDefinition;
  label: string;
  tables: TablePlan[];
  totalRows: number;
  withheldNotes: string[];
}

export function scopeLabel(scope: ScopeDefinition): string {
  const module = scope.moduleKey ? moduleByKey(scope.moduleKey)?.label ?? scope.moduleKey : "All modules";
  if (scope.kind === "LOCATION") return `${scope.siteName} · ${scope.locationLabel} · ${module}`;
  if (scope.kind === "MODULE") return `${scope.siteName} · ${module}`;
  return `${scope.siteName} · entire site`;
}

export function withheldNote(spec: TableSpec, reason: RowDecision["reason"], count: number): string {
  const rows = `${count} ${count === 1 ? "record" : "records"}`;
  switch (reason) {
    case "NO_LOCATION_COLUMN":
      return `${spec.table}: ${rows} left alone because they do not name a location — clear these with a module or whole-site clear instead.`;
    case "UNLOCATED_MULTI_SITE":
      return `${spec.table}: ${rows} left alone because they name no location and more than one site exists, so they cannot be tied to this site.`;
    case "OTHER_LOCATION":
      return `${spec.table}: ${rows} left alone because they belong to another location.`;
    case "PARENT_OUT_OF_SCOPE":
      return `${spec.table}: ${rows} left alone because the record they belong to is outside this scope.`;
    default:
      return `${spec.table}: ${rows} left alone.`;
  }
}

/** Tables in restore order — parents before children. */
export function restoreOrder(moduleKeys: string[]): TableSpec[] {
  const specs: TableSpec[] = [];
  for (const key of moduleKeys) {
    const module = moduleByKey(key);
    if (!module) continue;
    specs.push(...[...module.tables].reverse());
  }
  return specs;
}

/** Tables in clear order — children before parents. */
export function clearOrder(moduleKeys: string[]): { module: string; spec: TableSpec }[] {
  const out: { module: string; spec: TableSpec }[] = [];
  for (const key of moduleKeys) {
    const module = moduleByKey(key);
    if (!module) continue;
    for (const spec of module.tables) out.push({ module: module.key, spec });
  }
  return out;
}

export function moduleKeysForScope(scope: ScopeDefinition): string[] {
  if (scope.moduleKey) return [scope.moduleKey];
  return modulesForScope(scope.kind).map((m) => m.key);
}
