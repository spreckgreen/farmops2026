// Who may use the planner print sheets.
//
// Administrators always may. Anyone else needs an explicit grant recorded in
// task_print_grants by an administrator — the grant is data, never a client-side
// flag, and every read/write below is checked server-side.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminRole, requireAdminRole } from "@/lib/admin-role.server";

type LooseDb = { from: (table: string) => any };

export interface TaskPrintAccess {
  allowed: boolean;
  isAdmin: boolean;
  /** True when access comes from an explicit grant rather than the admin role. */
  granted: boolean;
}

/**
 * Whether the signed-in person has the premium print package: planner sheets,
 * label sheets, grid sheets, and publishing to Ghost and Obsidian.
 */
export const taskPrintAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskPrintAccess> => {
    const isAdmin = await isAdminRole(context.supabase, context.userId);
    if (isAdmin) return { allowed: true, isAdmin: true, granted: false };
    const granted = await hasPremiumPrint(context.supabase, context.userId);
    return { allowed: granted, isAdmin: false, granted };
  });

export interface TaskPrintGrantRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  note: string | null;
  created_at: string;
}

/** Everyone currently granted planner printing (administrators only). */
export const listTaskPrintGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskPrintGrantRow[]> => {
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;
    const grants = await db
      .from("task_print_grants")
      .select("user_id,note,created_at")
      .order("created_at", { ascending: true });
    if (grants.error) throw new Error(grants.error.message);
    const rows = (grants.data ?? []) as Record<string, any>[];
    if (!rows.length) return [];
    const profiles = await db
      .from("profiles")
      .select("id,email,display_name")
      .in("id", rows.map((r) => String(r["user_id"])));
    if (profiles.error) throw new Error(profiles.error.message);
    const byId = new Map(
      ((profiles.data ?? []) as Record<string, any>[]).map((p) => [String(p["id"]), p]),
    );
    return rows.map((r) => {
      const p = byId.get(String(r["user_id"]));
      return {
        user_id: String(r["user_id"]),
        email: (p?.["email"] as string | null) ?? null,
        display_name: (p?.["display_name"] as string | null) ?? null,
        note: (r["note"] as string | null) ?? null,
        created_at: String(r["created_at"]),
      };
    });
  });

/** Grants or revokes planner printing for one person (administrators only). */
export const setTaskPrintGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; allowed: boolean; note?: string | null }) => {
    if (!data?.user_id) throw new Error("A person must be chosen.");
    return {
      user_id: String(data.user_id),
      allowed: Boolean(data.allowed),
      note: data.note ? String(data.note).trim() || null : null,
    };
  })
  .handler(async ({ context, data }): Promise<{ allowed: boolean }> => {
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;
    if (!data.allowed) {
      const del = await db.from("task_print_grants").delete().eq("user_id", data.user_id);
      if (del.error) throw new Error(del.error.message);
      return { allowed: false };
    }
    const up = await db
      .from("task_print_grants")
      .upsert(
        {
          user_id: data.user_id,
          granted_by: context.userId,
          note: data.note,
        },
        { onConflict: "user_id" },
      );
    if (up.error) throw new Error(up.error.message);
    return { allowed: true };
  });
