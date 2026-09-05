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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChevronDown, Eye, PencilLine, Zap } from "lucide-react";

/**
 * Sub-navigation is grouped by what the page is *for* — records, diagrams,
 * field work, QA/review, data migration — so a long flat strip of 25+ links
 * stays readable. Group menus only list the entries the access gate allows,
 * and a group is hidden entirely when nothing inside it is visible.
 */
type NavEntry = {
  label: string;
  to: string;
  params?: Record<string, string>;
  section?: Parameters<typeof canOpenSection>[1];
};

type NavGroup = { label: string; entries: NavEntry[] };

function navGroups(): NavGroup[] {
  return [
    {
      label: "Records",
      entries: [
        ...ENTITY_KINDS.map((kind) => ({
          label: ENTITIES[kind].title,
          to: "/electrical/$kind",
          params: { kind },
        })),
        { label: "Services", to: "/electrical/services" },
      ],
    },
    {
      label: "Diagrams & maps",
      entries: [
        { label: "Diagrams", to: "/electrical/diagrams" },
        { label: "Topology", to: "/electrical/topology" },
        { label: "Panel diagram", to: "/electrical/panel-diagram" },
        { label: "Wiring", to: "/electrical/wiring" },
        { label: "Grid map", to: "/electrical/grid-map" },
        { label: "Critical loads", to: "/electrical/critical-loads" },
      ],
    },
    {
      label: "Field work",
      entries: [
        { label: "Audit sheet", to: "/electrical/audit-sheet" },
        { label: "Install progress", to: "/electrical/install-progress" },
        { label: "Switches & controls", to: "/electrical/switch-controls" },
        { label: "Design to field", to: "/electrical/design-to-field" },


        { label: "Labels", to: "/electrical/labels" },
        { label: "Documents", to: "/electrical/documents" },
        { label: "Nameplate scan", to: "/electrical/nameplate-scan", section: "nameplate_scan" },
        { label: "Change log", to: "/electrical/changes", section: "changes" },
        { label: "Standards", to: "/electrical/standards" },
        { label: "Terminology", to: "/electrical/terminology" },
      ],
    },
    {
      label: "QA & review",
      entries: [
        { label: "QA checks", to: "/electrical/qa", section: "qa" },
        { label: "Parallel validation", to: "/electrical/validation", section: "validation" },
        { label: "Load adjudication", to: "/electrical/adjudication", section: "adjudication" },
        { label: "SOR status", to: "/electrical/sor", section: "sor" },
      ],
    },

    {
      label: "Data & migration",
      entries: [
        { label: "Workbook", to: "/electrical/workbook" },
        { label: "ODS import", to: "/electrical/import", section: "import" },
        { label: "Import contract", to: "/electrical/import-contract" },
        { label: "Field mapping", to: "/electrical/mapping", section: "mapping" },
        { label: "Grid data quality", to: "/electrical/grid-data-quality" },
        { label: "Audit batches", to: "/electrical/audit-batches" },
        { label: "Reconciliation export", to: "/electrical/export", section: "export" },
      ],
    },

    {
      label: "Integration",
      entries: [{ label: "API & docs", to: "/electrical/api-docs" }],
    },
  ];
}

export function ElectricalNav({ access }: { access?: ElectricalAccess }) {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const show = (section?: Parameters<typeof canOpenSection>[1]) =>
    !section || !access || canOpenSection(access, section);
  const item =
    "px-2.5 py-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors";
  const active = { className: "px-2.5 py-1 rounded-md text-sm bg-accent text-foreground" };
  const groups = navGroups()
    .map((g) => ({ ...g, entries: g.entries.filter((e) => show(e.section)) }))
    .filter((g) => g.entries.length > 0);

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
      <Link to="/electrical" className={item} activeProps={active} activeOptions={{ exact: true }}>
        Overview
      </Link>

      {groups.map((group) => {
        // A group reads as active when the open page lives inside it. Entity
        // pages share one route pattern, so match on the resolved path.
        const groupActive = group.entries.some((e) => {
          const path = e.params ? `/electrical/${e.params.kind}` : e.to;
          return pathname === path || pathname.startsWith(`${path}/`);
        });
        return (
          <DropdownMenu key={group.label}>
            <DropdownMenuTrigger
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-md text-sm transition-colors outline-none",
                groupActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {group.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {group.label}
              </DropdownMenuLabel>
              {group.entries.map((entry) => (
                <DropdownMenuItem key={entry.label} asChild>
                  {entry.params ? (
                    <Link
                      to={entry.to}
                      params={entry.params}
                      className="cursor-pointer"
                      activeProps={{ className: "bg-accent" }}
                    >
                      {entry.label}
                    </Link>
                  ) : (
                    <Link
                      to={entry.to}
                      className="cursor-pointer"
                      activeProps={{ className: "bg-accent" }}
                    >
                      {entry.label}
                    </Link>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {show("assistant") && (
        <Link to="/electrical/assistant" className={item} activeProps={active}>
          AI assist
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
