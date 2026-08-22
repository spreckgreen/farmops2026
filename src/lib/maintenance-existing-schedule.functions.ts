// Existing (already drafted/applied) maintenance schedule lookup, used to
// confirm with the user before researching a supplemental schedule.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface ExistingScheduleEntry {
  id: string;
  asset_id: string | null;
  asset_name: string | null;
  title: string | null;
  service_type: string | null;
  recurrence: string | null;
  due_at: string | null;
  scheduled_date: string | null;
  status: string | null;
}

const Input = z.object({
  asset_ids: z.array(z.string().uuid()).min(1).max(200),
});

export const listExistingSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ExistingScheduleEntry[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("maintenance_records")
      .select(
        "id, asset_id, asset_name, title, service_type, recurrence, due_at, scheduled_date, status",
      )
      .eq("user_id", userId)
      .in("asset_id", data.asset_ids)
      .neq("status", "completed")
      .order("due_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ExistingScheduleEntry[];
  });
