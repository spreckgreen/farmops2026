// Administrator queue for temporary panel edit access.
// Approving opens exactly one 24-hour window for that requester and that panel.
// Deciding requires a verified second factor on the current session.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { supabase } from "@/integrations/supabase/client";
import {
  decidePanelEditRequest,
  listPanelEditRequests,
  revokePanelEditGrant,
} from "@/lib/panel-access.functions";
import { GRANT_WINDOW_HOURS, remainingLabel } from "@/lib/electrical-panel-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin/panel-access")({
  beforeLoad: requireAuthenticatedUser,
  component: PanelAccessAdminPage,
  head: () => ({
    meta: [
      { title: "Panel Edit Access Approvals — Bostead Farms" },
      {
        name: "description",
        content:
          "Approve or decline 24-hour electrical panel edit windows requested from scanned panel labels.",
      },
      { property: "og:title", content: "Panel Edit Access Approvals — Bostead Farms" },
      {
        property: "og:description",
        content: "Administrator queue for temporary electrical panel edit access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const STATE_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  active: "default",
  expired: "outline",
  revoked: "outline",
  rejected: "destructive",
};

/** Step up the current session to AAL2 so decisions can be authorized. */
function SecondFactorPrompt({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const verify = useMutation({
    mutationFn: async () => {
      const { data: factors, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const factor = factors?.totp?.find((f) => f.status === "verified");
      if (!factor) {
        throw new Error(
          "No verified authenticator app is enrolled on your account. Add one in your account security settings first.",
        );
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
    },
    onSuccess: () => {
      toast.success("Second factor verified for this session.");
      setCode("");
      onVerified();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not verify that code."),
  });

  return (
    <Alert>
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>Second factor required to approve access</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-xs">
          Enter your current authenticator code. Approving a window grants someone{" "}
          {GRANT_WINDOW_HOURS} hours of write access to a panel record.
        </p>
        <div className="flex max-w-xs gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="123456"
            aria-label="Authenticator code"
          />
          <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function PanelAccessAdminPage() {
  const fetchRequests = useServerFn(listPanelEditRequests);
  const decideFn = useServerFn(decidePanelEditRequest);
  const revokeFn = useServerFn(revokePanelEditGrant);
  const [note, setNote] = useState<Record<string, string>>({});
  const [needsMfa, setNeedsMfa] = useState(false);

  const requests = useQuery({
    queryKey: ["panel-edit-requests"],
    queryFn: () => fetchRequests(),
    refetchInterval: 60_000,
  });

  const handleError = (e: unknown) => {
    const message = e instanceof Error ? e.message : "Action failed.";
    if (message.toLowerCase().includes("second factor")) setNeedsMfa(true);
    toast.error(message);
  };

  const decide = useMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "rejected" }) =>
      decideFn({ data: { ...vars, note: note[vars.id]?.trim() || undefined } }),
    onSuccess: (result) => {
      toast.success(
        result.state === "active"
          ? `Approved — ${GRANT_WINDOW_HOURS}-hour window open for ${result.request.panel_id}.`
          : `Request for ${result.request.panel_id} declined.`,
      );
      void requests.refetch();
    },
    onError: handleError,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: (result) => {
      toast.success(`Access to ${result.request.panel_id} revoked.`);
      void requests.refetch();
    },
    onError: handleError,
  });

  const rows = requests.data?.rows ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Panel edit access
            </h1>
            <p className="text-sm text-muted-foreground">
              Requests raised from scanned panel labels. Approving opens one {GRANT_WINDOW_HOURS}-hour
              edit window for that person and that panel; it closes on its own.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {requests.data?.pending ? (
              <Badge variant="secondary">{requests.data.pending} pending</Badge>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void requests.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>
        </header>

        {needsMfa ? <SecondFactorPrompt onVerified={() => setNeedsMfa(false)} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : requests.error ? (
              <p className="text-sm text-muted-foreground">
                {requests.error instanceof Error ? requests.error.message : "Unknown error."}
              </p>
            ) : !rows.length ? (
              <p className="text-sm text-muted-foreground">No access requests yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Panel</TableHead>
                      <TableHead>Requester</TableHead>
                      <TableHead>Asking for</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead className="text-right">Decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-mono font-medium">{row.panel_id}</span>
                          <p className="text-xs text-muted-foreground">
                            {row.panel_description ?? row.panel_building ?? "—"}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.requester_email ?? row.requester_id.slice(0, 8)}
                          <p className="text-muted-foreground">
                            {new Date(row.created_at).toLocaleString()}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge
                            variant={row.scope === "system_data" ? "destructive" : "outline"}
                          >
                            {row.scope === "system_data"
                              ? "Other panels / full system"
                              : "Correct this panel"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs text-xs">{row.reason ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={STATE_BADGE[row.state] ?? "outline"}>{row.state}</Badge>
                          {row.decision_note ? (
                            <p className="mt-1 text-xs text-muted-foreground">{row.decision_note}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {row.expires_at ? remainingLabel(row.expires_at) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.state === "pending" ? (
                            <div className="flex flex-col items-end gap-2">
                              <Input
                                value={note[row.id] ?? ""}
                                onChange={(e) => setNote({ ...note, [row.id]: e.target.value })}
                                placeholder="Optional note"
                                className="h-8 w-40 text-xs"
                              />
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    decide.mutate({ id: row.id, decision: "approved" })
                                  }
                                  disabled={decide.isPending}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    decide.mutate({ id: row.id, decision: "rejected" })
                                  }
                                  disabled={decide.isPending}
                                >
                                  <X className="mr-1 h-3.5 w-3.5" /> Decline
                                </Button>
                              </div>
                            </div>
                          ) : row.state === "active" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => revoke.mutate(row.id)}
                              disabled={revoke.isPending}
                            >
                              Revoke now
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {row.decided_at ? new Date(row.decided_at).toLocaleString() : "—"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
