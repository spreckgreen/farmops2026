// "Connect a bridge" card inside Security → Cameras.
//
// Ring has no public live-video API, so the supported route is a local bridge
// (Home Assistant or Scrypted with go2rtc) that republishes each camera as HLS.
// The owner enters the bridge address once and confirms the stream name for each
// camera; the addresses are derived from those two facts and nothing else.

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyBridgeFeeds } from "@/lib/cameras.functions";
import {
  bridgeBaseProblem,
  buildBridgePlan,
  mixedContentWarning,
  streamSlug,
} from "@/lib/camera-bridge";
import type { CameraRow } from "@/lib/cameras";

interface Props {
  cameras: CameraRow[];
  /** Called after addresses are recorded, so statuses can be re-checked. */
  onApplied: () => void;
}

export function BridgeWiringCard({ cameras, onApplied }: Props) {
  const apply = useServerFn(applyBridgeFeeds);
  const [base, setBase] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});

  // Prefill each stream name from the camera name — a starting point the owner
  // corrects to whatever the bridge actually calls the stream.
  useEffect(() => {
    setNames((prev) => {
      const next = { ...prev };
      for (const row of cameras) {
        if (next[row.id] === undefined) next[row.id] = streamSlug(row.name);
      }
      return next;
    });
  }, [cameras]);

  const baseProblem = base.trim() === "" ? null : bridgeBaseProblem(base);

  const plan = useMemo(
    () =>
      buildBridgePlan(
        base,
        cameras.map((row) => ({
          id: row.id,
          camera_id: row.camera_id,
          name: row.name,
          streamName: names[row.id] ?? "",
        })),
      ),
    [base, cameras, names],
  );

  const mixed = useMemo(
    () =>
      typeof window === "undefined" ? null : mixedContentWarning(base, window.location.protocol),
    [base],
  );

  const mutation = useMutation({
    mutationFn: () =>
      apply({
        data: {
          base_url: base,
          assignments: plan.assignments.map((a) => ({ id: a.id, stream_name: a.streamName })),
        },
      }),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Recorded feed addresses for ${res.updated} cameras.`);
      else toast.error("Some addresses could not be recorded — see the list below.");
      onApplied();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canApply =
    !baseProblem &&
    base.trim() !== "" &&
    plan.assignments.length > 0 &&
    plan.duplicateStreamNames.length === 0 &&
    !mutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          Connect a bridge
        </CardTitle>
        <CardDescription>
          Ring does not offer a live video address of its own, so point these cameras at your Home
          Assistant or Scrypted bridge. Enter the bridge address, confirm the stream name each camera
          uses on it, and the playable addresses are recorded for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bridge-base">Bridge address</Label>
          <Input
            id="bridge-base"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="http://192.168.1.50:1984"
            autoComplete="off"
            spellCheck={false}
          />
          {baseProblem ? (
            <p className="text-xs text-destructive">{baseProblem}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The address you open the bridge on — host and port only, no path.
            </p>
          )}
        </div>

        {mixed && (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {mixed}
          </p>
        )}

        <div className="space-y-3">
          {cameras.map((row) => {
            const match = plan.assignments.find((a) => a.id === row.id);
            const duplicate =
              match !== undefined &&
              plan.duplicateStreamNames.includes(match.streamName.toLowerCase());
            return (
              <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1.4fr] sm:items-center">
                <div className="text-sm">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground">{row.camera_id}</div>
                </div>
                <div className="space-y-1">
                  <Input
                    value={names[row.id] ?? ""}
                    onChange={(e) => setNames((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="stream name on the bridge"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Bridge stream name for ${row.name}`}
                  />
                  {duplicate && (
                    <p className="text-xs text-destructive">
                      Two cameras cannot share the same stream name.
                    </p>
                  )}
                  {match && !duplicate && (
                    <p className="break-all text-xs font-mono text-muted-foreground">
                      {match.streamUrl}
                    </p>
                  )}
                  {!match && (
                    <p className="text-xs text-muted-foreground">
                      Left as it is until a stream name is entered.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!canApply} onClick={() => mutation.mutate()}>
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            {mutation.isPending
              ? "Recording addresses…"
              : `Record ${plan.assignments.length} feed ${plan.assignments.length === 1 ? "address" : "addresses"} and check`}
          </Button>
          {plan.skipped.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {plan.skipped.length} left unchanged.
            </span>
          )}
        </div>

        {mutation.data && (
          <ul className="space-y-1 text-xs">
            {mutation.data.results.map((r) => (
              <li key={r.id} className={r.error ? "text-destructive" : "text-muted-foreground"}>
                {r.camera_id}: {r.error ?? "address recorded"}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
