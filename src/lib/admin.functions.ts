// User-management server functions: profile/role lookups for the current
// user, plus admin-only management of approval status and roles.
//
// Role model:
//   * viewer — read-only access to app data
//   * editor — can create/update app data (tasks, notes, inventory, …)
//   * admin  — everything editors can do plus user management & app settings
//
// Approval flow: new sign-ups land with status='pending'. The AppLayout's
// ProfileGate shows a "waiting for approval" screen until an admin promotes
// them to 'approved'. Rejected users see a rejection screen.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "viewer" | "editor" | "admin";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type MyProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: ApprovalStatus;
  roles: AppRole[];
  canEdit: boolean;
  isAdmin: boolean;
};

export type ManagedUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: ApprovalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  roles: AppRole[];
};

// ---- Helpers -------------------------------------------------------------

async function requireAdmin(supabase: NonNullable<unknown>, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

// ---- Current-user profile (called every time the layout mounts) ---------

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile> => {
    const { supabase, userId, claims } = context;
    const email = (claims as { email?: string }).email ?? null;

    // Ensure a profile row exists for this user. New sign-ups land pending.
    const existing = await supabase
      .from("profiles")
      .select("id, email, display_name, status")
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let profile = existing.data;
    if (!profile) {
      const inserted = await supabase
        .from("profiles")
        .insert({ id: userId, email, status: "pending" })
        .select("id, email, display_name, status")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      profile = inserted.data;
    } else if (email && profile.email !== email) {
      // Keep email in sync with the auth record.
      await supabase.from("profiles").update({ email }).eq("id", userId);
      profile.email = email;
    }

    const rolesRes = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesRes.error) throw new Error(rolesRes.error.message);
    const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);

    return {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      status: profile.status as ApprovalStatus,
      roles,
      canEdit: roles.includes("editor") || roles.includes("admin"),
      isAdmin: roles.includes("admin"),
    };
  });

// ---- Admin-only management ----------------------------------------------

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagedUser[]> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    const profiles = await supabase
      .from("profiles")
      .select("id, email, display_name, status, reviewed_by, reviewed_at, created_at")
      .order("created_at", { ascending: false });
    if (profiles.error) throw new Error(profiles.error.message);

    const roles = await supabase.from("user_roles").select("user_id, role");
    if (roles.error) throw new Error(roles.error.message);

    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of roles.data ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as AppRole);
      rolesByUser.set(r.user_id, arr);
    }

    return (profiles.data ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      status: p.status as ApprovalStatus,
      reviewed_by: p.reviewed_by,
      reviewed_at: p.reviewed_at,
      created_at: p.created_at,
      roles: rolesByUser.get(p.id) ?? [],
    }));
  });

export const setApprovalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; status: ApprovalStatus }) => {
    if (!d.userId) throw new Error("userId required");
    if (!["pending", "approved", "rejected"].includes(d.status)) {
      throw new Error("invalid status");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const upd = await supabaseAdmin
      .from("profiles")
      .update({
        status: data.status,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.userId);
    if (upd.error) throw new Error(upd.error.message);

    // On first approval, give the user the viewer role if they have none.
    if (data.status === "approved") {
      const existing = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.userId);
      if (!existing.error && (existing.data?.length ?? 0) === 0) {
        await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: data.userId, role: "viewer", granted_by: userId });
      }
    }
    return { ok: true };
  });

export const setUserRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; roles: AppRole[] }) => {
    if (!d.userId) throw new Error("userId required");
    if (!Array.isArray(d.roles)) throw new Error("roles must be an array");
    for (const r of d.roles) {
      if (!["viewer", "editor", "admin"].includes(r)) {
        throw new Error(`invalid role: ${r}`);
      }
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    // Don't let an admin strip their own admin role — keeps at least one
    // admin in the system and avoids accidental lock-out.
    if (data.userId === userId && !data.roles.includes("admin")) {
      throw new Error("You cannot remove your own admin role.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const del = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (del.error) throw new Error(del.error.message);

    if (data.roles.length) {
      const ins = await supabaseAdmin
        .from("user_roles")
        .insert(
          data.roles.map((role) => ({
            user_id: data.userId,
            role,
            granted_by: userId,
          })),
        );
      if (ins.error) throw new Error(ins.error.message);
    }
    return { ok: true };
  });
