// Admin → AI: single hub for every AI administrative screen.
//
// Configuration (engines, runtime, per-feature routing), cost reporting, and
// who is currently provisioned for which AI feature. Read-only summaries here;
// each action links to the screen that owns the change.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Cpu, DollarSign, Gauge, ShieldCheck, Users, Sliders } from "lucide-react";
import { adminListAiProvisionedUsers } from "@/lib/admin-ai-provisioning.functions";
import { getAiFeatureToggles } from "@/lib/ai-usage.functions";
import { getAiUsageBill } from "@/lib/ai-usage.functions";
import { formatBillUsd } from "@/lib/ai-usage";
import { ELECTRICAL_AI_SCENARIOS } from "@/lib/electrical-ai-scenarios";
import { AI_FEATURE_AREAS } from "@/lib/ai-feature-areas";

export const Route = createFileRoute("/admin/ai")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI administration — Bostead" },
      {
        name: "description",
        content:
          "One place for Bostead AI administration: engine configuration, per-feature routing, cost reporting, and provisioned users.",
      },
      { property: "og:title", content: "AI administration — Bostead" },
      {
        property: "og:description",
        content: "AI engine configuration, cost reporting, and user provisioning for Bostead.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminAiHubPage,
});

const SCENARIO_LABELS = new Map(ELECTRICAL_AI_SCENARIOS.map((s) => [s.id, s.label]));
const AREA_LABELS = new Map(AI_FEATURE_AREAS.map((a) => [a.id, a.label]));

const SCREENS = [
  {
    to: "/admin/ai-engines" as const,
    icon: Cpu,
    title: "AI engines",
    description:
      "Self-hosted, Ollama Cloud and other cloud engines: endpoints, credentials, enable/disable, connection tests.",
  },
  {
    to: "/admin/ai-runtime" as const,
    icon: Gauge,
    title: "AI runtime & routing",
    description:
      "Active endpoint and model, per-feature routing, feature switches, and the nameplate write approval queue.",
  },
  {
    to: "/admin/ai-settings" as const,
    icon: Sliders,
    title: "AI feature configuration",
    description: "Turn individual user-facing AI capabilities on or off for this instance.",
  },
  {
    to: "/admin/ai-costs" as const,
    icon: DollarSign,
    title: "AI cost & usage report",
    description:
      "Per-feature cloud cost, 7/30/90-day usage, local vs cloud split, and projected 30-day spend.",
  },
  {
    to: "/admin/users" as const,
    icon: ShieldCheck,
    title: "Approve AI feature requests",
    description:
      "Approve, reject or revoke a person's AI feature requests, and review their metered AI bill.",
  },
];

function AdminAiHubPage() {
  const listProvisioned = useServerFn(adminListAiProvisionedUsers);
  const loadToggles = useServerFn(getAiFeatureToggles);
  const loadBill = useServerFn(getAiUsageBill);

  const provisioning = useQuery({
    queryKey: ["admin-ai-provisioning"],
    queryFn: () => listProvisioned(),
  });
  const toggles = useQuery({
    queryKey: ["admin-ai-toggles"],
    queryFn: () => loadToggles(),
  });
  const bill = useQuery({
    queryKey: ["admin-ai-bill", 30],
    queryFn: () => loadBill({ data: { days: 30 } }),
  });

  const disabledAreas = (toggles.data ?? []).filter((t) => !t.enabled);
  const enabledCount = (toggles.data ?? []).length - disabledAreas.length;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            AI administration
          </h1>
          <p className="text-sm text-muted-foreground">
            Every AI screen in one place: configuration, cost, and who is provisioned for which
            feature.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryTile
            label="Feature areas enabled"
            value={
              toggles.isLoading
                ? "…"
                : `${enabledCount}/${(toggles.data ?? []).length}`
            }
            hint={
              disabledAreas.length
                ? `Off: ${disabledAreas
                    .map((t) => AREA_LABELS.get(t.area) ?? t.area)
                    .slice(0, 3)
                    .join(", ")}${disabledAreas.length > 3 ? "…" : ""}`
                : "No feature area is switched off"
            }
          />
          <SummaryTile
            label="Metered AI spend (30 days)"
            value={bill.isLoading ? "…" : formatBillUsd(bill.data?.totalCostUsd ?? 0)}
            hint={
              bill.data
                ? `${bill.data.totalRuns} runs · ${bill.data.totalMeteredRuns} metered`
                : "Self-hosted runs cost $0.00"
            }
          />
          <SummaryTile
            label="Provisioned AI features"
            value={
              provisioning.isLoading ? "…" : String(provisioning.data?.approvedCount ?? 0)
            }
            hint={
              provisioning.data?.pendingCount
                ? `${provisioning.data.pendingCount} awaiting approval`
                : "No pending requests"
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI screens</CardTitle>
            <CardDescription>
              Each screen owns its changes — this hub only links and summarises.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {SCREENS.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="flex gap-3 rounded-md border p-3 hover:bg-accent"
              >
                <s.icon className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="space-y-1">
                  <span className="block font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.description}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Provisioned users &amp; AI features
            </CardTitle>
            <CardDescription>
              Approved scenarios per person. Change approvals in User management.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {provisioning.isLoading && (
              <p className="text-muted-foreground">Loading provisioning…</p>
            )}
            {provisioning.error && (
              <p className="text-destructive">
                {(provisioning.error as Error).message || "Could not load provisioning."}
              </p>
            )}
            {provisioning.data && provisioning.data.users.length === 0 && (
              <p className="text-muted-foreground">
                No one has requested or been granted an AI feature yet.
              </p>
            )}
            {provisioning.data?.users.map((u) => (
              <div key={u.userId} className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {u.email ?? u.displayName ?? u.userId.slice(0, 8)}
                  </span>
                  {u.roles.map((r) => (
                    <Badge key={r} variant="secondary" className="text-xs">
                      {r}
                    </Badge>
                  ))}
                </div>
                <ScenarioRow label="Approved" items={u.approved} variant="default" />
                <ScenarioRow label="Pending" items={u.pending} variant="outline" />
                <ScenarioRow label="Rejected / revoked" items={u.other} variant="destructive" />
              </div>
            ))}
            <Link to="/admin/users" className="inline-block text-xs underline">
              Manage approvals in User management
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function ScenarioRow({
  label,
  items,
  variant,
}: {
  label: string;
  items: Array<{ scenario: string }>;
  variant: "default" | "outline" | "destructive";
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      {items.map((s) => (
        <Badge key={s.scenario} variant={variant} className="text-xs">
          {SCENARIO_LABELS.get(s.scenario as never) ?? s.scenario}
        </Badge>
      ))}
    </div>
  );
}
