// Phase 4.4b — apply gate server functions for the system-voltage migration.
//
// Preview writes nothing. Apply requires confirm: true AND an explicit approved
// list, and for each entry it re-reads the live panel row, confirms the stable
// ID, confirms the scalar voltage is unchanged, confirms no conflicting
// designation exists and confirms the canonical ODS still states the same
// designation — then writes ONLY the `system_voltage` column (plus its
// applied-at stamp). The legacy scalar `voltage` is never modified.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { resolveSystemVoltage } from "@/lib/electrical-system-voltage";
import {
  AUTHORIZED_PANEL_SET,
  stillSafeToApply,
  summarizeSystemVoltageGate,
  systemVoltageGateKey,
  systemVoltagePayload,
  type SystemVoltageGateRow,
  type SystemVoltageGateStatus,
  type SystemVoltageGateSummary,
} from "@/lib/electrical-system-voltage-gate";

type LooseDb = { from: (table: string) => any };

const TABLE = "electrical_panels";

const entrySchema = z.object({
  stable_id: z.string().trim().min(1),
  /** Canonical ODS cell text, e.g. "120/240". */
  ods_value: z.string().trim().min(1).max(200),
  /** Scalar voltage the reviewed preview was based on. */
  expected_scalar: z.union([z.number(), z.null()]).default(null),
});

const inputSchema = z.object({
  entries: z.array(entrySchema).min(1).max(50),
  confirm: z.boolean().default(false),
  /** Approved rows as `electrical_panels|<stable_id>|system_voltage`. */
  approved: z.array(z.string()).default([]),
});

export interface SystemVoltageGateResult {
  applied: boolean;
  changed: number;
  skipped: number;
  generated_at: string;
  rows: SystemVoltageGateRow[];
  summary: SystemVoltageGateSummary;
}

async function runGate(
  db: LooseDb,
  data: z.infer<typeof inputSchema>,
): Promise<SystemVoltageGateResult> {
  const approved = new Set(data.approved);
  const rows: SystemVoltageGateRow[] = [];
  let changed = 0;
  let skipped = 0;
  const generated_at = new Date().toISOString();

  for (const entry of data.entries) {
    const proposed = resolveSystemVoltage(entry.ods_value);
    const base = {
      table: TABLE,
      stable_id: entry.stable_id,
      column: "system_voltage",
      ods_value: entry.ods_value,
      expected_scalar: entry.expected_scalar,
      applied_at: null as string | null,
    };
    const push = (
      patch: {
        row_uuid?: string | null;
        live_scalar?: number | null;
        live_representation?: string;
        status: SystemVoltageGateStatus;
        detail?: string;
        applied_at?: string | null;
      },
    ) => {
      rows.push({
        ...base,
        row_uuid: patch.row_uuid ?? null,
        live_scalar: patch.live_scalar ?? null,
        live_representation: patch.live_representation ?? "",
        proposed: proposed ?? {
          code: "",
          designation: entry.ods_value,
          line_neutral_volts: 0,
          line_line_volts: 0,
          phases: null,
          wires: null,
          note: "unresolved",
        },
        status: patch.status,
        applied_at: patch.applied_at ?? null,
        ...(patch.detail ? { detail: patch.detail } : {}),
      });
    };

    if (!proposed) {
      push({
        status: "failed",
        detail: `"${entry.ods_value}" is not a resolvable system-voltage designation; the canonical workbook must be resolved first.`,
      });
      skipped++;
      continue;
    }
    if (!AUTHORIZED_PANEL_SET.has(entry.stable_id)) {
      push({
        status: "not_approved",
        detail: `${entry.stable_id} is outside the seven panels authorized for this migration.`,
      });
      skipped++;
      continue;
    }

    const { data: found, error } = await db
      .from(TABLE)
      .select("id, panel_id, voltage, system_voltage, system_voltage_applied_at")
      .eq("panel_id", entry.stable_id)
      .maybeSingle();
    if (error) {
      push({ status: "failed", detail: error.message });
      skipped++;
      continue;
    }
    if (!found) {
      push({ status: "not_found" });
      skipped++;
      continue;
    }
    const row = found as Record<string, unknown>;
    if (String(row["panel_id"] ?? "") !== entry.stable_id) {
      push({ status: "failed", detail: "Stable ID mismatch on the live row." });
      skipped++;
      continue;
    }
    const uuid = String(row["id"]);
    const liveScalar = row["voltage"] === null || row["voltage"] === undefined ? null : Number(row["voltage"]);
    const liveRep = resolveSystemVoltage(row["system_voltage"]);
    const liveRepText = liveRep ? liveRep.designation : "";

    if (liveRep && liveRep.designation === proposed.designation) {
      push({
        row_uuid: uuid,
        live_scalar: liveScalar,
        live_representation: liveRepText,
        status: "already_correct",
        applied_at: (row["system_voltage_applied_at"] as string | null) ?? null,
      });
      skipped++;
      continue;
    }

    const safe = stillSafeToApply({
      stable_id: entry.stable_id,
      ods_value: entry.ods_value,
      expected_scalar: entry.expected_scalar,
      live_scalar: liveScalar,
      live_representation: row["system_voltage"],
      proposed,
    });
    if (!safe.ok) {
      push({
        row_uuid: uuid,
        live_scalar: liveScalar,
        live_representation: liveRepText,
        status: safe.status,
        detail: safe.reason,
      });
      skipped++;
      continue;
    }

    if (!data.confirm) {
      push({ row_uuid: uuid, live_scalar: liveScalar, live_representation: liveRepText, status: "would_change" });
      changed++;
      continue;
    }
    if (!approved.has(systemVoltageGateKey({ table: TABLE, stable_id: entry.stable_id }))) {
      push({
        row_uuid: uuid,
        live_scalar: liveScalar,
        live_representation: liveRepText,
        status: "not_approved",
        detail: "Not in the explicitly approved migration set.",
      });
      skipped++;
      continue;
    }

    // Immediately before the write: re-read this exact row by UUID and re-run
    // every protection against the freshest state.
    const { data: fresh, error: reErr } = await db
      .from(TABLE)
      .select("id, panel_id, voltage, system_voltage")
      .eq("id", uuid)
      .maybeSingle();
    if (reErr || !fresh) {
      push({
        row_uuid: uuid,
        live_scalar: liveScalar,
        live_representation: liveRepText,
        status: "failed",
        detail: reErr?.message ?? "Row disappeared before the write.",
      });
      skipped++;
      continue;
    }
    const f = fresh as Record<string, unknown>;
    const freshScalar = f["voltage"] === null || f["voltage"] === undefined ? null : Number(f["voltage"]);
    const stillOk = stillSafeToApply({
      stable_id: String(f["panel_id"] ?? ""),
      ods_value: entry.ods_value,
      expected_scalar: entry.expected_scalar,
      live_scalar: freshScalar,
      live_representation: f["system_voltage"],
      proposed,
    });
    if (!stillOk.ok) {
      push({
        row_uuid: uuid,
        live_scalar: freshScalar,
        live_representation: resolveSystemVoltage(f["system_voltage"])?.designation ?? "",
        status: stillOk.status,
        detail: stillOk.reason,
      });
      skipped++;
      continue;
    }

    const appliedAt = new Date().toISOString();
    const { error: upErr } = await db
      .from(TABLE)
      // Only the representation columns. The scalar `voltage` is untouched.
      .update({ system_voltage: systemVoltagePayload(proposed), system_voltage_applied_at: appliedAt })
      .eq("id", uuid);
    if (upErr) {
      push({
        row_uuid: uuid,
        live_scalar: freshScalar,
        live_representation: liveRepText,
        status: "failed",
        detail: upErr.message,
      });
      skipped++;
      continue;
    }
    push({
      row_uuid: uuid,
      live_scalar: freshScalar,
      live_representation: liveRepText,
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
    summary: summarizeSystemVoltageGate(rows),
  };
}

export const previewSystemVoltageMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse({ ...(d as object), confirm: false }))
  .handler(async ({ context, data }): Promise<SystemVoltageGateResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    return runGate(context.supabase as unknown as LooseDb, { ...data, confirm: false });
  });

export const applySystemVoltageMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ context, data }): Promise<SystemVoltageGateResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    return runGate(context.supabase as unknown as LooseDb, data);
  });
