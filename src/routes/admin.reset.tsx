// Admin-only "fresh start" panel. Wipes every operational table so a freshly
// self-hosted Bostead instance can be handed off to a new farm. Preserves
// user accounts, profiles, and roles.

import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ShieldX, Trash2 } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { resetApplicationData, type ResetSummary } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/reset")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Reset application data — Bostead Farms" }] }),
  component: ResetPage,
});

const CLEARED = [
  "Backlog, today & scheduled tasks",
  "Projects",
  "Daily notes & summaries",
  "Maintenance records & service scheduling",
  "Inventory & consumables",
  "Food plan (people, foods, weekly entries)",
  "Food storage (pantry items & storage plan)",
  "Crops (plantings & harvests)",
  "Garden plots",
  "Orchard trees",
  "Livestock",
  "Plant seasons",
  "Food price history",
  "Activity log",
];

const PRESERVED = ["User accounts & sign-in", "Profiles & approval status", "Role assignments"];

function ResetPage() {
  const profile = useCurrentProfile();
  const resetFn = useServerFn(resetApplicationData);
  const [confirm, setConfirm] = useState("");
  const [results, setResults] = useState<ResetSummary[] | null>(null);

  const mut = useMutation({
    mutationFn: () => resetFn({ data: { confirm } }),
    onSuccess: (res) => {
      setResults(res.results);
      setConfirm("");
      const failed = res.results.filter((r) => r.error);
      if (failed.length) {
        toast.error(`${failed.length} table(s) failed — see details below.`);
      } else {
        const total = res.results.reduce((n, r) => n + (r.deleted ?? 0), 0);
        toast.success(`Application data cleared (${total} rows removed).`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (profile.isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-muted-foreground">
          Loading…
        </div>
      </AppLayout>
    );
  }

  if (!profile.data?.isAdmin) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-3">
          <ShieldX className="h-10 w-10 mx-auto text-destructive" />
          <h1 className="text-xl font-semibold">Admins only</h1>
          <p className="text-sm text-muted-foreground">
            You need the <strong>admin</strong> role to reset application data.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Fresh start</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Wipes all operational farm data so a self-hosted instance can be handed off
            to a new farm. Intended to be run <strong>once</strong> on a freshly deployed
            self-hosted copy.
          </p>
        </header>

        <div className="border border-destructive/40 rounded-lg bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5 mt-0.5" />
            <div className="text-sm font-medium">
              This is irreversible. There is no undo and no automatic backup.
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-medium mb-1">Will be deleted</div>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                {CLEARED.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">Will be preserved</div>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                {PRESERVED.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">
            Type <span className="font-mono font-semibold">RESET</span> to confirm
          </Label>
          <Input
            id="confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESET"
            autoComplete="off"
          />
        </div>

        <Button
          variant="destructive"
          disabled={confirm !== "RESET" || mut.isPending}
          onClick={() => mut.mutate()}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {mut.isPending ? "Clearing…" : "Clear all application data"}
        </Button>

        {results && (
          <div className="border border-border rounded-lg bg-card/30 p-4">
            <div className="font-medium text-sm mb-2">Results</div>
            <ul className="text-xs font-mono space-y-1">
              {results.map((r) => (
                <li
                  key={r.table}
                  className={r.error ? "text-destructive" : "text-muted-foreground"}
                >
                  {r.table}: {r.error ? `error — ${r.error}` : `${r.deleted ?? 0} rows`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
