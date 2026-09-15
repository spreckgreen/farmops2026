import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { RunAiTestCard } from "@/components/run-ai-test-card";
import { ReseedProfileCard } from "@/components/reseed-profile-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSelfHostConfig } from "@/hooks/use-self-host-config";
import {
  AlertTriangle,
  CheckCircle2,
  Users,
  Download,
  Upload,
  Trash2,
  Server,
  ShieldCheck,
  KeyRound,
  Database,
  DatabaseBackup,
  Bot,
  Merge,
  Activity,
  Mail,


  ClipboardList,
  Printer,
  Grid3x3,

} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Admin — Bostead" },
      {
        name: "description",
        content: "Admin dashboard: user management, backups, and AI diagnostics.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminIndexPage,
});

function AdminIndexPage() {
  const selfHost = useSelfHostConfig();
  const cfg = selfHost.data;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            Admin
          </h1>
          <p className="text-sm text-muted-foreground">
            Diagnostics and administrative tools for this Bostead instance.
          </p>
        </header>

        <ReseedProfileCard />

        <RunAiTestCard description="Verify the active AI backend and model before relying on it for reports and procedures." />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hosting model and reseed status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {selfHost.isLoading && (
              <p className="text-muted-foreground">Loading hosting status…</p>
            )}
            {selfHost.error && (
              <p className="text-destructive">
                Could not load hosting status: {(selfHost.error as Error).message}
              </p>
            )}
            {cfg && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Current model:</span>
                  <Badge variant="secondary">{cfg.hostingModelLabel}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {cfg.pendingDivergence ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-amber-800">
                        Pending divergence reported. Resolve before destructive migration or reseed.
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-muted-foreground">No pending divergence reported.</span>
                    </>
                  )}
                </div>
                <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                  <div className="font-medium flex items-center gap-2">
                    Cloud-synced reseed
                    <Badge variant={cfg.reseedReadiness.ready ? "secondary" : "outline"}>
                      {cfg.reseedReadiness.ready ? "Ready" : "Blocked"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{cfg.reseedWorkflowHint}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link to="/admin/reseed" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent">
                      <DatabaseBackup className="h-4 w-4" /> Open cloud-synced reseed
                    </Link>
                    <Link to="/settings/self-host" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent">
                      <Server className="h-4 w-4" /> Self-host settings
                    </Link>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin tools</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Link to="/admin/users" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Users className="h-4 w-4" /> User management
            </Link>
            <Link to="/admin/panel-access" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Users className="h-4 w-4" /> Panel edit access approvals
            </Link>
            <Link to="/admin/electrical-audit" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <ClipboardList className="h-4 w-4" /> Electrical change audit
            </Link>

            <Link to="/admin/export" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Download className="h-4 w-4" /> Export snapshot
            </Link>
            <Link to="/admin/restore" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Upload className="h-4 w-4" /> Restore backup
            </Link>
            <Link to="/admin/reseed" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <DatabaseBackup className="h-4 w-4" /> Cloud-synced reseed
            </Link>
            <Link to="/admin/reset" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Trash2 className="h-4 w-4" /> Reset data
            </Link>
            <Link to="/admin/vault-rotation" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <KeyRound className="h-4 w-4" /> Rotate vault key
            </Link>
            <Link to="/admin/vault-backup" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <KeyRound className="h-4 w-4" /> Vault backup & restore
            </Link>
            <Link to="/admin/vault-secrets" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <KeyRound className="h-4 w-4" /> Encrypted secret metadata
            </Link>
            <Link to="/admin/schema" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Database className="h-4 w-4" /> Schema diagnostics
            </Link>
            <Link to="/admin/ai" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent sm:col-span-2">
              <Bot className="h-4 w-4" /> AI administration (engines, routing, costs, provisioning)
            </Link>


            <Link to="/settings/self-host" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Mail className="h-4 w-4" /> SMTP / outbound email
            </Link>
            <Link to="/admin/task-dedupe" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Merge className="h-4 w-4" /> Task reconciliation
            </Link>
            <Link to="/admin/task-health" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Activity className="h-4 w-4" /> Task health monitor
            </Link>
            <Link to="/admin/task-print" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Printer className="h-4 w-4" /> Task print templates
            </Link>

            <Link
              to="/electrical/grid-data-quality"
              search={{ tab: "status" }}
              className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent"
            >
              <Grid3x3 className="h-4 w-4" /> Data quality — electrical grid
            </Link>




            <Link to="/settings/self-host" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent sm:col-span-2">
              <Server className="h-4 w-4" /> Self-host settings
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
