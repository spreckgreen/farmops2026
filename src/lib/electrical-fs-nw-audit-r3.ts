// FA-FS-2026-09-03-PM-R3 — metadata reconciliation for the 20 loads audited in
// FA-FS-2026-09-03-PM-R2.
//
// R2 is preserved byte-for-byte: it stays exactly as imported and applied, and
// nothing here rewrites, compensates or supersedes it. R2 staged the audited
// breaker-to-load relationship only, so the deterministic metadata consequences
// of those same physically traced installations are still outstanding. R3
// stages, per load and in ONE item each:
//   * the approved circuit-group relationship (idempotent — already applied
//     loads become no-change on preview);
//   * planned → complete directly, because the audit physically traced the
//     connection to an installed breaker/circuit group (no artificial
//     material-ready or installation steps), advancing to as-built verified
//     where location evidence was also accepted;
//   * NOT the dedicated/shared classification: that column is outside this
//     batch's evidence-supported scope, so a general metadata reconciliation
//     never overwrites it (a dedicated circuit needs explicit evidence that it
//     supplies only the identified equipment);
//   * building context from the authoritative group → panel chain;
//   * any grid cell / perimeter post the audit EXPLICITLY observed.
//
// Grid and post values are never invented: unless an explicit observation is
// supplied for a load, its location stays a visible gap and is reconciled on
// its own evidence.
import {
  AUDIT_BATCH_SCHEMA_VERSION,
  type AuditBatchItemInput,
  type AuditBatchManifest,
  type PoleObservation,
} from "@/lib/electrical-audit-batch";
import {
  stageAsBuiltLoadObservation,
  type AsBuiltStaging,
} from "@/lib/electrical-audit-as-built";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDITED_LOADS,
  FS_NW_AUDIT_R2_BATCH_ID,
  FS_NW_PANEL_ID,
  type AuditedBreaker,
  type ResolvedAuditedGroup,
} from "@/lib/electrical-fs-nw-audit-r1";

export const FS_NW_AUDIT_R3_BATCH_ID = "FA-FS-2026-09-03-PM-R3-METADATA";
export const FS_NW_AUDIT_R3_RECONCILES = FS_NW_AUDIT_R2_BATCH_ID;

/** Explicitly observed location per load, keyed by load stable ID. Empty by default. */
export interface ObservedLoadLocation {
  grid_reference?: string | null;
  pole?: PoleObservation | null;
}

export interface R3BuildInput {
  /** Approved circuit groups, resolved from the applied breaker positions. */
  groups: readonly ResolvedAuditedGroup[];
  /** Load stable IDs that exist in FarmOps today. */
  knownLoadIds: readonly string[];
  /**
   * Building context resolved from the authoritative panel relationship. Omit to
   * leave building as an explicit gap; never pass a value derived from an ID.
   */
  buildingFromPanel?: string | null;
  /** Explicit field-observed locations, keyed by load stable ID (FS-044). */
  observedLocations?: Record<string, ObservedLoadLocation>;
  observedDate?: string;
}

export interface R3BuildResult {
  manifest: AuditBatchManifest;
  staged: AsBuiltStaging[];
  /** Loads staged with the full consequence set. */
  reconciled: string[];
  /** Audited breakers with no approved circuit group yet — withheld, never guessed. */
  groupsNotApproved: string[];
  /** Audited loads with no FarmOps record — withheld, never created. */
  loadsNotFound: string[];
  sharedCircuitLoads: string[];
  dedicatedCircuitLoads: string[];
  /** Loads whose connection AND location evidence were accepted (as-built verified). */
  verifiedLoads: string[];
  /** Loads advanced straight to complete without location evidence. */
  completeLoads: string[];
  gapCount: number;
}

export const r3ItemKey = (loadId: string) =>
  `fs-nw-r3-${loadId.trim().toLowerCase()}-as-built`;

function groupNotApprovedHold(
  b: AuditedBreaker,
  loadIds: readonly string[],
): AuditBatchItemInput {
  return {
    item_key: `fs-nw-r3-b${b.breaker_number}-group-not-approved`,
    entity_kind: "circuit_group",
    target_stable_id: null,
    observation_class: "HOLD_UNRESOLVED",
    operation: "HOLD_UNRESOLVED",
    fields: {},
    install_state: null,
    pole: null,
    field_grid_reference: null,
    refs: { panel_ref: FS_NW_PANEL_ID },
    observed_label: b.circuit_group_label,
    evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — ${b.breaker_reference} ("${b.circuit_group_label}") feeds ${loadIds.join(", ")}.`,
    notes: `Held because no approved circuit group was found for ${b.breaker_reference}, so the metadata consequences of its audited loads cannot be reconciled yet.`,
    reason: `No approved circuit group for ${b.breaker_reference}; ${loadIds.length} load reconciliation(s) withheld.`,
    ods_field: null,
    ods_candidate_value: null,
  };
}

function loadNotFoundHold(b: AuditedBreaker, loadId: string): AuditBatchItemInput {
  return {
    item_key: `fs-nw-r3-${loadId.toLowerCase()}-not-found`,
    entity_kind: "load",
    target_stable_id: null,
    observation_class: "HOLD_UNRESOLVED",
    operation: "HOLD_UNRESOLVED",
    fields: {},
    install_state: null,
    pole: null,
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — ${loadId} was observed on ${b.breaker_reference}.`,
    notes: `Held because ${loadId} has no FarmOps load record in this instance. A field audit never creates a load record.`,
    reason: `No load record ${loadId} found; metadata reconciliation withheld.`,
    ods_field: null,
    ods_candidate_value: null,
  };
}

/**
 * Build FA-FS-2026-09-03-PM-R3. Deterministic: identical input always yields
 * byte-identical JSON, so the manifest fingerprint recorded at import is stable.
 */
export function buildFsNwAuditManifestR3(input: R3BuildInput): R3BuildResult {
  const groupByBreaker = new Map(
    input.groups.map((g) => [g.breaker_reference.toUpperCase(), g.circuit_group_id]),
  );
  const known = new Set(input.knownLoadIds.map((v) => v.trim().toUpperCase()));
  const observed = Object.fromEntries(
    Object.entries(input.observedLocations ?? {}).map(([k, v]) => [k.trim().toUpperCase(), v]),
  );

  const items: AuditBatchItemInput[] = [];
  const staged: AsBuiltStaging[] = [];
  const reconciled: string[] = [];
  const groupsNotApproved: string[] = [];
  const loadsNotFound: string[] = [];
  const sharedCircuitLoads: string[] = [];
  const dedicatedCircuitLoads: string[] = [];
  const verifiedLoads: string[] = [];
  const completeLoads: string[] = [];
  let gapCount = 0;

  for (const b of FS_NW_AUDITED_BREAKERS) {
    const ids = (FS_NW_AUDITED_LOADS[b.breaker_reference] ?? [])
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
    if (!ids.length) continue;

    const groupId = groupByBreaker.get(b.breaker_reference.toUpperCase()) ?? null;
    if (!groupId) {
      groupsNotApproved.push(b.breaker_reference);
      items.push(groupNotApprovedHold(b, ids));
      continue;
    }

    for (const id of ids) {
      if (!known.has(id)) {
        loadsNotFound.push(id);
        items.push(loadNotFoundHold(b, id));
        continue;
      }
      const loc = observed[id] ?? {};
      const stage = stageAsBuiltLoadObservation({
        item_key: r3ItemKey(id),
        load_id: id,
        circuit_group_ref: groupId,
        breaker_reference: b.breaker_reference,
        circuit_group_label: b.circuit_group_label,
        group_load_ids: ids,
        building_from_relationship: input.buildingFromPanel ?? null,
        physically_installed: true,
        // Out of scope: this reconciliation carries no evidence about what else
        // each branch circuit supplies, so the classification is left alone.
        sharing_classification_in_scope: false,
        observed_grid_reference: loc.grid_reference ?? null,
        observed_pole: loc.pole ?? null,
        evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — ${id} physically traced to the circuit on ${b.breaker_reference} ("${b.circuit_group_label}"), recorded as ${groupId}. Metadata reconciliation of the relationship-only links applied in ${FS_NW_AUDIT_R3_RECONCILES}.`,
      });
      staged.push(stage);
      items.push(stage.item);
      reconciled.push(id);
      gapCount += stage.gaps.length;
      if (stage.as_built_verified) verifiedLoads.push(id);
      else if (stage.install_state === "installed") completeLoads.push(id);
      if (stage.sharing === "S") sharedCircuitLoads.push(id);
      else if (stage.sharing === "D") dedicatedCircuitLoads.push(id);
    }
  }

  const scope =
    `Reconciles the metadata consequences of the ${reconciled.length} physically traced load(s) whose ` +
    `relationship-only links were applied in ${FS_NW_AUDIT_R3_RECONCILES} (preserved unchanged). Each item stages the ` +
    `circuit-group relationship, the complete/as-built-verified state and building context from the panel chain in one ` +
    `transaction. Dedicated/shared classification is out of scope and untouched` +
    (groupsNotApproved.length
      ? `. ${groupsNotApproved.length} breaker(s) without an approved group held`
      : "") +
    (loadsNotFound.length ? `. ${loadsNotFound.length} load(s) not found (held)` : "") +
    `. Grid and post values are staged only where explicitly observed.`;

  const manifest: AuditBatchManifest = {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: FS_NW_AUDIT_R3_BATCH_ID,
    title: "Farm Shop PNL-FS-NW as-built metadata reconciliation — 03 Sep 2026 PM (R3-METADATA)",
    scope: scope.length > 400 ? `${scope.slice(0, 397)}...` : scope,
    building: "Farm Shop",
    observed_date: input.observedDate ?? "2026-09-03",
    observed_time_precision: "afternoon",
    timezone: "America/New_York",
    source: `metadata-reconciliation-of:${FS_NW_AUDIT_R3_RECONCILES}`,
    evidence: [
      {
        name: "PNL-FS-NW panel schedule photo set",
        label: "03 Sep 2026 PM",
        subject: "PNL-FS-NW breakers 29–40 load tracing",
      },
    ],
    // Not a compensating batch: R2 stays applied and correct as far as it went.
    compensates_batch_id: null,
    items: items.length
      ? items
      : [groupNotApprovedHold(FS_NW_AUDITED_BREAKERS[0], ["(none resolved)"])],
  };

  return {
    manifest,
    staged,
    reconciled,
    groupsNotApproved,
    loadsNotFound,
    sharedCircuitLoads,
    dedicatedCircuitLoads,
    verifiedLoads,
    completeLoads,
    gapCount,
  };
}

export function fsNwAuditManifestR3Text(input: R3BuildInput): string {
  return JSON.stringify(buildFsNwAuditManifestR3(input).manifest, null, 2);
}
