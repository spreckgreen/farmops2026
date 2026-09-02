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
  /**
   * Administrative suspension — deliberately separate from approval status and
   * from add-on revocation. A disabled account keeps its approval and roles but
   * cannot use the app until an administrator re-enables it.
   */
  disabled_at: string | null;
  disabled_reason: string | null;
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
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  disabled_reason: string | null;
};



// ---- Helpers -------------------------------------------------------------

async function requireAdmin(supabase: NonNullable<unknown>, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

// ---- Current-user profile (called every time the layout mounts) ---------

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile> => {
    const { supabase, userId, claims } = context;
    const email = (claims as { email?: string }).email ?? null;

    const cols = "id, email, display_name, status, disabled_at, disabled_reason";
    // Ensure a profile row exists for this user. New sign-ups land pending.
    const existing = await supabase
      .from("profiles")
      .select(cols)
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let profile = existing.data;
    if (!profile) {
      const inserted = await supabase
        .from("profiles")
        .insert({ id: userId, email, status: "pending" })
        .select(cols)
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
      disabled_at: profile.disabled_at ?? null,
      disabled_reason: profile.disabled_reason ?? null,
    };

  });

// ---- One-click self re-seed (bootstrap / recovery) ----------------------
//
// Ensures the signed-in user has a `profiles` row (status=approved) and an
// admin role in `user_roles`. Safe because:
//   * Non-admins can only self-grant admin when NO admin exists yet
//     (fresh self-hosted DB bootstrap). Once any admin exists, this
//     endpoint refuses to escalate — a non-admin caller only gets their
//     profile row ensured, without any role change.
//   * Existing admins can call it any time to repair a missing profile
//     or role row after a partial restore.

export type ReseedResult = {
  ok: boolean;
  email: string | null;
  profile: "created" | "updated" | "unchanged";
  adminRole: "granted" | "already" | "denied_admins_exist";
  message: string;
};

export const reseedMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReseedResult> => {
    const { userId, claims } = context;
    const email = (claims as { email?: string }).email ?? null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Ensure the profile row exists and is approved.
    const existing = await supabaseAdmin
      .from("profiles")
      .select("id, status, email")
      .eq("id", userId)
      .maybeSingle();
    if (existing.error) throw new Error(`profiles lookup failed: ${existing.error.message}`);

    let profileState: ReseedResult["profile"] = "unchanged";
    if (!existing.data) {
      const ins = await supabaseAdmin
        .from("profiles")
        .insert({ id: userId, email, status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString() });
      if (ins.error) throw new Error(`profile insert failed: ${ins.error.message}`);
      profileState = "created";
    } else if (existing.data.status !== "approved" || (email && existing.data.email !== email)) {
      const upd = await supabaseAdmin
        .from("profiles")
        .update({ status: "approved", email: email ?? existing.data.email, reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("id", userId);
      if (upd.error) throw new Error(`profile update failed: ${upd.error.message}`);
      profileState = "updated";
    }

    // 2. Decide whether to grant the admin role.
    const myAdmin = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (myAdmin.error) throw new Error(`role lookup failed: ${myAdmin.error.message}`);

    let adminRole: ReseedResult["adminRole"];
    if (myAdmin.data) {
      adminRole = "already";
    } else {
      // Bootstrap allowed only when no admin exists yet.
      const anyAdmin = await supabaseAdmin
        .from("user_roles")
        .select("id", { head: true, count: "exact" })
        .eq("role", "admin");
      if (anyAdmin.error) throw new Error(`admin count failed: ${anyAdmin.error.message}`);

      if ((anyAdmin.count ?? 0) === 0) {
        const grant = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: userId, role: "admin", granted_by: userId });
        if (grant.error) throw new Error(`admin grant failed: ${grant.error.message}`);
        adminRole = "granted";
      } else {
        adminRole = "denied_admins_exist";
      }
    }

    const parts: string[] = [];
    parts.push(
      profileState === "created"
        ? "Profile created (approved)."
        : profileState === "updated"
          ? "Profile updated to approved."
          : "Profile already approved.",
    );
    if (adminRole === "granted") parts.push("Admin role granted (bootstrap).");
    else if (adminRole === "already") parts.push("Admin role already present.");
    else parts.push("Admin role NOT granted — another admin already exists; ask them to promote you.");

    return {
      ok: true,
      email,
      profile: profileState,
      adminRole,
      message: parts.join(" "),
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

    // Pull auth confirmation + last-sign-in via admin API so the UI can flag
    // unconfirmed accounts and offer the "Confirm email" action.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const authByUser = new Map<string, { confirmed: string | null; lastSignIn: string | null }>();
    try {
      const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of data?.users ?? []) {
        authByUser.set(u.id, {
          confirmed: u.email_confirmed_at ?? null,
          lastSignIn: u.last_sign_in_at ?? null,
        });
      }
    } catch {
      // Non-fatal — fall back to unknown confirmation state.
    }

    return (profiles.data ?? []).map((p) => {
      const auth = authByUser.get(p.id);
      return {
        id: p.id,
        email: p.email,
        display_name: p.display_name,
        status: p.status as ApprovalStatus,
        reviewed_by: p.reviewed_by,
        reviewed_at: p.reviewed_at,
        created_at: p.created_at,
        roles: rolesByUser.get(p.id) ?? [],
        email_confirmed_at: auth?.confirmed ?? null,
        last_sign_in_at: auth?.lastSignIn ?? null,
      };
    });
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

// ---- Confirm a user's email (bypass the email-confirmation link) --------

export const confirmUserEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => {
    if (!d?.userId) throw new Error("userId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(
      data.userId,
      { email_confirm: true },
    );
    if (error) throw new Error(error.message);
    return { ok: true, email_confirmed_at: updated.user.email_confirmed_at ?? null };
  });

// ---- Bulk-confirm every unconfirmed user (one-click) --------------------

export type BulkConfirmResult = {
  ok: true;
  confirmed: Array<{ id: string; email: string | null }>;
  failed: Array<{ id: string; email: string | null; error: string }>;
};

export const confirmAllUnconfirmedUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BulkConfirmResult> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const confirmed: BulkConfirmResult["confirmed"] = [];
    const failed: BulkConfirmResult["failed"] = [];

    // Page through auth.users; confirm any without email_confirmed_at.
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.email_confirmed_at) continue;
        const upd = await supabaseAdmin.auth.admin.updateUserById(u.id, { email_confirm: true });
        if (upd.error) failed.push({ id: u.id, email: u.email ?? null, error: upd.error.message });
        else confirmed.push({ id: u.id, email: u.email ?? null });
      }
      if (users.length < 200) break;
    }

    return { ok: true, confirmed, failed };
  });

// ---- Set a temporary password (admin-only). The user should change it
// immediately after signing in.

export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; password: string }) => {
    if (!d?.userId) throw new Error("userId required");
    if (typeof d.password !== "string" || d.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    if (d.password.length > 128) throw new Error("Password too long.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Also mark the email confirmed — an unconfirmed user still can't sign in
    // even with a valid password, and this is the common "let them in" case.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });



// ---- Reset application data (self-host fresh start) ---------------------
//
// Wipes every row of operational app data so a freshly self-hosted instance
// can start clean for a new farm. Preserves user accounts, profiles, and
// role assignments so the admin who runs this stays signed in and in charge.

const RESET_TABLES = [
  "activity_log",
  "summaries",
  "daily_notes",
  "tasks",
  "projects",
  "maintenance_records",
  "consumables",
  "inventory_items",
  "crop_harvests",
  "crop_plantings",
  "garden_plots",
  "orchard_trees",
  "livestock_animals",
  "plant_seasons",
  "food_storage_items",
  "food_storage_plan",
  "food_plan_entries",
  "food_plan_foods",
  "food_plan_people",
  "food_price_history",
  "procedures",
] as const;


export type ResetSummary = { table: string; deleted: number | null; error?: string };

export const resetApplicationData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirm: string }) => {
    if (d?.confirm !== "RESET") {
      throw new Error('Confirmation text must be exactly "RESET".');
    }
    return d;
  })
  .handler(async ({ context }): Promise<{ ok: true; results: ResetSummary[] }> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: ResetSummary[] = [];
    for (const table of RESET_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await (supabaseAdmin as any)
        .from(table)
        .delete({ count: "exact" })
        .not("id", "is", null);
      results.push({
        table,
        deleted: error ? null : (count ?? 0),
        error: error?.message,
      });
    }
    return { ok: true, results };
  });

// ---- Export snapshot of all operational data ---------------------------
//
// Dumps every row of every operational table as JSON so a freshly deployed
// self-hosted instance can be seeded from an existing farm's data. Admin-only.
//
// Every snapshot embeds a SHA-256 integrity digest over the canonicalized
// `app + version + tables` payload. The restore endpoint recomputes the
// digest and refuses the import on mismatch, so a snapshot that was
// truncated mid-download or hand-edited will fail fast rather than
// partially overwrite the database.

import {
  computeIntegrity,
  normalizeIntegrityEnvelope,
  verifyIntegrity,
  type IntegrityEnvelope,
} from "./snapshot-integrity";

export type SnapshotTable = {
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  error?: string;
};

export type Snapshot = {
  generated_at: string;
  generated_by: string;
  app: "bostead";
  version: 1;
  tables: SnapshotTable[];
  /**
   * Integrity envelope. Present on every snapshot generated by this app
   * since the introduction of `snapshot-integrity.ts`. Older v1 snapshots
   * may omit it; the restore endpoint refuses them by default unless the
   * caller explicitly opts in via `allowMissingIntegrity: true`.
   */
  integrity?: IntegrityEnvelope;
};

export const exportApplicationData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Snapshot> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    // Use the request-scoped (user JWT + publishable key) client for reads.
    // The service-role client cannot be used for PostgREST GETs on Lovable
    // Cloud because the injected key is not in JWT format and PostgREST
    // rejects it with "Expected 3 parts in JWT; got 1". RLS still applies,
    // but in this single-farm app every operational table is owned by the
    // admin's user_id, so the admin sees every row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = supabase as any;

    const tables: SnapshotTable[] = [];
    // PostgREST caps a single response at ~1000 rows. Page through every
    // table with explicit ranges so large tables (activity_log) are exported
    // in full instead of being silently truncated.
    const PAGE_SIZE = 1000;
    for (const table of RESET_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = [];
      let pageError: string | undefined;
      let from = 0;
      // Hard cap defends against accidental infinite loops if a page ever
      // returns more rows than requested.
      for (let page = 0; page < 1000; page++) {
        const { data, error } = await reader
          .from(table)
          .select("*")
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          pageError = error.message;
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batch = (data as any[]) ?? [];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      tables.push({ table, rows: pageError ? [] : rows, error: pageError });
    }
    const payload = { app: "bostead" as const, version: 1 as const, tables };
    const integrity = await computeIntegrity(payload);
    return {
      generated_at: new Date().toISOString(),
      generated_by: userId,
      ...payload,
      integrity,
    };
  });


// ---- Restore snapshot (import) -----------------------------------------
//
// Re-imports a snapshot produced by `exportApplicationData`. Admin-only.
// Two modes:
//   - "merge"   (default) upsert each row by primary key `id`; never deletes
//   - "replace" wipe each table first, then insert every row
// Returns a per-table report so the UI can show what changed and where.

export type ImportMode = "merge" | "replace";

export type RestoreDebugInfo = {
  stage: "delete" | "write";
  chunkIndex?: number;
  chunkSize?: number;
  sampleRowJson?: string;

  rowKeys?: string[];
  postgrest: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  };
  diagnostics: {
    rlsEnabled?: boolean;
    policies?: Array<{ policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }>;
    grants?: Array<{ grantee: string; privilege_type: string }>;
    canInsertAsAuthenticated?: boolean;
    diagnosticsError?: string;
  };
};

export type ImportTableResult = {
  table: string;
  attempted: number;
  succeeded: number;
  deleted: number; // only set in replace mode
  error?: string;
  debug?: RestoreDebugInfo;
};

export type ImportResult = {
  ok: boolean;
  mode: ImportMode;
  dry_run: boolean;
  rewrite_ownership: boolean;
  started_at: string;
  finished_at: string;
  results: ImportTableResult[];
  debug?: boolean;
};



// Explicit topological order: parents before children. Reversing RESET_TABLES
// is not sufficient because dependencies aren't linear (e.g. food_price_history
// references food_plan_foods, and activity_log references daily_notes + tasks).
const RESTORE_INSERT_ORDER = [
  "procedures",
  "food_plan_people",
  "food_plan_foods",
  "food_price_history",   // → food_plan_foods
  "food_plan_entries",    // → food_plan_foods, food_plan_people
  "food_storage_plan",
  "food_storage_items",
  "plant_seasons",
  "livestock_animals",
  "orchard_trees",
  "garden_plots",
  "crop_plantings",
  "crop_harvests",        // → crop_plantings
  "inventory_items",
  "consumables",
  "maintenance_records",
  "projects",
  "tasks",
  "daily_notes",
  "summaries",
  "activity_log",         // → daily_notes, tasks
] as const;

// Per-table conflict target for merge-mode upsert. Defaults to "id" (primary
// key). Tables with additional unique constraints that ownership rewriting
// can collide with need their natural key here — otherwise a row whose PK is
// new but whose (user_id, natural_key) already exists throws 23505.
const RESTORE_CONFLICT_TARGETS: Record<string, string> = {
  daily_notes: "user_id,date",
};

const RESTORE_USER_SCOPED_COLUMNS = ["user_id"] as const;

export function scopeRestoreRowsToUser(rows: SnapshotTable["rows"], userId: string): SnapshotTable["rows"] {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const scoped = { ...row } as Record<string, unknown>;
    for (const column of RESTORE_USER_SCOPED_COLUMNS) {
      if (column in scoped) scoped[column] = userId;
    }
    return scoped;
  });
}

export const importApplicationData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      snapshot: Snapshot;
      mode?: ImportMode;
      confirm?: string;
      allowMissingIntegrity?: boolean;
      debug?: boolean;
      dryRun?: boolean;
      rewriteOwnership?: boolean;
    }) => {
      if (!d || typeof d !== "object") throw new Error("Invalid payload");
      if (!d.snapshot || d.snapshot.app !== "bostead") {
        throw new Error('Not a Bostead snapshot (missing app: "bostead")');
      }
      if (d.snapshot.version !== 1) {
        throw new Error(`Unsupported snapshot version: ${d.snapshot.version}`);
      }
      if (!Array.isArray(d.snapshot.tables)) {
        throw new Error("Snapshot has no tables array");
      }
      const mode: ImportMode = d.mode === "replace" ? "replace" : "merge";
      const dryRun = d.dryRun === true;
      // Replace mode requires REPLACE confirmation only for live runs; dry-runs
      // never touch the database, so the confirmation is unnecessary.
      if (mode === "replace" && !dryRun && d.confirm !== "REPLACE") {
        throw new Error('Replace mode requires confirm="REPLACE".');
      }
      return {
        snapshot: d.snapshot,
        mode,
        confirm: d.confirm,
        allowMissingIntegrity: d.allowMissingIntegrity === true,
        debug: d.debug === true,
        dryRun,
        // Default true preserves prior behavior (rewrite to caller). Ownership
        // is ALWAYS derived from the bearer-verified userId — this flag only
        // toggles whether rewriting happens, never who the target is.
        rewriteOwnership: d.rewriteOwnership !== false,
      };
    },

  )

  .handler(async ({ data, context }): Promise<ImportResult> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);

    // Fail-fast integrity check BEFORE touching the database. A snapshot
    // that was truncated mid-download, hand-edited, or corrupted on disk
    // is rejected here so the restore can never partially apply.
    const normalizedIntegrity = normalizeIntegrityEnvelope(data.snapshot.integrity, {
      app: data.snapshot.app,
      version: data.snapshot.version,
      tables: data.snapshot.tables,
    });
    if (normalizedIntegrity) {
      const verdict = await verifyIntegrity(
        {
          app: data.snapshot.app,
          version: data.snapshot.version,
          tables: data.snapshot.tables,
        },
        normalizedIntegrity,
      );
      if (!verdict.ok) {
        throw new Error(
          `Snapshot integrity check failed: ${verdict.reason} ` +
            `(expected ${verdict.expected.slice(0, 12)}…, got ${verdict.actual.slice(0, 12)}…)`,
        );
      }
    } else if (!data.allowMissingIntegrity) {
      throw new Error(
        "Snapshot has no integrity digest. Re-export from a current Bostead " +
          "instance, or pass allowMissingIntegrity: true to import a legacy file.",
      );
    }

    // Use the request-scoped (user JWT) client. The service-role client
    // cannot be used on Lovable Cloud — PostgREST rejects the injected
    // sb_secret_* key with "Expected 3 parts in JWT; got 1". RLS still
    // applies, but in this single-farm app the admin owns every row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabase as any;


    const startedAt = new Date().toISOString();
    const byTable = new Map<string, SnapshotTable>();
    for (const t of data.snapshot.tables) byTable.set(t.table, t);


    const results: ImportTableResult[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function collectDiagnostics(table: string): Promise<RestoreDebugInfo["diagnostics"]> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: diag, error } = await (admin as any).rpc("restore_table_diagnostics", {
          _table: table,
        });
        if (error) return { diagnosticsError: error.message };
        const d = (diag ?? {}) as Record<string, unknown>;
        return {
          rlsEnabled: d.rls_enabled as boolean | undefined,
          policies: d.policies as RestoreDebugInfo["diagnostics"]["policies"],
          grants: d.grants as RestoreDebugInfo["diagnostics"]["grants"],
          canInsertAsAuthenticated: d.can_authenticated_insert as boolean | undefined,
        };
      } catch (e) {
        return { diagnosticsError: (e as Error).message };
      }
    }


    function safeSampleRow(row: unknown): string | undefined {
      try {
        return JSON.stringify(row);
      } catch {
        return undefined;
      }
    }

    for (const table of RESTORE_INSERT_ORDER) {
      const snap = byTable.get(table);
      const sourceRows = snap?.rows ?? [];
      // Ownership rewriting: userId comes exclusively from the verified bearer
      // token via requireSupabaseAuth. Callers cannot inject an alternate owner.
      const rows = data.rewriteOwnership
        ? scopeRestoreRowsToUser(sourceRows, userId)
        : sourceRows;
      let deleted = 0;
      let succeeded = 0;
      let errorMessage: string | undefined;
      let debug: RestoreDebugInfo | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const captureDebug = async (stage: "delete" | "write", pgErr: any, chunkIndex?: number, chunk?: any[]) => {
        if (!data.debug) return;
        debug = {
          stage,
          chunkIndex,
          chunkSize: chunk?.length,
          sampleRowJson: chunk && chunk.length ? safeSampleRow(chunk[0]) : undefined,
          rowKeys: chunk && chunk.length && chunk[0] && typeof chunk[0] === "object" ? Object.keys(chunk[0]) : undefined,
          postgrest: {
            message: pgErr?.message ?? String(pgErr),
            code: pgErr?.code,
            details: pgErr?.details,
            hint: pgErr?.hint,
          },
          diagnostics: await collectDiagnostics(table),
        };
      };

      try {
        if (data.dryRun) {
          // No writes. Report what WOULD happen: rows to insert/upsert, and
          // for replace, the current row count that would be deleted first.
          if (data.mode === "replace") {
            const { count, error: countErr } = await admin
              .from(table)
              .select("id", { count: "exact", head: true });
            if (countErr) {
              await captureDebug("delete", countErr);
              throw new Error(`preview count failed: ${countErr.message}`);
            }
            deleted = count ?? 0;
          }
          succeeded = rows.length;
        } else {
          if (data.mode === "replace") {
            const { error: delErr, count } = await admin
              .from(table)
              .delete({ count: "exact" })
              .not("id", "is", null);
            if (delErr) {
              await captureDebug("delete", delErr);
              throw new Error(`delete failed: ${delErr.message}`);
            }
            deleted = count ?? 0;
          }

          if (rows.length > 0) {
            const CHUNK = 500;
            for (let i = 0; i < rows.length; i += CHUNK) {
              const chunk = rows.slice(i, i + CHUNK);
              const onConflict = RESTORE_CONFLICT_TARGETS[table] ?? "id";
              const query =
                data.mode === "replace"
                  ? admin.from(table).insert(chunk)
                  : admin.from(table).upsert(chunk, { onConflict });
              const { error: writeErr } = await query;
              if (writeErr) {
                await captureDebug("write", writeErr, i, chunk);
                throw new Error(`write failed at chunk ${i}: ${writeErr.message}`);
              }
              succeeded += chunk.length;
            }
          }
        }
      } catch (e) {
        errorMessage = (e as Error).message;
      }

      results.push({
        table,
        attempted: rows.length,
        succeeded,
        deleted,
        error: errorMessage,
        debug,
      });
    }

    const ok = results.every((r) => !r.error);
    return {
      ok,
      mode: data.mode,
      dry_run: data.dryRun,
      rewrite_ownership: data.rewriteOwnership,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results,
      debug: data.debug,
    };
  });



