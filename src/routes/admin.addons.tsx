import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import {
  listEntitlements,
  revokeEntitlement,
  setEntitlement,
} from "@/lib/addons.functions";
import { ENTITLEMENT_STATUSES, MAX_REVOCATIONS_BEFORE_BLOCK, statusLabel } from "@/lib/addons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, PackagePlus } from "lucide-react";

export const Route = createFileRoute("/admin/addons")({
  component: AddonsPage,
  head: () => ({
    meta: [
      { title: "Add-on Entitlements — Bostead Farms" },
      {
        name: "description",
        content:
          "Grant, trial, expire or disable optional Bostead modules per user with entitlement records.",
      },
      { property: "og:title", content: "Add-on Entitlements — Bostead Farms" },
      {
        property: "og:description",
        content: "Manage which users have access to optional Bostead modules.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AddonsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listEntitlements);
  const save = useServerFn(setEntitlement);
  const revoke = useServerFn(revokeEntitlement);

  const [userId, setUserId] = useState("");
  const [addonKey, setAddonKey] = useState("electrical");
  const [status, setStatus] = useState<string>("active");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  const q = useQuery({ queryKey: ["admin", "addons"], queryFn: () => list() });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "addons"] });
    void qc.invalidateQueries({ queryKey: ["my-addons"] });
  };

  const grant = useMutation({
    mutationFn: async () =>
      save({
        data: {
          user_id: userId,
          addon_key: addonKey,
          status: status as (typeof ENTITLEMENT_STATUSES)[number],
          expires_at: expiresAt || null,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      toast.success("Entitlement saved");
      setNotes("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => revoke({ data: { id } }),
    onSuccess: (res) => {
      const r = res as { revoked_count?: number; blocked_until?: string | null; test_account?: boolean };
      toast.success(
        r.blocked_until
          ? `Access revoked (${r.revoked_count} times) — self-service access is blocked until ${new Date(r.blocked_until).toLocaleDateString()}.`
          : r.test_account
            ? "Access revoked. Test account — revocations are not counted."
            : `Access revoked (${r.revoked_count ?? 1} of ${MAX_REVOCATIONS_BEFORE_BLOCK} allowed). The user can be re-enabled or ask again.`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Add-on entitlements</h1>
          <p className="text-sm text-muted-foreground">
            Optional modules are gated by entitlement records, so access can be granted,
            trialled, expired or disabled per user without touching code. Server functions
            fail closed when no active entitlement exists. A disabled user can be re-enabled
            or self-provision again; more than {MAX_REVOCATIONS_BEFORE_BLOCK} revocations lock
            the account out of self-service access for a year.
          </p>
        </header>

        {q.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : q.error ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {(q.error as Error).message}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <PackagePlus className="h-4 w-4" />
                  Grant or update
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">User</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                  >
                    <option value="">Select a user…</option>
                    {q.data!.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email ?? u.display_name ?? u.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Add-on</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={addonKey}
                    onChange={(e) => setAddonKey(e.target.value)}
                  >
                    {q.data!.addons.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {ENTITLEMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expires (optional)</Label>
                  <Input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. included with the 2026 build season plan"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button
                    disabled={!userId || grant.isPending}
                    onClick={() => grant.mutate()}
                  >
                    {grant.isPending ? "Saving…" : "Save entitlement"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Current entitlements</CardTitle>
              </CardHeader>
              <CardContent>
                {!q.data!.entitlements.length ? (
                  <p className="text-sm text-muted-foreground">
                    No entitlements yet — every optional module is off for everyone.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">User</th>
                          <th className="px-3 py-2 font-medium">Add-on</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Expires</th>
                          <th className="px-3 py-2 font-medium">Access</th>
                          <th className="px-3 py-2 font-medium">Revocations</th>
                          <th className="px-3 py-2 font-medium">Notes</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {q.data!.entitlements.map((e) => (
                          <tr key={e.id} className="border-t border-border align-top">
                            <td className="px-3 py-2">{e.email ?? e.display_name ?? e.user_id}</td>
                            <td className="px-3 py-2 font-mono">{e.addon_key}</td>
                            <td className="px-3 py-2">{statusLabel(e.status)}</td>
                            <td className="px-3 py-2">{e.expires_at?.slice(0, 10) ?? "—"}</td>
                            <td className="px-3 py-2">
                              <Badge variant={e.enabled ? "default" : "outline"}>
                                {e.enabled ? "enabled" : "blocked"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              {e.revoked_count}
                              {e.blocked ? (
                                <span className="block text-xs text-destructive">
                                  locked out until {e.blocked_until?.slice(0, 10)}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{e.notes ?? "—"}</td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (
                                    confirm(
                                      "Revoke this access? The user keeps a disabled record and may ask again, unless this passes the revocation limit.",
                                    )
                                  )
                                    remove.mutate(e.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
