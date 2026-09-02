// Who currently has which AI features provisioned, for the AI admin hub.
//
// Read-only: it joins the electrician AI feature grants with profile emails and
// roles so an administrator can see provisioning at a glance. Approving or
// revoking still happens in Admin → Users (the authoritative decision path).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import { isElectricalAiScenarioId } from "@/lib/electrical-ai-scenarios";
import type { ElectricalAiScenarioId } from "@/lib/electrical-ai-scenarios";

type LooseDb = { from: (table: string) => any };

export interface AiProvisionedScenario {
  scenario: ElectricalAiScenarioId;
  status: "pending" | "approved" | "rejected" | "revoked";
  decidedAt: string | null;
  requestedAt: string;
}

export interface AiProvisionedUser {
  userId: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
  approved: AiProvisionedScenario[];
  pending: AiProvisionedScenario[];
  other: AiProvisionedScenario[];
}

export interface AiProvisioningReport {
  users: AiProvisionedUser[];
  approvedCount: number;
  pendingCount: number;
}

export const adminListAiProvisionedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiProvisioningReport> => {
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;

    const { data: grantRows, error } = await db
      .from("electrical_ai_feature_grants")
      .select("user_id, scenario, status, requested_at, decided_at")
      .order("requested_at", { ascending: false });
    if (error) throw new Error(error.message);

    const grants = ((grantRows ?? []) as Array<{
      user_id: string;
      scenario: string;
      status: string;
      requested_at: string;
      decided_at: string | null;
    }>).filter((g) => isElectricalAiScenarioId(g.scenario));

    const ids = Array.from(new Set(grants.map((g) => g.user_id)));
    const profiles = new Map<string, { email: string | null; displayName: string | null }>();
    const roles = new Map<string, string[]>();

    if (ids.length) {
      const [{ data: profileRows }, { data: roleRows }] = await Promise.all([
        db.from("profiles").select("id, email, display_name").in("id", ids),
        db.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);
      for (const p of (profileRows ?? []) as Array<{
        id: string;
        email: string | null;
        display_name: string | null;
      }>) {
        profiles.set(p.id, { email: p.email ?? null, displayName: p.display_name ?? null });
      }
      for (const r of (roleRows ?? []) as Array<{ user_id: string; role: string }>) {
        roles.set(r.user_id, [...(roles.get(r.user_id) ?? []), r.role]);
      }
    }

    const byUser = new Map<string, AiProvisionedUser>();
    for (const g of grants) {
      let row = byUser.get(g.user_id);
      if (!row) {
        const profile = profiles.get(g.user_id);
        row = {
          userId: g.user_id,
          email: profile?.email ?? null,
          displayName: profile?.displayName ?? null,
          roles: roles.get(g.user_id) ?? [],
          approved: [],
          pending: [],
          other: [],
        };
        byUser.set(g.user_id, row);
      }
      const entry: AiProvisionedScenario = {
        scenario: g.scenario as ElectricalAiScenarioId,
        status: (g.status as AiProvisionedScenario["status"]) ?? "pending",
        decidedAt: g.decided_at,
        requestedAt: g.requested_at,
      };
      if (entry.status === "approved") row.approved.push(entry);
      else if (entry.status === "pending") row.pending.push(entry);
      else row.other.push(entry);
    }

    const users = Array.from(byUser.values()).sort((a, b) => {
      if (b.approved.length !== a.approved.length) return b.approved.length - a.approved.length;
      return (a.email ?? a.userId).localeCompare(b.email ?? b.userId);
    });

    return {
      users,
      approvedCount: users.reduce((n, u) => n + u.approved.length, 0),
      pendingCount: users.reduce((n, u) => n + u.pending.length, 0),
    };
  });
