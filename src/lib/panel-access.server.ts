// Server-only notification helper for panel edit-access requests.
//
// The in-app admin queue is the source of truth. Email is best-effort: it is
// only attempted when a sender domain has been configured for this instance,
// and a failure never blocks or hides a request.
export type NotifyResult = {
  emailed: boolean;
  recipients: number;
  reason: string;
};

interface RequestNotice {
  panelId: string;
  /** What was asked for: a panel correction window or a wider read scope. */
  scope?: "panel_edit" | "building_data" | "site_data" | "system_data";
  /** Building / site name the wider scope applies to. */
  scopeDetail?: string | null;
  requesterEmail: string | null;
  reason: string | null;
  requestedAt: string;
  reviewUrl: string;
}


/**
 * Email every administrator about a pending request. Returns why it did or did
 * not send so the UI can tell the requester the truth instead of implying an
 * email went out.
 */
export async function notifyAdminsOfPanelRequest(notice: RequestNotice): Promise<NotifyResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roleRows, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  if (error) return { emailed: false, recipients: 0, reason: error.message };

  const emails: string[] = [];
  for (const row of roleRows ?? []) {
    const userId = (row as { user_id: string }).user_id;
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (email) emails.push(email);
  }

  const { sendBrandedEmail } = await import("@/lib/smtp-mailer.server");
  const { panelAccessRequestEmail } = await import("@/lib/email-branding");
  const base = (process.env["APP_BASE_URL"] ?? "https://bostead.lovable.app").replace(/\/$/, "");
  const reviewUrl = /^https?:\/\//i.test(notice.reviewUrl)
    ? notice.reviewUrl
    : `${base}${notice.reviewUrl}`;

  const outcome = await sendBrandedEmail(
    emails,
    panelAccessRequestEmail({
      panelId: notice.panelId,
      scope: notice.scope ?? "panel_edit",
      requesterEmail: notice.requesterEmail,
      reason: notice.reason,
      requestedAt: notice.requestedAt,
      reviewUrl,
      windowHours: 24,
    }),
  );

  if (!outcome.sent) {
    console.info(
      `[panel-access] pending ${notice.scope ?? "panel_edit"} request for ${notice.panelId}; ${emails.length} administrator(s) to review in-app (${outcome.reason})`,
    );
  }
  return { emailed: outcome.sent, recipients: emails.length, reason: outcome.reason };
}

/** Tell a requester what an administrator decided. Best-effort, never throws. */
export async function notifyRequesterOfDecision(input: {
  requesterEmail: string | null;
  panelId: string;
  scope: "panel_edit" | "system_data";
  status: "approved" | "declined" | "revoked";
  expiresAt: string | null;
  note: string | null;
}): Promise<NotifyResult> {
  if (!input.requesterEmail) {
    return { emailed: false, recipients: 0, reason: "no_requester_email" };
  }
  const { sendBrandedEmail } = await import("@/lib/smtp-mailer.server");
  const { panelAccessDecisionEmail } = await import("@/lib/email-branding");
  const base = (process.env["APP_BASE_URL"] ?? "https://bostead.lovable.app").replace(/\/$/, "");
  const outcome = await sendBrandedEmail(
    input.requesterEmail,
    panelAccessDecisionEmail({
      panelId: input.panelId,
      scope: input.scope,
      status: input.status,
      expiresAt: input.expiresAt,
      note: input.note,
      panelUrl: `${base}/electrical/panel/${input.panelId}`,
    }),
  );
  return { emailed: outcome.sent, recipients: 1, reason: outcome.reason };
}

/** Look up requester emails for the admin queue without exposing other claims. */
export async function requesterEmails(userIds: string[]): Promise<Record<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: Record<string, string> = {};
  for (const id of [...new Set(userIds)]) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(id);
    if (data?.user?.email) out[id] = data.user.email;
  }
  return out;
}
