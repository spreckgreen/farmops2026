import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Lock, Sparkles } from "lucide-react";
import { PRICED_EDITIONS, PRICED_MODULES } from "@/lib/farmops-pricing";
import { FREE_TIER, isPaidTier, moduleAllowance, statusLabel, tierFit } from "@/lib/subscription-tiers";
import { chooseFreeTier, startTierTrial, TRIAL_DAYS } from "@/lib/subscriptions.functions";
import { useMySubscription } from "@/hooks/use-subscription";

export const Route = createFileRoute("/subscription")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: SubscriptionPage,
  head: () => ({
    meta: [
      { title: "Your Plan — Bostead Farms" },
      {
        name: "description",
        content:
          "See which FarmOps modules your plan unlocks, start a trial, or move to a bigger tier.",
      },
      { property: "og:title", content: "Your Plan — Bostead Farms" },
      {
        property: "og:description",
        content: "Choose a FarmOps plan and unlock the modules it includes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tier?: string } =>
    typeof search.tier === "string" ? { tier: search.tier } : {},
});

function moduleName(key: string) {
  return PRICED_MODULES.find((m) => m.key === key)?.name ?? key;
}

function SubscriptionPage() {
  const { tier: wantedTier } = Route.useSearch();
  const qc = useQueryClient();
  const mine = useMySubscription();
  const chooseFree = useServerFn(chooseFreeTier);
  const trial = useServerFn(startTierTrial);

  const cloudTiers = useMemo(() => PRICED_EDITIONS.filter((e) => e.deployment === "cloud"), []);
  const selfHostTiers = useMemo(() => PRICED_EDITIONS.filter((e) => e.deployment === "selfhost"), []);

  const [selected, setSelected] = useState<string>(
    wantedTier && PRICED_EDITIONS.some((e) => e.key === wantedTier) ? wantedTier : "cloud_pro",
  );
  const [modules, setModules] = useState<string[]>(["electrical"]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["my-subscription"] });
    void qc.invalidateQueries({ queryKey: ["my-addons"] });
  };

  const freeMutation = useMutation({
    mutationFn: () => chooseFree(),
    onSuccess: () => {
      toast.success("You are on the free Knowledge Base plan.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const trialMutation = useMutation({
    mutationFn: (tierKey: string) =>
      trial({
        data: {
          tier_key: tierKey,
          modules,
          seats: 1,
          sites: 1,
          contractor: false,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Trial started — modules unlocked until ${new Date(r.ends_at).toLocaleDateString()}.`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = mine.data ?? null;

  const toggleModule = (key: string) =>
    setModules((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <AppLayout>
      <div className="p-4 space-y-6 max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold">Your plan</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A plan is what switches modules on. Knowledge Base and Procedures stay free forever.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mine.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : plan ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-medium">{plan.tier_name}</span>
                  <Badge variant={plan.active ? "default" : "outline"}>{statusLabel(plan.status)}</Badge>
                  {plan.current_period_end && (
                    <span className="text-xs text-muted-foreground">
                      runs to {new Date(plan.current_period_end).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground mb-1">Modules switched on right now</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.unlocked.length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        None yet — the free plan covers the Knowledge Base only.
                      </span>
                    )}
                    {plan.unlocked.map((m) => (
                      <Badge key={m} variant="secondary">
                        {moduleName(m)}
                      </Badge>
                    ))}
                  </div>
                </div>
                {plan.modules.filter((m) => !plan.unlocked.includes(m)).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Picked but not covered by this plan:{" "}
                    {plan.modules
                      .filter((m) => !plan.unlocked.includes(m))
                      .map(moduleName)
                      .join(", ")}
                    . A bigger plan covers them.
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">You have not chosen a plan yet.</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={freeMutation.isPending}
                  onClick={() => freeMutation.mutate()}
                >
                  Start on the free plan
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modules you want</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {PRICED_MODULES.map((m) => {
                const on = modules.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleModule(m.key)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                      on ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    {m.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Smaller plans cover fewer modules; the plan card below says how many.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {cloudTiers.map((t) => {
            const allowance = moduleAllowance(t);
            const fit = tierFit(t, {
              seats: 1,
              sites: 1,
              contractor: false,
              modules,
              deployment: "cloud",
            });
            const isCurrent = plan?.tier_key === t.key;
            return (
              <Card
                key={t.key}
                className={
                  isCurrent ? "border-primary" : selected === t.key ? "border-primary/50" : undefined
                }
                onClick={() => setSelected(t.key)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>{t.name}</span>
                    {isCurrent && <Badge>Current</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-lg font-semibold tabular-nums">
                    {t.monthly > 0 ? `$${t.monthly}/month` : "Free forever"}
                    {t.annual > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        or ${t.annual}/year
                      </span>
                    )}
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>{allowance === "all" ? "Every paid module" : allowance === 0 ? "Knowledge Base only" : `${allowance} paid module`}</li>
                    <li>{t.seats === "unlimited" ? "Unlimited people" : `${t.seats} people`}</li>
                    <li>{t.sites === "unlimited" ? "Unlimited sites" : `${t.sites} site${t.sites === 1 ? "" : "s"}`}</li>
                    {t.contractor && <li>Manage customer sites</li>}
                  </ul>
                  {!fit.fits && (
                    <p className="text-xs text-muted-foreground">{fit.shortfalls.join(" ")}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {t.key === FREE_TIER ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={freeMutation.isPending || isCurrent}
                        onClick={() => freeMutation.mutate()}
                      >
                        {isCurrent ? "You are here" : "Switch to free"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={
                          trialMutation.isPending || !fit.fits || Boolean(plan?.trial_used) || isCurrent
                        }
                        onClick={() => trialMutation.mutate(t.key)}
                      >
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        {plan?.trial_used ? "Trial already used" : `Try free for ${TRIAL_DAYS} days`}
                      </Button>
                    )}
                    {isPaidTier(t.key) && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/plans/$tier" params={{ tier: t.key }}>
                          See the pages it opens
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4" />
              Run it on your own hardware
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {selfHostTiers.map((t) => (
              <p key={t.key}>
                <span className="font-medium text-foreground">{t.name}</span> — ${t.oneTime} once, then $
                {t.maintenancePerYear} a year for upgrades and support.
              </p>
            ))}
            <p>
              Self-hosted licences are arranged directly, then switched on for your account by an
              administrator.
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Prices are the FarmOps design anchors shown on the public calculator. Paid plans are activated
          by an administrator once payment is confirmed; a trial unlocks the modules immediately and
          expires on its own.
        </p>
      </div>
    </AppLayout>
  );
}
