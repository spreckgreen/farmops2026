// FA-FS-2026-09-06-R1 — Farm Shop electrical field audit of 2026-09-06.
//
// Immutable manifest: the fingerprint must never move once the owner has
// previewed it. Everything here is recorded exactly as observed in the field.
//
// What the audit established, and therefore what this batch stages:
//   * JB-105-01 at the top of Post 03NE, with BR-105-01-01 → FS-039 and
//     BR-105-01-02 → FS-038. Mounting height was not measured, so no height is
//     recorded.
//   * JB-104-01 at grid B3.5, with BR-104-01-01 → JB-104-03,
//     BR-104-01-02 → JB-104-02 and BR-104-01-03 → FS-054.
//   * JB-104-02 with only two branches observed (BR-104-02-03 fans,
//     BR-104-02-04 LED). BR-104-02-01 and BR-104-02-02 were NOT found in the
//     field and are staged as holds requiring disposition — never deleted,
//     because "not found" is not yet "removed, abandoned or never installed".
//   * CON-201 → FS-083 and CON-202 → FS-021 with a flexible final connection.
//   * The verified load grid locations, including positions recorded between
//     two adjacent cells exactly as observed (B9/C9, D9/E9, ...).
//   * FS-053 D3.5/E3.5, superseding the 2026-09-03 D4/E4 observation. The
//     earlier value stays in audit history; nothing is rewritten there.
//   * FS-035 between Post 23N and Post 24NE only. No building-grid cell is
//     inferred from a perimeter-post location.
//   * FS-048 stays a working outlet/load on circuit group CG-FS-005. Its
//     outgoing branch to the remaining outlets is a hold: the branch ID and the
//     downstream outlet sequence are unverified and are never invented.
//   * FS-054 at grid A5/A6 and Post 23N with BR-104-01-03 as the direct branch;
//     the conflicting BR-104-02 → FS-054 note is held, not applied.
import type {
  AuditBatchItemInput,
  AuditBatchManifest,
  PoleObservation,
} from "@/lib/electrical-audit-batch";
import { AUDIT_BATCH_SCHEMA_VERSION } from "@/lib/electrical-audit-batch";

export const FS_AUDIT_R1_20260906_BATCH_ID = "FA-FS-2026-09-06-R1";
export const FS_AUDIT_R1_20260906_OBSERVED_DATE = "2026-09-06";

/** CG-FS-005, confirmed in the field for FS-048. */
export const FS_048_CIRCUIT_GROUP_ID = "CG-FS-005";
export const FS_048_CIRCUIT_GROUP_UUID = "4a5ed2f0-aab5-4f14-80db-62589812bd34";

const EV = "Farm Shop field audit 2026-09-06 (FA-FS-2026-09-06-R1)";

const atPost = (post: string): PoleObservation => ({
  pole_scheme: "FS_POLE_GRID_V1",
  pole_location_kind: "AT_POST",
  pole_ref_start: post,
  pole_ref_end: null,
});

const betweenPosts = (start: string, end: string): PoleObservation => ({
  pole_scheme: "FS_POLE_GRID_V1",
  pole_location_kind: "BETWEEN_POSTS",
  pole_ref_start: start,
  pole_ref_end: end,
});

/**
 * Verified load grid locations. A value containing "/" is a position observed
 * between two adjacent cells and is preserved exactly, never reduced to one
 * cell and never averaged.
 */
export const FS_AUDIT_R1_20260906_LOAD_GRIDS: readonly {
  load_id: string;
  grid: string;
  note?: string;
}[] = [
  { load_id: "FS-013", grid: "B9/C9" },
  { load_id: "FS-014", grid: "C9/D9" },
  { load_id: "FS-015", grid: "D9/E9" },
  { load_id: "FS-020", grid: "F6.5" },
  {
    load_id: "FS-021",
    grid: "D9/E9",
    note: "Connected from CON-202; the final connection uses flexible conduit.",
  },
  { load_id: "FS-022", grid: "F7" },
  { load_id: "FS-023", grid: "F7" },
  { load_id: "FS-034", grid: "C5" },
  { load_id: "FS-052", grid: "C3.5" },
  {
    load_id: "FS-053",
    grid: "D3.5/E3.5",
    note: "Supersedes the 2026-09-03 observation of D4/E4, which stays in audit history.",
  },
  { load_id: "FS-068", grid: "A9" },
  { load_id: "FS-069", grid: "D1/E1" },
  { load_id: "FS-070", grid: "A1" },
  { load_id: "FS-071", grid: "A3/A4" },
  { load_id: "FS-072", grid: "A5/A6" },
  {
    load_id: "FS-082",
    grid: "F6.5",
    note: "Building-grid location, not a rack reference.",
  },
  {
    load_id: "FS-083",
    grid: "F5",
    note: "Building-grid location, not a rack reference. Fed from CON-201; the final connection uses flexible conduit.",
  },
  {
    load_id: "FS-084",
    grid: "F2",
    note: "Building-grid location, not a rack reference.",
  },
  { load_id: "FS-092", grid: "C1/D1" },
  { load_id: "FS-094", grid: "A9" },
  { load_id: "FS-097", grid: "D7" },
  { load_id: "FS-098", grid: "F4.5" },
  { load_id: "FS-099", grid: "D2.5" },
];

/** Branches found in the field, per junction box. */
export const FS_AUDIT_R1_20260906_BRANCHES: readonly {
  branch_id: string;
  jbox_id: string;
  dest_kind: "load" | "junction_box";
  dest_ref: string;
  note?: string;
}[] = [
  { branch_id: "BR-105-01-01", jbox_id: "JB-105-01", dest_kind: "load", dest_ref: "FS-039" },
  { branch_id: "BR-105-01-02", jbox_id: "JB-105-01", dest_kind: "load", dest_ref: "FS-038" },
  {
    branch_id: "BR-104-01-01",
    jbox_id: "JB-104-01",
    dest_kind: "junction_box",
    dest_ref: "JB-104-03",
  },
  {
    branch_id: "BR-104-01-02",
    jbox_id: "JB-104-01",
    dest_kind: "junction_box",
    dest_ref: "JB-104-02",
  },
  {
    branch_id: "BR-104-01-03",
    jbox_id: "JB-104-01",
    dest_kind: "load",
    dest_ref: "FS-054",
    note: "Direct branch to FS-054 as traced on 2026-09-06.",
  },
];

/** Branch records recorded previously but not found in the field. */
export const FS_AUDIT_R1_20260906_NOT_FOUND: readonly string[] = [
  "BR-104-02-01",
  "BR-104-02-02",
];

function loadLocationItem(load: {
  load_id: string;
  grid: string;
  note?: string;
}): AuditBatchItemInput {
  return {
    item_key: `fs-2026-09-06-r1-${load.load_id.toLowerCase()}-location`,
    entity_kind: "load",
    target_stable_id: load.load_id,
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: null,
    pole: null,
    field_grid_reference: load.grid,
    refs: {},
    observed_label: null,
    evidence: EV,
    notes: load.note ?? null,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput;
}

function branchItem(b: {
  branch_id: string;
  jbox_id: string;
  dest_kind: "load" | "junction_box";
  dest_ref: string;
  note?: string;
}): AuditBatchItemInput {
  return {
    item_key: `fs-2026-09-06-r1-${b.branch_id.toLowerCase()}`,
    entity_kind: "branch",
    target_stable_id: b.branch_id,
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {
      source_endpoint_type: "junction_box",
      source_endpoint_ref: b.jbox_id,
      dest_endpoint_type: b.dest_kind,
      dest_endpoint_ref: b.dest_ref,
    },
    install_state: "installed",
    pole: null,
    field_grid_reference: null,
    refs:
      b.dest_kind === "load"
        ? { jbox_ref: b.jbox_id, load_ref: b.dest_ref }
        : { jbox_ref: b.jbox_id },
    observed_label: null,
    evidence: EV,
    notes: b.note ?? null,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput;
}

function holdItem(
  key: string,
  entity_kind: AuditBatchItemInput["entity_kind"],
  target: string | null,
  reason: string,
  refs: AuditBatchItemInput["refs"] = {},
): AuditBatchItemInput {
  return {
    item_key: key,
    entity_kind,
    target_stable_id: target,
    observation_class: "HOLD_UNRESOLVED",
    operation: null,
    fields: {},
    install_state: null,
    pole: null,
    field_grid_reference: null,
    refs,
    observed_label: null,
    evidence: EV,
    notes: null,
    reason,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput;
}

export function buildFsAuditR120260906Manifest(): AuditBatchManifest {
  const items: AuditBatchItemInput[] = [];

  // ---- Junction boxes -------------------------------------------------
  items.push({
    item_key: "fs-2026-09-06-r1-jb-105-01",
    entity_kind: "jbox",
    target_stable_id: "JB-105-01",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: "installed",
    pole: atPost("03NE"),
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: EV,
    notes:
      "Mounted at the top of Post 03NE. Mounting height was not measured, so no height is recorded.",
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  items.push({
    item_key: "fs-2026-09-06-r1-jb-104-01",
    entity_kind: "jbox",
    target_stable_id: "JB-104-01",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: "installed",
    pole: null,
    field_grid_reference: "B3.5",
    refs: {},
    observed_label: null,
    evidence: EV,
    notes: null,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  // ---- Verified branches ----------------------------------------------
  for (const b of FS_AUDIT_R1_20260906_BRANCHES) items.push(branchItem(b));

  // JB-104-02: only two branches observed. The observed circuit purpose is
  // recorded as a note; no circuit-group identity is asserted, because no
  // circuit-group record was identified in the field.
  items.push(
    branchItem({
      branch_id: "BR-104-02-03",
      jbox_id: "JB-104-02",
      dest_kind: "load",
      dest_ref: "",
      note: "Observed serving the fans circuit. The circuit-group record was not identified in the field, so no circuit-group relationship is asserted here.",
    }),
  );
  items.push(
    branchItem({
      branch_id: "BR-104-02-04",
      jbox_id: "JB-104-02",
      dest_kind: "load",
      dest_ref: "",
      note: "Observed serving the LED lighting circuit. The circuit-group record was not identified in the field, so no circuit-group relationship is asserted here.",
    }),
  );

  for (const missing of FS_AUDIT_R1_20260906_NOT_FOUND) {
    items.push(
      holdItem(
        `fs-2026-09-06-r1-${missing.toLowerCase()}-not-found`,
        "branch",
        missing,
        `FIELD_NOT_FOUND / DISPOSITION_REQUIRED: only two branches were observed at JB-104-02 on 2026-09-06. ${missing} is not deleted — it stays on hold until it is confirmed removed, abandoned or never installed.`,
        { jbox_ref: "JB-104-02" },
      ),
    );
  }

  // ---- Conduit final connections --------------------------------------
  items.push({
    item_key: "fs-2026-09-06-r1-con-201-flex",
    entity_kind: "raceway",
    target_stable_id: "CON-201",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: "installed",
    pole: null,
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: EV,
    notes: "Serves FS-083; the final connection uses flexible conduit.",
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  items.push({
    item_key: "fs-2026-09-06-r1-con-202-flex",
    entity_kind: "raceway",
    target_stable_id: "CON-202",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: "installed",
    pole: null,
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: EV,
    notes: "Serves FS-021; the final connection uses flexible conduit.",
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  // ---- Verified load locations ----------------------------------------
  for (const load of FS_AUDIT_R1_20260906_LOAD_GRIDS) items.push(loadLocationItem(load));

  // FS-035: perimeter-post location only.
  items.push({
    item_key: "fs-2026-09-06-r1-fs-035-pole",
    entity_kind: "load",
    target_stable_id: "FS-035",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: null,
    pole: betweenPosts("23N", "24NE"),
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: EV,
    notes:
      "Observed between Post 23N and Post 24NE. The building-grid cell remains unverified and is never inferred from the post location.",
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  items.push(
    holdItem(
      "fs-2026-09-06-r1-fs-035-grid-unverified",
      "load",
      "FS-035",
      "The exact building-grid cell for FS-035 was not established. A grid coordinate is never derived from the Post 23N/24NE location.",
    ),
  );

  // ---- FS-048 topology -------------------------------------------------
  items.push({
    item_key: "fs-2026-09-06-r1-fs-048-circuit-group",
    entity_kind: "load",
    target_stable_id: "FS-048",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {
      circuit_group_ref: FS_048_CIRCUIT_GROUP_ID,
    },
    install_state: null,
    pole: null,
    field_grid_reference: null,
    refs: { circuit_group_ref: FS_048_CIRCUIT_GROUP_ID },
    observed_label: null,
    evidence: EV,
    notes:
      "FS-048 is a working receptacle outlet and stays classified as a load. It is also the starting connection point of a branch serving the remaining outlets in circuit group CG-FS-005. It is never converted into a junction box or a branch record.",
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  items.push(
    holdItem(
      "fs-2026-09-06-r1-fs-048-outgoing-branch",
      "branch",
      null,
      `The outgoing branch from FS-048 to the remaining outlets of ${FS_048_CIRCUIT_GROUP_ID} is confirmed to exist, but its branch ID and downstream outlet sequence are unverified. Neither is invented; the branch record is created once both are verified, associated with ${FS_048_CIRCUIT_GROUP_ID}.`,
      { circuit_group_ref: FS_048_CIRCUIT_GROUP_ID, load_ref: "FS-048" },
    ),
  );

  // ---- FS-054 correction and conflict ----------------------------------
  items.push({
    item_key: "fs-2026-09-06-r1-fs-054-location",
    entity_kind: "load",
    target_stable_id: "FS-054",
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: null,
    pole: atPost("23N"),
    field_grid_reference: "A5/A6",
    refs: {},
    observed_label: null,
    evidence: EV,
    notes:
      "Supersedes the 2026-09-03 observation of grid A3 at Post 21NW, which stays in audit history. Directly fed by BR-104-01-03 as traced on 2026-09-06.",
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  } as AuditBatchItemInput);

  items.push(
    holdItem(
      "fs-2026-09-06-r1-fs-054-br-104-02-conflict",
      "branch",
      null,
      "A second 2026-09-06 note recorded BR-104-02 → FS-054, which conflicts with the more specific traced relationship BR-104-01-03 → FS-054. Held until it is confirmed whether BR-104-02 is an upstream grouping/reference or whether that note is superseded. Nothing is applied silently.",
      { load_ref: "FS-054", jbox_ref: "JB-104-02" },
    ),
  );

  return {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: FS_AUDIT_R1_20260906_BATCH_ID,
    title: "Farm Shop Electrical Field Audit",
    scope:
      "Field-observed junction boxes, branch runs, conduit final connections and verified load locations in the Farm Shop on 2026-09-06. Verified grid corrections and unambiguous topology are staged for approval; conflicting relationships and records needing disposition are held.",
    building: "Farm Shop",
    observed_date: FS_AUDIT_R1_20260906_OBSERVED_DATE,
    timezone: "America/New_York",
    source: "Field observation",
    evidence: [{ name: EV, subject: "Farm Shop" }],
    compensates_batch_id: null,
    items,
  } as AuditBatchManifest;
}

export function fsAuditR120260906ManifestText(): string {
  return JSON.stringify(buildFsAuditR120260906Manifest(), null, 2);
}
