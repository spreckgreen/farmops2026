// Audit sheet writes: one small, targeted status/notes update per tap, so a walk
// through the shop records real progress on the authoritative electrical tables.
//
// Nothing is created here — the row must already exist, and the write is scoped to
// the signed-in owner. Only install status, completion percent and notes change;
// no relationship, location or engineering value is touched.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { INSTALL_STATUSES } from "@/lib/electrical-install-progress.functions";

type LooseDb = { from: (table: string) => any };

const TABLE: Record<string, string> = {
  panel: "electrical_panels",
  position: "electrical_breaker_positions",
  circuit: "electrical_circuit_groups",
  load: "electrical_loads",
};

/** Tables that carry a completion_percent column. */
const HAS_PERCENT = new Set(["electrical_panels", "electrical_circuit_groups", "electrical_loads"]);

export const recordAuditSheetEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["panel", "position", "circuit", "load"]),
        uuid: z.string().uuid(),
        installStatus: z.enum(INSTALL_STATUSES).optional(),
        completionPercent: z
          .union([z.number(), z.string()])
          .nullish()
          .transform((v) => {
            if (v == null || v === "") return null;
            const n = Number(v);
            return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
          }),
        notes: z
          .string()
          .trim()
          .max(2000)
          .nullish()
          .transform((v) => (v == null ? undefined : v === "" ? null : v)),
      })
      .refine((v) => v.installStatus != null || v.completionPercent != null || v.notes !== undefined, {
        message: "Nothing to record.",
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true; kind: string; uuid: string }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const table = TABLE[data.kind]!;
    const patch: Record<string, unknown> = {};
    if (data.installStatus) patch.install_status = data.installStatus;
    if (data.completionPercent != null && HAS_PERCENT.has(table)) {
      patch.completion_percent = data.completionPercent;
    }
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await db
      .from(table)
      .update(patch)
      .eq("id", data.uuid)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, kind: data.kind, uuid: data.uuid };
  });
