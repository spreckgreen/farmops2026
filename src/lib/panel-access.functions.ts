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
import { ensureScanAddon, requireAddon, requireAnyAddon, hasAddon } from "@/lib/addons.server";
import { PANEL_SHEET_ADDONS } from "@/lib/addons";
import { isAdminRole } from "@/lib/admin-role.server";
import {
  GRANT_WINDOW_HOURS,
  accessState,
  canReadPanel,
  grantExpiry,
  isEditUnlocked,
  latestRequest,
  latestWiderRequest,
  type PanelAccessScope,
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
    scope: ((row["scope"] as PanelAccessScope | null) ?? "panel_edit") as PanelAccessScope,
    scope_detail: (row["scope_detail"] as string | null) ?? null,
    status: row["status"] as PanelEditRequest["status"],
    decided_by: (row["decided_by"] as string | null) ?? null,
    decided_at: (row["decided_at"] as string | null) ?? null,
    decision_note: (row["decision_note"] as string | null) ?? null,
    expires_at: (row["expires_at"] as string | null) ?? null,
    revoked_at: (row["revoked_at"] as string | null) ?? null,
    created_at: String(row["created_at"]),
  };
}

/* ------------------------------------------------- scanned-panel bookkeeping */

/**
 * The panels this user actually reached by scanning a printed label. A
 * scan-provisioned viewer may only open these; nothing else in the electrical
 * record is readable to them without an administrator-approved wider window.
 */
async function scannedPanelIds(db: { from: (t: string) => any }, userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("electrical_scan_grants")
    .select("panel_id")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { panel_id: string }[]).map((r) => String(r.panel_id).toUpperCase());
}

/** Remember that this user scanned this panel (idempotent). */
async function recordScannedPanel(
  db: { from: (t: string) => any },
  userId: string,
  panelId: string,
): Promise<void> {
  await db
    .from("electrical_scan_grants")
    .upsert(
      { user_id: userId, panel_id: panelId },
      { onConflict: "user_id,panel_id", ignoreDuplicates: true },
    );
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
    // Printing the whole label sheet is farm-wide, so it stays on the full add-on.
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

/**
 * Whether this viewer may look past the panel(s) they scanned. A scanned label
 * only ever carries that panel plus its own local topology; anything wider needs
 * an administrator-approved building / site / system window.
 */
export interface SystemDataAccess {
  state: PanelAccessState;
  granted: boolean;
  expires_at: string | null;
  request: PanelEditRequest | null;
  window_hours: number;
  /** The scope of the newest wider request, so the UI can name what is live. */
  scope: PanelAccessScope | null;
  /** The named building / site the live window covers, when scoped that way. */
  scope_detail: string | null;
  /** True when this window is farm-wide (site or system), not one building. */
  covers_whole_system: boolean;
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
  /** Wider read access; false keeps the page scoped to scanned panels only. */
  system_access: SystemDataAccess;
  /** Panels this viewer reached by scanning a printed label. */
  scanned_panels: string[];
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
    await requireAnyAddon(context.supabase, context.userId, PANEL_SHEET_ADDONS);
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

    const isAdmin = await isAdminRole(context.supabase, context.userId);
    const fullAddon = await hasAddon(context.supabase, context.userId, "electrical");

    // Every request row for this caller: the panel-edit window for THIS panel and
    // any wider read window they hold, whatever panel it was raised from.
    const { data: allRows, error: allError } = await db
      .from("electrical_panel_edit_requests")
      .select("*")
      .eq("requester_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (allError) throw new Error(allError.message);
    const myRequests = ((allRows ?? []) as Record<string, unknown>[]).map(toRequest);
    const request = latestRequest(
      myRequests.filter((r) => r.panel_id === data.panelId),
      "panel_edit",
    );
    const widerRequest = latestWiderRequest(myRequests);

    // Scope enforcement: a scan-provisioned viewer sees only the panels they
    // physically scanned, plus whatever an approved wider window covers.
    const scanned = fullAddon || isAdmin ? [] : await scannedPanelIds(db, context.userId);
    const allowed = canReadPanel({
      fullAddon,
      isAdmin,
      scannedPanelIds: scanned,
      panelId: data.panelId,
      panel: { building: (panel["building"] as string | null) ?? null },
      widerRequest,
    });
    if (!allowed) {
      throw new Error(
        `Your access is limited to the panel label you scanned. Panel ${data.panelId} is outside that scope — request building or site access from the panel you scanned.`,
      );
    }

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

    const widerLive = isAdmin || isEditUnlocked(widerRequest);
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
      system_access: {
        state: accessState(widerRequest),
        granted: widerLive,
        expires_at: widerRequest?.expires_at ?? null,
        request: widerRequest,
        window_hours: GRANT_WINDOW_HOURS,
        scope: widerRequest?.scope ?? null,
        scope_detail: widerRequest?.scope_detail ?? null,
        covers_whole_system:
          isAdmin ||
          (widerLive &&
            (widerRequest?.scope === "system_data" || widerRequest?.scope === "site_data")),
      },
      scanned_panels: scanned,
      captured_at: new Date().toISOString(),
    };
  });


/* --------------------------------------------------------------- access flow */

/**
 * Ask an administrator for a 24-hour window.
 *  * `panel_edit`    — corrections to the one scanned panel
 *  * `building_data` — read every panel in the named building
 *  * `site_data`     — read every panel on the named site
 *  * `system_data`   — read the whole electrical system and its topology views
 * All go through the same approval pipeline (in-app queue + best-effort email +
 * administrator second factor on the decision).
 */
export const requestPanelEditAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        panelId: panelIdSchema,
        scope: z
          .enum(["panel_edit", "building_data", "site_data", "system_data"])
          .default("panel_edit"),
        /** Building or site the wider scope applies to. Required for `building_data`. */
        scopeDetail: z.string().trim().max(120).optional(),
        reason: z.string().trim().max(500).optional(),
        reviewUrl: z.string().trim().max(300).optional(),
      })
      .refine((v) => v.scope !== "building_data" || (v.scopeDetail ?? "").length > 0, {
        message: "Name the building you need access to.",
        path: ["scopeDetail"],
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAnyAddon(context.supabase, context.userId, PANEL_SHEET_ADDONS);
    const db = await readerClient();

    const { data: panel, error: panelError } = await db
      .from("electrical_panels")
      .select("panel_id")
      .eq("panel_id", data.panelId)
      .maybeSingle();
    if (panelError) throw new Error(panelError.message);
    if (!panel) throw new Error(`No panel is recorded with the ID ${data.panelId}.`);

    // An open request or a live window is never duplicated. Wider windows are not
    // tied to one panel, so they are de-duplicated across panels.
    let existingQuery = db
      .from("electrical_panel_edit_requests")
      .select("*")
      .eq("requester_id", context.userId)
      .eq("scope", data.scope);
    if (data.scope === "panel_edit") existingQuery = existingQuery.eq("panel_id", data.panelId);
    if (data.scope === "building_data" && data.scopeDetail) {
      existingQuery = existingQuery.eq("scope_detail", data.scopeDetail);
    }
    const { data: existingRows } = await existingQuery
      .order("created_at", { ascending: false })
      .limit(10);
    const existing = latestRequest(
      ((existingRows ?? []) as Record<string, unknown>[]).map(toRequest),
      data.scope,
    );
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
        scope: data.scope,
        scope_detail: data.scopeDetail ?? null,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const request = toRequest(inserted as Record<string, unknown>);

    const { notifyAdminsOfPanelRequest } = await import("@/lib/panel-access.server");
    const notice = await notifyAdminsOfPanelRequest({
      panelId: data.panelId,
      scope: data.scope,
      scopeDetail: data.scopeDetail ?? null,
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
    await requireAnyAddon(context.supabase, context.userId, PANEL_SHEET_ADDONS);
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

/** Longest window an administrator may hand out in one action: 90 days. */
export const MAX_GRANT_HOURS = 24 * 90;

/**
 * Approve or decline a request. Requires the administrator role AND a verified
 * second factor on the current session. Approval opens exactly one window,
 * `hours` long (default 24), and never extends an existing one silently.
 */
export const decidePanelEditRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        // The administrator sets the length at approval time; 24 h stays the default.
        hours: z.number().int().min(1).max(MAX_GRANT_HOURS).optional(),
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
      expires_at:
        data.decision === "approved"
          ? grantExpiry(decidedAt, data.hours ?? GRANT_WINDOW_HOURS)
          : null,
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

    // Branded decision email is best-effort: the in-app queue stays truthful.
    const { notifyRequesterOfDecision } = await import("@/lib/panel-access.server");
    const notice = await notifyRequesterOfDecision({
      requesterEmail: row.requester_email,
      panelId: row.panel_id,
      scope: row.scope,
      status: data.decision === "approved" ? "approved" : "declined",
      expiresAt: row.expires_at,
      note: row.decision_note,
    });

    return {
      request: row,
      state: accessState(row),
      hours: data.hours ?? GRANT_WINDOW_HOURS,
      notified: notice.emailed,
    };
  });

/**
 * Extend (or reopen) an already-approved window for a longer period than the
 * default 24 hours — the administrator names the number of hours at extension
 * time. The new window always runs from now, so an expired grant can be
 * reopened without the requester filing again. A revoked grant is not
 * extendable: that requires a fresh request.
 */
export const extendPanelEditGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        hours: z.number().int().min(1).max(MAX_GRANT_HOURS),
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
    if (request.status !== "approved") {
      throw new Error("Only an approved request can be extended.");
    }
    if (request.revoked_at) {
      throw new Error("That access was terminated. The requester has to ask again.");
    }

    const from = new Date().toISOString();
    const { data: updated, error } = await db
      .from("electrical_panel_edit_requests")
      .update({
        expires_at: grantExpiry(from, data.hours),
        decided_by: context.userId,
        decided_at: from,
        decision_note:
          data.note?.trim() ||
          `Extended to ${data.hours} hours by an administrator on ${from.slice(0, 16).replace("T", " ")} UTC.`,
      })
      .eq("id", data.id)
      .eq("status", "approved")
      .is("revoked_at", null)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = toRequest(updated as Record<string, unknown>);
    return { request: row, state: accessState(row), hours: data.hours };
  });

/**
 * Terminate access. Works on any approved grant — live, or one that was
 * extended — and takes effect immediately: the state becomes `revoked`, which
 * the panel sheet and every gated write path treat as locked.
 */
export const revokePanelEditGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), note: z.string().trim().max(300).optional() })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireMfaAdmin(context as never);
    const db = await readerClient();

    const { data: current } = await db
      .from("electrical_panel_edit_requests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("That request no longer exists.");
    const existing = toRequest(current as Record<string, unknown>);
    if (existing.status !== "approved") {
      throw new Error("There is no approved access to terminate on that request.");
    }
    if (existing.revoked_at) throw new Error("That access was already terminated.");

    const now = new Date().toISOString();
    const { data: updated, error } = await db
      .from("electrical_panel_edit_requests")
      .update({
        revoked_at: now,
        decided_by: context.userId,
        decided_at: now,
        ...(data.note?.trim() ? { decision_note: data.note.trim() } : {}),
      })
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
    await requireAnyAddon(context.supabase, context.userId, PANEL_SHEET_ADDONS);
    const db = await readerClient();

    const isAdmin = await isAdminRole(context.supabase, context.userId);
    if (!isAdmin) {
      const { data: reqRows, error: reqError } = await db
        .from("electrical_panel_edit_requests")
        .select("*")
        .eq("panel_id", data.panelId)
        .eq("requester_id", context.userId)
        .eq("scope", "panel_edit")
        .order("created_at", { ascending: false })
        .limit(10);
      if (reqError) throw new Error(reqError.message);
      const request = latestRequest(
        ((reqRows ?? []) as Record<string, unknown>[]).map(toRequest),
        "panel_edit",
      );
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

/**
 * Called by the panel sheet the moment a scanned label lands on it.
 *
 * A brand-new account that follows a QR code has no Electrical entitlement, so
 * the page used to read "module is not enabled" and the label was a dead end.
 * Here a signed-in viewer is granted the scan-scoped add-on automatically —
 * which unlocks that panel and its own local topology and nothing else. Holders
 * of the full `electrical` add-on are left untouched.
 */
export const ensurePanelScanAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ panelId: panelIdSchema }).parse(d))
  .handler(async ({ context, data }): Promise<{ scope: "full" | "scan"; granted: boolean }> => {
    if (await hasAddon(context.supabase, context.userId, "electrical")) {
      return { scope: "full", granted: false };
    }

    // Only a real, recorded panel can bootstrap access.
    const db = await readerClient();
    const { data: panel, error } = await db
      .from("electrical_panels")
      .select("panel_id")
      .eq("panel_id", data.panelId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!panel) throw new Error(`No panel is recorded with the ID ${data.panelId}.`);

    const already = await hasAddon(context.supabase, context.userId, "electrical_scan");
    if (!already) await ensureScanAddon(context.userId);
    // Bind the grant to THIS panel: the scan-scoped add-on alone opens nothing,
    // only the panels recorded here (plus approved wider windows).
    await recordScannedPanel(db, context.userId, data.panelId);
    return { scope: "scan", granted: !already };

  });
