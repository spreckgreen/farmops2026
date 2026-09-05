// FARMOPS-ELEC-R3A-OUTLET-CLASSIFICATION-V1 — immutable preview-only
// corrective batch.
//
// FA-FS-2026-09-03-PM-R3A-OUTLET-CLASSIFICATION corrects two receptacle-outlet
// records that were classified as dedicated only because a single load row was
// linked to their circuit group. That is never evidence of a dedicated branch
// circuit (see DEDICATED_REQUIRES_EVIDENCE_RULE): both are general-use
// receptacle outlets, so the correct classification is shared.
//
// Scope is exactly two fields on exactly two loads. Amperage, connected VA,
// amps semantic, circuit-group relationships, breaker relationships, locations,
// grid, pole, lifecycle state, evidence, voltage, descriptions and stable IDs
// are all out of scope and untouched. Importing writes nothing; applying
// selected items is atomic and audit logged. R2, R3-METADATA and
// R3-OUTLET-METADATA are preserved unchanged.
import {
  AUDIT_BATCH_SCHEMA_VERSION,
  type AuditBatchItemInput,
  type AuditBatchManifest,
} from "@/lib/electrical-audit-batch";
import { SHARED_TOKEN, type OutletLoadRow } from "@/lib/electrical-outlet-metadata-r3";

export const R3A_OUTLET_CLASSIFICATION_BATCH_ID =
  "FA-FS-2026-09-03-PM-R3A-OUTLET-CLASSIFICATION";

/** The batches this correction follows. None of them is modified. */
export const R3A_PRESERVED_BATCH_IDS = [
  "FA-FS-2026-09-03-PM-R2",
  "FA-FS-2026-09-03-PM-R3-METADATA",
  "FA-FS-2026-09-03-PM-R3-OUTLET-METADATA",
] as const;

/** The two loads this batch corrects. */
export const R3A_OUTLET_LOADS = ["FS-039", "FS-076"] as const;

/** The only two fields this batch may write. */
export const R3A_PERMITTED_FIELDS = ["dedicated", "dedicated_shared"] as const;

export const R3A_OUT_OF_SCOPE_NOTE =
  "Classification only. Amperage, connected VA, amps semantic, circuit-group and breaker relationships, location, grid, pole, lifecycle state, evidence, voltage, description and stable ID are out of scope and unchanged.";

export interface R3AClassificationRow {
  load_id: string;
  before: { dedicated: boolean | null; dedicated_shared: string | null };
  after: { dedicated: boolean; dedicated_shared: string };
  changed: string[];
  already_correct: boolean;
  found: boolean;
}

export interface R3ABuild {
  manifest: AuditBatchManifest;
  rows: R3AClassificationRow[];
  loadsNotFound: string[];
  alreadyCorrect: string[];
}

const str = (v: unknown): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};

const EVIDENCE =
  "PNL-FS-NW field audit 03 Sep 2026 PM — this record is a general-use receptacle outlet. The dedicated classification came from a single linked load row, not from evidence that the branch circuit supplies only one piece of identified utilization equipment. No such evidence exists, so the circuit is shared.";

/**
 * Build the immutable preview-only classification correction from live rows.
 * Deterministic: identical input yields byte-identical JSON, so the manifest
 * fingerprint recorded at import is stable.
 */
export function buildOutletClassificationR3A(input: {
  loads: readonly OutletLoadRow[];
}): R3ABuild {
  const byId = new Map(
    input.loads.map((r) => [String(r.load_id).trim().toUpperCase(), r] as const),
  );
  const rows: R3AClassificationRow[] = [];
  const items: AuditBatchItemInput[] = [];
  const loadsNotFound: string[] = [];
  const alreadyCorrect: string[] = [];

  for (const loadId of R3A_OUTLET_LOADS) {
    const row = byId.get(loadId.toUpperCase());
    const after = { dedicated: false, dedicated_shared: SHARED_TOKEN };
    if (!row) {
      loadsNotFound.push(loadId);
      rows.push({
        load_id: loadId,
        before: { dedicated: null, dedicated_shared: null },
        after,
        changed: [],
        already_correct: false,
        found: false,
      });
      items.push({
        item_key: `${loadId.toLowerCase()}-outlet-classification-hold`,
        entity_kind: "load",
        target_stable_id: loadId,
        observation_class: "HOLD_UNRESOLVED",
        operation: "HOLD_UNRESOLVED",
        fields: {},
        refs: {},
        evidence: EVIDENCE,
        notes: `Held: ${loadId} has no FarmOps load record in this instance, so its classification cannot be read or corrected.`,
        reason: `No load record ${loadId} found; classification correction withheld.`,
      });
      continue;
    }

    const before = {
      dedicated: row.dedicated ?? null,
      dedicated_shared: str(row.dedicated_shared),
    };
    const changed = R3A_PERMITTED_FIELDS.filter((f) => before[f] !== after[f]);
    const already = changed.length === 0;
    if (already) alreadyCorrect.push(loadId);
    rows.push({
      load_id: loadId,
      before,
      after,
      changed: [...changed],
      already_correct: already,
      found: true,
    });
    if (already) continue;

    const fields: Record<string, unknown> = {};
    for (const f of changed) fields[f] = after[f];

    items.push({
      item_key: `${loadId.toLowerCase()}-outlet-classification`,
      entity_kind: "load",
      target_stable_id: loadId,
      observation_class: "FIELD_AS_BUILT",
      operation: "UPDATE",
      fields: fields as AuditBatchItemInput["fields"],
      refs: {},
      evidence: EVIDENCE,
      notes: `Before: dedicated=${before.dedicated ?? "null"}, dedicated_shared=${
        before.dedicated_shared ?? "null"
      }. After: dedicated=false, dedicated_shared=${SHARED_TOKEN}. ${R3A_OUT_OF_SCOPE_NOTE}`,
      reason:
        "Correct a dedicated classification that was derived from a single linked load row rather than from evidence that the branch circuit supplies only the identified utilization equipment.",
    });
  }

  const manifest: AuditBatchManifest = {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: R3A_OUTLET_CLASSIFICATION_BATCH_ID,
    title: "Farm Shop receptacle-outlet dedicated/shared classification correction",
    scope: `Classification-only correction of ${R3A_OUTLET_LOADS.join(" and ")}: dedicated true → false and dedicated_shared D → ${SHARED_TOKEN}. ${R3A_OUT_OF_SCOPE_NOTE}`,
    building: "Farm Shop",
    observed_date: "2026-09-03",
    observed_time_precision: "PM",
    timezone: "America/Chicago",
    source: `classification-correction-following:${R3A_PRESERVED_BATCH_IDS.join(",")}`,
    evidence: [
      {
        name: "general-use-receptacle-classification",
        label: "General-use receptacle outlets on PNL-FS-NW branch circuits",
        subject: R3A_OUTLET_LOADS.join(", "),
      },
    ],
    compensates_batch_id: null,
    items: items.length
      ? items
      : [
          {
            item_key: "outlet-classification-no-change",
            entity_kind: "load",
            target_stable_id: null,
            observation_class: "HOLD_UNRESOLVED",
            operation: "HOLD_UNRESOLVED",
            fields: {},
            refs: {},
            evidence: EVIDENCE,
            notes:
              "Both audited receptacle outlets already carry the shared classification; nothing is staged.",
            reason: "No classification change required.",
          },
        ],
  };

  return { manifest, rows, loadsNotFound, alreadyCorrect };
}

/** CSV of the two-row before/after classification preview. */
export function outletClassificationCsv(rows: readonly R3AClassificationRow[]): string {
  const head = [
    "load_id",
    "found",
    "dedicated_before",
    "dedicated_after",
    "dedicated_shared_before",
    "dedicated_shared_after",
    "changed",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.load_id,
        r.found,
        r.before.dedicated ?? "",
        r.after.dedicated,
        r.before.dedicated_shared ?? "",
        r.after.dedicated_shared,
        r.changed.join(" "),
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}
