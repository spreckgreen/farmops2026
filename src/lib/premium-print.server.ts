/**
 * Premium print entitlement, checked server-side.
 *
 * One grant covers the whole premium print package:
 *   - planner sheets (the task print templates)
 *   - electrical label sheets
 *   - grid sheets (grid map print / PDF)
 *   - publishing out to Ghost and to an Obsidian vault
 *
 * Administrators always have it. Anyone else needs an explicit row in
 * task_print_grants, written by an administrator. Always checked with the
 * caller's own user-scoped client so RLS applies.
 */
import { isAdminRole } from "@/lib/admin-role.server";

type LooseDb = { from: (table: string) => any };

export async function hasPremiumPrint(supabase: unknown, userId: string): Promise<boolean> {
  if (await isAdminRole(supabase, userId)) return true;
  const res = await (supabase as LooseDb)
    .from("task_print_grants")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return Boolean(res.data);
}

export async function requirePremiumPrint(supabase: unknown, userId: string): Promise<void> {
  if (!(await hasPremiumPrint(supabase, userId))) {
    throw new Error(
      "Premium print is not enabled for this account. An administrator can grant it.",
    );
  }
}
