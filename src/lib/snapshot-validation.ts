// Pure validator for snapshots produced by `exportApplicationData`. Runs in the
// browser against the downloaded JSON so the admin can confirm the snapshot
// will import cleanly into a fresh self-hosted instance.
//
// The DB schema does not declare foreign keys (everything is application-level),
// so this module encodes the logical schema: which columns must be present and
// which columns must reference an id in another exported table.

import type { Snapshot, SnapshotTable } from "@/lib/admin.functions";

type FkRule = { column: string; refTable: string; nullable: boolean };

type TableRules = {
  /** Columns that must be present on every row and non-null/non-empty. */
  required: string[];
  /** Application-level foreign keys to validate. */
  fks: FkRule[];
};

// Logical schema derived from information_schema (NOT NULL columns) and from
// how the app uses cross-table id references. `user_id` is intentionally
// excluded from `required` checks because the import target may rewrite it,
// but it is reported separately if missing.
const SCHEMA: Record<string, TableRules> = {
  activity_log: {
    required: ["id", "user_id", "entry_type", "raw_content", "created_at"],
    fks: [
      { column: "task_id", refTable: "tasks", nullable: true },
      { column: "daily_note_id", refTable: "daily_notes", nullable: true },
    ],
  },
  summaries: {
    required: [
      "id",
      "user_id",
      "mode",
      "period_start",
      "period_end",
      "generated_summary",
      "status",
    ],
    fks: [{ column: "scope_task_id", refTable: "tasks", nullable: true }],
  },
  daily_notes: {
    required: ["id", "user_id", "date", "markdown_content"],
    fks: [],
  },
  tasks: {
    required: [
      "id",
      "user_id",
      "slug",
      "title",
      "status",
      "project_tags",
      "percent_complete",
      "recurrence",
    ],
    fks: [],
  },
  projects: {
    required: ["id", "user_id", "slug", "name"],
    fks: [],
  },
  maintenance_records: {
    required: ["id", "user_id", "raw", "consumables_used"],
    fks: [{ column: "asset_id", refTable: "inventory_items", nullable: true }],
  },
  consumables: {
    required: ["id", "user_id", "name", "quantity_in_stock", "min_quantity", "raw"],
    fks: [],
  },
  inventory_items: {
    required: ["id", "user_id", "raw", "status", "tags", "current_hours", "current_miles", "usage_tracking"],
    fks: [],
  },
  crop_harvests: {
    required: ["id", "user_id", "harvested_on", "quantity", "unit", "raw"],
    fks: [{ column: "planting_id", refTable: "crop_plantings", nullable: true }],
  },
  crop_plantings: {
    required: ["id", "user_id", "crop", "status", "raw"],
    fks: [],
  },
  garden_plots: {
    required: ["id", "user_id", "row_label", "position"],
    fks: [],
  },
  orchard_trees: {
    required: ["id", "user_id", "species", "quantity", "status"],
    fks: [],
  },
  livestock_animals: {
    required: ["id", "user_id", "species", "quantity", "purpose", "yield_unit", "status"],
    fks: [],
  },
  plant_seasons: {
    required: ["id", "user_id", "name", "kind", "season", "lead", "notes", "sort_order"],
    fks: [],
  },
  food_storage_items: {
    required: ["id", "user_id", "name", "quantity", "unit", "status"],
    fks: [],
  },
  food_storage_plan: {
    required: ["id", "user_id", "name", "pounds_per_year", "target_months", "sort_order"],
    fks: [],
  },
  food_plan_entries: {
    required: ["id", "user_id", "person_id", "food_id", "day_of_week", "quantity"],
    fks: [
      { column: "person_id", refTable: "food_plan_people", nullable: false },
      { column: "food_id", refTable: "food_plan_foods", nullable: false },
    ],
  },
  food_plan_foods: {
    required: ["id", "user_id", "name", "category", "freeze_dry", "sort_order"],
    fks: [],
  },
  food_plan_people: {
    required: ["id", "user_id", "name", "sort_order"],
    fks: [],
  },
  food_price_history: {
    required: ["id", "user_id", "food_name", "changed_at"],
    fks: [{ column: "food_id", refTable: "food_plan_foods", nullable: true }],
  },
};

export type SnapshotIssue = {
  table: string;
  severity: "error" | "warning";
  kind:
    | "missing_required"
    | "broken_fk"
    | "duplicate_id"
    | "export_error"
    | "missing_user_id"
    | "unknown_table";
  message: string;
  rowId?: string | null;
};

export type SnapshotValidation = {
  ok: boolean;
  totalRows: number;
  errors: number;
  warnings: number;
  issues: SnapshotIssue[];
  /** Per-table summary so the UI can render a clean status list. */
  byTable: Record<string, { rows: number; errors: number; warnings: number }>;
};

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v === "") return true;
  if (Array.isArray(v) && v.length === 0) return false; // empty arrays are valid
  return false;
}

export function validateSnapshot(snapshot: Snapshot): SnapshotValidation {
  const issues: SnapshotIssue[] = [];
  const byTable: SnapshotValidation["byTable"] = {};
  let totalRows = 0;

  // Pre-index every table's ids so FK checks are O(1).
  const idIndex = new Map<string, Set<string>>();
  for (const t of snapshot.tables) {
    const ids = new Set<string>();
    for (const row of t.rows) {
      const id = (row as Record<string, unknown>).id;
      if (typeof id === "string") ids.add(id);
    }
    idIndex.set(t.table, ids);
  }

  for (const t of snapshot.tables as SnapshotTable[]) {
    const rules = SCHEMA[t.table];
    const summary = { rows: t.rows.length, errors: 0, warnings: 0 };
    byTable[t.table] = summary;
    totalRows += t.rows.length;

    const push = (issue: SnapshotIssue) => {
      issues.push(issue);
      if (issue.severity === "error") summary.errors++;
      else summary.warnings++;
    };

    if (t.error) {
      push({
        table: t.table,
        severity: "error",
        kind: "export_error",
        message: `Export failed: ${t.error}`,
      });
      continue;
    }

    if (!rules) {
      push({
        table: t.table,
        severity: "warning",
        kind: "unknown_table",
        message: "Table is not in the known import schema — skipping field/FK checks.",
      });
      continue;
    }

    // Duplicate id detection within the table.
    const seenIds = new Set<string>();
    for (const row of t.rows) {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      if (id) {
        if (seenIds.has(id)) {
          push({
            table: t.table,
            severity: "error",
            kind: "duplicate_id",
            message: `Duplicate id ${id}`,
            rowId: id,
          });
        } else {
          seenIds.add(id);
        }
      }

      // Required fields.
      for (const col of rules.required) {
        if (isEmpty(r[col])) {
          push({
            table: t.table,
            severity: "error",
            kind: "missing_required",
            message: `Row is missing required field "${col}"`,
            rowId: id,
          });
        }
      }

      // user_id is reported separately — import targets may rewrite it, but
      // a snapshot without one cannot be assigned to anyone.
      if (isEmpty(r.user_id)) {
        push({
          table: t.table,
          severity: "error",
          kind: "missing_user_id",
          message: "Row has no user_id — cannot be reassigned on import",
          rowId: id,
        });
      }

      // Foreign keys.
      for (const fk of rules.fks) {
        const val = r[fk.column];
        if (val === null || val === undefined || val === "") {
          if (!fk.nullable) {
            push({
              table: t.table,
              severity: "error",
              kind: "missing_required",
              message: `Required reference "${fk.column}" is empty (expected id in ${fk.refTable})`,
              rowId: id,
            });
          }
          continue;
        }
        const refIds = idIndex.get(fk.refTable);
        if (!refIds || !refIds.has(String(val))) {
          push({
            table: t.table,
            severity: "error",
            kind: "broken_fk",
            message: `"${fk.column}" = ${val} does not match any id in ${fk.refTable}`,
            rowId: id,
          });
        }
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, totalRows, errors, warnings, issues, byTable };
}
