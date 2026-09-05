// /plans/$tier — one plan in detail: the modules it covers, every real page each
// module opens, and whether that page is open for this account right now.
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { useMySubscription } from "@/hooks/use-subscription";
import { moduleAllowance, statusLabel } from "@/lib/subscription-tiers";
import {
  ALWAYS_INCLUDED,
  allowanceSentence,
  moduleAccess,
  planTier,
  priceSentence,
} from "@/lib/plan-pages";

export const Route = createFileRoute("/plans/$tier")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  loader: ({ params }) => {
    const found = planTier(params.tier);
    if (!found) throw notFound();
    return { tierKey: found.key, tierName: found.name };
  },
  component: PlanDetailPage,
  notFoundComponent: PlanNotFound,
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Plan unavailable — Bostead Farms" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `${loaderData.tierName} — what it opens | Bostead Farms`;
    const description = `The modules and pages the ${loaderData.tierName} plan opens in FarmOps.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
});

function PlanNotFound() {
  return (
    <AppLayout>
      <div className="p-4 max-w-xl space-y-3">
        <h1 className="text-xl font-semibold">That plan does not exist</h1>
        <p className="text-sm text-muted-foreground">
          The plan you asked for is not one of ours. Pick one from the list instead.
        </p>
        <Button asChild size="sm">
          <Link to="/plans">All plans</Link>
        </Button>
      </div>
    </AppLayout>
  );
}

function PlanDetailPage() {
  const { tier: tierKey } = Route.useParams();
  const mine = useMySubscription();
  const plan = mine.data ?? null;
  const edition = useMemo(() => planTier(tierKey), [tierKey]);
  const access = useMemo(
    () => moduleAccess(edition, plan?.unlocked ?? []),
    [edition, plan?.unlocked],
  );

  if (!edition) return <PlanNotFound />;

  const isCurrent = plan?.tier_key === edition.key;
  const allowance = moduleAllowance(edition);
  const allowanceText =
    allowance === "all" ? "every module" : `${allowance} module${allowance === 1 ? "" : "s"}`;

  return (
    <AppLayout>
      <div className="p-4 space-y-6 max-w-4xl">
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link to="/plans">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> All plans
          </Link>
        </Button>

        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{edition.name}</h1>
            {isCurrent && <Badge>Your plan</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {priceSentence(edition)} · {allowanceSentence(edition)}
          </p>
        </header>

        {mine.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isCurrent ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">You are on this plan</CardTitle>
              <CardDescription>
                {statusLabel(plan!.status)}
                {plan!.current_period_end
                  ? ` · runs to ${new Date(plan!.current_period_end).toLocaleDateString()}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Pages marked open below work for you right now.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Not your plan yet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                {plan
                  ? `You are on ${plan.tier_name} today. Moving to this plan opens ${allowanceText} of the ones below.`
                  : `You have not chosen a plan yet. This plan opens ${allowanceText} of the ones below.`}
              </p>
              <Button asChild size="sm">
                <Link to="/subscription" search={{ tier: edition.key }}>
                  Choose this plan
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Free on every plan</CardTitle>
            <CardDescription>Procedures and the Knowledge Base are never charged for.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {ALWAYS_INCLUDED.map((page) => (
              <Button key={page.to} asChild size="sm" variant="outline">
                <Link to={page.to}>{page.label}</Link>
              </Button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Paid modules and their pages</h2>
          {allowance !== "all" && allowance > 0 && (
            <p className="text-sm text-muted-foreground">
              This plan covers {allowanceText}; you choose which on your plan page.
            </p>
          )}
          {allowance === 0 && (
            <p className="text-sm text-muted-foreground">
              This plan covers no paid module — the pages below stay closed until you move up.
            </p>
          )}
          {access.map((m) => (
            <Card key={m.key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {m.open ? (
                    <Check className="h-4 w-4 text-primary" aria-hidden />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
                  )}
                  {m.name}
                  <Badge variant={m.open ? "secondary" : "outline"} className="ml-auto">
                    {m.open ? "Open for you" : "Closed for you"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {m.pages.map((page) => (
                    <Button
                      key={page.to}
                      asChild={m.open}
                      size="sm"
                      variant="outline"
                      disabled={!m.open}
                    >
                      {m.open ? <Link to={page.to}>{page.label}</Link> : <span>{page.label}</span>}
                    </Button>
                  ))}
                </div>
                {!m.open && (
                  <p className="text-xs text-muted-foreground">
                    {allowance === 0
                      ? "A bigger plan is needed for this module."
                      : "Pick this module on your plan page to open these pages."}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Opening a page is decided on the server every time, so this list always matches what your
          account can really reach.
        </p>
      </div>
    </AppLayout>
  );
}
