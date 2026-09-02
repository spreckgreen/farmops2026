// Admin card: the self-provisioning AI feature request queue.
//
// Electricians tick the AI scenarios they want on /electrical/assistant; every
// pending request lands here so an admin can approve or turn it down in one
// place instead of opening each user in Admin → Users.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Inbox, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  adminListElectricalAiFeatureGrants,
  adminSetElectricalAiFeatures,
  type AdminElectricalAiGrantRow,
} from "@/lib/electrical-ai-access.functions";
import {
  ELECTRICAL_AI_SCENARIOS,
  type ElectricalAiScenarioId,
} from "@/lib/electrical-ai-scenarios";
import { listAdminUsers } from "@/lib/admin.functions";

export function AiRequestQueueCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListElectricalAiFeatureGrants);
  const saveFn = useServerFn(adminSetElectricalAiFeatures);
  const usersFn = useServerFn(listAdminUsers);
  const [busy, setBusy] = useState<string | null>(null);

  const grantsQ = useQuery<AdminElectricalAiGrantRow[]>({
    queryKey: ["admin", "electrical-ai-grants"],
    queryFn: () => listFn(),
  });
  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => usersFn(),
  });

  const emailFor = (userId: string) =>
    (usersQ.data ?? []).find((u: { id: string; email: string | null }) => u.id === userId)?.email ??
    `${userId.slice(0, 8)}…`;

  const rows = grantsQ.data ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);

  const decide = useMutation({
    mutationFn: async (vars: {
      userId: string;
      scenario: ElectricalAiScenarioId;
      approve: boolean;
    }) => {
      const approvedNow = rows
        .filter((r) => r.user_id === vars.userId && r.status === "approved")
        .map((r) => r.scenario as ElectricalAiScenarioId);
      const approved = vars.approve
        ? Array.from(new Set([...approvedNow, vars.scenario]))
        : approvedNow;
      return saveFn({
        data: {
          userId: vars.userId,
          approved,
          rejected: vars.approve ? [] : [vars.scenario],
        },
      });
    },
    onMutate: (vars) => setBusy(`${vars.userId}:${vars.scenario}`),
    onSuccess: (_r, vars) => {
      toast.success(vars.approve ? "AI feature approved." : "Request turned down.");
      qc.invalidateQueries({ queryKey: ["admin", "electrical-ai-grants"] });
      qc.invalidateQueries({ queryKey: ["electrical-ai-scenarios"] });
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusy(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" />
          AI feature requests
          <Badge variant={pending.length ? "destructive" : "secondary"} className="ml-1">
            {pending.length} pending
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Self-provisioning requests from the Electrical assistant. Approving unlocks
          the scenario only — it never widens which records the person can read, and
          AI stays read-only.
        </p>

        {grantsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {grantsQ.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(grantsQ.error as Error).message}
          </div>
        )}

        {!grantsQ.isLoading && pending.length === 0 && (
          <div className="text-sm text-muted-foreground">No requests waiting for approval.</div>
        )}

        {pending.map((row) => {
          const def = ELECTRICAL_AI_SCENARIOS.find((s) => s.id === row.scenario);
          const key = `${row.user_id}:${row.scenario}`;
          return (
            <div
              key={key}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{def?.label ?? row.scenario}</div>
                <div className="text-xs text-muted-foreground">{emailFor(row.user_id)}</div>
                {row.request_note && (
                  <div className="text-xs mt-1 italic">“{row.request_note}”</div>
                )}
                <div className="text-[11px] text-muted-foreground mt-1">
                  Requested {new Date(row.requested_at).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === key}
                  onClick={() =>
                    decide.mutate({
                      userId: row.user_id,
                      scenario: row.scenario as ElectricalAiScenarioId,
                      approve: true,
                    })
                  }
                >
                  <Check className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === key}
                  onClick={() =>
                    decide.mutate({
                      userId: row.user_id,
                      scenario: row.scenario as ElectricalAiScenarioId,
                      approve: false,
                    })
                  }
                >
                  <X className="h-4 w-4 mr-1" />
                  Turn down
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
