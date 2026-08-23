/**
 * Shared admin-role assertion for server functions and server routes.
 *
 * Always checked with a *user-scoped* Supabase client (RLS applies), never the
 * service role — the caller's own token must prove the admin row exists.
 */
type RoleClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (a: string, b: string) => {
        eq: (a: string, b: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
};

export async function isAdminRole(supabase: unknown, userId: string): Promise<boolean> {
  const { data, error } = await (supabase as RoleClient)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function requireAdminRole(supabase: unknown, userId: string): Promise<void> {
  if (!(await isAdminRole(supabase, userId))) {
    throw new Error("Forbidden: admin role required");
  }
}
