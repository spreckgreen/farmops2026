import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { RunAiTestCard } from "@/components/run-ai-test-card";
import { ReseedProfileCard } from "@/components/reseed-profile-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  Download,
  Upload,
  Trash2,
  Server,
  ShieldCheck,
  KeyRound,
  Database,
  Bot,
  Merge,
  Activity,
  Mail,


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
            <CardTitle className="text-base">Admin tools</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Link to="/admin/users" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Users className="h-4 w-4" /> User management
            </Link>
            <Link to="/admin/panel-access" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Users className="h-4 w-4" /> Panel edit access approvals
            </Link>
            <Link to="/admin/export" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Download className="h-4 w-4" /> Export snapshot
            </Link>
            <Link to="/admin/restore" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Upload className="h-4 w-4" /> Restore backup
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
            <Link to="/admin/ai-settings" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Bot className="h-4 w-4" /> AI configuration
            </Link>
            <Link to="/admin/ai-engines" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Bot className="h-4 w-4" /> AI engines (local / hosted)
            </Link>
            <Link to="/admin/ai-runtime" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
              <Bot className="h-4 w-4" /> AI runtime (endpoint, model, tests)
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


            <Link to="/settings/self-host" className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent sm:col-span-2">
              <Server className="h-4 w-4" /> Self-host settings
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
