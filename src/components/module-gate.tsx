// Shows a module only when the account's plan (or a direct grant) unlocks it.
//
// Display gate only: every server function behind these pages already re-checks
// its own entitlement, so hiding the page is never the sole protection.
// Administrators always pass, so the farm owner can never lock themselves out
// of their own records with a plan change.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { useAddon } from "@/hooks/use-addon";
import { useMySubscription } from "@/hooks/use-subscription";
import type { AddonKey } from "@/lib/addons";
import { Lock } from "lucide-react";

export function ModuleGate({
  moduleKey,
  title,
  children,
  wrap = true,
}: {
  moduleKey: AddonKey;
  title: string;
  children: ReactNode;
  /** Set false when the caller already renders its own AppLayout. */
  wrap?: boolean;
}) {
  const profile = useCurrentProfile();
  const addon = useAddon(moduleKey);
  const sub = useMySubscription();

  const loading = profile.isLoading || addon.isLoading || sub.isLoading;
  // A failed check must never read as "not entitled".
  const failed = Boolean(addon.error || sub.error);
  const allowed =
    Boolean(profile.data?.isAdmin) ||
    addon.enabled ||
    Boolean(sub.data?.unlocked.includes(moduleKey)) ||
    failed;

  if (loading) {
    const body = (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
    return wrap ? <AppLayout>{body}</AppLayout> : body;
  }

  if (allowed) return <>{children}</>;

  const plan = sub.data;
  const locked = (
    <div className="p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            {title} is not part of your plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            {plan
              ? `Your current plan is ${plan.tier_name}${plan.active ? "" : " (not active)"}. Upgrading, or picking ${title} as one of your paid modules, switches this area on straight away.`
              : `You have not chosen a plan yet. Pick one and ${title} switches on straight away.`}
          </p>
          {plan && plan.modules.length > 0 && (
            <p className="flex flex-wrap items-center gap-1">
              Included today:
              {plan.unlocked.map((m) => (
                <Badge key={m} variant="outline">
                  {m}
                </Badge>
              ))}
              {plan.unlocked.length === 0 && <span>none</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/subscription">See plans</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/plans">What each plan opens</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return wrap ? <AppLayout>{locked}</AppLayout> : locked;
}
