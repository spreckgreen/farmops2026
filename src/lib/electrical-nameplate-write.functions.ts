// Nameplate → equipment row write path, gated by administrator approval.
//
// Flow: an electrician with electrical read access submits a nameplate draft
// against one load row → the request lands `pending` and writes nothing → an
// administrator reviews the field-by-field diff and approves or declines.
// Approval is the only code path that touches `electrical_loads`, and it only
// ever writes the `nameplate_*` columns.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  NAMEPLATE_WRITE_IDS,
  nameplateChanges,
  nameplateColumnPatch,
  sanitizeNameplateProposal,
  type NameplateFieldChange,
  type NameplateWriteRequestRow,
} from "@/lib/electrical-nameplate-write";

type LooseDb = { from: (table: string) => any };

export const NAMEPLATE_WRITE_TABLE = "electrical_nameplate_write_requests";

const SELECT_COLS =
  "id, requested_by, load_uuid, load_ref, load_label, proposed, request_note, status, decided_by, decided_at, decision_note, applied_at, applied_fields, created_at";

const LOAD_COLS =
  "id, load_id, description, location, nameplate_manufacturer, nameplate_model, nameplate_serial, nameplate_volts, nameplate_phase, nameplate_fla_rla, nameplate_mca, nameplate_mocp";

function toRow(raw: Record<string, unknown>): NameplateWriteRequestRow {
  return {
    ...(raw as unknown as NameplateWriteRequestRow),
    proposed: sanitizeNameplateProposal(
      (raw["proposed"] ?? {}) as Record<string, unknown>,
    ),
    applied_fields: (raw["applied_fields"] ?? null) as Record<string, string> | null,
  };
}

export interface NameplateTargetLoad {
  id: string;
  load_id: string;
  description: string | null;
  location: string | null;
}

/** Equipment rows a nameplate draft can be attached to. */
export const listNameplateTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ search: z.string().trim().max(120).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<NameplateTargetLoad[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const { data: rows, error } = await (context.supabase as unknown as LooseDb)
      .from("electrical_loads")
      .select("id, load_id, description, location")
      .order("load_id");
    if (error) throw new Error(error.message);
    let out = (rows ?? []) as NameplateTargetLoad[];
    if (data.search) {
      const needle = data.search.toLowerCase();
      out = out.filter((r) =>
        `${r.load_id} ${r.description ?? ""} ${r.location ?? ""}`
          .toLowerCase()
          .includes(needle),
      );
    }
    return out.slice(0, 200);
  });

const SubmitInput = z.object({
  loadUuid: z.string().uuid(),
  proposed: z.record(z.string(), z.union([z.string(), z.null()])),
  note: z.string().trim().max(500).optional(),
});

/**
 * Submit a nameplate draft for approval. Nothing is written to the equipment
 * row here — the request is the record until an administrator decides.
 */
export const submitNameplateWriteRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubmitInput.parse(d))
  .handler(async ({ context, data }): Promise<NameplateWriteRequestRow> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");

    const proposal = sanitizeNameplateProposal(data.proposed);
    if (Object.keys(proposal).length === 0) {
      throw new Error(
        `Nothing legible to submit. Writable fields are: ${NAMEPLATE_WRITE_IDS.join(", ")}.`,
      );
    }

    const { data: load, error: loadError } = await (context.supabase as unknown as LooseDb)
      .from("electrical_loads")
      .select(LOAD_COLS)
      .eq("id", data.loadUuid)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!load) throw new Error("That equipment row could not be found.");

    const changes = nameplateChanges(proposal, load as Record<string, unknown>);
    if (changes.length === 0) {
      throw new Error("The equipment row already holds these nameplate values.");
    }

    const { data: inserted, error } = await (context.supabase as unknown as LooseDb)
      .from(NAMEPLATE_WRITE_TABLE)
      .insert({
        requested_by: context.userId,
        load_uuid: data.loadUuid,
        load_ref: (load as { load_id?: string }).load_id ?? null,
        load_label: (load as { description?: string | null }).description ?? null,
        proposed: proposal,
        request_note: data.note ?? null,
        status: "pending",
      })
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return toRow(inserted as Record<string, unknown>);
  });

/** The caller's own nameplate write requests, newest first. */
export const myNameplateWriteRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NameplateWriteRequestRow[]> => {
    const { data, error } = await (context.supabase as unknown as LooseDb)
      .from(NAMEPLATE_WRITE_TABLE)
      .select(SELECT_COLS)
      .eq("requested_by", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(toRow);
  });

export interface NameplateWriteReview extends NameplateWriteRequestRow {
  requester_email: string | null;
  changes: NameplateFieldChange[];
}

/** Admin queue: pending requests with the exact diff approval would apply. */
export const listNameplateWriteRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ status: z.enum(["pending", "approved", "rejected", "all"]).default("pending") })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<NameplateWriteReview[]> => {
    await requireAdminRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as LooseDb;

    let q = db
      .from(NAMEPLATE_WRITE_TABLE)
      .select(SELECT_COLS)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const requests = ((rows ?? []) as Record<string, unknown>[]).map(toRow);
    if (requests.length === 0) return [];

    const loadIds = [...new Set(requests.map((r) => r.load_uuid))];
    const { data: loads, error: loadError } = await db
      .from("electrical_loads")
      .select(LOAD_COLS)
      .in("id", loadIds);
    if (loadError) throw new Error(loadError.message);
    const byId = new Map(
      ((loads ?? []) as Record<string, unknown>[]).map((l) => [String(l["id"]), l]),
    );

    const userIds = [...new Set(requests.map((r) => r.requested_by))];
    const { data: profiles } = await db
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    const emailById = new Map(
      ((profiles ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]),
    );

    return requests.map((r) => ({
      ...r,
      requester_email: emailById.get(r.requested_by) ?? null,
      changes: nameplateChanges(r.proposed, byId.get(r.load_uuid) ?? null),
    }));
  });

const DecideInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  /** Optional subset of field ids to apply; defaults to every proposed field. */
  fields: z.array(z.string()).max(20).optional(),
  note: z.string().trim().max(300).optional(),
});

export interface NameplateDecisionResult {
  request: NameplateWriteRequestRow;
  applied: Record<string, string>;
}

/**
 * Administrator decision. Approval is the gate: it is the only place the
 * nameplate columns of `electrical_loads` are written, and it writes nothing
 * else — semantic as-installed values are untouched.
 */
export const decideNameplateWriteRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DecideInput.parse(d))
  .handler(async ({ context, data }): Promise<NameplateDecisionResult> => {
    await requireAdminRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as LooseDb;

    const { data: current, error: readError } = await db
      .from(NAMEPLATE_WRITE_TABLE)
      .select(SELECT_COLS)
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("That request no longer exists.");
    const request = toRow(current as Record<string, unknown>);
    if (request.status !== "pending") {
      throw new Error(`That request was already ${request.status}.`);
    }

    const decidedAt = new Date().toISOString();
    let applied: Record<string, string> = {};

    if (data.decision === "approved") {
      const keep = data.fields && data.fields.length > 0 ? new Set(data.fields) : null;
      applied = Object.fromEntries(
        Object.entries(request.proposed).filter(([id]) => !keep || keep.has(id)),
      );
      if (Object.keys(applied).length === 0) {
        throw new Error("Select at least one field to apply before approving.");
      }
      const patch = {
        ...nameplateColumnPatch(applied),
        nameplate_source: "ai_photo_extract",
        nameplate_captured_at: request.created_at,
        nameplate_applied_by: context.userId,
      };
      const { error: writeError } = await db
        .from("electrical_loads")
        .update(patch)
        .eq("id", request.load_uuid);
      if (writeError) throw new Error(writeError.message);
    }

    const { data: updated, error } = await db
      .from(NAMEPLATE_WRITE_TABLE)
      .update({
        status: data.decision,
        decided_by: context.userId,
        decided_at: decidedAt,
        decision_note: data.note ?? null,
        applied_at: data.decision === "approved" ? decidedAt : null,
        applied_fields: data.decision === "approved" ? applied : null,
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);

    return { request: toRow(updated as Record<string, unknown>), applied };
  });
