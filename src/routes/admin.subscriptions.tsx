import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PRICED_EDITIONS, PRICED_MODULES } from "@/lib/farmops-pricing";
import { SUBSCRIPTION_STATUSES, statusLabel } from "@/lib/subscription-tiers";
import {
  cancelSubscription,
  listSubscriptions,
  setSubscription,
} from "@/lib/subscriptions.functions";
import { CreditCard, XCircle } from "lucide-react";

export const Route = createFileRoute("/admin/subscriptions")({
  ssr: false,
  component: SubscriptionsAdminPage,
  head: () => ({
    meta: [
      { title: "Subscription Tiers — Bostead Farms" },
      {
        name: "description",
        content:
          "Activate, change or cancel FarmOps subscription tiers and let them grant module access.",
      },
      { property: "og:title", content: "Subscription Tiers — Bostead Farms" },
      {
        property: "og:description",
        content: "Administer FarmOps plans and the module access they grant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function SubscriptionsAdminPage() {
  const qc = useQueryClient();
  const list = useServerFn(listSubscriptions);
  const save = useServerFn(setSubscription);
  const cancel = useServerFn(cancelSubscription);

  const q = useQuery({ queryKey: ["admin", "subscriptions"], queryFn: () => list() });

  const [userId, setUserId] = useState("");
  const [tierKey, setTierKey] = useState("cloud_pro");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [status, setStatus] = useState<string>("active");
  const [modules, setModules] = useState<string[]>(["electrical"]);
  const [seats, setSeats] = useState(1);
  const [sites, setSites] = useState(1);
  const [contractor, setContractor] = useState(false);
  const [periodEnd, setPeriodEnd] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
    void qc.invalidateQueries({ queryKey: ["admin", "addons"] });
    void qc.invalidateQueries({ queryKey: ["my-subscription"] });
    void qc.invalidateQueries({ queryKey: ["my-addons"] });
  };

  const edition = PRICED_EDITIONS.find((e) => e.key === tierKey);

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          user_id: userId.trim(),
          tier_key: tierKey,
          deployment: edition?.deployment ?? "cloud",
          billing,
          status: status as (typeof SUBSCRIPTION_STATUSES)[number],
          modules,
          seats,
          sites,
          contractor,
          current_period_end: periodEnd || null,
          provider: providerRef.trim() ? "stripe" : "manual",
          provider_ref: providerRef.trim() || null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.granted.length > 0
          ? `Plan saved — unlocked ${r.granted.join(", ")}.`
          : "Plan saved. No paid modules unlocked.",
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancel({ data: { user_id: id } }),
    onSuccess: () => {
      toast.success("Plan canceled and module access withdrawn.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleModule = (key: string) =>
    setModules((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <AppLayout>
      <div className="p-4 space-y-6 max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription tiers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Saving a plan rewrites that account's module access in the same step, so the two can never
            drift apart.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activate or change a plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sub-user">Person</Label>
                <select
                  id="sub-user"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {(q.data?.users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email ?? u.display_name ?? u.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="sub-tier">Plan</Label>
                <select
                  id="sub-tier"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={tierKey}
                  onChange={(e) => setTierKey(e.target.value)}
                >
                  {PRICED_EDITIONS.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="sub-status">State</Label>
                <select
                  id="sub-status"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="sub-billing">Billing</Label>
                <select
                  id="sub-billing"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={billing}
                  onChange={(e) => setBilling(e.target.value as "monthly" | "annual")}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Yearly</option>
                </select>
              </div>
              <div>
                <Label htmlFor="sub-seats">People</Label>
                <Input
                  id="sub-seats"
                  type="number"
                  min={1}
                  value={seats}
                  onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sub-sites">Sites</Label>
                <Input
                  id="sub-sites"
                  type="number"
                  min={1}
                  value={sites}
                  onChange={(e) => setSites(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sub-end">Paid period ends (optional)</Label>
                <Input
                  id="sub-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sub-ref">Payment reference (optional)</Label>
                <Input
                  id="sub-ref"
                  value={providerRef}
                  onChange={(e) => setProviderRef(e.target.value)}
                  placeholder="sub_1P… from the payment provider"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Paid modules</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {PRICED_MODULES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleModule(m.key)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      modules.includes(m.key)
                        ? "border-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="sub-contractor"
                type="checkbox"
                checked={contractor}
                onChange={(e) => setContractor(e.target.checked)}
              />
              <Label htmlFor="sub-contractor">Contractor managing customer sites</Label>
            </div>

            <div>
              <Label htmlFor="sub-notes">Notes</Label>
              <Textarea
                id="sub-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
                rows={2}
              />
            </div>

            <Button
              disabled={!userId.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              Save plan and grant access
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plans in place</CardTitle>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (q.data?.subscriptions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No plans yet.</p>
            ) : (
              <div className="space-y-2">
                {(q.data?.subscriptions ?? []).map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.email ?? s.display_name ?? s.user_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.tier_name} · {statusLabel(s.status)}
                        {s.current_period_end
                          ? ` · to ${new Date(s.current_period_end).toLocaleDateString()}`
                          : ""}
                        {s.provider_ref ? ` · ${s.provider_ref}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {s.unlocked.map((m) => (
                        <Badge key={m} variant="secondary">
                          {m}
                        </Badge>
                      ))}
                      {s.unlocked.length === 0 && <Badge variant="outline">no modules</Badge>}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancelMutation.isPending || s.status === "canceled"}
                        onClick={() => cancelMutation.mutate(s.user_id)}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
