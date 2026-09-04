// Admin-only server function that runs the private schema_diagnostics()
// SECURITY DEFINER function and returns a structured report of missing
// tables, enums, and triggers, plus RLS/policy status.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TableCheck = {
  table: string;
  present: boolean;
  rls_enabled: boolean;
  policy_count: number;
};
export type EnumCheck = {
  type: string;
  present: boolean;
  labels: string[];
};
export type TriggerCheck = {
  table: string;
  trigger: string;
  present: boolean;
};
export type SchemaDiagnostics = {
  checked_at: string;
  tables: TableCheck[];
  enums: EnumCheck[];
  triggers: TriggerCheck[];
};

export const getSchemaDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SchemaDiagnostics> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supa = context.supabase as any;
    // Read `user_roles` under RLS. The `has_role()` helper now lives in the
    // `private` schema and is not exposed through PostgREST, so an
    // `rpc("has_role", ...)` call fails with
    // "function public.has_role(uuid, unknown) does not exist".
    const { data: roleRow, error: roleErr } = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(`Role check failed: ${roleErr.message}`);
    if (!roleRow) throw new Error("Forbidden: admin role required");


    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data, error } = await admin.schema("private").rpc("schema_diagnostics");
    if (error) throw new Error(`Diagnostics failed: ${error.message}`);
    return data as SchemaDiagnostics;
  });
