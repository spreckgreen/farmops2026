// Client-side add-on gate + sub-navigation shell for the Electrical module.
// This only controls what is *shown* — every server function re-checks the
// entitlement, so a hidden page is still an unauthorized page.
import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { useAddon } from "@/hooks/use-addon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import {
  RECONCILIATION_DENIED,
  canOpenSection,
  electricalAccess,
  sectionFromPathname,
  type ElectricalAccess,
} from "@/lib/electrical-access";
import { Eye, PencilLine, Zap } from "lucide-react";

export function ElectricalNav({ access }: { access?: ElectricalAccess }) {
  const show = (section: Parameters<typeof canOpenSection>[1]) =>
    !access || canOpenSection(access, section);
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
      <Link to="/electrical/services" className={item} activeProps={active}>
        Services
      </Link>
      <Link to="/electrical/diagrams" className={item} activeProps={active}>
        Diagrams
      </Link>
      <Link to="/electrical/topology" className={item} activeProps={active}>
        Topology
      </Link>
      <Link to="/electrical/panel-diagram" className={item} activeProps={active}>
        Panel diagram
      </Link>
      <Link to="/electrical/wiring" className={item} activeProps={active}>
        Wiring
      </Link>
      <Link to="/electrical/install-progress" className={item} activeProps={active}>
        Install progress
      </Link>

      <Link to="/electrical/critical-loads" className={item} activeProps={active}>
        Critical loads
      </Link>
      <Link to="/electrical/mapping-audit" className={item} activeProps={active}>
        Mapping audit
      </Link>
      <Link to="/electrical/mapping-repair" className={item} activeProps={active}>
        Mapping repair
      </Link>
      <Link to="/electrical/grid-migration" className={item} activeProps={active}>
        Grid migration
      </Link>


      <Link to="/electrical/workbook" className={item} activeProps={active}>
        Workbook
      </Link>
      <Link to="/electrical/labels" className={item} activeProps={active}>
        Labels
      </Link>
      {show("assistant") && (
        <Link to="/electrical/assistant" className={item} activeProps={active}>
          AI assist
        </Link>
      )}


      {show("qa") && (
        <Link to="/electrical/qa" className={item} activeProps={active}>
          QA
        </Link>
      )}
      {show("mapping") && (
  <Link to="/electrical/mapping" className={item} activeProps={active}>
          Field mapping
        </Link>
      )}
      <Link to="/electrical/standards" className={item} activeProps={active}>
        Standards
      </Link>
      {show("changes") && (
        <Link to="/electrical/changes" className={item} activeProps={active}>
          Change log
        </Link>
      )}
      {show("sor") && (
  <Link to="/electrical/sor" className={item} activeProps={active}>
          SOR status
        </Link>
      )}
      {show("validation") && (
  <Link to="/electrical/validation" className={item} activeProps={active}>
          Parallel validation
        </Link>
      )}
      {show("adjudication") && (
  <Link to="/electrical/adjudication" className={item} activeProps={active}>
          Load adjudication
        </Link>
      )}


      {show("import") && (
  <Link to="/electrical/import" className={item} activeProps={active}>
          ODS import
        </Link>
      )}
      {show("nameplate_scan") && (
        <Link to="/electrical/nameplate-scan" className={item} activeProps={active}>
          Nameplate scan
        </Link>
      )}
      {show("export") && (
  <Link to="/electrical/export" className={item} activeProps={active}>
          Reconciliation export
        </Link>
      )}

    </nav>
  );
}

/**
 * `hideNav` is used by scanned-label pages: an electrician who reached the app
 * through a panel QR code sees that panel only, so the farm-wide sub-navigation
 * is withheld until an administrator approves a system-data window.
 */
export function ElectricalGate({
  children,
  hideNav = false,
  allowScanScope = false,
}: {
  children: ReactNode;
  hideNav?: boolean;
  /**
   * Scanned-label pages also accept the scan-scoped add-on, which a viewer is
   * granted automatically when they follow a panel QR code. It unlocks the
   * scanned panel only — the sub-navigation stays hidden with `hideNav`.
   */
  allowScanScope?: boolean;
}) {
  const full = useAddon("electrical");
  const readOnly = useAddon("electrical_readonly");
  const fieldWrite = useAddon("electrical_fieldwrite");
  const scan = useAddon("electrical_scan");
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const section = sectionFromPathname(pathname);
  const access = electricalAccess({
    full: full.enabled,
    fieldWrite: fieldWrite.enabled,
    readOnly: readOnly.enabled,
    scan: allowScanScope && scan.enabled,
  });
  // Report the entitlement the user is actually browsing on, so a failed check
  // is still surfaced rather than silently read as "not entitled".
  const addon = full.enabled
    ? full
    : fieldWrite.enabled
      ? fieldWrite
      : readOnly.enabled
      ? readOnly
      : allowScanScope && scan.enabled
        ? scan
        : full.error
          ? full
          : readOnly.error
            ? readOnly
            : full;
  const scanOnly = access.scanOnly;
  const sectionAllowed = canOpenSection(access, section);
  const anyLoading =
    full.isLoading ||
    readOnly.isLoading ||
    fieldWrite.isLoading ||
    (allowScanScope && scan.isLoading);

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
              {hideNav
                ? "Scanned panel label. This view is scoped to the panel on the label and its own local topology."
                : "Field record of panels, raceways, junction boxes, branch runs, circuits and loads. The engineering spreadsheet stays the release authority — this is the as-installed truth."}
            </p>
          </div>
          {scanOnly ? (
            <Badge variant="secondary">Scanned-label access</Badge>
          ) : access.auditedWrites ? (
            <Badge variant="secondary" className="gap-1">
              <PencilLine className="h-3 w-3" />
              Field write · changes are audited
            </Badge>
          ) : access.canView && access.readOnly ? (
            <Badge variant="secondary" className="gap-1">
              <Eye className="h-3 w-3" />
              Read-only electrician access
            </Badge>
          ) : addon.enabled && addon.status ? (
            <Badge variant={addon.status === "trialing" ? "secondary" : "outline"}>
              Add-on: {addon.status === "trialing" ? "trial" : "active"}
              {addon.expiresAt ? ` · until ${addon.expiresAt.slice(0, 10)}` : ""}
            </Badge>
          ) : null}
        </header>

        {anyLoading ? (
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
        ) : access.canView ? (
          <>
            {hideNav ? null : <ElectricalNav access={access} />}
            {sectionAllowed ? (
              children
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Reconciliation is not part of read-only access
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>{RECONCILIATION_DENIED}</p>
                  <p>
                    Everything else in the module — panels, raceways, junction boxes,
                    branch runs, circuits, loads, diagrams, topology, the workbook,
                    labels, QA and standards — stays open to you.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/electrical">Back to overview</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
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
                {allowScanScope
                  ? "Scanned-label access is granted automatically once the panel on the label is recognised — reload this page to retry. "
                  : ""}
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
