import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { InferenceSummary } from "./usage-schedule-inference.server";

/** Backfill projected calendar dates for usage-based maintenance intervals. */
export const inferUsageScheduledDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InferenceSummary> => {
    const { backfillUsageScheduledDates } = await import("./usage-schedule-inference.server");
    return backfillUsageScheduledDates(context.supabase, context.userId);
  });
