// Cross-deployment transfer of field-audit batches and canonical verified
// locations between two FarmOps deployments.
//
// A field audit is deployment-local until it is synchronized. This module owns
// the *pure* wire contract and the deterministic import plan; it never reads,
// writes or reaches the network.
//
// Hard rules encoded here:
//   * only field-verified location statements travel. Design coordinates,
//     engineering values, circuits, topology and descriptions never do,
//   * a record that does not exist locally is a creation (safe: nothing is
//     overwritten),
//   * filling a blank local location field is a fill,
//   * changing an existing non-empty local value is a CONFLICT and always
//     requires explicit approval — import order never decides,
//   * stable IDs are the identity. UUIDs are never carried across deployments.
import type { AuditDisposition } from "@/lib/electrical-audit-batch";

export const PEER_BUNDLE_SCHEMA_VERSION = "1.0";

export type BundleKind =
  | "panel"
  | "load"
  | "junction_box"
  | "device"
  | "power_asset"
  | "rack"
  | "switch_bank";

export interface BundleKindConfig {
  table: string;
  idColumn: string;
  label: string;
  /** Field-verified location columns carried across deployments. */
  fields: string[];
}

const FULL_LOCATION_FIELDS = [
  "field_grid_reference",
  "field_verification_status",
  "grid_reference",
  "grid_reference_precision",
  "location_source",
  "location_precision",
  "location_evidence",
  "location_x_ft",
  "location_y_ft",
  "pole_scheme",
  "pole_location_kind",
  "pole_ref_start",
  "pole_ref_end",
  "verified_at",
  "verification_notes",
];

const XY_ONLY_FIELDS = ["location_source", "location_precision", "location_x_ft", "location_y_ft"];

export const BUNDLE_KINDS: Record<BundleKind, BundleKindConfig> = {
  panel: {
    table: "electrical_panels",
    idColumn: "panel_id",
    label: "Panel",
    fields: FULL_LOCATION_FIELDS,
  },
  load: {
    table: "electrical_loads",
    idColumn: "load_id",
    label: "Load / equipment",
    fields: FULL_LOCATION_FIELDS,
  },
  junction_box: {
    table: "electrical_junction_boxes",
    idColumn: "jbox_id",
    label: "Junction box",
    fields: [
      "field_grid_reference",
      "location_source",
      "location_precision",
      "location_evidence",
      "location_x_ft",
      "location_y_ft",
      "pole_scheme",
      "pole_location_kind",
      "pole_ref_start",
      "pole_ref_end",
    ],
  },
  device: {
    table: "electrical_devices",
    idColumn: "device_id",
    label: "Device",
    fields: XY_ONLY_FIELDS,
  },
  power_asset: {
    table: "electrical_power_assets",
    idColumn: "power_asset_id",
    label: "Power asset",
    fields: XY_ONLY_FIELDS,
  },
  rack: {
    table: "electrical_racks",
    idColumn: "rack_id",
    label: "Equipment rack",
    fields: XY_ONLY_FIELDS,
  },
  switch_bank: {
    table: "electrical_switch_banks",
    idColumn: "switch_bank_id",
    label: "Switch bank",
    fields: [
      "field_grid_reference",
      "field_verification_status",
      "location_source",
      "location_precision",
      "location_x_ft",
      "location_y_ft",
      "pole_scheme",
    ],
  },
};

export const BUNDLE_KIND_LIST = Object.keys(BUNDLE_KINDS) as BundleKind[];

export type BundleFieldValue = string | number | null;

export interface PeerBundleRecord {
  kind: BundleKind;
  stable_id: string;
  description: string | null;
  updated_at: string | null;
  fields: Record<string, BundleFieldValue>;
}

export interface PeerBundleBatch {
  batch_id: string;
  title: string | null;
  status: string | null;
  applied_at: string | null;
  manifest_sha256: string | null;
  /** Full manifest when available; a metadata-only listing carries null. */
  manifest: Record<string, unknown> | null;
}

export interface PeerBundle {
  schema_version: string;
  generated_at: string;
  /** Origin of the exporting deployment, e.g. "https://farmops.example.com". */
  origin: string;
  note: string;
  batches: PeerBundleBatch[];
  records: PeerBundleRecord[];
}

export const DEPLOYMENT_SCOPE_NOTE =
  "Field audits are deployment-local until synchronized. If an audit was applied in another FarmOps deployment, this instance cannot use that evidence until the audit batch or resulting canonical records are imported and verified.";

const VERIFIED_STATUSES = new Set(["VERIFIED_AS_INSTALLED", "UPDATED_FROM_FIELD_OBSERVATION"]);
const VERIFIED_POLE_KINDS = new Set(["AT_POST", "BETWEEN_POSTS"]);
const FIELD_SOURCE = /^FIELD/i;

const text = (v: unknown): string => (v == null ? "" : String(v)).trim();

/** True when the recorded location carries field evidence, not design intent. */
export function isFieldVerified(fields: Record<string, unknown>): boolean {
  if (text(fields["field_grid_reference"])) return true;
  if (VERIFIED_POLE_KINDS.has(text(fields["pole_location_kind"]).toUpperCase())) return true;
  if (VERIFIED_STATUSES.has(text(fields["field_verification_status"]).toUpperCase())) return true;
  if (FIELD_SOURCE.test(text(fields["location_source"]))) return true;
  return false;
}

function pickFields(kind: BundleKind, row: Record<string, unknown>): Record<string, BundleFieldValue> {
  const out: Record<string, BundleFieldValue> = {};
  for (const column of BUNDLE_KINDS[kind].fields) {
    const raw = row[column];
    if (raw == null) continue;
    if (typeof raw === "number") {
      out[column] = Number.isFinite(raw) ? raw : null;
      continue;
    }
    const value = text(raw);
    if (value) out[column] = value;
  }
  return out;
}

/** One exportable record, or null when the row carries no field-verified location. */
export function bundleRecordFromRow(
  kind: BundleKind,
  row: Record<string, unknown>,
): PeerBundleRecord | null {
  const stableId = text(row[BUNDLE_KINDS[kind].idColumn]);
  if (!stableId) return null;
  const fields = pickFields(kind, row);
  if (!isFieldVerified(fields)) return null;
  if (Object.keys(fields).length === 0) return null;
  return {
    kind,
    stable_id: stableId,
    description: text(row["description"]) || null,
    updated_at: text(row["updated_at"]) || null,
    fields,
  };
}

export interface BuildBundleInput {
  generatedAt: string;
  origin: string;
  rows: Partial<Record<BundleKind, Record<string, unknown>[]>>;
  batches: PeerBundleBatch[];
}

export function buildPeerBundle(input: BuildBundleInput): PeerBundle {
  const records: PeerBundleRecord[] = [];
  for (const kind of BUNDLE_KIND_LIST) {
    for (const row of input.rows[kind] ?? []) {
      const record = bundleRecordFromRow(kind, row);
      if (record) records.push(record);
    }
  }
  records.sort((a, b) => a.kind.localeCompare(b.kind) || a.stable_id.localeCompare(b.stable_id));
  const batches = [...input.batches].sort((a, b) => a.batch_id.localeCompare(b.batch_id));
  return {
    schema_version: PEER_BUNDLE_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    origin: input.origin,
    note: DEPLOYMENT_SCOPE_NOTE,
    batches,
    records,
  };
}

export function serializePeerBundle(bundle: PeerBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function peerBundleFilename(generatedAt: string): string {
  const [date = "", rest = ""] = generatedAt.split("T");
  const time = rest.replace(/\..*$/, "").replace(/Z$/, "").replace(/:/g, "");
  return `farmops-peer-bundle-${date}T${time}.json`;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

export function parsePeerBundle(raw: string): {
  ok: boolean;
  bundle?: PeerBundle;
  errors: string[];
} {
  const errors: string[] = [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["The bundle is not valid JSON."] };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["The bundle must be a JSON object."] };
  }
  const obj = body as Record<string, unknown>;
  const version = text(obj["schema_version"]);
  if (version !== PEER_BUNDLE_SCHEMA_VERSION) {
    errors.push(
      `Bundle schema ${version || "(missing)"} is not supported; this deployment reads ${PEER_BUNDLE_SCHEMA_VERSION}.`,
    );
  }
  const origin = text(obj["origin"]);
  if (!origin) errors.push("The bundle does not say which deployment produced it.");

  const records: PeerBundleRecord[] = [];
  const rawRecords = Array.isArray(obj["records"]) ? (obj["records"] as unknown[]) : [];
  rawRecords.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`Record ${index + 1} is not an object.`);
      return;
    }
    const r = entry as Record<string, unknown>;
    const kind = text(r["kind"]) as BundleKind;
    if (!BUNDLE_KINDS[kind]) {
      errors.push(`Record ${index + 1} has unknown record type "${text(r["kind"])}".`);
      return;
    }
    const stableId = text(r["stable_id"]);
    if (!stableId) {
      errors.push(`Record ${index + 1} has no stable ID.`);
      return;
    }
    const fieldsIn =
      r["fields"] && typeof r["fields"] === "object" && !Array.isArray(r["fields"])
        ? (r["fields"] as Record<string, unknown>)
        : {};
    const allowed = new Set(BUNDLE_KINDS[kind].fields);
    const fields: Record<string, BundleFieldValue> = {};
    for (const [column, value] of Object.entries(fieldsIn)) {
      if (!allowed.has(column)) continue;
      if (value == null) continue;
      if (typeof value === "number") {
        if (Number.isFinite(value)) fields[column] = value;
        continue;
      }
      const clean = text(value);
      if (clean) fields[column] = clean;
    }
    records.push({
      kind,
      stable_id: stableId,
      description: text(r["description"]) || null,
      updated_at: text(r["updated_at"]) || null,
      fields,
    });
  });

  const batches: PeerBundleBatch[] = [];
  const rawBatches = Array.isArray(obj["batches"]) ? (obj["batches"] as unknown[]) : [];
  rawBatches.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`Audit batch ${index + 1} is not an object.`);
      return;
    }
    const b = entry as Record<string, unknown>;
    const batchId = text(b["batch_id"]);
    if (!batchId) {
      errors.push(`Audit batch ${index + 1} has no batch ID.`);
      return;
    }
    batches.push({
      batch_id: batchId,
      title: text(b["title"]) || null,
      status: text(b["status"]) || null,
      applied_at: text(b["applied_at"]) || null,
      manifest_sha256: text(b["manifest_sha256"]) || null,
      manifest: (b["manifest"] ?? null) as Record<string, unknown> | null,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    bundle: {
      schema_version: PEER_BUNDLE_SCHEMA_VERSION,
      generated_at: text(obj["generated_at"]) || new Date(0).toISOString(),
      origin,
      note: text(obj["note"]) || DEPLOYMENT_SCOPE_NOTE,
      batches,
      records,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Import plan
 * ------------------------------------------------------------------ */

export type CanonicalDecision = "create" | "fill" | "conflict" | "no_change" | "not_verified";

export const DECISION_LABEL: Record<CanonicalDecision, string> = {
  create: "New record here — applies automatically",
  fill: "Fills a blank local value — applies automatically",
  conflict: "Disagrees with a local value — needs approval",
  no_change: "Already matches",
  not_verified: "No field evidence — not imported",
};

export interface CanonicalChange {
  column: string;
  before: BundleFieldValue;
  after: BundleFieldValue;
}

export interface CanonicalPlanRow {
  /** `electrical_loads|FS-035` — stable across preview and apply. */
  key: string;
  kind: BundleKind;
  table: string;
  stable_id: string;
  description: string | null;
  peer_description: string | null;
  decision: CanonicalDecision;
  requires_approval: boolean;
  changes: CanonicalChange[];
  note: string | null;
}

export function planKey(kind: BundleKind, stableId: string): string {
  return `${BUNDLE_KINDS[kind].table}|${stableId.toUpperCase()}`;
}

const sameValue = (a: BundleFieldValue, b: BundleFieldValue): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  return text(a).toUpperCase() === text(b).toUpperCase();
};

const blank = (v: unknown): boolean => v == null || text(v) === "";

/**
 * Deterministic plan. `local` is keyed by `planKey`; a missing entry means the
 * record does not exist in this deployment.
 */
export function planCanonicalImport(
  records: PeerBundleRecord[],
  local: Map<string, Record<string, unknown>>,
): CanonicalPlanRow[] {
  const rows: CanonicalPlanRow[] = [];
  for (const record of records) {
    const config = BUNDLE_KINDS[record.kind];
    const key = planKey(record.kind, record.stable_id);
    const localRow = local.get(key) ?? null;
    const base: Omit<CanonicalPlanRow, "decision" | "requires_approval" | "changes" | "note"> = {
      key,
      kind: record.kind,
      table: config.table,
      stable_id: record.stable_id,
      description: localRow ? text(localRow["description"]) || null : null,
      peer_description: record.description,
    };

    if (!isFieldVerified(record.fields)) {
      rows.push({
        ...base,
        decision: "not_verified",
        requires_approval: false,
        changes: [],
        note: "The incoming location carries no field evidence, so it is never imported.",
      });
      continue;
    }

    if (!localRow) {
      rows.push({
        ...base,
        decision: "create",
        requires_approval: false,
        changes: Object.entries(record.fields).map(([column, after]) => ({
          column,
          before: null,
          after,
        })),
        note: `Creates ${config.label.toLowerCase()} ${record.stable_id} with the verified location only.`,
      });
      continue;
    }

    const changes: CanonicalChange[] = [];
    let conflict = false;
    for (const [column, after] of Object.entries(record.fields)) {
      const before = (localRow[column] ?? null) as BundleFieldValue;
      if (sameValue(before, after)) continue;
      changes.push({ column, before, after });
      if (!blank(before)) conflict = true;
    }
    if (changes.length === 0) {
      rows.push({
        ...base,
        decision: "no_change",
        requires_approval: false,
        changes: [],
        note: null,
      });
      continue;
    }
    rows.push({
      ...base,
      decision: conflict ? "conflict" : "fill",
      requires_approval: conflict,
      changes,
      note: conflict
        ? "This deployment already records a different value. The verified field reference only wins once you approve it."
        : "Only blank local fields are filled in.",
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

export interface CanonicalPlanSummary {
  total: number;
  create: number;
  fill: number;
  conflict: number;
  no_change: number;
  not_verified: number;
  auto_apply: number;
}

export function summarizeCanonicalPlan(rows: CanonicalPlanRow[]): CanonicalPlanSummary {
  const count = (d: CanonicalDecision) => rows.filter((r) => r.decision === d).length;
  return {
    total: rows.length,
    create: count("create"),
    fill: count("fill"),
    conflict: count("conflict"),
    no_change: count("no_change"),
    not_verified: count("not_verified"),
    auto_apply: rows.filter((r) => !r.requires_approval && (r.decision === "create" || r.decision === "fill"))
      .length,
  };
}

/** Rows this import writes, given the approvals the operator ticked. */
export function writableRows(
  rows: CanonicalPlanRow[],
  approvedKeys: Iterable<string>,
): CanonicalPlanRow[] {
  const approved = new Set(approvedKeys);
  return rows.filter(
    (r) =>
      (r.decision === "create" || r.decision === "fill") ||
      (r.decision === "conflict" && approved.has(r.key)),
  );
}

/** Batch statuses worth importing: the audit is finished on the other side. */
export const IMPORTABLE_BATCH_STATUSES = new Set(["applied", "partially_applied"]);

export interface BatchImportPlanRow {
  batch_id: string;
  title: string | null;
  peer_status: string | null;
  applied_at: string | null;
  outcome: "importable" | "metadata_only" | "skipped_status" | "present_locally";
  message: string;
}

export function planBatchImport(
  batches: PeerBundleBatch[],
  localBatchIds: Iterable<string>,
): BatchImportPlanRow[] {
  const present = new Set([...localBatchIds].map((id) => id.toUpperCase()));
  return batches
    .map((batch): BatchImportPlanRow => {
      const status = text(batch.status).toLowerCase();
      if (present.has(batch.batch_id.toUpperCase())) {
        return {
          batch_id: batch.batch_id,
          title: batch.title,
          peer_status: batch.status,
          applied_at: batch.applied_at,
          outcome: "present_locally",
          message: "Already staged in this deployment — nothing is re-imported.",
        };
      }
      if (status && !IMPORTABLE_BATCH_STATUSES.has(status)) {
        return {
          batch_id: batch.batch_id,
          title: batch.title,
          peer_status: batch.status,
          applied_at: batch.applied_at,
          outcome: "skipped_status",
          message: `The other deployment reports this batch as ${status}; only applied audits are imported.`,
        };
      }
      if (!batch.manifest) {
        return {
          batch_id: batch.batch_id,
          title: batch.title,
          peer_status: batch.status,
          applied_at: batch.applied_at,
          outcome: "metadata_only",
          message:
            "The bundle lists this audit but carries no manifest, so its evidence is not available locally.",
        };
      }
      return {
        batch_id: batch.batch_id,
        title: batch.title,
        peer_status: batch.status,
        applied_at: batch.applied_at,
        outcome: "importable",
        message: "Stages here as a preview; approvals are never carried across deployments.",
      };
    })
    .sort((a, b) => a.batch_id.localeCompare(b.batch_id));
}

/** Kept so an imported preview always reports a local disposition word. */
export type ImportedDisposition = AuditDisposition;
