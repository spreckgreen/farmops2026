// /plans — the real, signed-in plan pages. The public handout sells the idea;
// this compares plans against the account's own subscription and links straight
// into the pages each plan opens.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Lock, ArrowRight } from "lucide-react";
import { useMySubscription } from "@/hooks/use-subscription";
import { statusLabel } from "@/lib/subscription-tiers";
import {
  ALWAYS_INCLUDED,
  allowanceSentence,
  moduleAccess,
  openPageCount,
  planTiers,
  priceSentence,
} from "@/lib/plan-pages";

export const Route = createFileRoute("/plans/")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: PlansPage,
  head: () => ({
    meta: [
      { title: "Plans and what they open — Bostead Farms" },
      {
        name: "description",
        content:
          "Compare FarmOps plans against your account and see exactly which pages each plan opens.",
      },
      { property: "og:title", content: "Plans and what they open — Bostead Farms" },
      {
        property: "og:description",
        content: "Every FarmOps plan, the modules it covers, and the pages it opens for your account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function PlansPage() {
  const mine = useMySubscription();
  const plan = mine.data ?? null;
  const tiers = useMemo(() => planTiers(), []);
  const access = useMemo(() => moduleAccess(undefined, plan?.unlocked ?? []), [plan?.unlocked]);
  const openNow = access.filter((m) => m.open);

  return (
    <AppLayout>
      <div className="p-4 space-y-6 max-w-5xl">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Plans and what they open</h1>
          <p className="text-sm text-muted-foreground">
            Every plan below is real: pick one and the pages it lists open straight away. Procedures and
            the Knowledge Base stay free forever on every plan.
          </p>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Open for you right now</CardTitle>
            <CardDescription>
              {mine.isLoading
                ? "Checking your plan…"
                : plan
                  ? `${plan.tier_name} — ${statusLabel(plan.status)}`
                  : "You have not chosen a plan yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mine.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {openPageCount(access)} pages are open to you today.
                </p>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Free on every plan</p>
                  <div className="flex flex-wrap gap-2">
                    {ALWAYS_INCLUDED.map((page) => (
                      <Button key={page.to} asChild size="sm" variant="outline">
                        <Link to={page.to}>{page.label}</Link>
                      </Button>
                    ))}
                  </div>
                </div>
                {openNow.length > 0 ? (
                  openNow.map((m) => (
                    <div key={m.key} className="space-y-2">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Check className="h-4 w-4 text-primary" aria-hidden /> {m.name}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {m.pages.map((page) => (
                          <Button key={page.to} asChild size="sm" variant="outline">
                            <Link to={page.to}>{page.label}</Link>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No paid module is switched on yet, so only the free pages above are open.
                  </p>
                )}
                {access.filter((m) => !m.open).length > 0 && (
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden /> Closed today:
                    {access
                      .filter((m) => !m.open)
                      .map((m) => (
                        <Badge key={m.key} variant="outline">
                          {m.name}
                        </Badge>
                      ))}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {tiers.map((t) => {
            const isCurrent = plan?.tier_key === t.key;
            return (
              <Card key={t.key} className={isCurrent ? "border-primary" : undefined}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>{t.name}</span>
                    {isCurrent && <Badge>Current</Badge>}
                  </CardTitle>
                  <CardDescription>{priceSentence(t)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <ul className="space-y-1 text-muted-foreground">
                    <li>{allowanceSentence(t)}</li>
                    <li>{t.seats === "unlimited" ? "Unlimited people" : `${t.seats} people`}</li>
                    <li>
                      {t.sites === "unlimited"
                        ? "Unlimited sites"
                        : `${t.sites} site${t.sites === 1 ? "" : "s"}`}
                    </li>
                    {t.contractor && <li>Manage customer sites</li>}
                    <li>
                      {t.deployment === "selfhost" ? "Runs on your own hardware" : "Hosted for you"}
                    </li>
                  </ul>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/plans/$tier" params={{ tier: t.key }}>
                      See the pages it opens <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Switching plan, starting a trial or moving to the free plan all happen on{" "}
          <Link to="/subscription" className="underline">
            your plan page
          </Link>
          . Paid plans are switched on once payment is confirmed; a trial opens the pages immediately
          and expires on its own.
        </p>
      </div>
    </AppLayout>
  );
}
