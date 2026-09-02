// Read + review side of the Electrical change audit.
//
// Administrators see every recorded change and can mark entries reviewed; an
// electrician sees their own history so they can check what they submitted.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminRole } from "@/lib/admin-role.server";
import { AUDIT_TABLE, type AuditFieldChange } from "@/lib/electrical-audit.server";

type LooseDb = { from: (table: string) => any };

export interface AuditEntry {
  id: string;
  user_id: string;
  actor_email: string | null;
  section: string;
  entity_kind: string;
  entity_uuid: string | null;
  entity_ref: string | null;
  action: "create" | "update" | "delete";
  summary: string | null;
  changes: AuditFieldChange[];
  access_basis: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
}

export interface AuditReport {
  /** True when the caller is an administrator seeing every actor. */
  isAdmin: boolean;
  entries: AuditEntry[];
  total: number;
  unreviewed: number;
  actors: string[];
}

export const listElectricalChangeAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        /** "unreviewed" narrows to changes still awaiting admin review. */
        filter: z.enum(["all", "unreviewed", "reviewed"]).default("all"),
        actor: z.string().trim().max(160).optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<AuditReport> => {
    const db = context.supabase as unknown as LooseDb;
    const isAdmin = await isAdminRole(context.supabase, context.userId);

    // RLS already scopes a non-admin to their own rows; the explicit filter
    // keeps the query honest rather than relying on the policy alone.
    let query = db.from(AUDIT_TABLE).select("*").order("created_at", { ascending: false });
    if (!isAdmin) query = query.eq("user_id", context.userId);
    if (data.filter === "unreviewed") query = query.is("reviewed_at", null);
    if (data.filter === "reviewed") query = query.not("reviewed_at", "is", null);
    if (data.actor) query = query.eq("actor_email", data.actor);

    const { data: rows, error } = await query.limit(data.limit);
    if (error) throw new Error(error.message);

    const entries = ((rows ?? []) as AuditEntry[]).map((r) => ({
      ...r,
      changes: Array.isArray(r.changes) ? r.changes : [],
    }));

    return {
      isAdmin,
      entries,
      total: entries.length,
      unreviewed: entries.filter((e) => !e.reviewed_at).length,
      actors: Array.from(
        new Set(entries.map((e) => e.actor_email).filter((e): e is string => Boolean(e))),
      ).sort(),
    };
  });

/** Admin sign-off on one recorded change. The change itself is never altered. */
export const reviewElectricalChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        note: z.string().trim().max(1000).optional(),
        /** false re-opens an entry that was marked reviewed by mistake. */
        reviewed: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    if (!(await isAdminRole(context.supabase, context.userId))) {
      throw new Error("Only an administrator can review electrical changes.");
    }
    const { error } = await (context.supabase as unknown as LooseDb)
      .from(AUDIT_TABLE)
      .update({
        reviewed_at: data.reviewed ? new Date().toISOString() : null,
        reviewed_by: data.reviewed ? context.userId : null,
        review_note: data.note?.trim() || null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
