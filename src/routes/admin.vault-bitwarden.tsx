import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { mirrorStatusLabel, mirrorStatusTone, type MirrorStatus } from "@/lib/vault-bitwarden";
import {
  forgetMirrorLink,
  getMirrorStatus,
  resolveMirrorConflict,
  rotateBridgeToken,
  saveMirrorSettings,
} from "@/lib/vault-bitwarden.functions";

export const Route = createFileRoute("/admin/vault-bitwarden")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Bitwarden mirror — Bostead" },
      {
        name: "description",
        content:
          "Mirror the FarmOps vault with a Bitwarden folder through a bridge that runs on your own network.",
      },
      { property: "og:title", content: "Bitwarden mirror — Bostead" },
      {
        property: "og:description",
        content: "Two-way, conflict-aware mirroring between the FarmOps vault and your Bitwarden folder.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VaultBitwardenPage,
});

function toneClass(tone: "ok" | "warn" | "danger" | "muted"): string {
  switch (tone) {
    case "ok":
      return "border-primary/40 text-primary";
    case "warn":
      return "border-accent/60 text-accent-foreground";
    case "danger":
      return "border-destructive/60 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}

function VaultBitwardenPage() {
  const fetchStatus = useServerFn(getMirrorStatus);
  const saveSettings = useServerFn(saveMirrorSettings);
  const rotateToken = useServerFn(rotateBridgeToken);
  const resolveConflict = useServerFn(resolveMirrorConflict);
  const forgetLink = useServerFn(forgetMirrorLink);

  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftFolder, setDraftFolder] = useState<string | null>(null);

  const status = useQuery({ queryKey: ["vault-bitwarden-status"], queryFn: () => fetchStatus() });

  const data = status.data;
  const folderName = draftFolder ?? data?.folderName ?? "FarmOps";

  async function withBusy(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await status.refetch();
      toast.success(label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Bitwarden mirror</h1>
          <p className="text-sm text-muted-foreground">
            Your vault entries and a Bitwarden folder stay matched to each other. A small helper on your own
            network does the talking to Bitwarden, so your Bitwarden password never reaches this app.
          </p>
        </header>

        {status.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading mirror status…
          </div>
        ) : status.error ? (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              {status.error instanceof Error ? status.error.message : "Could not load the mirror status."}
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What gets mirrored</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">My personal entries</p>
                      <p className="text-xs text-muted-foreground">Only entries you own.</p>
                    </div>
                    <Switch
                      checked={data.mirrorPersonal}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        withBusy("Mirror settings saved", () =>
                          saveSettings({
                            data: {
                              mirrorPersonal: checked,
                              mirrorShared: data.mirrorShared,
                              folderName,
                              paused: data.paused,
                            },
                          }),
                        )
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">Shared entries</p>
                      <p className="text-xs text-muted-foreground">Entries everyone with access can see.</p>
                    </div>
                    <Switch
                      checked={data.mirrorShared}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        withBusy("Mirror settings saved", () =>
                          saveSettings({
                            data: {
                              mirrorPersonal: data.mirrorPersonal,
                              mirrorShared: checked,
                              folderName,
                              paused: data.paused,
                            },
                          }),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="folder">Bitwarden folder name</Label>
                    <Input
                      id="folder"
                      value={folderName}
                      onChange={(event) => setDraftFolder(event.target.value)}
                      placeholder="FarmOps"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      withBusy("Mirror settings saved", async () => {
                        await saveSettings({
                          data: {
                            mirrorPersonal: data.mirrorPersonal,
                            mirrorShared: data.mirrorShared,
                            folderName,
                            paused: data.paused,
                          },
                        });
                        setDraftFolder(null);
                      })
                    }
                  >
                    Save folder
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{data.paused ? "Mirroring is paused" : "Mirroring is active"}</p>
                    <p className="text-xs text-muted-foreground">
                      {data.paused
                        ? "The helper is turned away until you resume."
                        : "The helper may run whenever it is scheduled."}
                    </p>
                  </div>
                  <Button
                    variant={data.paused ? "default" : "outline"}
                    disabled={busy}
                    onClick={() =>
                      withBusy(data.paused ? "Mirroring resumed" : "Mirroring paused", () =>
                        saveSettings({
                          data: {
                            mirrorPersonal: data.mirrorPersonal,
                            mirrorShared: data.mirrorShared,
                            folderName,
                            paused: !data.paused,
                          },
                        }),
                      )
                    }
                  >
                    {data.paused ? "Resume" : "Pause"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4" /> Helper access code
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  The helper on your network signs in with a long access code. We keep only a fingerprint of it, so
                  it is shown once and never again.
                </p>
                <p>
                  Current code fingerprint:{" "}
                  <span className="font-mono">{data.tokenFingerprint ?? "none yet"}</span>
                  {data.tokenRotatedAt ? (
                    <span className="text-muted-foreground"> · set {new Date(data.tokenRotatedAt).toLocaleString()}</span>
                  ) : null}
                </p>
                <p className="text-muted-foreground">
                  Last time the helper checked in:{" "}
                  {data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString() : "never"}
                </p>
                {freshToken ? (
                  <div className="space-y-2 rounded-md border border-primary/40 p-3">
                    <p className="font-medium">Copy this now — it will not be shown again.</p>
                    <code className="block break-all rounded bg-muted p-2 font-mono text-xs">{freshToken}</code>
                    <Button size="sm" variant="ghost" onClick={() => setFreshToken(null)}>
                      I have saved it
                    </Button>
                  </div>
                ) : null}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    withBusy("New access code created", async () => {
                      const result = await rotateToken();
                      setFreshToken(result.token);
                    })
                  }
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Create a new access code
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Entries</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.links.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing paired yet. Set up the helper, then it will pair entries on its first run.
                  </p>
                ) : (
                  data.links.map((link) => {
                    const tone = mirrorStatusTone(link.status as MirrorStatus);
                    return (
                      <div
                        key={link.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{link.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {link.scope === "personal" ? "Personal" : "Shared"}
                            {link.lastSyncedAt
                              ? ` · matched ${new Date(link.lastSyncedAt).toLocaleString()}`
                              : " · never matched"}
                          </p>
                          {link.conflictReason ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {link.conflictReason}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={toneClass(tone)}>
                            {mirrorStatusLabel(link.status as MirrorStatus)}
                          </Badge>
                          {link.status === "conflict" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  withBusy("This app's copy will be sent to Bitwarden", () =>
                                    resolveConflict({ data: { linkId: link.id, winner: "keep_farmops" } }),
                                  )
                                }
                              >
                                Keep this app's copy
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  withBusy("The Bitwarden copy will be brought in", () =>
                                    resolveConflict({ data: { linkId: link.id, winner: "keep_bitwarden" } }),
                                  )
                                }
                              >
                                Keep the Bitwarden copy
                              </Button>
                            </>
                          ) : null}
                          {link.status === "deleted_local" ||
                          link.status === "deleted_remote" ||
                          link.status === "orphan" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                withBusy("Pairing forgotten — nothing was deleted", () =>
                                  forgetLink({ data: { linkId: link.id } }),
                                )
                              }
                            >
                              Forget pairing
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent runs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.runs.length === 0 ? (
                  <p className="text-muted-foreground">The helper has not run yet.</p>
                ) : (
                  data.runs.map((run) => (
                    <div key={run.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                      {run.status === "ok" ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : run.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      )}
                      <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
                      <span>
                        {run.pushed} sent · {run.pulled} brought in · {run.conflicts} to decide · {run.skipped} skipped
                      </span>
                      {run.error ? <span className="text-destructive">{run.error}</span> : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
