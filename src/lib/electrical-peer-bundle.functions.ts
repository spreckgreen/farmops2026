// Cross-deployment import/export of audit batches and canonical verified
// locations. Reading, planning and guarded writing only.
//
// Nothing here writes an engineering value, a circuit relationship or a design
// coordinate. Incoming audit batches always land as `validated` previews — a
// peer approval is never carried across — and a canonical location only
// overwrites an existing local value after explicit approval in this
// deployment.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { requireAdminRole } from "@/lib/admin-role.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import { stageManifestText } from "@/lib/electrical-audit-batch.functions";
import { assertPeerUrl, peerFetch } from "@/lib/electrical-peer-net";
import {
  BUNDLE_KINDS,
  BUNDLE_KIND_LIST,
  buildPeerBundle,
  parsePeerBundle,
  planBatchImport,
  planCanonicalImport,
  planKey,
  serializePeerBundle,
  summarizeCanonicalPlan,
  writableRows,
  type BatchImportPlanRow,
  type BundleKind,
  type CanonicalPlanRow,
  type CanonicalPlanSummary,
  type PeerBundle,
  type PeerBundleBatch,
} from "@/lib/electrical-peer-bundle";

type LooseDb = { from: (table: string) => any };

const SECTION = "peer_deployment_import";
const BATCHES = "electrical_audit_batches";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

function selectFor(kind: BundleKind): string {
  const c = BUNDLE_KINDS[kind];
  return ["id", c.idColumn, "description", "updated_at", ...c.fields].join(", ");
}

async function readKindRows(
  db: LooseDb,
  kind: BundleKind,
  stableIds?: string[],
): Promise<Record<string, unknown>[]> {
  const c = BUNDLE_KINDS[kind];
  let query = db.from(c.table).select(selectFor(kind));
  if (stableIds && stableIds.length > 0) query = query.in(c.idColumn, stableIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/* ------------------------------------------------------------------ *
 * Export — build a bundle this deployment can hand to another site.
 * ------------------------------------------------------------------ */

export interface PeerBundleExport {
  /** Deterministic bundle JSON, ready to save to a file. */
  text: string;
  origin: string;
  generated_at: string;
  counts: { records: number; batches: number };
}

export const exportPeerBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        origin: z.string().trim().min(1).max(300).default("this FarmOps deployment"),
        include_manifests: z.boolean().default(true),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<PeerBundleExport> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const { collectPeerBundle } = await import("@/lib/electrical-peer-bundle.server");
    const bundle = await collectPeerBundle(context.supabase as never, {
      origin: data.origin,
      includeManifests: data.include_manifests,
    });
    return {
      text: serializePeerBundle(bundle),
      origin: bundle.origin,
      generated_at: bundle.generated_at,
      counts: { records: bundle.records.length, batches: bundle.batches.length },
    };
  });

/* ------------------------------------------------------------------ *
 * Preview — parse a bundle and plan, writing nothing.
 * ------------------------------------------------------------------ */

export interface PeerBundleImportPreview {
  ok: boolean;
  errors: string[];
  origin: string | null;
  generated_at: string | null;
  note: string;
  batches: BatchImportPlanRow[];
  records: CanonicalPlanRow[];
  summary: CanonicalPlanSummary;
}

async function localIndex(
  db: LooseDb,
  bundle: PeerBundle,
): Promise<Map<string, Record<string, unknown>>> {
  const wanted = new Map<BundleKind, string[]>();
  for (const record of bundle.records) {
    const list = wanted.get(record.kind) ?? [];
    list.push(record.stable_id);
    wanted.set(record.kind, list);
  }
  const index = new Map<string, Record<string, unknown>>();
  for (const [kind, ids] of wanted) {
    const rows = await readKindRows(db, kind, [...new Set(ids)]);
    for (const row of rows) {
      const stableId = s(row[BUNDLE_KINDS[kind].idColumn]);
      if (stableId) index.set(planKey(kind, stableId), row);
    }
  }
  return index;
}

async function planBundle(
  db: LooseDb,
  bundle: PeerBundle,
): Promise<{ records: CanonicalPlanRow[]; batches: BatchImportPlanRow[] }> {
  const index = await localIndex(db, bundle);
  const { data: localBatches, error } = await db.from(BATCHES).select("batch_id");
  if (error) throw new Error(error.message);
  const localIds = ((localBatches ?? []) as Record<string, unknown>[]).map((r) => s(r["batch_id"]));
  return {
    records: planCanonicalImport(bundle.records, index),
    batches: planBatchImport(bundle.batches, localIds),
  };
}

const bundleInput = z.object({ bundle: z.string().min(2).max(8_000_000) });

export const previewPeerBundleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bundleInput.parse(d))
  .handler(async ({ context, data }): Promise<PeerBundleImportPreview> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const parsed = parsePeerBundle(data.bundle);
    if (!parsed.ok || !parsed.bundle) {
      return {
        ok: false,
        errors: parsed.errors,
        origin: null,
        generated_at: null,
        note: "",
        batches: [],
        records: [],
        summary: summarizeCanonicalPlan([]),
      };
    }
    const plan = await planBundle(context.supabase as unknown as LooseDb, parsed.bundle);
    return {
      ok: true,
      errors: [],
      origin: parsed.bundle.origin,
      generated_at: parsed.bundle.generated_at,
      note: parsed.bundle.note,
      batches: plan.batches,
      records: plan.records,
      summary: summarizeCanonicalPlan(plan.records),
    };
  });

/* ------------------------------------------------------------------ *
 * Apply — creations and blank fills go in automatically; a disagreement
 * with an existing local value only lands when it was approved here.
 * ------------------------------------------------------------------ */

export interface PeerBundleImportResult {
  ok: boolean;
  errors: string[];
  origin: string | null;
  created: number;
  updated: number;
  skipped_conflicts: number;
  batches_staged: string[];
  batches_failed: { batch_id: string; message: string }[];
  applied: { key: string; stable_id: string; outcome: "created" | "updated"; columns: string[] }[];
  failures: { key: string; message: string }[];
  summary: CanonicalPlanSummary;
}

export const applyPeerBundleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    bundleInput
      .extend({
        approved_keys: z.array(z.string().min(1).max(300)).default([]),
        import_batches: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<PeerBundleImportResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;

    const parsed = parsePeerBundle(data.bundle);
    if (!parsed.ok || !parsed.bundle) {
      return {
        ok: false,
        errors: parsed.errors,
        origin: null,
        created: 0,
        updated: 0,
        skipped_conflicts: 0,
        batches_staged: [],
        batches_failed: [],
        applied: [],
        failures: [],
        summary: summarizeCanonicalPlan([]),
      };
    }
    const bundle = parsed.bundle;
    // Re-plan against live rows: the preview the operator saw may be stale.
    const plan = await planBundle(db, bundle);
    const writes = writableRows(plan.records, data.approved_keys);

    const applied: PeerBundleImportResult["applied"] = [];
    const failures: PeerBundleImportResult["failures"] = [];

    for (const row of writes) {
      const config = BUNDLE_KINDS[row.kind];
      const patch: Record<string, unknown> = {};
      for (const change of row.changes) patch[change.column] = change.after;
      try {
        if (row.decision === "create") {
          const insert = {
            [config.idColumn]: row.stable_id,
            user_id: context.userId,
            description: row.peer_description,
            ...patch,
          };
          const { error } = await db.from(config.table).insert(insert);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await db
            .from(config.table)
            .update(patch)
            .eq(config.idColumn, row.stable_id);
          if (error) throw new Error(error.message);
        }
        applied.push({
          key: row.key,
          stable_id: row.stable_id,
          outcome: row.decision === "create" ? "created" : "updated",
          columns: row.changes.map((c) => c.column),
        });
        await recordElectricalChange(context.supabase, context.userId, {
          section: SECTION,
          action: row.decision === "create" ? "create" : "update",
          entityKind: row.kind,
          entityRef: row.stable_id,
          summary:
            row.decision === "create"
              ? `${row.stable_id} created from field-verified location imported from ${bundle.origin}`
              : `${row.stable_id} field-verified location imported from ${bundle.origin} (${row.decision})`,
          changes: row.changes.map((c) => ({
            column: c.column,
            before: c.before == null ? null : String(c.before),
            after: c.after == null ? null : String(c.after),
          })),
        });
      } catch (e) {
        failures.push({ key: row.key, message: e instanceof Error ? e.message : String(e) });
      }
    }

    const staged: string[] = [];
    const batchesFailed: PeerBundleImportResult["batches_failed"] = [];
    if (data.import_batches) {
      for (const entry of plan.batches) {
        if (entry.outcome !== "importable") continue;
        const source = bundle.batches.find((b) => b.batch_id === entry.batch_id);
        if (!source?.manifest) continue;
        try {
          await stageManifestText(context, JSON.stringify(source.manifest), {
            source_note: `imported from FarmOps deployment ${bundle.origin} on ${new Date().toISOString()} (their status ${entry.peer_status ?? "unknown"})`,
          });
          staged.push(entry.batch_id);
        } catch (e) {
          batchesFailed.push({
            batch_id: entry.batch_id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      ok: failures.length === 0 && batchesFailed.length === 0,
      errors: [],
      origin: bundle.origin,
      created: applied.filter((a) => a.outcome === "created").length,
      updated: applied.filter((a) => a.outcome === "updated").length,
      skipped_conflicts: plan.records.filter(
        (r) => r.decision === "conflict" && !data.approved_keys.includes(r.key),
      ).length,
      batches_staged: staged,
      batches_failed: batchesFailed,
      applied,
      failures,
      summary: summarizeCanonicalPlan(plan.records),
    };
  });

/* ------------------------------------------------------------------ *
 * Pull — fetch the bundle straight from a reachable peer deployment.
 * ------------------------------------------------------------------ */

export interface PeerBundlePull {
  ok: boolean;
  error: string | null;
  origin: string | null;
  bundle_text: string | null;
  counts: { records: number; batches: number } | null;
}

export const pullPeerBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        peer_base_url: z.string().trim().min(8).max(300),
        peer_token: z.string().trim().min(10).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<PeerBundlePull> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    await requireAdminRole(context.supabase, context.userId);
    try {
      const base = assertPeerUrl(data.peer_base_url);
      const endpoint = new URL("/api/v1/electrical/location-bundle", base.origin);
      const res = await peerFetch(endpoint, {
        method: "GET",
        headers: { authorization: `Bearer ${data.peer_token}`, accept: "application/json" },
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `The other deployment refused the bundle (HTTP ${res.status}). Its token needs electrical:sor:read and it must run a FarmOps version that publishes the location bundle.`,
          origin: base.origin,
          bundle_text: null,
          counts: null,
        };
      }
      const text = await res.text();
      const parsed = parsePeerBundle(text);
      if (!parsed.ok || !parsed.bundle) {
        return {
          ok: false,
          error: `The other deployment returned a bundle this deployment cannot read: ${parsed.errors.join(" | ")}`,
          origin: base.origin,
          bundle_text: null,
          counts: null,
        };
      }
      return {
        ok: true,
        error: null,
        origin: parsed.bundle.origin,
        bundle_text: text,
        counts: {
          records: parsed.bundle.records.length,
          batches: parsed.bundle.batches.length,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "The other deployment could not be reached.",
        origin: null,
        bundle_text: null,
        counts: null,
      };
    }
  });
