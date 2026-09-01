// Server functions for printed panel QR labels, the read-only panel sheet and
// the administrator-approved 24-hour edit window.
//
// Rules enforced here (the UI is only a convenience):
//  * every caller must be signed in AND hold the `electrical` add-on;
//  * the panel sheet is READ-ONLY unless the caller is an administrator or has
//    an approved, unexpired grant for that exact panel;
//  * only an administrator with a verified second factor (AAL2) may approve,
//    decline or revoke a window.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import { isAdminRole } from "@/lib/admin-role.server";
import {
  GRANT_WINDOW_HOURS,
  accessState,
  grantExpiry,
  isEditUnlocked,
  latestRequest,
  type PanelAccessState,
  type PanelEditRequest,
} from "@/lib/electrical-panel-access";
import { resolveSystemVoltage } from "@/lib/electrical-system-voltage";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type PanelRow = { id: string } & Record<string, Json>;

const panelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((s) => s.toUpperCase());

/** Panel reference data is farm-wide: readable by any entitled signed-in user. */
async function readerClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    from: (table: string) => any;
    auth: unknown;
  };
}

async function requireMfaAdmin(context: {
  supabase: unknown;
  userId: string;
  claims: Record<string, unknown>;
}) {
  if (!(await isAdminRole(context.supabase, context.userId))) {
    throw new Error("Forbidden: administrator role required to decide access requests.");
  }
  if (String(context.claims["aal"] ?? "") !== "aal2") {
    throw new Error(
      "Second factor required: verify your authenticator code before approving or revoking access.",
    );
  }
}

function toRequest(row: Record<string, unknown>): PanelEditRequest {
  return {
    id: String(row["id"]),
    panel_id: String(row["panel_id"]),
    requester_id: String(row["requester_id"]),
    requester_email: (row["requester_email"] as string | null) ?? null,
    reason: (row["reason"] as string | null) ?? null,
    status: row["status"] as PanelEditRequest["status"],
    decided_by: (row["decided_by"] as string | null) ?? null,
    decided_at: (row["decided_at"] as string | null) ?? null,
    decision_note: (row["decision_note"] as string | null) ?? null,
    expires_at: (row["expires_at"] as string | null) ?? null,
    revoked_at: (row["revoked_at"] as string | null) ?? null,
    created_at: String(row["created_at"]),
  };
}

/* ------------------------------------------------------------ label printing */

export interface PanelLabel {
  id: string;
  panel_id: string;
  description: string | null;
  building: string | null;
  grid: string | null;
  bus_rating_amps: number | null;
  voltage: number | null;
  phase: string | null;
  spaces: number | null;
  feeder_source: string | null;
  /** Full system designation when one is stored, e.g. "120/240 V, 1φ, 3-wire". */
  voltage_designation: string | null;
  install_status: string | null;
}

/** Every panel, with just the fields a printed label carries. */
export const listPanelLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PanelLabel[]> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = await readerClient();
    const { data, error } = await db
      .from("electrical_panels")
      .select(
        "id, panel_id, description, building, grid, bus_rating_amps, voltage, phase, spaces, feeder_source, system_voltage, install_status",
      )
      .order("panel_id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r["id"]),
      panel_id: String(r["panel_id"] ?? ""),
      description: (r["description"] as string | null) ?? null,
      building: (r["building"] as string | null) ?? null,
      grid: (r["grid"] as string | null) ?? null,
      bus_rating_amps: (r["bus_rating_amps"] as number | null) ?? null,
      voltage: (r["voltage"] as number | null) ?? null,
      phase: (r["phase"] as string | null) ?? null,
      spaces: (r["spaces"] as number | null) ?? null,
      feeder_source: (r["feeder_source"] as string | null) ?? null,
      voltage_designation: resolveSystemVoltage(r["system_voltage"])?.designation ?? null,
      install_status: (r["install_status"] as string | null) ?? null,
    }));
  });

/* ---------------------------------------------------------------- panel sheet */

export interface PanelSheetAccess {
  state: PanelAccessState;
  is_admin: boolean;
  can_edit: boolean;
  expires_at: string | null;
  request: PanelEditRequest | null;
  window_hours: number;
}

export interface PanelSheet {
  panel: PanelRow;
  voltage_designation: string | null;
  breakers: PanelRow[];
  circuit_groups: PanelRow[];
  loads: PanelRow[];
  feeders_in: PanelRow[];
  feeders_out: PanelRow[];
  raceways: PanelRow[];
  branch_runs: PanelRow[];
  access: PanelSheetAccess;
  captured_at: string;
}

/**
 * Everything an electrician needs at the panel door, read-only by default.
 * Scanning the printed QR lands here.
 */
export const panelSheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ panelId: panelIdSchema }).parse(d))
  .handler(async ({ context, data }): Promise<PanelSheet> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = await readerClient();

    const { data: panelRow, error } = await db
      .from("electrical_panels")
      .select("*")
      .eq("panel_id", data.panelId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!panelRow) throw new Error(`No panel is recorded with the ID ${data.panelId}.`);
    const panel = panelRow as Record<string, unknown>;
    const panelUuid = String(panel["id"]);

    const rows = async (table: string, build: (q: any) => any): Promise<PanelRow[]> => {
      const { data: out, error: e } = await build(db.from(table).select("*"));
      if (e) throw new Error(e.message);
      return (out ?? []) as PanelRow[];
    };

    const [breakers, circuitGroups, feedersIn, feedersOut, raceways, branchRuns] = await Promise.all([
      rows("electrical_breaker_positions", (q) =>
        q.eq("panel_uuid", panelUuid).order("side").order("position"),
      ),
      rows("electrical_circuit_groups", (q) => q.eq("panel_uuid", panelUuid).order("circuit_group_id")),
      rows("electrical_feeders", (q) => q.eq("dest_panel_uuid", panelUuid).order("feeder_id")),
      rows("electrical_feeders", (q) => q.eq("source_panel_uuid", panelUuid).order("feeder_id")),
      rows("electrical_raceways", (q) => q.eq("source_panel_uuid", panelUuid).order("exit_order")),
      rows("electrical_branch_runs", (q) => q.eq("source_panel_uuid", panelUuid).order("branch_id")),
    ]);

    const groupIds = circuitGroups.map((g) => String(g["id"]));
    const loads = groupIds.length
      ? await rows("electrical_loads", (q) => q.in("circuit_group_uuid", groupIds).order("load_id"))
      : [];

    const isAdmin = await isAdminRole(context.supabase, context.userId);
    const { data: reqRows, error: reqError } = await db
      .from("electrical_panel_edit_requests")
      .select("*")
      .eq("panel_id", data.panelId)
      .eq("requester_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (reqError) throw new Error(reqError.message);
    const request = latestRequest(((reqRows ?? []) as Record<string, unknown>[]).map(toRequest));

    return {
      panel: panel as PanelRow,
      voltage_designation: resolveSystemVoltage(panel["system_voltage"])?.designation ?? null,
      breakers,
      circuit_groups: circuitGroups,
      loads,
      feeders_in: feedersIn,
      feeders_out: feedersOut,
      raceways,
      branch_runs: branchRuns,
      access: {
        state: accessState(request),
        is_admin: isAdmin,
        can_edit: isAdmin || isEditUnlocked(request),
        expires_at: request?.expires_at ?? null,
        request,
        window_hours: GRANT_WINDOW_HOURS,
      },
      captured_at: new Date().toISOString(),
    };
  });

/* --------------------------------------------------------------- access flow */

/** Ask an administrator for a 24-hour edit window on one panel. */
export const requestPanelEditAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        panelId: panelIdSchema,
        reason: z.string().trim().max(500).optional(),
        reviewUrl: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = await readerClient();

    const { data: panel, error: panelError } = await db
      .from("electrical_panels")
      .select("panel_id")
      .eq("panel_id", data.panelId)
      .maybeSingle();
    if (panelError) throw new Error(panelError.message);
    if (!panel) throw new Error(`No panel is recorded with the ID ${data.panelId}.`);

    // An open request or a live window is never duplicated.
    const { data: existingRows } = await db
      .from("electrical_panel_edit_requests")
      .select("*")
      .eq("panel_id", data.panelId)
      .eq("requester_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(10);
    const existing = latestRequest(((existingRows ?? []) as Record<string, unknown>[]).map(toRequest));
    const state = accessState(existing);
    if (state === "pending" || state === "active") {
      return { request: existing!, state, notified: null as null | string, duplicate: true };
    }

    const email = (context.claims["email"] as string | undefined) ?? null;
    const { data: inserted, error } = await db
      .from("electrical_panel_edit_requests")
      .insert({
        panel_id: data.panelId,
        requester_id: context.userId,
        requester_email: email,
        reason: data.reason ?? null,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const request = toRequest(inserted as Record<string, unknown>);

    const { notifyAdminsOfPanelRequest } = await import("@/lib/panel-access.server");
    const notice = await notifyAdminsOfPanelRequest({
      panelId: data.panelId,
      requesterEmail: email,
      reason: data.reason ?? null,
      requestedAt: request.created_at,
      reviewUrl: data.reviewUrl ?? "/admin/panel-access",
    });

    return {
      request,
      state: "pending" as PanelAccessState,
      notified: notice.emailed
        ? `Emailed ${notice.recipients} administrator(s).`
        : `${notice.recipients} administrator(s) will see this in the approval queue.`,
      duplicate: false,
    };
  });

/** The caller's own requests, newest first. */
export const myPanelEditRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PanelEditRequest[]> => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const { data, error } = await (context.supabase as unknown as { from: (t: string) => any })
      .from("electrical_panel_edit_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(toRequest);
  });

export interface AdminRequestRow extends PanelEditRequest {
  state: PanelAccessState;
  panel_description: string | null;
  panel_building: string | null;
}

/** The administrator approval queue: pending first, then recent decisions. */
export const listPanelEditRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: AdminRequestRow[]; pending: number }> => {
    if (!(await isAdminRole(context.supabase, context.userId))) {
      throw new Error("Forbidden: administrator role required.");
    }
    const db = await readerClient();
    const { data, error } = await db
      .from("electrical_panel_edit_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const requests = ((data ?? []) as Record<string, unknown>[]).map(toRequest);

    const { data: panels } = await db.from("electrical_panels").select("panel_id, description, building");
    const byId = new Map(
      ((panels ?? []) as Record<string, unknown>[]).map((p) => [String(p["panel_id"]), p]),
    );

    const rows: AdminRequestRow[] = requests.map((r) => {
      const p = byId.get(r.panel_id);
      return {
        ...r,
        state: accessState(r),
        panel_description: (p?.["description"] as string | null) ?? null,
        panel_building: (p?.["building"] as string | null) ?? null,
      };
    });
    rows.sort((a, b) => {
      const rank = (s: PanelAccessState) => (s === "pending" ? 0 : s === "active" ? 1 : 2);
      return rank(a.state) - rank(b.state) || b.created_at.localeCompare(a.created_at);
    });
    return { rows, pending: rows.filter((r) => r.state === "pending").length };
  });

/**
 * Approve or decline a request. Requires the administrator role AND a verified
 * second factor on the current session; approval opens exactly one 24-hour
 * window and never extends an existing one silently.
 */
export const decidePanelEditRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireMfaAdmin(context as never);
    const db = await readerClient();

    const { data: current, error: readError } = await db
      .from("electrical_panel_edit_requests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("That request no longer exists.");
    const request = toRequest(current as Record<string, unknown>);
    if (request.status !== "pending") {
      throw new Error(`That request was already ${request.status}.`);
    }

    const decidedAt = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: data.decision,
      decided_by: context.userId,
      decided_at: decidedAt,
      decision_note: data.note ?? null,
      expires_at: data.decision === "approved" ? grantExpiry(decidedAt) : null,
    };
    const { data: updated, error } = await db
      .from("electrical_panel_edit_requests")
      .update(patch)
      .eq("id", data.id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = toRequest(updated as Record<string, unknown>);
    return { request: row, state: accessState(row) };
  });

/** End a live window early. Same administrator + second-factor requirement. */
export const revokePanelEditGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireMfaAdmin(context as never);
    const db = await readerClient();
    const { data: updated, error } = await db
      .from("electrical_panel_edit_requests")
      .update({ revoked_at: new Date().toISOString(), decided_by: context.userId })
      .eq("id", data.id)
      .eq("status", "approved")
      .is("revoked_at", null)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = toRequest(updated as Record<string, unknown>);
    return { request: row, state: accessState(row) };
  });

/* ----------------------------------------------------- gated field correction */

/** Fields the temporary window may correct. Stable IDs are never editable. */
export const PANEL_SHEET_EDITABLE = [
  "description",
  "building",
  "bus_rating_amps",
  "voltage",
  "phase",
  "spaces",
  "circuits",
  "feeder_source",
  "backup_class",
  "install_status",
  "label_status",
  "notes",
] as const;

/**
 * Save corrections from the panel sheet. Allowed only for administrators or a
 * caller holding a live approved window for THIS panel, re-checked here.
 */
export const savePanelSheetDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        panelId: panelIdSchema,
        values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = await readerClient();

    const isAdmin = await isAdminRole(context.supabase, context.userId);
    if (!isAdmin) {
      const { data: reqRows, error: reqError } = await db
        .from("electrical_panel_edit_requests")
        .select("*")
        .eq("panel_id", data.panelId)
        .eq("requester_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (reqError) throw new Error(reqError.message);
      const request = latestRequest(((reqRows ?? []) as Record<string, unknown>[]).map(toRequest));
      if (!isEditUnlocked(request)) {
        throw new Error(
          "Your edit window is not active. Request access and wait for an administrator to approve it.",
        );
      }
    }

    const allowed = new Set<string>(PANEL_SHEET_EDITABLE);
    const patch: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(data.values)) {
      if (!allowed.has(key)) continue;
      if (raw === null || raw === "") {
        patch[key] = null;
        continue;
      }
      const numeric = ["bus_rating_amps", "voltage", "spaces", "circuits"].includes(key);
      patch[key] = numeric ? Number(raw) : String(raw);
    }
    if (!Object.keys(patch).length) return { updated: false };

    const { error } = await db
      .from("electrical_panels")
      .update(patch)
      .eq("panel_id", data.panelId);
    if (error) throw new Error(error.message);
    return { updated: true, fields: Object.keys(patch) };
  });
