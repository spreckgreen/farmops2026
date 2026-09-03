// In-app rendering of docs/PRODUCT_ARCHITECTURE.md. Both read the structured
// design data in @/lib/product-architecture so the page cannot drift from the doc.
import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ADDON_PRODUCTS,
  BILLING_FLOWS,
  BILLING_PORT_NOTES,
  BUILD_ORDER,
  EDITIONS,
  ELECTRICIAN_MODELS,
  GAP_ANALYSIS,
  HANDOVER_FLOW,
  HANDOVER_PACKAGE,
  LICENSE_CLAIMS,
  LICENSE_RULES,
  MIGRATION_RULES,
  NON_GOALS,
  OS_MODULES,
  PRODUCT_ARCH_VERSION,
} from "@/lib/product-architecture";

export const Route = createFileRoute("/docs/product-architecture")({
  component: ProductArchitecturePage,
  head: () => ({
    meta: [
      { title: "FarmOps Product Architecture — Editions & Add-ons" },
      {
        name: "description",
        content:
          "How FarmOps is packaged as a product: the FarmOps OS platform modules, free Knowledge Base tier, paid add-ons, self-host and subscription editions, standalone contractor apps and migration paths.",
      },
      { property: "og:title", content: "FarmOps Product Architecture — Editions & Add-ons" },
      {
        property: "og:description",
        content:
          "Design document: FarmOps OS modules, licensing, Stripe billing, standalone Customer/Contractor editions and migration rules.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => (
    <AppLayout>
      <div className="mx-auto max-w-3xl p-6 text-sm text-destructive">
        Failed to load the product architecture: {error.message}
      </div>
    </AppLayout>
  ),
  notFoundComponent: () => (
    <AppLayout>
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Not found.</div>
    </AppLayout>
  ),
});

function Diagram({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

const SHAPE = `FarmOps OS  (platform, always required)
  └── Knowledge Base            free forever, capped  (default add-on)
  └── Paid add-ons              Electrical, Food, Inventory, Maintenance
        └── Standalone editions Customer (single site) / Contractor (multi-site)`;

const MIGRATION_DIAGRAM = `Standalone (customer)  →  Self-host FarmOps OS  →  Cloud subscription
        ↘                        ↕                      ↙
             portable export bundle + license transfer`;

function ProductArchitecturePage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">FarmOps Product Architecture</h1>
          <p className="text-sm text-muted-foreground">
            Design document v{PRODUCT_ARCH_VERSION}. Mirrors{" "}
            <code className="text-xs">docs/PRODUCT_ARCHITECTURE.md</code>. Nothing here is
            enforced by running code yet, and every price is an anchor for discussion rather
            than a live price.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Product shape</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Diagram>{SHAPE}</Diagram>
            <h2 className="text-sm font-semibold">FarmOps OS base modules</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Gates</TableHead>
                  <TableHead>Today</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {OS_MODULES.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell className="align-top font-medium">{m.name}</TableCell>
                    <TableCell className="align-top text-xs">{m.purpose}</TableCell>
                    <TableCell className="align-top text-xs capitalize">
                      {m.administeredBy}
                    </TableCell>
                    <TableCell className="align-top text-xs">{m.gates}</TableCell>
                    <TableCell className="align-top text-xs text-muted-foreground">
                      {m.today}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <h2 className="pt-2 text-sm font-semibold">Add-ons</h2>
            <div className="space-y-2">
              {ADDON_PRODUCTS.map((a) => (
                <div key={a.key} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge variant={a.tier === "free" ? "default" : "secondary"}>{a.tier}</Badge>
                    <Badge variant="outline">{a.status}</Badge>
                    {a.standalone && <Badge variant="outline">standalone-capable</Badge>}
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">{a.summary}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Knowledge Base ships enabled and free forever. It is the on-ramp: a new account
              gets something useful immediately and learns the OS shell before it ever sees a
              paywall.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Commercial model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Edition</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Price anchor</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Sites</TableHead>
                  <TableHead>Add-ons</TableHead>
                  <TableHead>AI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {EDITIONS.map((e) => (
                  <TableRow key={e.key}>
                    <TableCell className="align-top font-medium">
                      {e.name}
                      <div className="pt-1 text-[11px] font-normal text-muted-foreground">
                        {e.notes}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-xs capitalize">{e.model}</TableCell>
                    <TableCell className="align-top text-xs">{e.price}</TableCell>
                    <TableCell className="align-top text-xs">{e.seats}</TableCell>
                    <TableCell className="align-top text-xs">{e.sites}</TableCell>
                    <TableCell className="align-top text-xs">{e.addons}</TableCell>
                    <TableCell className="align-top text-xs">{e.aiPolicy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <h2 className="pt-2 text-sm font-semibold">License key claims</h2>
            <Bullets items={LICENSE_CLAIMS} />
            <h2 className="pt-2 text-sm font-semibold">Licensing rules</h2>
            <Bullets items={LICENSE_RULES} />

            <h2 className="pt-2 text-sm font-semibold">Billing rails — Stripe</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flow</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Effect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BILLING_FLOWS.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="align-top font-medium">{f.name}</TableCell>
                    <TableCell className="align-top text-xs">{f.trigger}</TableCell>
                    <TableCell className="align-top text-xs">{f.effect}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Bullets items={BILLING_PORT_NOTES} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Add-ons as standalone applications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Each add-on can ship as a standalone application carrying only its own scoped
              data plus the minimum OS services: auth, licensing, vault, backup/restore,
              export, data quality and audit.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="font-medium">Customer edition</div>
                <p className="pt-1 text-xs text-muted-foreground">
                  One site per instance. The hand-over target: the customer owns and edits
                  their scoped data, produces exports, and runs backup/restore. No contractor
                  tooling, no spawn rights, no other add-ons.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <div className="font-medium">Contractor edition</div>
                <p className="pt-1 text-xs text-muted-foreground">
                  Many customer sites in one instance with per-site isolation, plus the right
                  to spawn a Customer-edition instance for any site and hand it over.
                </p>
              </div>
            </div>

            <h2 className="pt-2 text-sm font-semibold">Hand-over package</h2>
            <Bullets items={HANDOVER_PACKAGE} />

            <h2 className="pt-2 text-sm font-semibold">Spawn flow</h2>
            <ol className="space-y-1 text-sm">
              {HANDOVER_FLOW.map((s) => (
                <li key={s.step}>
                  <span className="font-medium">{s.step}</span> — {s.detail}
                </li>
              ))}
            </ol>

            <h2 className="pt-2 text-sm font-semibold">
              Electrician deployment and revenue models
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>How it works</TableHead>
                  <TableHead>Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ELECTRICIAN_MODELS.map((m) => (
                  <TableRow key={m.name}>
                    <TableCell className="align-top font-medium">{m.name}</TableCell>
                    <TableCell className="align-top text-xs">{m.detail}</TableCell>
                    <TableCell className="align-top text-xs">{m.revenue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Migration paths</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Diagram>{MIGRATION_DIAGRAM}</Diagram>
            <Bullets items={MIGRATION_RULES} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">5. Boundaries and non-goals</CardTitle>
          </CardHeader>
          <CardContent>
            <Bullets items={NON_GOALS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">6. Gap analysis against today's codebase</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Capability</TableHead>
                  <TableHead>Exists today</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead className="text-right">Phase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {GAP_ANALYSIS.map((g) => (
                  <TableRow key={g.capability}>
                    <TableCell className="align-top font-medium">{g.capability}</TableCell>
                    <TableCell className="align-top text-xs text-muted-foreground">
                      {g.exists}
                    </TableCell>
                    <TableCell className="align-top text-xs">{g.missing}</TableCell>
                    <TableCell className="align-top text-right text-xs">{g.phase}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h2 className="pt-2 text-sm font-semibold">Suggested build order</h2>
            <Bullets items={BUILD_ORDER} />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
