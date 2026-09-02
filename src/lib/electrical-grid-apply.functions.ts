// Farm Shop physical-location migration — preview/apply server operations.
//
// Preview performs no writes. Apply writes ONLY the six physical-location
// columns, one row at a time, and only for records the frozen-transformation
// preview classified as EXACT, NEAREST or NON_FIXED. Every write is preceded by
// a fresh re-read of that exact row and a full re-verification of identity,
// legacy grid, transformation fingerprint, derived grid reference, precision
// classification and superseding evidence. Circuits, loads, electrical values,
// panels, topology, descriptions, equipment, ODS data and engineering
// classifications are never touched.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import {
  migrateAll,
  migrateRow,
  summarizeMigration,
  summarizePrecision,
  type GridMigrationRow,
  type MigrationInputRow,
  type MigrationSummary,
  type PrecisionSummary,
} from "@/lib/electrical-grid-migration";
import {
  alreadyStored,
  applyAuditSummary,
  applyKey,
  eligibility,
  patchFor,
  stableIdColumn,
  stillSafeToApply,
  summarizeApply,
  tableFor,
  GRID_APPLY_GATE_VERSION,
  GRID_TRANSFORM_FINGERPRINT,
  LOCATION_COLUMNS,
  type GridApplyProposal,
  type GridApplySummary,
} from "@/lib/electrical-grid-apply-gate";

type LooseDb = { from: (table: string) => any };

const APPLY_SECTION = "grid_location_migration";

const FARM_SHOP_AREA = /farm\s*shop/i;

const inputSchema = z.object({
  confirm: z.boolean().default(false),
  /** Approved records as `electrical_loads|FS-001`. */
  approved: z.array(z.string()).default([]),
});

export interface GridApplyPayload {
  applied: boolean;
  generated_at: string;
  transform_fingerprint: string;
  gate_version: string;
  writable_columns: string[];
  proposals: GridApplyProposal[];
  summary: GridApplySummary;
  migration_summary: MigrationSummary;
  precision: PrecisionSummary;
  /** Post-apply re-run of the complete migration population. */
  validation: {
    rows: number;
    already_correct: number;
    would_change: number;
    interval_untouched: number;
    unresolved_untouched: number;
    field_confirmation_required: number;
    non_fixed_with_null_xy: number;
    non_fixed_violations: string[];
    newly_resolved_without_evidence: string[];
  } | null;
}

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

interface LiveRows {
  loads: Record<string, unknown>[];
  panels: Record<string, unknown>[];
}

async function readLive(db: LooseDb): Promise<LiveRows> {
  const [loadRes, panelRes] = await Promise.all([
    db
      .from("electrical_loads")
      .select(
        "id, load_id, description, grid, location, area, location_x_ft, location_y_ft, grid_reference, grid_reference_precision, grid_migration_provenance, legacy_grid",
      ),
    db
      .from("electrical_panels")
      .select(
        "id, panel_id, description, grid, building, location_x_ft, location_y_ft, grid_reference, grid_reference_precision, grid_migration_provenance, legacy_grid",
      ),
  ]);
  if (loadRes.error) throw new Error(loadRes.error.message);
  if (panelRes.error) throw new Error(panelRes.error.message);
  return {
    loads: (loadRes.data ?? []) as Record<string, unknown>[],
    panels: (panelRes.data ?? []) as Record<string, unknown>[],
  };
}

/** The migration population: exactly the same set the preview page reports. */
function population(live: LiveRows): {
  inputs: MigrationInputRow[];
  byId: Map<string, Record<string, unknown>>;
} {
  const byId = new Map<string, Record<string, unknown>>();
  const inputs: MigrationInputRow[] = [];

  for (const r of live.panels) {
    const id = s(r["panel_id"]);
    if (!id.toUpperCase().startsWith("PNL-FS-")) continue;
    byId.set(`electrical_panels|${id}`, r);
    inputs.push({
      kind: "panel",
      stable_id: id,
      description: s(r["description"]),
      grid: s(r["grid"]),
      location: s(r["building"]),
    });
  }

  for (const r of live.loads) {
    const id = s(r["load_id"]);
    const isFarmShop = id.startsWith("FS-") || FARM_SHOP_AREA.test(s(r["area"]));
    if (!isFarmShop) continue;
    // Legacy grid may already have been moved into legacy_grid by a prior apply.
    const legacy = s(r["legacy_grid"]) || s(r["grid"]);
    if (!legacy) continue;
    byId.set(`electrical_loads|${id}`, r);
    inputs.push({
      kind: "load",
      stable_id: id,
      description: s(r["description"]),
      grid: legacy,
      location: s(r["location"]),
      area: s(r["area"]),
    });
  }

  return { inputs, byId };
}

/**
 * Location-field evidence recorded after this gate's own writes supersedes the
 * migration for that record.
 */
async function supersedingEvidence(db: LooseDb, refs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!refs.length) return out;
  const { data } = await db
    .from("electrical_change_audit")
    .select("entity_ref, section, summary, changes, created_at")
    .in("entity_ref", refs);
  for (const a of (data ?? []) as {
    entity_ref: string | null;
    section: string | null;
    summary: string | null;
    changes: unknown;
    created_at: string | null;
  }[]) {
    if (!a.entity_ref) continue;
    if (a.section === APPLY_SECTION) continue; // our own migration is not newer evidence
    const changes = Array.isArray(a.changes) ? (a.changes as { column?: string }[]) : [];
    const touchesLocation = changes.some(
      (c) => c.column && (LOCATION_COLUMNS as readonly string[]).includes(c.column),
    );
    if (!touchesLocation) continue;
    out.set(
      a.entity_ref.trim(),
      `${a.summary ?? "location change"} recorded ${a.created_at ?? "previously"} (section ${a.section ?? "unknown"}).`,
    );
  }
  return out;
}

function proposalFor(
  row: GridMigrationRow,
  live: Record<string, unknown> | undefined,
): GridApplyProposal {
  const table = tableFor(row.kind);
  return {
    table,
    kind: row.kind,
    stable_id: row.stable_id,
    row_uuid: (live?.["id"] as string | undefined) ?? null,
    description: row.description,
    legacy_grid: row.legacy_grid,
    current_farmops_grid: s(live?.["grid"]),
    location_x_ft: row.location_x_ft,
    location_y_ft: row.location_y_ft,
    grid_reference: row.grid_reference,
    grid_reference_precision: row.grid_reference_precision,
    grid_migration_provenance: row.grid_migration_provenance,
    supporting_evidence: row.supporting_evidence,
    transform_fingerprint: GRID_TRANSFORM_FINGERPRINT,
    writes: Object.keys(patchFor(row)) as GridApplyProposal["writes"],
    status: "would_change",
    applied_at: null,
  };
}

async function runGate(
  db: LooseDb,
  supabase: unknown,
  userId: string,
  data: { confirm: boolean; approved: string[] },
): Promise<GridApplyPayload> {
  const generated_at = new Date().toISOString();
  const approved = new Set(data.approved);

  const live = await readLive(db);
  const { inputs, byId } = population(live);
  const rows = migrateAll(inputs);
  const evidence = await supersedingEvidence(
    db,
    rows.map((r) => r.stable_id),
  );

  const proposals: GridApplyProposal[] = [];

  for (const row of rows) {
    const liveRow = byId.get(`${tableFor(row.kind)}|${row.stable_id}`);
    const base = proposalFor(row, liveRow);
    const elig = eligibility(row);

    if (!elig.eligible) {
      proposals.push({ ...base, status: elig.status, detail: elig.reason ?? undefined });
      continue;
    }
    if (!liveRow) {
      proposals.push({ ...base, status: "failed", detail: "No FarmOps row for this stable ID." });
      continue;
    }

    const patch = patchFor(row);
    if (alreadyStored(liveRow, patch)) {
      proposals.push({ ...base, status: "already_correct" });
      continue;
    }
    const newer = evidence.get(row.stable_id) ?? null;
    if (newer) {
      proposals.push({
        ...base,
        status: "newer_evidence",
        detail: `Newer physical-location evidence supersedes the migration: ${newer}`,
      });
      continue;
    }

    if (!data.confirm) {
      proposals.push(base);
      continue;
    }

    const key = applyKey(base);
    if (!approved.has(key)) {
      proposals.push({ ...base, status: "not_approved", detail: "Not approved for apply." });
      continue;
    }

    // Immediately before the write: re-read this exact row and re-verify.
    const idCol = stableIdColumn(row.kind);
    const { data: fresh, error: reErr } = await db
      .from(base.table)
      .select("*")
      .eq("id", base.row_uuid)
      .maybeSingle();
    if (reErr || !fresh) {
      proposals.push({
        ...base,
        status: "failed",
        detail: reErr?.message ?? "Row disappeared before the write.",
      });
      continue;
    }
    const f = fresh as Record<string, unknown>;
    const freshLegacy = s(f["legacy_grid"]) || s(f["grid"]);
    const recomputed = migrateRow({
      kind: row.kind,
      stable_id: s(f[idCol]),
      description: s(f["description"]),
      grid: freshLegacy,
      location: row.kind === "panel" ? s(f["building"]) : s(f["location"]),
      area: row.kind === "panel" ? undefined : s(f["area"]),
    });
    const recomputedEligible = eligibility(recomputed);

    const safe = stillSafeToApply({
      stable_id: base.stable_id,
      live_stable_id: s(f[idCol]),
      row_uuid: base.row_uuid,
      previewed_legacy_grid: base.legacy_grid,
      live_legacy_grid: freshLegacy,
      previewed_fingerprint: base.transform_fingerprint,
      current_fingerprint: GRID_TRANSFORM_FINGERPRINT,
      previewed_precision: base.grid_reference_precision,
      current_precision: recomputed.grid_reference_precision,
      previewed_grid_reference: base.grid_reference,
      rederived_grid_reference: recomputed.grid_reference,
      eligible: recomputedEligible.eligible,
      withheld_status: recomputedEligible.eligible ? null : recomputedEligible.status,
      newer_evidence: evidence.get(base.stable_id) ?? null,
      approved: true,
    });
    if (!safe.ok) {
      proposals.push({ ...base, status: safe.status, detail: safe.reason });
      continue;
    }

    const { error: upErr } = await db.from(base.table).update(patch).eq("id", base.row_uuid);
    if (upErr) {
      proposals.push({ ...base, status: "failed", detail: upErr.message });
      continue;
    }
    const appliedRow: GridApplyProposal = {
      ...base,
      status: "applied",
      applied_at: new Date().toISOString(),
    };
    proposals.push(appliedRow);
    await recordElectricalChange(supabase, userId, {
      section: APPLY_SECTION,
      entityKind: row.kind,
      action: "update",
      entityUuid: base.row_uuid,
      entityRef: base.stable_id,
      summary: applyAuditSummary(appliedRow),
      changes: Object.entries(patch).map(([column, after]) => ({
        column,
        before: liveRow[column] == null ? null : String(liveRow[column]),
        after: after == null ? null : String(after),
      })),
    });
  }

  // Post-apply validation: re-run the complete migration against fresh records.
  let validation: GridApplyPayload["validation"] = null;
  if (data.confirm) {
    const live2 = await readLive(db);
    const { inputs: inputs2, byId: byId2 } = population(live2);
    const rows2 = migrateAll(inputs2);
    let already = 0;
    let would = 0;
    let nonFixedNull = 0;
    const nonFixedViolations: string[] = [];
    const newlyResolved: string[] = [];
    for (const r of rows2) {
      const l = byId2.get(`${tableFor(r.kind)}|${r.stable_id}`);
      const e = eligibility(r);
      if (r.grid_reference_precision === "NON_FIXED") {
        const clean =
          l?.["location_x_ft"] == null && l?.["location_y_ft"] == null && !s(l?.["grid_reference"]);
        if (clean) nonFixedNull += 1;
        else nonFixedViolations.push(r.stable_id);
      }
      if (!e.eligible) {
        // A withheld record must not have gained a stored location.
        if (l && (l["location_x_ft"] != null || s(l["grid_reference"]))) {
          newlyResolved.push(r.stable_id);
        }
        continue;
      }
      if (l && alreadyStored(l, patchFor(r))) already += 1;
      else would += 1;
    }
    validation = {
      rows: rows2.length,
      already_correct: already,
      would_change: would,
      interval_untouched: rows2.filter((r) => r.grid_reference_precision === "INTERVAL").length,
      unresolved_untouched: rows2.filter((r) => r.grid_reference_precision === "UNRESOLVED").length,
      field_confirmation_required: rows2.filter(
        (r) => eligibility(r).status === "field_confirmation_required",
      ).length,
      non_fixed_with_null_xy: nonFixedNull,
      non_fixed_violations: nonFixedViolations,
      newly_resolved_without_evidence: newlyResolved,
    };
  }

  return {
    applied: data.confirm,
    generated_at,
    transform_fingerprint: GRID_TRANSFORM_FINGERPRINT,
    gate_version: GRID_APPLY_GATE_VERSION,
    writable_columns: [...LOCATION_COLUMNS],
    proposals,
    summary: summarizeApply(proposals),
    migration_summary: summarizeMigration(rows),
    precision: summarizePrecision(rows),
    validation,
  };
}

export const previewFarmShopGridApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<GridApplyPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    return runGate(context.supabase as unknown as LooseDb, context.supabase, context.userId, {
      confirm: false,
      approved: data.approved,
    });
  });

export const applyFarmShopGridMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<GridApplyPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    if (!data.confirm) {
      throw new Error("Explicit confirmation is required before any location field is written.");
    }
    if (!data.approved.length) {
      throw new Error("No records were approved for apply.");
    }
    return runGate(context.supabase as unknown as LooseDb, context.supabase, context.userId, {
      confirm: true,
      approved: data.approved,
    });
  });
