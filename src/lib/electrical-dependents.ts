// Reverse-dependency map for electrical records.
//
// Deleting a record must never silently orphan topology, so before a delete we
// enumerate every other record that points at it. Pure and deterministic: the
// shape below is derived from RELATIONS only, so it is unit testable.
import { ENTITIES } from "@/lib/electrical-entities";
import { RELATIONS } from "@/lib/electrical-relations";
import type { ElectricalEntityKind } from "@/lib/electrical";

/** One incoming FK that references `targetKind`. */
export interface DependentSpec {
  /** Entity kind holding the reference. */
  kind: ElectricalEntityKind;
  /** FK column on that entity. */
  fkColumn: string;
  /** Human label of the FK field, e.g. "Source panel". */
  fieldLabel: string;
  /** Table to query. */
  table: string;
  /** Stable-ID column of the referencing entity. */
  stableIdField: string;
  /**
   * Column used as the human-readable label, or null when the entity has none.
   * Branch runs, for example, have no `description` column — selecting it would
   * make PostgREST reject the whole query and hide the dependency.
   */
  descriptionField: string | null;
}

/** Every FK column across all entities that can point at `target`. */
export function dependentSpecs(target: ElectricalEntityKind): DependentSpec[] {
  const out: DependentSpec[] = [];
  for (const kind of Object.keys(RELATIONS) as ElectricalEntityKind[]) {
    for (const spec of RELATIONS[kind]) {
      if (spec.targetKind !== target) continue;
      const def = ENTITIES[kind];
      const field = def.fields.find((f) => f.key === spec.fkColumn);
      const descriptionField = def.fields.some((f) => f.key === "description")
        ? "description"
        : def.fields.some((f) => f.key === "notes")
          ? "notes"
          : null;
      out.push({
        kind,
        fkColumn: spec.fkColumn,
        fieldLabel: field?.label ?? spec.fkColumn,
        table: def.table,
        stableIdField: def.stableIdField,
        descriptionField,
      });
    }
  }

  return out;
}

/** One referencing record, ready to link to from the UI. */
export interface DependentRow {
  id: string;
  stableId: string;
  description: string | null;
}

/** Dependents grouped by referencing entity + field. */
export interface DependentGroup {
  kind: ElectricalEntityKind;
  /** Title of the referencing entity list, e.g. "Raceways / conduits". */
  title: string;
  fkColumn: string;
  fieldLabel: string;
  rows: DependentRow[];
}

/** Non-FK dependents (child rows deleted through their own screens). */
export interface DependentChildGroup {
  /** Route-friendly name, e.g. "waypoints". */
  title: string;
  count: number;
  hint: string;
}

export interface DependencyReport {
  kind: ElectricalEntityKind;
  total: number;
  groups: DependentGroup[];
  children: DependentChildGroup[];
}

/** One-line summary used in toasts and server error messages. */
export function dependencySummary(report: DependencyReport): string {
  const parts = [
    ...report.groups.map((g) => `${g.rows.length} ${g.title.toLowerCase()} (${g.fieldLabel})`),
    ...report.children.map((c) => `${c.count} ${c.title.toLowerCase()}`),
  ];
  if (!parts.length) return "";
  return parts.join(", ");
}

/** A single field the cleanup flow would write, with before/after values. */
export interface FieldChange {
  column: string;
  before: string | null;
  after: string | null;
}

/** Preview returned by a cleanup dry run — nothing is written. */
export interface CleanupPreview {
  kind: ElectricalEntityKind;
  table: string;
  rowId: string;
  stableId: string;
  action: "unlink" | "reassign";
  changes: FieldChange[];
  /** Columns in the patch whose value already matches (no write needed). */
  unchanged: string[];
}

function display(value: unknown): string | null {
  if (value == null || value === "") return null;
  return typeof value === "string" ? value : String(value);
}

/**
 * Compare a proposed patch against the current row. Deterministic column order
 * so previews and audits are stable.
 */
export function diffFieldChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): { changes: FieldChange[]; unchanged: string[] } {
  const changes: FieldChange[] = [];
  const unchanged: string[] = [];
  for (const column of Object.keys(patch).sort()) {
    const next = display(patch[column]);
    const prev = display(before[column]);
    if (next === prev) unchanged.push(column);
    else changes.push({ column, before: prev, after: next });
  }
  return { changes, unchanged };
}
