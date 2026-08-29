// Relationship (foreign-key) rules for the electrical records.
//
// Phase 4.1 makes the FK the authoritative link between two electrical records
// and keeps the legacy free-text `*_endpoint_ref` / `*_ref` columns as derived
// mirrors so the canonical ODS import/export contract keeps working.
//
// Pure and deterministic: no database access, so every rule below is unit
// testable.
import type { ElectricalEntityKind, EndpointType } from "@/lib/electrical";

/** One FK column and the legacy text column it keeps in sync. */
export interface RelationSpec {
  /** FK column holding the target row UUID. */
  fkColumn: string;
  /** Which entity the FK points at. */
  targetKind: ElectricalEntityKind;
  /** Endpoint slot this relation fills, when the entity has endpoints. */
  slot?: "source" | "dest";
  /** Endpoint type written when this FK is set. */
  endpointType?: EndpointType;
  /** Legacy text column mirrored from the target's stable ID. */
  refColumn: string;
  /** Endpoint-type column mirrored from `endpointType`, when applicable. */
  typeColumn?: string;
}

export const RELATIONS: Record<ElectricalEntityKind, RelationSpec[]> = {
  panel: [],
  jbox: [],
  raceway: [
    {
      fkColumn: "source_panel_uuid",
      targetKind: "panel",
      slot: "source",
      endpointType: "panel",
      refColumn: "source_endpoint_ref",
      typeColumn: "source_endpoint_type",
    },
    {
      fkColumn: "source_jbox_uuid",
      targetKind: "jbox",
      slot: "source",
      endpointType: "junction_box",
      refColumn: "source_endpoint_ref",
      typeColumn: "source_endpoint_type",
    },
    {
      fkColumn: "dest_panel_uuid",
      targetKind: "panel",
      slot: "dest",
      endpointType: "panel",
      refColumn: "dest_endpoint_ref",
      typeColumn: "dest_endpoint_type",
    },
    {
      fkColumn: "dest_jbox_uuid",
      targetKind: "jbox",
      slot: "dest",
      endpointType: "junction_box",
      refColumn: "dest_endpoint_ref",
      typeColumn: "dest_endpoint_type",
    },
  ],
  branch: [
    {
      fkColumn: "source_panel_uuid",
      targetKind: "panel",
      slot: "source",
      endpointType: "panel",
      refColumn: "source_endpoint_ref",
      typeColumn: "source_endpoint_type",
    },
    {
      fkColumn: "source_jbox_uuid",
      targetKind: "jbox",
      slot: "source",
      endpointType: "junction_box",
      refColumn: "source_endpoint_ref",
      typeColumn: "source_endpoint_type",
    },
    {
      fkColumn: "load_uuid",
      targetKind: "load",
      slot: "dest",
      endpointType: "load",
      refColumn: "dest_endpoint_ref",
      typeColumn: "dest_endpoint_type",
    },
  ],
  load: [{ fkColumn: "circuit_group_uuid", targetKind: "circuit_group", refColumn: "circuit_group_ref" }],
  circuit_group: [{ fkColumn: "panel_uuid", targetKind: "panel", refColumn: "suggested_panel" }],
};

export function relationsFor(kind: ElectricalEntityKind): RelationSpec[] {
  return RELATIONS[kind] ?? [];
}

export interface RelationTarget {
  id: string;
  kind: ElectricalEntityKind;
  stableId: string;
}

export interface RelationApplyResult {
  /** Derived columns to merge into the row being written. */
  derived: Record<string, string | null>;
  errors: string[];
}

/**
 * Merge FK selections into their derived legacy columns and reject impossible
 * topology (two endpoints in one slot, or a record wired to itself).
 *
 * `merged` is the full post-write row (existing values plus the patch), so the
 * rules see the record as it will actually be stored.
 */
export function applyRelations(
  kind: ElectricalEntityKind,
  merged: Record<string, unknown>,
  targets: Record<string, RelationTarget | null>,
  self?: { id?: string | null; stableId?: string | null },
): RelationApplyResult {
  const derived: Record<string, string | null> = {};
  const errors: string[] = [];
  const specs = relationsFor(kind);

  for (const slot of ["source", "dest"] as const) {
    const filled = specs.filter(
      (s) => s.slot === slot && merged[s.fkColumn] != null && String(merged[s.fkColumn]),
    );
    if (filled.length > 1) {
      errors.push(
        `Pick only one ${slot === "source" ? "source" : "destination"} endpoint — ${filled
          .map((s) => s.fkColumn)
          .join(" and ")} are both set.`,
      );
      continue;
    }
    const spec = filled[0];
    if (!spec) continue;
    const target = targets[spec.fkColumn];
    if (!target) {
      errors.push(`The selected ${spec.targetKind.replace("_", " ")} no longer exists.`);
      continue;
    }
    if (self?.id && target.id === self.id) {
      errors.push("A record cannot be its own endpoint.");
      continue;
    }
    derived[spec.refColumn] = target.stableId;
    if (spec.typeColumn && spec.endpointType) derived[spec.typeColumn] = spec.endpointType;
  }

  // Non-endpoint relations (load -> circuit group, circuit group -> panel).
  for (const spec of specs.filter((s) => !s.slot)) {
    const value = merged[spec.fkColumn];
    if (value == null || !String(value)) continue;
    const target = targets[spec.fkColumn];
    if (!target) {
      errors.push(`The selected ${spec.targetKind.replace("_", " ")} no longer exists.`);
      continue;
    }
    derived[spec.refColumn] = target.stableId;
  }

  const sourceRef = String(derived["source_endpoint_ref"] ?? merged["source_endpoint_ref"] ?? "");
  const destRef = String(derived["dest_endpoint_ref"] ?? merged["dest_endpoint_ref"] ?? "");
  if (sourceRef && destRef && sourceRef === destRef) {
    errors.push(`Source and destination are both ${sourceRef}; a run must connect two endpoints.`);
  }

  return { derived, errors };
}
