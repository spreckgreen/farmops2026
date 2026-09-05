// Admin-only scoped data cleaning: clear an entire site, one module on a site,
// or one location on a site. Every clear takes a backup first, and each backup
// can be downloaded or restored back into an empty scope.

import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Eraser, RotateCcw, ShieldX } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import {
  downloadCleanBackup,
  listCleanBackups,
  listCleaningTargets,
  previewDataClean,
  restoreCleanBackup,
  runDataClean,
} from "@/lib/data-cleaning.functions";
import type { ScopeKind } from "@/lib/data-cleaning";

export const Route = createFileRoute("/admin/data-cleaning")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Clear and restore site data — Bostead Farms" },
      {
        name: "description",
        content:
          "Clear a whole site, a single module, or one location, with a backup taken before every clear and a restore that only fills an empty scope.",
      },
      { property: "og:title", content: "Clear and restore site data — Bostead Farms" },
      {
        property: "og:description",
        content: "Scoped data cleaning with a required backup and matching restore.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataCleaningPage,
});

const SCOPES: { value: ScopeKind; label: string; hint: string }[] = [
  { value: "WHOLE_SITE", label: "Entire site", hint: "Everything recorded for this site, including its building grids." },
  { value: "MODULE", label: "One module", hint: "One area of the app across the whole site." },
  { value: "LOCATION", label: "One location", hint: "Only records that name a single building on the site." },
];

function DataCleaningPage() {
  const profile = useCurrentProfile();
  const queryClient = useQueryClient();

  const targetsFn = useServerFn(listCleaningTargets);
  const previewFn = useServerFn(previewDataClean);
  const clearFn = useServerFn(runDataClean);
  const backupsFn = useServerFn(listCleanBackups);
  const downloadFn = useServerFn(downloadCleanBackup);
  const restoreFn = useServerFn(restoreCleanBackup);

  const [kind, setKind] = useState<ScopeKind>("MODULE");
  const [sitePlanId, setSitePlanId] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState<Record<string, string>>({});

  const isAdmin = Boolean(profile.data?.isAdmin);

  const targets = useQuery({
    queryKey: ["cleaning-targets"],
    queryFn: () => targetsFn(),
    enabled: isAdmin,
  });

  const backups = useQuery({
    queryKey: ["clean-backups"],
    queryFn: () => backupsFn(),
    enabled: isAdmin,
  });

  const site = useMemo(
    () => targets.data?.sites.find((s) => s.id === sitePlanId) ?? null,
    [targets.data, sitePlanId],
  );

  const allowedModules = useMemo(() => {
    const keys = targets.data?.module_keys_by_scope?.[kind] ?? [];
    return (targets.data?.modules ?? []).filter((m) => keys.includes(m.key));
  }, [targets.data, kind]);

  const scopeInput = {
    kind,
    site_plan_id: sitePlanId,
    module_key: kind === "WHOLE_SITE" ? null : moduleKey || null,
    location_label: kind === "LOCATION" ? locationLabel : null,
  };

  const ready =
    Boolean(sitePlanId) &&
    (kind === "WHOLE_SITE" || Boolean(moduleKey)) &&
    (kind !== "LOCATION" || Boolean(locationLabel));

  const preview = useMutation({
    mutationFn: () => previewFn({ data: scopeInput }),
    onError: (e) => toast.error((e as Error).message),
  });

  const clear = useMutation({
    mutationFn: () => clearFn({ data: { ...scopeInput, confirm_site_name: confirmName } }),
    onSuccess: (res) => {
      setConfirmName("");
      preview.reset();
      void queryClient.invalidateQueries({ queryKey: ["clean-backups"] });
      if (res.ok) toast.success(`Cleared ${res.total_rows} records. A backup was saved first.`);
      else toast.error("Some records could not be removed — see the results below.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const download = useMutation({
    mutationFn: (id: string) => downloadFn({ data: { id } }),
    onSuccess: (row) => {
      const blob = new Blob([JSON.stringify(row, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `farmops-backup-${String(row.id).slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const restore = useMutation({
    mutationFn: (input: { id: string; dry_run: boolean }) =>
      restoreFn({
        data: {
          id: input.id,
          confirm_site_name: restoreConfirm[input.id] ?? "",
          dry_run: input.dry_run,
        },
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["clean-backups"] });
      if (res.dry_run) {
        toast.success(
          res.ok
            ? `Ready to restore ${res.total_rows} records — nothing is in the way.`
            : `Cannot restore yet: ${res.blocking.map((b) => `${b.table} (${b.count})`).join(", ")}`,
        );
      } else if (res.ok) {
        toast.success(`Restored ${res.label}.`);
      } else {
        toast.error("Some records could not be put back — see the report.");
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (profile.isLoading) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 py-10 text-sm text-muted-foreground">Loading…</div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-3">
          <ShieldX className="h-10 w-10 mx-auto text-destructive" />
          <h1 className="text-xl font-semibold">Admins only</h1>
          <p className="text-sm text-muted-foreground">
            You need the <strong>admin</strong> role to clear or restore site data.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Clear and restore site data</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clear an entire site, one module, or one location. A backup of exactly what is removed is
            saved before anything is deleted, and you can put it back later into an empty scope.
          </p>
        </header>

        <section className="border border-border rounded-lg bg-card/30 p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Site</Label>
              <Select value={sitePlanId} onValueChange={setSitePlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a site" />
                </SelectTrigger>
                <SelectContent>
                  {(targets.data?.sites ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.site_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(targets.data?.sites ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No sites yet — define a site and its building grids first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>How much to clear</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ScopeKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {SCOPES.find((s) => s.value === kind)?.hint}
              </p>
            </div>

            {kind !== "WHOLE_SITE" && (
              <div className="space-y-2">
                <Label>Module</Label>
                <Select value={moduleKey} onValueChange={setModuleKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a module" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedModules.map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {kind === "LOCATION" && (
              <div className="space-y-2">
                <Label>Location on the site</Label>
                <Select value={locationLabel} onValueChange={setLocationLabel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a building" />
                  </SelectTrigger>
                  <SelectContent>
                    {(site?.locations ?? []).map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {site && site.locations.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    This site has no named buildings yet, so there is no location to clear.
                  </p>
                )}
              </div>
            )}
          </div>

          <Button variant="outline" disabled={!ready || preview.isPending} onClick={() => preview.mutate()}>
            {preview.isPending ? "Checking…" : "Show what would be cleared"}
          </Button>
        </section>

        {preview.data && (
          <section className="border border-destructive/40 rounded-lg bg-destructive/5 p-4 space-y-4">
            <div className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 mt-0.5" />
              <div className="text-sm font-medium">
                {preview.data.label} — {preview.data.total_rows}{" "}
                {preview.data.total_rows === 1 ? "record" : "records"} would be removed.
              </div>
            </div>

            <ul className="text-xs font-mono space-y-1 text-muted-foreground">
              {preview.data.tables.map((t) => (
                <li key={t.table}>
                  {t.table}: {t.count} to remove{t.withheld > 0 ? `, ${t.withheld} left alone` : ""}
                </li>
              ))}
            </ul>

            {preview.data.withheld_notes.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="font-medium">Left alone on purpose</div>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                  {preview.data.withheld_notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="confirm-name">
                Type the site name exactly —{" "}
                <span className="font-mono font-semibold">{preview.data.scope.site_name}</span>
              </Label>
              <Input
                id="confirm-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </div>

            <Button
              variant="destructive"
              disabled={
                clear.isPending ||
                preview.data.total_rows === 0 ||
                confirmName.trim().toLowerCase() !== preview.data.scope.site_name.trim().toLowerCase()
              }
              onClick={() => clear.mutate()}
            >
              <Eraser className="h-4 w-4 mr-2" />
              {clear.isPending ? "Backing up and clearing…" : "Back up, then clear"}
            </Button>

            {clear.data && (
              <ul className="text-xs font-mono space-y-1">
                {clear.data.results.map((r) => (
                  <li key={r.table} className={r.error ? "text-destructive" : "text-muted-foreground"}>
                    {r.table}: {r.error ? `error — ${r.error}` : `${r.deleted} removed`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Backups</h2>
          {(backups.data?.backups ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No clears have been run yet.</p>
          ) : (
            <ul className="space-y-3">
              {(backups.data?.backups ?? []).map((b: Record<string, unknown>) => {
                const id = String(b.id);
                const siteName = String(b.site_name ?? "");
                return (
                  <li key={id} className="border border-border rounded-lg bg-card/30 p-4 space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{String(b.label)}</div>
                        <div className="text-xs text-muted-foreground">
                          {String(b.total_rows)} records · cleared{" "}
                          {new Date(String(b.cleared_at)).toLocaleString()}
                          {b.restored_at
                            ? ` · restored ${new Date(String(b.restored_at)).toLocaleString()}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => download.mutate(id)}>
                          <Download className="h-4 w-4 mr-1" /> Download
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restore.mutate({ id, dry_run: true })}
                        >
                          Check restore
                        </Button>
                      </div>
                    </div>

                    {!b.restored_at && (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`restore-${id}`} className="text-xs">
                            Type <span className="font-mono font-semibold">{siteName}</span> to restore
                          </Label>
                          <Input
                            id={`restore-${id}`}
                            className="h-8 w-56"
                            value={restoreConfirm[id] ?? ""}
                            onChange={(e) =>
                              setRestoreConfirm((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={
                            restore.isPending ||
                            (restoreConfirm[id] ?? "").trim().toLowerCase() !==
                              siteName.trim().toLowerCase()
                          }
                          onClick={() => restore.mutate({ id, dry_run: false })}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" /> Put these records back
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
