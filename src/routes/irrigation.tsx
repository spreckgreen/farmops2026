import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Droplets, RefreshCw, Link2, Copy, Eye, EyeOff } from "lucide-react";

const RACHIO_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  listRachioDashboard,
  listLinkTargets,
  saveRachioToken,
  syncRachioInventory,
  syncRachioRecentRuns,
  linkRachioZone,
  type RachioZoneRow,
} from "@/lib/rachio.functions";

export const Route = createFileRoute("/irrigation")({
  component: IrrigationPage,
  errorComponent: ({ error }) => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-destructive">
        Failed to load irrigation: {error.message}
      </div>
    </AppLayout>
  ),
  notFoundComponent: () => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Not found.</div>
    </AppLayout>
  ),
});

function IrrigationPage() {
  const qc = useQueryClient();
  const fetchDashboard = useServerFn(listRachioDashboard);
  const dashboard = useQuery({
    queryKey: ["rachio", "dashboard"],
    queryFn: () => fetchDashboard({ data: { days: 14 } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rachio"] });

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Droplets className="h-6 w-6 text-sky-500" /> Irrigation
            </h1>
            <p className="text-sm text-muted-foreground">
              Rachio controller status, zone configuration, and recent watering runs.
            </p>
          </div>
        </header>

        {dashboard.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {dashboard.error && (
          <div className="text-sm text-destructive">{(dashboard.error as Error).message}</div>
        )}
        {dashboard.data && (
          <Tabs defaultValue={dashboard.data.status.connected ? "zones" : "setup"}>
            <TabsList>
              <TabsTrigger value="zones">Controllers &amp; Zones</TabsTrigger>
              <TabsTrigger value="runs">Recent Watering</TabsTrigger>
              <TabsTrigger value="setup">Setup</TabsTrigger>
            </TabsList>
            <TabsContent value="zones" className="mt-4">
              <ZonesPane data={dashboard.data} onChanged={invalidate} />
            </TabsContent>
            <TabsContent value="runs" className="mt-4">
              <RunsPane data={dashboard.data} />
            </TabsContent>
            <TabsContent value="setup" className="mt-4">
              <SetupPane data={dashboard.data} onChanged={invalidate} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

function ZonesPane({
  data,
  onChanged,
}: {
  data: Awaited<ReturnType<typeof listRachioDashboard>>;
  onChanged: () => void;
}) {
  const [linking, setLinking] = useState<RachioZoneRow | null>(null);
  const sync = useServerFn(syncRachioInventory);
  const syncMut = useMutation({
    mutationFn: () => sync({}),
    onSuccess: (r) => { toast.success(`Synced ${r.controllers} controllers, ${r.zones} zones`); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (!data.status.connected) {
    return <div className="text-sm text-muted-foreground">Connect Rachio first — see the Setup tab.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {data.controllers.length} controller{data.controllers.length === 1 ? "" : "s"} ·{" "}
          {data.zones.length} zone{data.zones.length === 1 ? "" : "s"}
          {data.status.lastSyncAt && ` · last synced ${new Date(data.status.lastSyncAt).toLocaleString()}`}
        </div>
        <Button size="sm" variant="outline" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 ${syncMut.isPending ? "animate-spin" : ""}`} /> Sync now
        </Button>
      </div>

      {data.controllers.map((c) => (
        <div key={c.id} className="rounded-md border">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <div>
              <div className="font-medium">{c.name ?? "Unnamed controller"}</div>
              <div className="text-xs text-muted-foreground">
                {[c.model, c.serial_number, c.status].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
          </div>
          <ul className="divide-y">
            {data.zones.filter((z) => z.controller_id === c.id).map((z) => (
              <li key={z.id} className="px-4 py-3 flex items-center gap-3">
                <div className="text-xs w-6 text-muted-foreground">{z.zone_number ?? "—"}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{z.name ?? `Zone ${z.zone_number ?? ""}`}</div>
                  <div className="text-xs text-muted-foreground">
                    {[z.nozzle, z.area_sqft ? `${z.area_sqft} sqft` : null,
                      z.last_run_at ? `last run ${new Date(z.last_run_at).toLocaleString()}` : "no recent runs",
                    ].filter(Boolean).join(" · ")}
                  </div>
                  {(z.garden_plot_id || z.orchard_tree_id) && (
                    <div className="text-xs text-emerald-600 mt-0.5">
                      Linked to {z.garden_plot_id ? "garden plot" : "orchard tree"}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setLinking(z)}>
                  <Link2 className="h-3.5 w-3.5" /> Link
                </Button>
              </li>
            ))}
            {data.zones.filter((z) => z.controller_id === c.id).length === 0 && (
              <li className="px-4 py-3 text-xs text-muted-foreground">No zones discovered yet — try Sync now.</li>
            )}
          </ul>
        </div>
      ))}

      {linking && (
        <LinkZoneDialog
          zone={linking}
          onClose={() => setLinking(null)}
          onSaved={() => { setLinking(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function LinkZoneDialog({
  zone, onClose, onSaved,
}: { zone: RachioZoneRow; onClose: () => void; onSaved: () => void }) {
  const fetchTargets = useServerFn(listLinkTargets);
  const targets = useQuery({ queryKey: ["rachio", "link-targets"], queryFn: () => fetchTargets({}) });
  const link = useServerFn(linkRachioZone);
  const [plot, setPlot] = useState<string>(zone.garden_plot_id ?? "");
  const [tree, setTree] = useState<string>(zone.orchard_tree_id ?? "");

  const save = useMutation({
    mutationFn: () => link({ data: {
      zoneId: zone.id,
      gardenPlotId: plot || null,
      orchardTreeId: tree || null,
    } }),
    onSuccess: () => { toast.success("Zone linked"); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link {zone.name ?? "zone"} to a plot or tree</DialogTitle>
          <DialogDescription>
            Watering runs for this zone will roll up to whatever you link below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Garden plot</Label>
            <Select value={plot || "none"} onValueChange={(v) => setPlot(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(targets.data?.plots ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.row_label} #{p.position}{p.plant_name ? ` — ${p.plant_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Orchard tree</Label>
            <Select value={tree || "none"} onValueChange={(v) => setTree(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(targets.data?.trees ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.species}{t.variety ? ` (${t.variety})` : ""}{t.location ? ` · ${t.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunsPane({ data }: { data: Awaited<ReturnType<typeof listRachioDashboard>> }) {
  const qc = useQueryClient();
  const sync = useServerFn(syncRachioRecentRuns);
  const syncMut = useMutation({
    mutationFn: () => sync({ data: { days: 7 } }),
    onSuccess: (r) => { toast.success(`${r.runs} runs synced`); qc.invalidateQueries({ queryKey: ["rachio"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{data.runs.length} runs in the last 14 days</div>
        <Button size="sm" variant="outline" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 ${syncMut.isPending ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr><th className="text-left p-2">When</th><th className="text-left p-2">Zone</th><th className="text-right p-2">Duration</th><th className="text-right p-2">Gallons</th><th className="text-left p-2">Source</th><th className="text-left p-2">Status</th></tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                <td className="p-2">{r.zone_name ?? "—"}</td>
                <td className="p-2 text-right">{r.duration_seconds ? `${Math.round(r.duration_seconds / 60)} min` : "—"}</td>
                <td className="p-2 text-right">{r.gallons != null ? Math.round(r.gallons) : "—"}</td>
                <td className="p-2">{r.source ?? "—"}</td>
                <td className="p-2">{r.status ?? "—"}</td>
              </tr>
            ))}
            {data.runs.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-xs text-muted-foreground">No runs recorded in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetupPane({
  data, onChanged,
}: { data: Awaited<ReturnType<typeof listRachioDashboard>>; onChanged: () => void }) {
  const [token, setToken] = useState("");
  const save = useServerFn(saveRachioToken);
  const sync = useServerFn(syncRachioInventory);
  const saveMut = useMutation({
    mutationFn: async () => {
      await save({ data: { token } });
      await sync({});
    },
    onSuccess: () => { toast.success("Connected to Rachio"); setToken(""); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const webhookHookUrl = `${data.status.webhookUrl}?token=YOUR_WEBHOOK_SECRET`;
  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Copy failed"),
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold">1. Connect your Rachio account</h2>
        <p className="text-xs text-muted-foreground">
          In the Rachio app, go to Account Settings → Get API Key. Paste it below; it is stored
          encrypted in your personal vault and never shared with other users.
        </p>
        <div className="space-y-2">
          <Label htmlFor="rachio-token">Personal API token</Label>
          <Input
            id="rachio-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={data.status.connected ? "•••• (already saved — paste a new value to replace)" : ""}
          />
          <Button onClick={() => saveMut.mutate()} disabled={!token || saveMut.isPending}>
            {saveMut.isPending ? "Validating…" : data.status.connected ? "Replace token" : "Connect"}
          </Button>
          {data.status.connected && (
            <div className="text-xs text-emerald-600">
              ✓ Connected{data.status.lastSyncAt && ` · last sync ${new Date(data.status.lastSyncAt).toLocaleString()}`}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold">2. Register the webhook in Rachio</h2>
        <p className="text-xs text-muted-foreground">
          Point Rachio's webhook at the URL below. The <code>token</code> query parameter is your
          shared secret — Bostead rejects any callback that does not match. Get the secret value
          from your <code>RACHIO_WEBHOOK_SECRET</code> environment variable on the server.
        </p>
        <div className="space-y-2">
          <Label>Webhook URL template</Label>
          <div className="flex gap-2">
            <Input readOnly value={webhookHookUrl} className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => copy(webhookHookUrl)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Subscribe to <code>DEVICE_ZONE_RUN_STARTED_EVENT</code>,{" "}
            <code>DEVICE_ZONE_RUN_COMPLETED_EVENT</code>, and{" "}
            <code>DEVICE_ZONE_RUN_SKIPPED_EVENT</code> for full coverage.
          </p>
        </div>
      </section>

      <section className="rounded-md border p-4 space-y-2">
        <h2 className="font-semibold">3. Optional: daily safety-net sync</h2>
        <p className="text-xs text-muted-foreground">
          Configure pg_cron (or any scheduler) to POST <code>{`${data.status.webhookUrl.replace("/webhooks/rachio", "/hooks/rachio-sync")}`}</code>{" "}
          with header <code>x-rachio-cron-secret: $RACHIO_WEBHOOK_SECRET</code> once a day.
          This re-pulls inventory and the last 48 h of runs in case any webhook was missed.
        </p>
      </section>
    </div>
  );
}
