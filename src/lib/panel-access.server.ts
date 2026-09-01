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
  const from = process.env["PANEL_ACCESS_EMAIL_FROM"] ?? process.env["EMAIL_FROM"] ?? "";
  const apiKey = process.env["LOVABLE_API_KEY"] ?? "";

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

  if (!from || !apiKey) {
    console.info(
      `[panel-access] pending request for ${notice.panelId}; ${emails.length} administrator(s) to review in-app (email sender not configured)`,
    );
    return {
      emailed: false,
      recipients: emails.length,
      reason: "email_sender_not_configured",
    };
  }

  try {
    const res = await fetch("https://api.lovable.dev/email/send", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: emails,
        subject: `Panel edit access requested — ${notice.panelId}`,
        text: [
          `${notice.requesterEmail ?? "A signed-in user"} requested 24-hour edit access to panel ${notice.panelId}.`,
          notice.reason ? `Reason: ${notice.reason}` : "No reason given.",
          `Requested at ${notice.requestedAt}.`,
          `Approve or decline: ${notice.reviewUrl}`,
        ].join("\n\n"),
      }),
    });
    if (!res.ok) {
      return { emailed: false, recipients: emails.length, reason: `email_failed_${res.status}` };
    }
    return { emailed: true, recipients: emails.length, reason: "sent" };
  } catch (e) {
    return {
      emailed: false,
      recipients: emails.length,
      reason: e instanceof Error ? e.message : "email_failed",
    };
  }
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
