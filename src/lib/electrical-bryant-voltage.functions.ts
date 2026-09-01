// Phase 4.4b — server functions for the Bryant nominal supply voltage gate.
//
// Preview writes nothing. Apply requires confirm: true AND an explicit approved
// list, and immediately before each write it re-reads the live row by UUID,
// re-checks the stable ID, re-checks the current scalar voltage, re-resolves the
// verified equipment configuration and re-runs the live adjudication for that
// load — then writes ONLY `electrical_loads.volts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";
import { adjudicateLoads } from "@/lib/electrical-load-adjudication";
import {
  buildProductionAdjudicationInput,
  CANONICAL_ODS_LOADS,
  type FarmOpsLoadRow,
} from "@/lib/electrical-load-adjudication-production";
import {
  BRYANT_FREQUENCY_HZ,
  BRYANT_NOMINAL_SUPPLY_VOLTAGE,
  BRYANT_PHASE,
  BRYANT_RATED_EQUIPMENT_VOLTAGE_CLASS,
  BRYANT_VOLTAGE_COLUMN,
  BRYANT_VOLTAGE_LOAD_IDS,
  BRYANT_VOLTAGE_LOAD_SET,
  bryantVoltageGateKey,
  stillSafeToApplyBryantVoltage,
  summarizeBryantVoltageGate,
  type BryantVoltageGateRow,
  type BryantVoltageGateStatus,
  type BryantVoltageGateSummary,
} from "@/lib/electrical-bryant-voltage-gate";

type LooseDb = { from: (table: string) => any };

const TABLE = "electrical_loads";

const SELECT =
  "id, load_id, description, equipment_model, volts, amps, connected_va, demand_va, source_circuit, circuit_group_ref, source_reference, notes";

const inputSchema = z.object({
  confirm: z.boolean().default(false),
  /** Approved rows as `electrical_loads|<stable_id>|volts`. */
  approved: z.array(z.string()).default([]),
});

export interface BryantVoltageGateResult {
  applied: boolean;
  changed: number;
  skipped: number;
  generated_at: string;
  rows: BryantVoltageGateRow[];
  summary: BryantVoltageGateSummary;
}

const odsVoltsFor = (stableId: string) =>
  CANONICAL_ODS_LOADS.find((o) => o.stable_id === stableId)?.volts ?? null;

/** Live adjudication bucket for one load's `volts` finding, or null. */
function voltsBucketFor(row: FarmOpsLoadRow): string | null {
  const report = adjudicateLoads(buildProductionAdjudicationInput([row]));
  const finding = report.findings.find(
    (f) => f.stable_id === row.load_id.trim() && f.field === "volts",
  );
  return finding?.bucket ?? null;
}

async function runGate(
  db: LooseDb,
  data: z.infer<typeof inputSchema>,
): Promise<BryantVoltageGateResult> {
  const approved = new Set(data.approved);
  const rows: BryantVoltageGateRow[] = [];
  const generated_at = new Date().toISOString();
  let changed = 0;
  let skipped = 0;

  const { data: found, error } = await db
    .from(TABLE)
    .select(SELECT)
    .in("load_id", [...BRYANT_VOLTAGE_LOAD_IDS]);

  const live = new Map<string, FarmOpsLoadRow>();
  if (!error) {
    for (const r of (found ?? []) as FarmOpsLoadRow[]) live.set(r.load_id.trim(), r);
  }

  for (const stable_id of BRYANT_VOLTAGE_LOAD_IDS) {
    const base = {
      table: TABLE,
      stable_id,
      column: BRYANT_VOLTAGE_COLUMN,
      proposed_volts: BRYANT_NOMINAL_SUPPLY_VOLTAGE,
      rated_equipment_voltage: BRYANT_RATED_EQUIPMENT_VOLTAGE_CLASS,
      phase: BRYANT_PHASE,
      frequency_hz: BRYANT_FREQUENCY_HZ,
    };
    const push = (patch: {
      row_uuid?: string | null;
      live_volts?: number | null;
      status: BryantVoltageGateStatus;
      detail?: string;
      applied_at?: string | null;
    }) => {
      rows.push({
        ...base,
        row_uuid: patch.row_uuid ?? null,
        live_volts: patch.live_volts ?? null,
        status: patch.status,
        applied_at: patch.applied_at ?? null,
        ...(patch.detail ? { detail: patch.detail } : {}),
      });
    };

    if (error) {
      push({ status: "failed", detail: error.message });
      skipped++;
      continue;
    }
    const row = live.get(stable_id);
    if (!row) {
      push({ status: "not_found" });
      skipped++;
      continue;
    }
    if (row.load_id.trim() !== stable_id || !BRYANT_VOLTAGE_LOAD_SET.has(row.load_id.trim())) {
      push({ row_uuid: row.id, status: "failed", detail: "Stable ID mismatch on the live row." });
      skipped++;
      continue;
    }
    const liveVolts = row.volts === null || row.volts === undefined ? null : Number(row.volts);
    if (liveVolts === BRYANT_NOMINAL_SUPPLY_VOLTAGE) {
      push({ row_uuid: row.id, live_volts: liveVolts, status: "already_correct" });
      skipped++;
      continue;
    }

    const safe = stillSafeToApplyBryantVoltage({
      stable_id,
      live_volts: liveVolts,
      equipment: equipmentFor(stable_id),
      adjudication_bucket: voltsBucketFor(row),
      ods_volts: odsVoltsFor(stable_id),
    });
    if (!safe.ok) {
      push({ row_uuid: row.id, live_volts: liveVolts, status: safe.status, detail: safe.reason });
      skipped++;
      continue;
    }

    if (!data.confirm) {
      push({ row_uuid: row.id, live_volts: liveVolts, status: "would_change" });
      changed++;
      continue;
    }
    if (!approved.has(bryantVoltageGateKey({ table: TABLE, stable_id }))) {
      push({
        row_uuid: row.id,
        live_volts: liveVolts,
        status: "not_approved",
        detail: "Not in the explicitly approved correction set.",
      });
      skipped++;
      continue;
    }

    // Immediately before the write: re-read this exact row by UUID and re-run
    // every protection against the freshest state.
    const { data: fresh, error: reErr } = await db
      .from(TABLE)
      .select(SELECT)
      .eq("id", row.id)
      .maybeSingle();
    if (reErr || !fresh) {
      push({
        row_uuid: row.id,
        live_volts: liveVolts,
        status: "failed",
        detail: reErr?.message ?? "Row disappeared before the write.",
      });
      skipped++;
      continue;
    }
    const f = fresh as FarmOpsLoadRow;
    const freshVolts = f.volts === null || f.volts === undefined ? null : Number(f.volts);
    const stillOk = stillSafeToApplyBryantVoltage({
      stable_id: f.load_id.trim(),
      live_volts: freshVolts,
      equipment: equipmentFor(f.load_id.trim()),
      adjudication_bucket: voltsBucketFor(f),
      ods_volts: odsVoltsFor(f.load_id.trim()),
    });
    if (!stillOk.ok) {
      push({
        row_uuid: row.id,
        live_volts: freshVolts,
        status: stillOk.status,
        detail: stillOk.reason,
      });
      skipped++;
      continue;
    }

    const appliedAt = new Date().toISOString();
    // Exactly one column. Amps, VA, notes, references, IDs and relationships
    // are never included in this payload.
    const { error: upErr } = await db
      .from(TABLE)
      .update({ volts: BRYANT_NOMINAL_SUPPLY_VOLTAGE })
      .eq("id", row.id);
    if (upErr) {
      push({ row_uuid: row.id, live_volts: freshVolts, status: "failed", detail: upErr.message });
      skipped++;
      continue;
    }
    push({
      row_uuid: row.id,
      live_volts: freshVolts,
      status: "applied",
      applied_at: appliedAt,
    });
    changed++;
  }

  return {
    applied: data.confirm,
    changed,
    skipped,
    generated_at,
    rows,
    summary: summarizeBryantVoltageGate(rows),
  };
}

export const previewBryantVoltageCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({ confirm: false as const, approved: [] as string[] }))
  .handler(async ({ context }): Promise<BryantVoltageGateResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    return runGate(context.supabase as unknown as LooseDb, { confirm: false, approved: [] });
  });

export const applyBryantVoltageCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse({ ...(d as object), confirm: true }))
  .handler(async ({ context, data }): Promise<BryantVoltageGateResult> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    return runGate(context.supabase as unknown as LooseDb, data);
  });
