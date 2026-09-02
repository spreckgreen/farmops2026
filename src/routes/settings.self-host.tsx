import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useSelfHostConfig } from "@/hooks/use-self-host-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SmtpConfigCard } from "@/components/smtp-config-card";
import {
  AlertTriangle,
  CheckCircle2,
  Server,
  Cloud,
  Sparkles,
  Webhook,
  ExternalLink,
} from "lucide-react";


export const Route = createFileRoute("/settings/self-host")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Self-Host Settings — Bostead" },
      {
        name: "description",
        content:
          "Review self-host mode status, AI provider routing, and deployment settings.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SelfHostSettingsPage,
});

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 text-sm font-mono">
        {ok === true && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        {ok === false && <AlertTriangle className="h-4 w-4 text-amber-600" />}
        <span>{value}</span>
      </div>
    </div>
  );
}

function SelfHostSettingsPage() {
  const q = useSelfHostConfig();
  const cfg = q.data;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6" />
            Self-host settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Runtime configuration for deployments outside the Lovable platform.
            All values are read from server-side environment variables and
            require a redeploy to change.
          </p>
        </header>

        {q.isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {q.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(q.error as Error).message}
          </div>
        )}

        {cfg && (
          <>
            {/* Mode banner */}
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                {cfg.selfHostMode ? (
                  <>
                    <Server className="h-5 w-5 text-emerald-600" />
                    <div>
                      <div className="font-semibold">Self-host mode is ON</div>
                      <div className="text-sm text-muted-foreground">
                        Lovable-only UI (publish status, deployment host
                        info) is hidden. Set{" "}
                        <code>SELF_HOST_MODE=false</code> to restore it.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Cloud className="h-5 w-5 text-sky-600" />
                    <div>
                      <div className="font-semibold">
                        Self-host mode is OFF
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Running with Lovable-hosted defaults. Set{" "}
                        <code>SELF_HOST_MODE=true</code> in your environment
                        to hide Lovable-specific UI surfaces.
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* AI runtime moved to its own admin page */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" />
                  AI runtime
                  <Badge
                    variant={cfg.aiProvider === "none" ? "destructive" : "secondary"}
                    className="ml-2"
                  >
                    {cfg.aiProvider === "custom" ? "Custom endpoint" : "Disabled"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Endpoint status, model picker, per-feature routing, and AI
                  workflow tests now live on their own page.
                </p>
                <Link
                  to="/admin/ai-runtime"
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent"
                >
                  <Sparkles className="h-4 w-4" /> Open AI runtime
                </Link>
              </CardContent>
            </Card>

            {/* Outbound mail */}
            <SmtpConfigCard />


            {/* Webhooks */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Webhook className="h-4 w-4" />
                  Outbound webhook origin
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Origin used when generating callback URLs sent to
                  third-party services (Rachio).
                </p>
                <Row
                  label="PUBLIC_APP_URL"
                  value={cfg.publicAppUrl ?? "(unset — using default)"}
                  ok={cfg.publicAppUrl ? true : null}
                />
                <Row
                  label="Rachio callback"
                  value={
                    <span className="flex items-center gap-1">
                      {cfg.webhookOrigin}/api/public/webhooks/rachio
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </span>
                  }
                  ok={cfg.publicAppUrl ? true : false}
                />
                {!cfg.publicAppUrl && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Set <code>PUBLIC_APP_URL</code> to your externally
                    reachable origin (e.g.{" "}
                    <code>https://farm.example.com</code>) so Rachio calls
                    reach this deployment.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Lovable-only UI toggles */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Lovable-only UI surfaces
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  label="Publish status panel (/sync)"
                  value={cfg.selfHostMode ? "hidden" : "visible"}
                />
                <p className="text-xs text-muted-foreground pt-2">
                  These surfaces classify the host by <code>*.lovable.app</code>{" "}
                  domains and are meaningless on a self-hosted deployment.
                  They are hidden automatically when self-host mode is on.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
