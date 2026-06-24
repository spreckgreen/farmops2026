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
  started_at: string;
  finished_at: string;
  results: ImportTableResult[];
  debug?: boolean;
};


const RESTORE_INSERT_ORDER = [...RESET_TABLES].reverse(); // parents before children

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
      if (mode === "replace" && d.confirm !== "REPLACE") {
        throw new Error('Replace mode requires confirm="REPLACE".');
      }
      return {
        snapshot: d.snapshot,
        mode,
        confirm: d.confirm,
        allowMissingIntegrity: d.allowMissingIntegrity === true,
        debug: d.debug === true,
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
      const rows = scopeRestoreRowsToUser(sourceRows, userId);
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
            const query =
              data.mode === "replace"
                ? admin.from(table).insert(chunk)
                : admin.from(table).upsert(chunk, { onConflict: "id" });
            const { error: writeErr } = await query;
            if (writeErr) {
              await captureDebug("write", writeErr, i, chunk);
              throw new Error(`write failed at chunk ${i}: ${writeErr.message}`);
            }
            succeeded += chunk.length;
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
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results,
      debug: data.debug,
    };
  });


