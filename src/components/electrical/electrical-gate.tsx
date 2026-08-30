// Client-side add-on gate + sub-navigation shell for the Electrical module.
// This only controls what is *shown* — every server function re-checks the
// entitlement, so a hidden page is still an unauthorized page.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { useAddon } from "@/hooks/use-addon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import { Zap } from "lucide-react";

export function ElectricalNav() {
  const item =
    "px-2.5 py-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";
  const active = { className: "px-2.5 py-1 rounded-md text-sm bg-accent text-foreground" };
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
      <Link to="/electrical" className={item} activeProps={active} activeOptions={{ exact: true }}>
        Overview
      </Link>
      {ENTITY_KINDS.map((kind) => (
        <Link
          key={kind}
          to="/electrical/$kind"
          params={{ kind }}
          className={item}
          activeProps={active}
        >
          {ENTITIES[kind].title}
        </Link>
      ))}
      <Link to="/electrical/diagrams" className={item} activeProps={active}>
        Diagrams
      </Link>
      <Link to="/electrical/qa" className={item} activeProps={active}>
        QA
      </Link>
      <Link to="/electrical/mapping" className={item} activeProps={active}>
        Field mapping
      </Link>
      <Link to="/electrical/standards" className={item} activeProps={active}>
        Standards
      </Link>
      <Link to="/electrical/sor" className={item} activeProps={active}>
        SOR status
      </Link>
      <Link to="/electrical/validation" className={item} activeProps={active}>
        Parallel validation
      </Link>


      <Link to="/electrical/import" className={item} activeProps={active}>
        ODS import
      </Link>
      <Link to="/electrical/export" className={item} activeProps={active}>
        Reconciliation export
      </Link>

    </nav>
  );
}

export function ElectricalGate({ children }: { children: ReactNode }) {
  const addon = useAddon("electrical");

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Electrical infrastructure
            </h1>
            <p className="text-sm text-muted-foreground">
              Field record of panels, raceways, junction boxes, branch runs, circuits and
              loads. The engineering spreadsheet stays the release authority — this is the
              as-installed truth.
            </p>
          </div>
          {addon.enabled && addon.status ? (
            <Badge variant={addon.status === "trialing" ? "secondary" : "outline"}>
              Add-on: {addon.status === "trialing" ? "trial" : "active"}
              {addon.expiresAt ? ` · until ${addon.expiresAt.slice(0, 10)}` : ""}
            </Badge>
          ) : null}
        </header>

        {addon.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : addon.error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Couldn't check your Electrical add-on</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                Your electrical records are untouched — only the add-on check failed
                {addon.error.message ? `: ${addon.error.message}` : "."}
              </p>
              <Button size="sm" variant="outline" onClick={() => void addon.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : addon.enabled ? (
          <>
            <ElectricalNav />
            {children}
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Electrical module is not enabled</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                The Electrical Infrastructure module is a subscription add-on. Your account
                does not have an active entitlement for it
                {addon.status ? ` (current status: ${addon.status})` : ""}.
              </p>
              <p>
                An administrator can enable it under{" "}
                <Link to="/admin/addons" className="underline">
                  Admin → Add-ons
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
