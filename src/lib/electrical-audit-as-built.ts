// FARMOPS-ELEC-AS-BUILT-STAGING-V1 — full-consequence staging for a
// FIELD_AS_BUILT load observation.
//
// Accepting a FIELD_AS_BUILT observation of a physically traced load stages,
// in ONE item and therefore in ONE approved transaction:
//   * the approved circuit-group relationship;
//   * the install state consequence (planned → installed/complete) when the
//     observation confirms physical installation;
//   * the sharing classification, from how many loads occupy that same approved
//     group (multiple loads → shared);
//   * building context, taken from the authoritative panel/group relationship;
//   * the explicit grid and pole observations the audit supplied.
//
// Hard boundaries:
//   * RELATIONSHIP_ONLY is an explicit exceptional mode and requires a written
//     reason. It is never the default.
//   * Grid and pole values are staged ONLY when the audit explicitly observed
//     them. They are never derived from a stable-ID prefix (FS-044 → F-row) or
//     from a breaker relationship.
//   * Description, label and notes are never rewritten unless explicitly
//     observed and explicitly supplied.
import {
  AS_BUILT_CONSEQUENCE_FIELDS,
  INSTALL_STATE_TO_FARMOPS,
  POLE_SCHEME,
  parseFieldGrid,
  validatePole,
  type AuditBatchItemInput,
  type AuditInstallState,
  type Json,
  type PoleObservation,
} from "@/lib/electrical-audit-batch";
import { stageCompletionPercent } from "@/lib/electrical-lifecycle";

export const AS_BUILT_STAGING_MODES = ["FULL_AS_BUILT", "RELATIONSHIP_ONLY"] as const;
export type AsBuiltStagingMode = (typeof AS_BUILT_STAGING_MODES)[number];

/** The default is always the complete consequence set. */
export const DEFAULT_AS_BUILT_STAGING_MODE: AsBuiltStagingMode = "FULL_AS_BUILT";

export const RELATIONSHIP_ONLY_IS_EXCEPTIONAL_RULE =
  "Relationship-only staging is an exceptional mode: it must be requested explicitly with a written reason, otherwise a FIELD_AS_BUILT load observation stages every explicitly observed field and every deterministic metadata consequence in the same item and transaction.";

export const NEVER_INFERRED_LOCATION_RULE =
  "Grid and pole values are staged only from an explicit field observation. They are never inferred from a stable-ID prefix or from a breaker relationship.";

export interface AsBuiltLoadObservation {
  /** FarmOps load stable ID, e.g. FS-044. */
  load_id: string;
  /** Approved (or manifest-pending) circuit-group reference for the traced circuit. */
  circuit_group_ref: string;
  /** Derived, display-only breaker reference, e.g. PNL-FS-NW-B37. */
  breaker_reference?: string | null;
  /** Observed circuit label — evidence only, never written to the load. */
  circuit_group_label?: string | null;
  /**
   * Every load occupying the same approved circuit group, including this one.
   * More than one member means the circuit is shared. One member means NOTHING
   * about dedication — see DEDICATED_REQUIRES_EVIDENCE_RULE.
   */
  group_load_ids: readonly string[];
  /**
   * True only when the dedicated/shared column is explicitly inside this
   * batch's evidence-supported scope. A general metadata reconciliation leaves
   * it false, so the existing classification is never overwritten.
   */
  sharing_classification_in_scope?: boolean;
  /** Explicit evidence the circuit supplies only this utilization equipment. */
  dedicated_circuit_evidence?: boolean;
  /** General-use receptacle outlet or grouped receptacle record. */
  general_use_receptacle?: boolean;
  /** The audit could not rule out further loads on the same circuit. */
  additional_loads_unresolved?: boolean;
  /**
   * Building context resolved from the authoritative relationship chain
   * (load → circuit group → panel → building). Omit it when the chain does not
   * resolve; it is never guessed from an ID prefix.
   */
  building_from_relationship?: string | null;
  /** True when the audit physically confirmed the load is installed. */
  physically_installed: boolean;
  /** Grid cell EXPLICITLY observed in the field, e.g. "F9". */
  observed_grid_reference?: string | null;
  /** Perimeter-post location EXPLICITLY observed in the field. */
  observed_pole?: PoleObservation | null;
  /** Description/label/notes text only when the audit explicitly observed it. */
  observed_notes?: string | null;
  evidence: string;
  item_key?: string;
  mode?: AsBuiltStagingMode;
  /** Required when mode is RELATIONSHIP_ONLY. */
  relationship_only_reason?: string | null;
}

export interface AsBuiltStaging {
  item: AuditBatchItemInput;
  mode: AsBuiltStagingMode;
  /** Every column this item would change, for the pre-approval preview. */
  affected_fields: string[];
  /** Deterministic consequences staged alongside the relationship. */
  consequences: { field: string; value: Json; because: string }[];
  /** Consequences that could not be staged, with the reason. */
  gaps: string[];
  errors: string[];
  install_state: AuditInstallState | null;
  /** True when both the audited connection and its location evidence were accepted. */
  as_built_verified: boolean;
  sharing: "D" | "S" | null;
  /**
   * Derived, read-only effective location the shared resolver produces once this
   * observation is accepted. It is recomputed inside the same approved
   * transaction — there is no separate metadata reconciliation step — and no
   * prior location value or evidence is removed.
   */
  effective_location_after: EffectiveLocation | null;
}


export const asBuiltItemKey = (loadId: string) =>
  `as-built-load-${loadId.trim().toLowerCase()}`;

export const DEDICATED_REQUIRES_EVIDENCE_RULE =
  "A dedicated branch circuit is only ever classified from explicit evidence that the circuit supplies nothing but the identified utilization equipment. The number of load rows presently linked to a circuit group is never that evidence: general-use receptacle outlets, grouped receptacle records and circuits with unresolved additional loads stay shared or unresolved.";

/** Evidence a sharing classification may be derived from. */
export interface SharingEvidence {
  /** Every load presently linked to the same approved circuit group. */
  groupLoadIds: readonly string[];
  /**
   * Explicit field evidence that this branch circuit supplies ONLY the
   * identified utilization equipment. Without it a single linked row can never
   * produce a dedicated classification.
   */
  dedicatedCircuitEvidence?: boolean;
  /** General-use receptacle outlet, or a grouped receptacle record. */
  generalUseReceptacle?: boolean;
  /** The audit could not rule out further loads on the same circuit. */
  additionalLoadsUnresolved?: boolean;
}

export interface SharingClassification {
  /** "S" shared, "D" dedicated, null when the evidence leaves it unresolved. */
  value: "D" | "S" | null;
  because: string;
}

/**
 * Classify a branch circuit as shared, dedicated, or unresolved.
 *
 * Shared is derivable from membership; dedicated is NOT. See
 * DEDICATED_REQUIRES_EVIDENCE_RULE.
 */
export function classifyCircuitSharing(
  loadId: string,
  ev: SharingEvidence,
): SharingClassification {
  const members = new Set(
    [loadId, ...ev.groupLoadIds].map((v) => v.trim().toUpperCase()).filter(Boolean),
  );
  if (members.size > 1) {
    return {
      value: "S",
      because: `${members.size} loads occupy the same approved circuit group, so the circuit is shared.`,
    };
  }
  if (ev.generalUseReceptacle) {
    return {
      value: "S",
      because: `${loadId} is a general-use receptacle outlet record, so the circuit is shared regardless of how many load rows are linked today.`,
    };
  }
  if (ev.additionalLoadsUnresolved) {
    return {
      value: null,
      because: `Classification unresolved for ${loadId}: the audit could not rule out further loads on the same branch circuit.`,
    };
  }
  if (ev.dedicatedCircuitEvidence) {
    return {
      value: "D",
      because: `Explicit field evidence records that this branch circuit supplies only ${loadId}, so it is dedicated.`,
    };
  }
  return {
    value: null,
    because: `Classification unresolved for ${loadId}: only one load row is linked to the circuit group, which is never on its own evidence of a dedicated branch circuit.`,
  };
}

/**
 * Shared when more than one load occupies the same approved group; otherwise
 * null (never "D" — dedicated needs explicit evidence).
 */
export function sharingFromGroupMembers(
  loadId: string,
  groupLoadIds: readonly string[],
): "S" | null {
  return classifyCircuitSharing(loadId, { groupLoadIds }).value === "S" ? "S" : null;
}


/**
 * Stage one FIELD_AS_BUILT load observation.
 *
 * FULL_AS_BUILT (default) stages the relationship plus every deterministic
 * consequence and every explicitly observed location value in a single item, so
 * one approval applies them atomically. RELATIONSHIP_ONLY stages nothing but
 * `circuit_group_ref` and must carry a reason.
 */
export function stageAsBuiltLoadObservation(obs: AsBuiltLoadObservation): AsBuiltStaging {
  const loadId = obs.load_id.trim().toUpperCase();
  const groupRef = obs.circuit_group_ref.trim();
  const mode = obs.mode ?? DEFAULT_AS_BUILT_STAGING_MODE;
  const errors: string[] = [];
  const gaps: string[] = [];
  const consequences: AsBuiltStaging["consequences"] = [];
  const fields: Record<string, Json> = { circuit_group_ref: groupRef };

  if (!loadId) errors.push("A load stable ID is required.");
  if (!groupRef) errors.push("An approved circuit-group reference is required.");

  const relationshipReason = (obs.relationship_only_reason ?? "").trim();
  if (mode === "RELATIONSHIP_ONLY" && !relationshipReason) {
    errors.push(
      "RELATIONSHIP_ONLY is an exceptional mode and requires a written reason; the default is full as-built staging.",
    );
  }

  let installState: AuditInstallState | null = null;
  let sharing: "D" | "S" | null = null;
  let pole: (PoleObservation & { pole_scheme: string }) | null = null;
  let grid: string | null = null;

  if (mode === "FULL_AS_BUILT") {
    // 1. Explicit location observations first: whether location evidence was
    //    accepted decides between complete and as-built verified.
    if (obs.observed_grid_reference && obs.observed_grid_reference.trim()) {
      const parsed = parseFieldGrid(obs.observed_grid_reference);
      if (!parsed) {
        errors.push(
          `"${obs.observed_grid_reference}" is not a valid observed grid reference for ${loadId}.`,
        );
      } else {
        grid = parsed.raw;
      }
    } else {
      gaps.push(
        `No grid cell staged for ${loadId}: the audit supplied none, and grid is never inferred from the stable ID or breaker.`,
      );
    }
    if (obs.observed_pole) {
      const poleErrors = validatePole(obs.observed_pole);
      if (poleErrors.length) errors.push(...poleErrors);
      else pole = { ...obs.observed_pole, pole_scheme: POLE_SCHEME };
    } else {
      gaps.push(
        `No perimeter post staged for ${loadId}: the audit supplied none, and post location is never inferred.`,
      );
    }
    const locationEvidence = Boolean(grid || pole);

    // 2. Install-state consequence — only from confirmed physical installation.
    //    A traced connection to an installed breaker/circuit group advances the
    //    load directly to complete; no artificial material-ready or
    //    installation clicks are required. When the audited connection AND its
    //    location evidence are both accepted, the load is as-built verified.
    if (obs.physically_installed) {
      installState = locationEvidence ? "as_built_verified" : "installed";
      consequences.push({
        field: "install_status",
        value: INSTALL_STATE_TO_FARMOPS[installState],
        because: locationEvidence
          ? `Field audit physically traced ${loadId} as connected to ${groupRef} and accepted its location evidence, so it advances directly to ${INSTALL_STATE_TO_FARMOPS.as_built_verified} — the intermediate stages are not required retroactively.`
          : `Field audit physically traced ${loadId} as connected to ${groupRef}, so it advances directly to ${INSTALL_STATE_TO_FARMOPS.installed} without artificial material-ready or installation steps.`,
      });
      const stagePercent =
        stageCompletionPercent(INSTALL_STATE_TO_FARMOPS[installState]) ?? 100;
      fields["completion_percent"] = stagePercent;
      consequences.push({
        field: "completion_percent",
        value: stagePercent,
        because: `Complete % always mirrors the recorded stage; ${INSTALL_STATE_TO_FARMOPS[installState]} is ${stagePercent}%.`,
      });
      if (!locationEvidence) {
        gaps.push(
          `${loadId} is recorded complete but not as-built verified: no location evidence (grid cell or perimeter post) was observed.`,
        );
      }
    } else {
      gaps.push(
        `Install state left unchanged: the observation did not confirm physical installation of ${loadId}.`,
      );
    }

    // 3. Sharing classification — only when the column is explicitly inside
    //    this batch's evidence-supported scope, and only from evidence that can
    //    actually establish it. Dedicated is never inferred from the number of
    //    load rows linked to the group.
    const classified = classifyCircuitSharing(loadId, {
      groupLoadIds: obs.group_load_ids,
      dedicatedCircuitEvidence: obs.dedicated_circuit_evidence ?? false,
      generalUseReceptacle: obs.general_use_receptacle ?? false,
      additionalLoadsUnresolved: obs.additional_loads_unresolved ?? false,
    });
    if (!obs.sharing_classification_in_scope) {
      gaps.push(
        `Dedicated/shared classification left unchanged for ${loadId}: the column is outside this batch's evidence-supported scope, so a metadata reconciliation never overwrites it.`,
      );
    } else if (classified.value === null) {
      gaps.push(classified.because);
    } else {
      sharing = classified.value;
      fields["dedicated_shared"] = sharing;
      fields["dedicated"] = sharing === "D";
      consequences.push({
        field: "dedicated_shared",
        value: sharing,
        because: classified.because,
      });
    }

    // 4. Building context — from the authoritative relationship chain only.
    const building = (obs.building_from_relationship ?? "").trim();
    if (building) {
      fields["location"] = building;
      consequences.push({
        field: "location",
        value: building,
        because: `Building context derived from the authoritative relationship chain ${loadId} → ${groupRef}${obs.breaker_reference ? ` → ${obs.breaker_reference}` : ""} → panel.`,
      });
    } else {
      gaps.push(
        "Building context not staged: the authoritative load → circuit group → panel chain did not resolve a building. It is never taken from a stable-ID prefix.",
      );
    }
  } else {
    gaps.push(
      `Exceptional RELATIONSHIP_ONLY staging: circuit_group_uuid is the only column this item changes. ${relationshipReason}`,
    );
  }

  const notes =
    obs.observed_notes && obs.observed_notes.trim() ? obs.observed_notes.trim() : null;

  const item: AuditBatchItemInput = {
    item_key: obs.item_key ?? asBuiltItemKey(loadId),
    entity_kind: "load",
    target_stable_id: loadId,
    observation_class: "FIELD_AS_BUILT",
    // A full as-built item both links and updates; the server recomputes the
    // operation from the resulting patch.
    operation: mode === "RELATIONSHIP_ONLY" ? "LINK" : "UPDATE",
    fields,
    install_state: installState,
    pole,
    field_grid_reference: grid,
    refs: { circuit_group_ref: groupRef, load_ref: loadId },
    // Labels are never rewritten from an audit: the observed circuit label is
    // evidence about the circuit, not the load's own text.
    observed_label: null,
    evidence: obs.evidence,
    notes,
    reason:
      mode === "RELATIONSHIP_ONLY"
        ? `Relationship-only exception: ${relationshipReason}`
        : null,
    ods_field: null,
    ods_candidate_value: null,
  };

  const affected = new Set<string>(["circuit_group_uuid", ...Object.keys(fields)]);
  if (installState) affected.add("install_status");
  if (grid) {
    affected.add("field_grid_reference");
    affected.add("location_evidence");
  }
  if (pole) {
    affected.add("pole_scheme");
    affected.add("pole_location_kind");
    affected.add("pole_ref_start");
    affected.add("pole_ref_end");
    affected.add("location_evidence");
  }
  if (notes) affected.add("notes");

  return {
    item,
    mode,
    affected_fields: Array.from(affected).sort(),
    consequences,
    gaps,
    errors,
    install_state: installState,
    as_built_verified: installState === "as_built_verified",
    sharing,
  };
}

/** Convenience: the consequence columns a full as-built load item can touch. */
export const AS_BUILT_METADATA_COLUMNS: readonly string[] = [
  "install_status",
  "completion_percent",
  ...AS_BUILT_CONSEQUENCE_FIELDS,
];
