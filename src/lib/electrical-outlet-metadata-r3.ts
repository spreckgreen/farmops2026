// FARMOPS-ELEC-R3-OUTLET-METADATA-V1 — immutable preview-only correction batch.
//
// FA-FS-2026-09-03-PM-R3-OUTLET-METADATA corrects legacy receptacle-outlet
// current metadata that was entered before shared circuit-group capacity was
// modeled. It is metadata only: every item is an UPDATE against an existing
// load, and no item may touch a circuit-group UUID, a breaker relationship, a
// description, a location, a pole reference, voltage, lifecycle state, evidence
// or a stable ID. R2 (FA-FS-2026-09-03-PM-R2) is never modified or replaced —
// this batch compensates the legacy ODS metadata that R2's relationships
// exposed as wrong.
//
// Importing writes nothing. Applying selected items is atomic and audit logged.
import {
  AUDIT_BATCH_SCHEMA_VERSION,
  type AuditBatchManifest,
  type AuditBatchItemInput,
} from "@/lib/electrical-audit-batch";

/** Permanent identifier of this correction batch. */
export const R3_OUTLET_METADATA_BATCH_ID = "FA-FS-2026-09-03-PM-R3-OUTLET-METADATA";

/** The batch whose relationships established the shared circuits. Untouched. */
export const R3_OUTLET_COMPENSATES_BATCH_ID = "FA-FS-2026-09-03-PM-R2";

/** The 18 audited receptacle loads this batch corrects. */
export const R3_OUTLET_AUDITED_LOADS = [
  "FS-036",
  "FS-037",
  "FS-038",
  "FS-039",
  "FS-040",
  "FS-042",
  "FS-043",
  "FS-044",
  "FS-045",
  "FS-046",
  "FS-047",
  "FS-048",
  "FS-049",
  "FS-074",
  "FS-075",
  "FS-076",
  "FS-077",
  "FS-078",
] as const;

/**
 * Outlet-like records that were NOT part of this audit. They are reported
 * read-only; nothing about them may change without its own field evidence.
 */
export const R3_OUTLET_CANDIDATE_LOADS = [
  "BL-005",
  "FS-041",
  "FS-050",
  "FS-051",
  "FS-073",
  "PH-019a",
  "PH-019b",
  "PH-028",
  "PH-029",
] as const;

/** Canonical ODS token for a shared circuit class. */
export const SHARED_TOKEN = "S";

/** Provenance sentence written to every corrected load. */
export const R3_OUTLET_PROVENANCE =
  `Legacy outlet amperage and derived VA removed by ${R3_OUTLET_METADATA_BATCH_ID}: the recorded value was the 20 A branch-circuit rating, not the receptacle outlet's load current. ${R3_OUTLET_COMPENSATES_BATCH_ID} established the shared circuit-group relationship; no verified calculation provenance existed for the derived VA. Current is now not recorded, which is not zero load.`;

/** Fields this batch is allowed to write. Nothing else may appear in a patch. */
export const R3_OUTLET_PERMITTED_FIELDS = [
  "dedicated",
  "dedicated_shared",
  "amps",
  "connected_va",
  "amps_semantic",
  "amps_semantic_provenance",
] as const;

/** Live values needed to state an exact before/after for one load. */
export interface OutletLoadRow {
  load_id: string;
  dedicated?: boolean | null;
  dedicated_shared?: string | null;
  amps?: number | null;
  connected_va?: number | null;
  amps_semantic?: string | null;
  amps_semantic_provenance?: string | null;
  circuit_group_uuid?: string | null;
}

export interface OutletCorrection {
  load_id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changed: string[];
  /** True when the load already carries the corrected metadata. */
  already_correct: boolean;
}

export interface OutletCandidateReport {
  load_id: string;
  found: boolean;
  dedicated: boolean | null;
  dedicated_shared: string | null;
  amps: number | null;
  connected_va: number | null;
  has_circuit_group: boolean;
  note: string;
}

export interface OutletMetadataBuild {
  manifest: AuditBatchManifest;
  corrections: OutletCorrection[];
  /** Audited loads that are not in the electrical records (held, not written). */
  loadsNotFound: string[];
  /** Audited loads already carrying the corrected metadata. */
  alreadyCorrect: string[];
  candidates: OutletCandidateReport[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};

/** The corrected target state for one audited outlet. */
function targetState(): Record<string, unknown> {
  return {
    dedicated: false,
    dedicated_shared: SHARED_TOKEN,
    // Cleared: a branch-circuit rating is not the outlet's load current, and the
    // derived VA had no verified calculation provenance.
    amps: null,
    connected_va: null,
    // The enum carries no unknown member, so the recorded semantic is cleared.
    amps_semantic: null,
    amps_semantic_provenance: R3_OUTLET_PROVENANCE,
  };
}

/**
 * Build the immutable preview-only manifest from the live rows. Only audited
 * loads that exist and genuinely differ become UPDATE items; missing loads are
 * reported as holds and never written.
 */
export function buildOutletMetadataR3(input: {
  audited: OutletLoadRow[];
  candidates: OutletLoadRow[];
}): OutletMetadataBuild {
  const byId = new Map(
    input.audited.map((r) => [String(r.load_id).toUpperCase(), r] as const),
  );
  const corrections: OutletCorrection[] = [];
  const loadsNotFound: string[] = [];
  const alreadyCorrect: string[] = [];
  const items: AuditBatchItemInput[] = [];

  for (const loadId of R3_OUTLET_AUDITED_LOADS) {
    const row = byId.get(loadId.toUpperCase());
    if (!row) {
      loadsNotFound.push(loadId);
      items.push({
        item_key: `${loadId}-outlet-metadata-hold`,
        entity_kind: "load",
        target_stable_id: loadId,
        observation_class: "FIELD_AS_BUILT",
        operation: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: "Audited receptacle outlet has no electrical load record; nothing can be corrected.",
        notes:
          "Held: the load record was not found, so no legacy current metadata could be read or corrected.",
      });
      continue;
    }
    const before = {
      dedicated: row.dedicated ?? null,
      dedicated_shared: str(row.dedicated_shared),
      amps: num(row.amps),
      connected_va: num(row.connected_va),
      amps_semantic: str(row.amps_semantic),
      amps_semantic_provenance: str(row.amps_semantic_provenance),
    };
    const after = targetState();
    const changed = R3_OUTLET_PERMITTED_FIELDS.filter(
      (f) => (before as Record<string, unknown>)[f] !== after[f],
    );
    const already = changed.length === 0;
    if (already) alreadyCorrect.push(loadId);
    corrections.push({ load_id: loadId, before, after, changed: [...changed], already_correct: already });
    if (already) continue;

    const fields: Record<string, unknown> = {};
    for (const f of changed) fields[f] = after[f];

    items.push({
      item_key: `${loadId}-outlet-metadata`,
      entity_kind: "load",
      target_stable_id: loadId,
      observation_class: "FIELD_AS_BUILT",
      operation: "UPDATE",
      fields: fields as AuditBatchItemInput["fields"],
      refs: {},
      evidence: `Field audit ${R3_OUTLET_COMPENSATES_BATCH_ID}: this receptacle outlet shares an audited 20 A branch circuit with other outlets. The legacy amps value was the circuit rating and the VA was derived from it.`,
      notes: `Metadata only. Before: dedicated=${before.dedicated ?? "null"}, dedicated_shared=${
        before.dedicated_shared ?? "null"
      }, amps=${before.amps ?? "null"}, connected_va=${before.connected_va ?? "null"}, amps_semantic=${
        before.amps_semantic ?? "null"
      }. Circuit group, breaker relationship, description, location, pole, voltage, lifecycle state and stable ID are unchanged; the circuit group and breaker position keep their 20 A rating.`,
      reason: `Correct legacy outlet current metadata after ${R3_OUTLET_COMPENSATES_BATCH_ID} established the shared circuit-group relationship.`,
    });
  }

  const candidateById = new Map(
    input.candidates.map((r) => [String(r.load_id).toUpperCase(), r] as const),
  );
  const candidates: OutletCandidateReport[] = R3_OUTLET_CANDIDATE_LOADS.map((id) => {
    const row = candidateById.get(id.toUpperCase());
    return {
      load_id: id,
      found: Boolean(row),
      dedicated: row?.dedicated ?? null,
      dedicated_shared: str(row?.dedicated_shared),
      amps: num(row?.amps),
      connected_va: num(row?.connected_va),
      has_circuit_group: Boolean(str(row?.circuit_group_uuid)),
      note: row
        ? "Outlet-like record not covered by this audit. Read-only: no metadata change without its own field evidence."
        : "No load record found. Reported only; nothing staged.",
    };
  });

  const manifest: AuditBatchManifest = {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: R3_OUTLET_METADATA_BATCH_ID,
    title: "Farm Shop receptacle-outlet legacy current metadata correction",
    scope:
      "Metadata-only correction of 18 audited receptacle outlets: shared circuit class, and removal of the legacy branch-circuit amperage and the VA derived from it. Relationships, engineering ratings and stable IDs are preserved.",
    building: "Farm Shop",
    observed_date: "2026-09-03",
    observed_time_precision: "PM",
    timezone: "America/Chicago",
    source: `Follow-up metadata reconciliation for ${R3_OUTLET_COMPENSATES_BATCH_ID}`,
    evidence: [
      {
        name: "shared-circuit-audit",
        label: "Audited shared 20 A branch circuits at PNL-FS-NW",
        subject: R3_OUTLET_COMPENSATES_BATCH_ID,
      },
    ],
    compensates_batch_id: R3_OUTLET_COMPENSATES_BATCH_ID,
    items,
  };

  return { manifest, corrections, loadsNotFound, alreadyCorrect, candidates };
}

/** CSV of the read-only candidate report for the nine unaudited records. */
export function outletCandidateCsv(rows: OutletCandidateReport[]): string {
  const head = [
    "load_id",
    "found",
    "dedicated",
    "dedicated_shared",
    "amps",
    "connected_va",
    "has_circuit_group",
    "note",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.load_id,
        r.found,
        r.dedicated ?? "",
        r.dedicated_shared ?? "",
        r.amps ?? "",
        r.connected_va ?? "",
        r.has_circuit_group,
        r.note,
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}
