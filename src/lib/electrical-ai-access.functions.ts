// Electrician-requested / admin-approved AI feature access.
//
// An electrician can see every Electrical AI scenario, tick the ones they want
// and submit them for approval. An administrator approves, rejects or revokes
// them from Admin → Users. Approval only unlocks a *scenario* — it never widens
// which electrical records the person can read, and AI stays read-only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminRole, requireAdminRole } from "@/lib/admin-role.server";
import {
  isElectricalAiScenarioId,
  type ElectricalAiScenarioId,
} from "@/lib/electrical-ai-scenarios";

export const AI_GRANT_TABLE = "electrical_ai_feature_grants";

export type ElectricalAiGrantStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";

export interface ElectricalAiGrantRow {
  user_id: string;
  scenario: ElectricalAiScenarioId;
  status: ElectricalAiGrantStatus;
  request_note: string | null;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

type LooseDb = { from: (table: string) => any };

const SELECT_COLS =
  "user_id, scenario, status, request_note, requested_at, decided_at, decision_note";

/** Approved scenario ids for one user — used by the AI scope resolver. */
export async function loadApprovedAiScenarios(
  supabase: unknown,
  userId: string,
): Promise<ElectricalAiScenarioId[]> {
  const { data, error } = await (supabase as LooseDb)
    .from(AI_GRANT_TABLE)
    .select("scenario, status")
    .eq("user_id", userId)
    .eq("status", "approved");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { scenario: string }[])
    .map((r) => r.scenario)
    .filter(isElectricalAiScenarioId);
}

/**
 * Scenarios an admin explicitly switched off for this user (revoked/rejected).
 * These override add-on entitlement, so unticking in Admin → Users really
 * removes the scenario from the user's AI features tab.
 */
export async function loadDeniedAiScenarios(
  supabase: unknown,
  userId: string,
): Promise<ElectricalAiScenarioId[]> {
  const { data, error } = await (supabase as LooseDb)
    .from(AI_GRANT_TABLE)
    .select("scenario, status")
    .eq("user_id", userId)
    .in("status", ["revoked", "rejected"]);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { scenario: string }[])
    .map((r) => r.scenario)
    .filter(isElectricalAiScenarioId);
}

/** The signed-in caller's own request/grant rows. */
export const listMyElectricalAiFeatureRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ElectricalAiGrantRow[]> => {
    const { data, error } = await (context.supabase as LooseDb)
      .from(AI_GRANT_TABLE)
      .select(SELECT_COLS)
      .eq("user_id", context.userId)
      .order("scenario");
    if (error) throw new Error(error.message);
    return (data ?? []) as ElectricalAiGrantRow[];
  });

const RequestInput = z.object({
  scenarios: z
    .array(z.string().refine(isElectricalAiScenarioId, "Unknown scenario"))
    .min(1)
    .max(20),
  note: z.string().trim().max(500).optional(),
});

/** Submit (or re-submit) scenarios for admin approval. Always lands as pending. */
export const requestElectricalAiFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RequestInput.parse(d))
  .handler(async ({ data, context }): Promise<{ requested: string[] }> => {
    const db = context.supabase as LooseDb;
    const now = new Date().toISOString();
    const rows = data.scenarios.map((scenario) => ({
      user_id: context.userId,
      scenario,
      status: "pending" as const,
      request_note: data.note ?? null,
      requested_at: now,
      decided_by: null,
      decided_at: null,
      decision_note: null,
    }));
    const { error } = await db
      .from(AI_GRANT_TABLE)
      .upsert(rows, { onConflict: "user_id,scenario" });
    if (error) throw new Error(error.message);
    return { requested: data.scenarios };
  });

export interface AdminElectricalAiGrantRow extends ElectricalAiGrantRow {
  decided_by: string | null;
}

/** Every request/grant row, for the admin user-management extension. */
export const adminListElectricalAiFeatureGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminElectricalAiGrantRow[]> => {
    await requireAdminRole(context.supabase, context.userId);
    const { data, error } = await (context.supabase as LooseDb)
      .from(AI_GRANT_TABLE)
      .select(`${SELECT_COLS}, decided_by`)
      .order("requested_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminElectricalAiGrantRow[];
  });

const DecideInput = z.object({
  userId: z.string().uuid(),
  /** Scenarios that should end up approved for this user. Everything else is cleared. */
  approved: z.array(z.string().refine(isElectricalAiScenarioId, "Unknown scenario")),
  /** Pending scenarios the admin explicitly turned down. */
  rejected: z
    .array(z.string().refine(isElectricalAiScenarioId, "Unknown scenario"))
    .optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Authoritative per-user AI feature set. Ticked scenarios become `approved`;
 * previously approved scenarios that are no longer ticked become `revoked` (the
 * row is kept so the history of the request and decision survives).
 */
export const adminSetElectricalAiFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DecideInput.parse(d))
  .handler(async ({ data, context }): Promise<{ approved: string[]; cleared: string[] }> => {
    if (!(await isAdminRole(context.supabase, context.userId))) {
      throw new Error("Forbidden: admin role required");
    }
    const db = context.supabase as LooseDb;
    const { data: existing, error: readErr } = await db
      .from(AI_GRANT_TABLE)
      .select(SELECT_COLS)
      .eq("user_id", data.userId);
    if (readErr) throw new Error(readErr.message);

    const rows = (existing ?? []) as ElectricalAiGrantRow[];
    const now = new Date().toISOString();
    const approved = new Set(data.approved);
    const rejected = new Set(data.rejected ?? []);
    const cleared: string[] = [];

    const upserts: Record<string, unknown>[] = [];

    for (const scenario of approved) {
      const prior = rows.find((r) => r.scenario === scenario);
      upserts.push({
        user_id: data.userId,
        scenario,
        status: "approved",
        request_note: prior?.request_note ?? null,
        requested_at: prior?.requested_at ?? now,
        decided_by: context.userId,
        decided_at: now,
        decision_note: data.note ?? null,
      });
    }

    for (const row of rows) {
      if (approved.has(row.scenario)) continue;
      const next: ElectricalAiGrantStatus = rejected.has(row.scenario)
        ? "rejected"
        : row.status === "approved"
          ? "revoked"
          : row.status === "pending"
            ? "rejected"
            : row.status;
      if (next === row.status) continue;
      cleared.push(row.scenario);
      upserts.push({
        user_id: data.userId,
        scenario: row.scenario,
        status: next,
        request_note: row.request_note,
        requested_at: row.requested_at,
        decided_by: context.userId,
        decided_at: now,
        decision_note: data.note ?? null,
      });
    }

    if (upserts.length > 0) {
      const { error } = await db
        .from(AI_GRANT_TABLE)
        .upsert(upserts, { onConflict: "user_id,scenario" });
      if (error) throw new Error(error.message);
    }
    return { approved: [...approved], cleared };
  });
