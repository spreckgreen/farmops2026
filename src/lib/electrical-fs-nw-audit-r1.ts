// FA-FS-2026-09-03-PM-R1 — revised Farm Shop / PNL-FS-NW breaker audit manifest.
//
// Why this exists: the earlier batch left the seven audited breakers as
// unresolved circuit-group placeholders, so the only way to get rows was
// "Record all slots", which creates BLANK placeholder slots. Blank slots must
// never be mistaken for installed breakers. This manifest establishes the seven
// observed 20A breaker positions as real records, allocates a permanent
// CG-FS-### identity for each audited circuit, and links the position to that
// group through `electrical_breaker_positions.circuit_group_uuid` in the same
// approved transaction.
//
// Authority boundaries kept intact:
//   * Panel identity (PNL-FS-NW) is referenced, never created or renamed.
//   * Circuit-group identity is allocated by FarmOps (AUTO) and is independent
//     of panel, breaker number and tape label. The derived breaker reference
//     PNL-FS-NW-B40 is display-only and never becomes part of the group ID.
//   * Load linkage comes from the observed breaker-to-load relationships in the
//     field audit — direct evidence, not description matching. An incomplete or
//     questionable LOCATION never suppresses a known electrical relationship
//     (e.g. FS-044 has no completed grid reference and FS-076 carries a
//     questionable 14NW location; both keep their audited circuit link and the
//     location is reconciled separately).
//   * The one observation that could not be resolved to a load record stays an
//     explicit HOLD item and is never applied.
//   * The manifest is preview-only input: import stages it, and every item
//     still needs individual owner approval before anything is written.
import {
  AUDIT_BATCH_SCHEMA_VERSION,
  type AuditBatchItemInput,
  type AuditBatchManifest,
} from "@/lib/electrical-audit-batch";
import { breakerReference } from "@/lib/electrical-breaker-reference";

export const FS_NW_AUDIT_R1_BATCH_ID = "FA-FS-2026-09-03-PM-R1";
export const FS_NW_AUDIT_R1_SUPERSEDES = "FA-FS-2026-09-03-PM";
export const FS_NW_PANEL_ID = "PNL-FS-NW";
/** Every audited breaker in this batch was observed as a single-pole 20A device. */
export const FS_NW_AUDIT_R1_OCP_AMPS = 20;
export const FS_NW_AUDIT_R1_POLES = 1;

export interface AuditedBreaker {
  /** Derived, display-only reference: PNL-FS-NW-B40. */
  breaker_reference: string;
  breaker_number: number;
  side: "Left" | "Right";
  position: number;
  /** Observed circuit-group label (blue tape / panel schedule text). */
  circuit_group_label: string;
}

/**
 * Frozen roster of the seven audited breakers, exactly as observed on
 * 03 Sep 2026 PM. Positions and numbers are recorded as read in the field and
 * are never re-derived from an assumed odd/even numbering scheme.
 */
export const FS_NW_AUDITED_BREAKERS: readonly AuditedBreaker[] = [
  { breaker_reference: "PNL-FS-NW-B40", breaker_number: 40, side: "Left", position: 1, circuit_group_label: "Garage Doors" },
  { breaker_reference: "PNL-FS-NW-B39", breaker_number: 39, side: "Right", position: 1, circuit_group_label: "Doors" },
  { breaker_reference: "PNL-FS-NW-B37", breaker_number: 37, side: "Right", position: 2, circuit_group_label: "A" },
  { breaker_reference: "PNL-FS-NW-B35", breaker_number: 35, side: "Right", position: 3, circuit_group_label: "B" },
  { breaker_reference: "PNL-FS-NW-B33", breaker_number: 33, side: "Right", position: 4, circuit_group_label: "C" },
  { breaker_reference: "PNL-FS-NW-B31", breaker_number: 31, side: "Right", position: 5, circuit_group_label: "D" },
  { breaker_reference: "PNL-FS-NW-B29", breaker_number: 29, side: "Right", position: 6, circuit_group_label: "E" },
] as const;

/** Sanity check: the stored reference must equal the derived projection. */
export function auditedBreakerReferenceMatches(b: AuditedBreaker): boolean {
  return breakerReference(FS_NW_PANEL_ID, b.breaker_number) === b.breaker_reference;
}

/**
 * Frozen audited breaker-to-load relationships, exactly as recorded on
 * 03 Sep 2026 PM. These are direct field observations of what each breaker
 * feeds; they are not derived from circuit descriptions, panel text, amps or
 * any other field. Order is the audited walk order and is part of the frozen
 * record, so the manifest stays byte-stable.
 */
export const FS_NW_AUDITED_LOADS: Readonly<Record<string, readonly string[]>> = {
  "PNL-FS-NW-B40": ["FS-054", "FS-055"],
  "PNL-FS-NW-B39": ["FS-076"],
  "PNL-FS-NW-B37": ["FS-044", "FS-075", "FS-045", "FS-046", "FS-047"],
  "PNL-FS-NW-B35": ["FS-074", "FS-043", "FS-040", "FS-042"],
  "PNL-FS-NW-B33": ["FS-048", "FS-077", "FS-049", "FS-078"],
  "PNL-FS-NW-B31": ["FS-036", "FS-037", "FS-038"],
  "PNL-FS-NW-B29": ["FS-039"],
} as const;

/**
 * The single audited observation that has no load record to link to: a second
 * load on the "E" circuit (PNL-FS-NW-B29) seen at grid F9 / Post 06SE. It is
 * carried as an explicit HOLD so the gap is recorded and never applied.
 */
export const FS_NW_UNIDENTIFIED_HOLD = {
  item_key: "fs-nw-b29-second-load-unidentified",
  breaker_reference: "PNL-FS-NW-B29",
  grid_reference: "F9",
  pole: "Post 06SE",
} as const;

export const holdItemKey = () => FS_NW_UNIDENTIFIED_HOLD.item_key;

/** Placeholder token this manifest uses to ask FarmOps for the next CG-FS-###. */
export const autoGroupToken = (b: AuditedBreaker) => `AUTO:${b.breaker_reference}-GROUP`;

export const groupItemKey = (b: AuditedBreaker) =>
  `fs-nw-b${b.breaker_number}-circuit-group`;
export const breakerItemKey = (b: AuditedBreaker) =>
  `fs-nw-b${b.breaker_number}-breaker-position`;
export const loadLinkItemKey = (b: AuditedBreaker, loadId: string) =>
  `fs-nw-b${b.breaker_number}-load-${loadId.toLowerCase()}`;

export interface BuildOptions {
  /**
   * Audited load linkage, keyed by breaker reference (`PNL-FS-NW-B37`) with
   * exact FarmOps load stable IDs (`FS-054`). Only supply IDs that were
   * positively identified in the field — an omitted breaker simply produces no
   * load item, and the circuit stays explicitly unlinked.
   *
   * Defaults to the frozen audited relationships in `FS_NW_AUDITED_LOADS`.
   */
  loads?: Record<string, readonly string[]>;
  /**
   * Include the HOLD item for the unidentified second load on B29. Defaults to
   * true when the frozen audited relationships are used.
   */
  includeUnidentifiedHold?: boolean;
  observedDate?: string;
}

function circuitGroupItem(b: AuditedBreaker): AuditBatchItemInput {
  return {
    item_key: groupItemKey(b),
    entity_kind: "circuit_group",
    // AUTO → FarmOps proposes the next unused permanent CG-FS-### identity.
    target_stable_id: autoGroupToken(b),
    observation_class: "FIELD_AS_BUILT",
    operation: "CREATE",
    fields: {
      description: b.circuit_group_label,
      breaker_number: b.breaker_number,
      breaker_position: `${b.side} ${b.position}`,
      circuit_rating_amps: FS_NW_AUDIT_R1_OCP_AMPS,
      install_status: "complete",
    },
    install_state: "installed",
    pole: null,
    field_grid_reference: null,
    refs: { panel_ref: FS_NW_PANEL_ID },
    observed_label: b.circuit_group_label,
    evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — observed 20A breaker at ${b.side} ${b.position} labelled "${b.circuit_group_label}".`,
    notes: `Permanent circuit-group identity for the audited circuit on ${b.breaker_reference}. The identity is independent of the breaker: reassigning the breaker never renames this group.`,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  };
}

function breakerPositionItem(b: AuditedBreaker): AuditBatchItemInput {
  return {
    item_key: breakerItemKey(b),
    entity_kind: "breaker_position",
    target_stable_id: null,
    observation_class: "FIELD_AS_BUILT",
    operation: "CREATE",
    fields: {
      side: b.side,
      position: b.position,
      breaker_number: b.breaker_number,
      poles: FS_NW_AUDIT_R1_POLES,
      ocp_amps: FS_NW_AUDIT_R1_OCP_AMPS,
      label: b.circuit_group_label,
      install_status: "complete",
    },
    install_state: "installed",
    pole: null,
    field_grid_reference: null,
    refs: {
      panel_ref: FS_NW_PANEL_ID,
      // Resolves to the circuit group this same manifest creates; apply
      // substitutes the returned UUID into circuit_group_uuid.
      circuit_group_ref: autoGroupToken(b),
    },
    observed_label: b.circuit_group_label,
    evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — installed single-pole 20A breaker ${b.breaker_reference} at ${b.side} ${b.position}.`,
    notes: `Authoritative identity is panel PNL-FS-NW plus physical position ${b.side} ${b.position}; ${b.breaker_reference} is the derived display reference.`,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  };
}

function loadLinkItem(b: AuditedBreaker, loadId: string): AuditBatchItemInput {
  return {
    item_key: loadLinkItemKey(b, loadId),
    entity_kind: "load",
    target_stable_id: loadId.toUpperCase(),
    observation_class: "FIELD_AS_BUILT",
    operation: "LINK",
    fields: {},
    install_state: null,
    pole: null,
    field_grid_reference: null,
    refs: {
      circuit_group_ref: autoGroupToken(b),
      load_ref: loadId.toUpperCase(),
    },
    observed_label: b.circuit_group_label,
    evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — ${loadId.toUpperCase()} traced to the circuit on ${b.breaker_reference} ("${b.circuit_group_label}").`,
    notes: `Connects the audited load to the permanent circuit group allocated for ${b.breaker_reference}.`,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  };
}

function unidentifiedLoadHoldItem(): AuditBatchItemInput {
  const b = FS_NW_AUDITED_BREAKERS.find(
    (x) => x.breaker_reference === FS_NW_UNIDENTIFIED_HOLD.breaker_reference,
  )!;
  return {
    item_key: FS_NW_UNIDENTIFIED_HOLD.item_key,
    entity_kind: "load",
    target_stable_id: null,
    observation_class: "HOLD_UNRESOLVED",
    operation: "HOLD_UNRESOLVED",
    fields: {},
    install_state: null,
    pole: FS_NW_UNIDENTIFIED_HOLD.pole,
    field_grid_reference: FS_NW_UNIDENTIFIED_HOLD.grid_reference,
    refs: { circuit_group_ref: autoGroupToken(b) },
    observed_label: b.circuit_group_label,
    evidence: `PNL-FS-NW field audit 03 Sep 2026 PM — a second load on the "${b.circuit_group_label}" circuit (${b.breaker_reference}) was observed at ${FS_NW_UNIDENTIFIED_HOLD.grid_reference} / ${FS_NW_UNIDENTIFIED_HOLD.pole} but could not be matched to a FarmOps load record.`,
    notes: `Recorded so the gap is visible. A field audit never invents a load record, so this stays on hold until the load is identified in a later batch.`,
    reason: `Unidentified second load on ${b.breaker_reference} at ${FS_NW_UNIDENTIFIED_HOLD.grid_reference} / ${FS_NW_UNIDENTIFIED_HOLD.pole} — no FarmOps load record identified.`,
    ods_field: null,
    ods_candidate_value: null,
  };
}

/**
 * Build FA-FS-2026-09-03-PM-R1. Deterministic: the same inputs always produce
 * byte-identical JSON, so the manifest SHA-256 recorded at import is stable.
 */
export function buildFsNwAuditManifestR1(options: BuildOptions = {}): AuditBatchManifest {
  const loads = options.loads ?? FS_NW_AUDITED_LOADS;
  const includeHold = options.includeUnidentifiedHold ?? options.loads === undefined;
  const linked: string[] = [];
  const unlinked: string[] = [];
  let linkCount = 0;
  const items: AuditBatchItemInput[] = [];

  for (const b of FS_NW_AUDITED_BREAKERS) {
    items.push(circuitGroupItem(b));
    items.push(breakerPositionItem(b));
    const ids = (loads[b.breaker_reference] ?? []).map((v) => v.trim()).filter(Boolean);
    if (!ids.length) {
      unlinked.push(b.breaker_reference);
      continue;
    }
    linked.push(b.breaker_reference);
    linkCount += ids.length;
    for (const id of ids) items.push(loadLinkItem(b, id));
  }

  if (includeHold) items.push(unidentifiedLoadHoldItem());

  const scope =
    `Establishes the seven audited PNL-FS-NW breakers as records, allocates a permanent ` +
    `CG-FS-### identity per circuit and links each position via circuit_group_uuid. Replaces the ` +
    `unresolved circuit-group placeholders in ${FS_NW_AUDIT_R1_SUPERSEDES}. ` +
    (unlinked.length
      ? `Load linkage withheld (no load positively identified): ${unlinked.join(", ")}.`
      : `Every audited circuit carries explicit load linkage from the observed ` +
        `breaker-to-load relationships (${linkCount} load links). Incomplete or questionable ` +
        `locations are reconciled separately and never suppress a known relationship.`) +
    (includeHold
      ? ` One observation is held unresolved: a second load on ${FS_NW_UNIDENTIFIED_HOLD.breaker_reference} ` +
        `at ${FS_NW_UNIDENTIFIED_HOLD.grid_reference} / ${FS_NW_UNIDENTIFIED_HOLD.pole} has no matching load record.`
      : "");

  return {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: FS_NW_AUDIT_R1_BATCH_ID,
    title: "Farm Shop PNL-FS-NW breaker audit — 03 Sep 2026 PM (R1)",
    scope,
    building: "Farm Shop",
    observed_date: options.observedDate ?? "2026-09-03",
    observed_time_precision: "afternoon",
    timezone: "America/New_York",
    source: `revision-of:${FS_NW_AUDIT_R1_SUPERSEDES}`,
    evidence: [
      {
        name: "PNL-FS-NW panel schedule photo set",
        label: "03 Sep 2026 PM",
        subject: "PNL-FS-NW breakers 29–40",
      },
    ],
    compensates_batch_id: null,
    items,
  };
}

/** Pretty-printed manifest text, ready to paste into the import box. */
export function fsNwAuditManifestR1Text(options: BuildOptions = {}): string {
  return JSON.stringify(buildFsNwAuditManifestR1(options), null, 2);
}
