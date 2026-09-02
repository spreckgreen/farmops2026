// Server functions behind the AI feature switches and the metered AI bill.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import {
  AI_FEATURE_AREAS,
  isAiAreaId,
  type AiAreaId,
} from "@/lib/ai-feature-areas";
import type {
  AiAreaUsageReport,
  AiAreaUsageRow,
  AiFeatureToggle,
  AiUsageBill,
  AiUsageBillRow,
  AiUsageEvent,
} from "@/lib/ai-usage";

type LooseDb = { from: (table: string) => any };

const AREA_IDS = AI_FEATURE_AREAS.map((a) => a.id) as [AiAreaId, ...AiAreaId[]];

/** Every feature area with its current switch state (absent row = enabled). */
export const getAiFeatureToggles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiFeatureToggle[]> => {
    const { loadAiFeatureToggles } = await import("./ai-feature-toggles.server");
    const rows = await loadAiFeatureToggles(context.supabase);
    const byArea = new Map(rows.map((r) => [r.area, r]));
    return AI_FEATURE_AREAS.map((area) => {
      const row = byArea.get(area.id);
      return {
        area: area.id,
        enabled: row ? row.enabled !== false : true,
        note: row?.note ?? null,
        updated_at: row?.updated_at ?? null,
      };
    });
  });

const ToggleInput = z.object({
  area: z.enum(AREA_IDS),
  enabled: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export const setAiFeatureToggle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ToggleInput.parse(d))
  .handler(async ({ data, context }): Promise<{ area: string; enabled: boolean }> => {
    await requireAdminRole(context.supabase, context.userId);
    const { AI_TOGGLE_TABLE } = await import("./ai-feature-toggles.server");
    const { error } = await (context.supabase as unknown as LooseDb)
      .from(AI_TOGGLE_TABLE)
      .upsert(
        {
          area: data.area,
          enabled: data.enabled,
          note: data.note ?? null,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "area" },
      );
    if (error) throw new Error(error.message);
    return { area: data.area, enabled: data.enabled };
  });

const WindowInput = z.object({ days: z.number().int().min(1).max(365).default(30) });

/** The caller's own metered usage — shown to non-admins on the assistant page. */
export const getMyAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WindowInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AiUsageEvent[]> => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { AI_USAGE_TABLE } = await import("./ai-metering.server");
    const { data: rows, error } = await (context.supabase as unknown as LooseDb)
      .from(AI_USAGE_TABLE)
      .select("*")
      .eq("user_id", context.userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (rows ?? []) as AiUsageEvent[];
  });

/** Running AI bill per user, for Admin → Users. */
export const getAiUsageBill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WindowInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AiUsageBill> => {
    await requireAdminRole(context.supabase, context.userId);
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const db = context.supabase as unknown as LooseDb;
    const { AI_USAGE_TABLE } = await import("./ai-metering.server");
    const { data: rows, error } = await db
      .from(AI_USAGE_TABLE)
      .select(
        "user_id, area, area_label, backend, metered, cost_usd, input_tokens, output_tokens, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20_000);
    if (error) throw new Error(error.message);

    const events = (rows ?? []) as Array<{
      user_id: string;
      area: string;
      area_label: string | null;
      backend: string;
      metered: boolean;
      cost_usd: number | string;
      input_tokens: number;
      output_tokens: number;
      created_at: string;
    }>;

    const emails = new Map<string, string | null>();
    const ids = Array.from(new Set(events.map((e) => e.user_id)));
    if (ids.length) {
      const { data: profiles } = await db
        .from("profiles")
        .select("id, email")
        .in("id", ids);
      for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) {
        emails.set(p.id, p.email ?? null);
      }
    }

    const byUser = new Map<string, AiUsageBillRow & { areas: Map<string, { label: string; runs: number; costUsd: number }> }>();
    for (const e of events) {
      const cost = Number(e.cost_usd) || 0;
      let row = byUser.get(e.user_id);
      if (!row) {
        row = {
          userId: e.user_id,
          email: emails.get(e.user_id) ?? null,
          runs: 0,
          meteredRuns: 0,
          localRuns: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          lastRunAt: null,
          byArea: [],
          areas: new Map(),
        };
        byUser.set(e.user_id, row);
      }
      row.runs += 1;
      if (e.metered) row.meteredRuns += 1;
      else row.localRuns += 1;
      row.inputTokens += e.input_tokens ?? 0;
      row.outputTokens += e.output_tokens ?? 0;
      row.costUsd += cost;
      if (!row.lastRunAt || e.created_at > row.lastRunAt) row.lastRunAt = e.created_at;
      const label =
        e.area_label ??
        (isAiAreaId(e.area) ? AI_FEATURE_AREAS.find((a) => a.id === e.area)?.label ?? e.area : e.area);
      const area = row.areas.get(e.area) ?? { label, runs: 0, costUsd: 0 };
      area.runs += 1;
      area.costUsd += cost;
      row.areas.set(e.area, area);
    }

    const billRows: AiUsageBillRow[] = Array.from(byUser.values())
      .map(({ areas, ...row }) => ({
        ...row,
        costUsd: Number(row.costUsd.toFixed(6)),
        byArea: Array.from(areas.entries())
          .map(([area, v]) => ({ area, label: v.label, runs: v.runs, costUsd: Number(v.costUsd.toFixed(6)) }))
          .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

    return {
      since,
      days: data.days,
      totalRuns: billRows.reduce((n, r) => n + r.runs, 0),
      totalMeteredRuns: billRows.reduce((n, r) => n + r.meteredRuns, 0),
      totalCostUsd: Number(billRows.reduce((n, r) => n + r.costUsd, 0).toFixed(6)),
      rows: billRows,
    };
  });

/**
 * Per-feature usage and cloud spend over a window. Admins see every user's
 * runs; anyone else sees only their own (RLS enforces that either way).
 */
export const getAiAreaUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => WindowInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AiAreaUsageReport> => {
    const { isAdminRole } = await import("@/lib/admin-role.server");
    const allUsers = await isAdminRole(context.supabase, context.userId);
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { AI_USAGE_TABLE } = await import("./ai-metering.server");
    const db = context.supabase as unknown as LooseDb;
    let query = db
      .from(AI_USAGE_TABLE)
      .select(
        "user_id, area, backend, metered, estimated, model, cost_usd, input_tokens, output_tokens, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20_000);
    if (!allUsers) query = query.eq("user_id", context.userId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const events = (rows ?? []) as Array<{
      user_id: string;
      area: string;
      backend: string;
      metered: boolean;
      estimated: boolean;
      model: string | null;
      cost_usd: number | string;
      input_tokens: number;
      output_tokens: number;
      created_at: string;
    }>;

    const acc = new Map<
      string,
      AiAreaUsageRow & { userIds: Set<string>; modelSet: Set<string>; meteredCost: number }
    >();
    for (const e of events) {
      let row = acc.get(e.area);
      if (!row) {
        row = {
          area: e.area,
          runs: 0,
          meteredRuns: 0,
          localRuns: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          avgMeteredCostUsd: 0,
          users: 0,
          lastRunAt: null,
          models: [],
          anyEstimated: false,
          userIds: new Set<string>(),
          modelSet: new Set<string>(),
          meteredCost: 0,
        };
        acc.set(e.area, row);
      }
      const cost = Number(e.cost_usd) || 0;
      row.runs += 1;
      if (e.metered) {
        row.meteredRuns += 1;
        row.meteredCost += cost;
      } else {
        row.localRuns += 1;
      }
      row.costUsd += cost;
      row.inputTokens += e.input_tokens ?? 0;
      row.outputTokens += e.output_tokens ?? 0;
      if (e.estimated) row.anyEstimated = true;
      row.userIds.add(e.user_id);
      if (e.model) row.modelSet.add(e.model);
      if (!row.lastRunAt || e.created_at > row.lastRunAt) row.lastRunAt = e.created_at;
    }

    const areaRows: AiAreaUsageRow[] = Array.from(acc.values())
      .map(({ userIds, modelSet, meteredCost, ...row }) => ({
        ...row,
        costUsd: Number(row.costUsd.toFixed(6)),
        avgMeteredCostUsd:
          row.meteredRuns > 0 ? Number((meteredCost / row.meteredRuns).toFixed(6)) : 0,
        users: userIds.size,
        models: Array.from(modelSet).sort(),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

    return {
      since,
      days: data.days,
      allUsers,
      totalRuns: areaRows.reduce((n, r) => n + r.runs, 0),
      totalMeteredRuns: areaRows.reduce((n, r) => n + r.meteredRuns, 0),
      totalCostUsd: Number(areaRows.reduce((n, r) => n + r.costUsd, 0).toFixed(6)),
      rows: areaRows,
    };
  });
