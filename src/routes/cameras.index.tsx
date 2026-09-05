import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Loader2, MapPin, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { CameraFeed } from "@/components/cameras/camera-feed";
import { CameraCoverageMap } from "@/components/cameras/camera-coverage-map";
import {
  CameraEditDialog,
  draftFromRow,
  type CameraDraft,
} from "@/components/cameras/camera-edit-dialog";
import {
  checkCameraStatus,
  deleteCamera,
  listCameraChecks,
  listCameras,
  saveCamera,
} from "@/lib/cameras.functions";
import {
  CAMERA_STATUS_CLASS,
  CAMERA_STATUS_LABEL,
  cameraCoverageSummary,
  cameraStatus,
  headingLabel,
  lastSeenLabel,
  nextCameraId,
  sortCameras,
  type CameraRow,
} from "@/lib/cameras";
import { rowsToCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/cameras/")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Cameras — live feeds and coverage | Bostead Farms" },
      {
        name: "description",
        content:
          "Watch farm cameras live, see what each one covers on the Farm Shop plan, and check which cameras are answering.",
      },
      { property: "og:title", content: "Cameras — live feeds and coverage" },
      {
        property: "og:description",
        content:
          "Live camera feeds, recorded coverage on the building plan, and on-demand reachability checks for Bostead Farms.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CamerasPage,
});

function numberOrNull(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function CamerasPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(listCameras);
  const save = useServerFn(saveCamera);
  const remove = useServerFn(deleteCamera);
  const check = useServerFn(checkCameraStatus);
  const checks = useServerFn(listCameraChecks);

  const [draft, setDraft] = useState<CameraDraft | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const camerasQuery = useQuery({ queryKey: ["cameras"], queryFn: () => load() });
  const rows = useMemo(() => sortCameras(camerasQuery.data?.cameras ?? []), [camerasQuery.data]);
  const summary = useMemo(() => cameraCoverageSummary(rows), [rows]);

  const historyQuery = useQuery({
    queryKey: ["camera-checks", historyFor],
    queryFn: () => checks({ data: { id: historyFor! } }),
    enabled: Boolean(historyFor),
  });

  const saveMutation = useMutation({
    mutationFn: (value: CameraDraft) =>
      save({
        data: {
          id: value.id ?? null,
          camera_id: value.camera_id,
          name: value.name,
          area: value.area,
          building: value.building,
          mount: value.mount,
          stream_kind: value.stream_kind,
          stream_url: value.stream_url,
          snapshot_url: value.snapshot_url,
          x_feet: numberOrNull(value.x_feet),
          y_feet: numberOrNull(value.y_feet),
          heading_degrees: numberOrNull(value.heading_degrees),
          fov_degrees: numberOrNull(value.fov_degrees),
          range_feet: numberOrNull(value.range_feet),
          electrical_load_ref: value.electrical_load_ref,
          notes: value.notes,
        },
      }),
    onSuccess: () => {
      toast.success("Camera saved");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["cameras"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The camera could not be saved."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Camera removed");
      void queryClient.invalidateQueries({ queryKey: ["cameras"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The camera could not be removed."),
  });

  const checkMutation = useMutation({
    mutationFn: (id: string) => check({ data: { id } }),
    onSuccess: (result) => {
      toast[result.ok ? "success" : "error"](result.detail);
      void queryClient.invalidateQueries({ queryKey: ["cameras"] });
      void queryClient.invalidateQueries({ queryKey: ["camera-checks"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "The camera could not be checked."),
  });

  const openNew = () => {
    setDraft(draftFromRow(null, nextCameraId(rows)));
    setDialogOpen(true);
  };
  const openEdit = (row: CameraRow) => {
    setDraft(draftFromRow(row, row.camera_id));
    setDialogOpen(true);
  };

  const exportCsv = () => {
    downloadCsv(
      "cameras.csv",
      rowsToCsv(
        rows.map((row) => ({
          camera_id: row.camera_id,
          name: row.name,
          building: row.building ?? "",
          area: row.area ?? "",
          mount: row.mount ?? "",
          status: cameraStatus(row),
          x_feet: row.x_feet ?? "",
          y_feet: row.y_feet ?? "",
          heading: row.heading_degrees ?? "",
          fov_degrees: row.fov_degrees,
          range_feet: row.range_feet,
          powered_by: row.electrical_load_ref ?? "",
          last_seen_at: row.last_seen_at ?? "",
        })),
        [
          { key: "camera_id", label: "Camera" },
          { key: "name", label: "Name" },
          { key: "building", label: "Building" },
          { key: "area", label: "Area" },
          { key: "mount", label: "Mount" },
          { key: "status", label: "Status" },
          { key: "x_feet", label: "X (ft)" },
          { key: "y_feet", label: "Y (ft)" },
          { key: "heading", label: "Facing (deg)" },
          { key: "fov_degrees", label: "View width (deg)" },
          { key: "range_feet", label: "Distance (ft)" },
          { key: "powered_by", label: "Powered by" },
          { key: "last_seen_at", label: "Last seen" },
        ],
      ),
    );
  };

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Camera className="h-6 w-6 text-primary" aria-hidden /> Cameras
            </h1>
            <p className="text-sm text-muted-foreground">
              Live views, what each camera actually covers, and which ones are answering right now.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              Export list
            </Button>
            <Button onClick={openNew}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add camera
            </Button>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Cameras", value: summary.total },
            { label: "Answering", value: summary.online },
            { label: "Not answering", value: summary.offline },
            { label: "On the plan", value: `${summary.placed} of ${summary.total}` },
          ].map((tile) => (
            <Card key={tile.label}>
              <CardHeader className="pb-2">
                <CardDescription>{tile.label}</CardDescription>
                <CardTitle className="text-2xl">{tile.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        {camerasQuery.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading cameras…
          </p>
        ) : camerasQuery.isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">
              {camerasQuery.error instanceof Error
                ? camerasQuery.error.message
                : "The camera list could not be loaded."}
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 p-6">
              <p className="text-sm text-muted-foreground">
                No cameras recorded yet. Add one with its feed address to watch it here, and add its
                position in feet to see its coverage on the shop plan.
              </p>
              <Button onClick={openNew}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add the first camera
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="live">
            <TabsList>
              <TabsTrigger value="live">Live feeds</TabsTrigger>
              <TabsTrigger value="coverage">Coverage map</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
            </TabsList>

            <TabsContent value="live" className="mt-4 grid gap-4 md:grid-cols-2">
              {rows.map((row) => {
                const status = cameraStatus(row);
                return (
                  <Card key={row.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">
                            {row.camera_id} · {row.name}
                          </CardTitle>
                          <CardDescription>
                            {[row.building, row.area, row.mount].filter(Boolean).join(" · ") ||
                              "No location recorded"}
                          </CardDescription>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs ${CAMERA_STATUS_CLASS[status]}`}
                        >
                          {CAMERA_STATUS_LABEL[status]}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <CameraFeed camera={row} />
                      <p className="text-xs text-muted-foreground">
                        {lastSeenLabel(row)}
                        {row.electrical_load_ref ? ` · Powered by ${row.electrical_load_ref}` : ""}
                        {headingLabel(row.heading_degrees)
                          ? ` · Facing ${headingLabel(row.heading_degrees)}`
                          : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => checkMutation.mutate(row.id)}
                          disabled={checkMutation.isPending}
                        >
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Check now
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${row.camera_id}? Its check history is removed with it.`,
                              )
                            ) {
                              deleteMutation.mutate(row.id);
                            }
                          }}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Remove
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>

            <TabsContent value="coverage" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MapPin className="h-4 w-4 text-primary" aria-hidden /> Farm Shop coverage
                  </CardTitle>
                  <CardDescription>
                    Each wedge is what one camera can see, drawn from its recorded position, facing,
                    view width and useful distance. Nothing here is estimated.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CameraCoverageMap
                    cameras={rows}
                    selectedId={selectedId}
                    onSelect={(camera) => setSelectedId(camera.id)}
                  />
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Green: answering</span>
                    <span>Red: not answering</span>
                    <span>Grey: not checked</span>
                    <span>
                      {summary.aimed} of {summary.total} have a facing direction recorded
                    </span>
                  </div>
                </CardContent>
              </Card>

              {summary.gaps.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">What is still missing</CardTitle>
                    <CardDescription>
                      These are stated plainly rather than filled in with assumptions.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {summary.gaps.map((gap, index) => (
                        <li key={`${gap.cameraId}-${index}`}>
                          <span className="font-medium text-foreground">{gap.cameraId}</span> —{" "}
                          {gap.reason}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="status" className="mt-4 space-y-4">
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {rows.map((row) => {
                      const status = cameraStatus(row);
                      return (
                        <div key={row.id} className="space-y-2 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">
                                {row.camera_id} · {row.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {lastSeenLabel(row)}
                                {row.last_check_detail ? ` · ${row.last_check_detail}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs ${CAMERA_STATUS_CLASS[status]}`}
                              >
                                {CAMERA_STATUS_LABEL[status]}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => checkMutation.mutate(row.id)}
                                disabled={checkMutation.isPending}
                              >
                                Check now
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setHistoryFor((prev) => (prev === row.id ? null : row.id))
                                }
                              >
                                {historyFor === row.id ? "Hide history" : "History"}
                              </Button>
                            </div>
                          </div>
                          {historyFor === row.id ? (
                            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                              {historyQuery.isLoading ? (
                                <p className="text-muted-foreground">Loading checks…</p>
                              ) : (historyQuery.data?.checks ?? []).length === 0 ? (
                                <p className="text-muted-foreground">
                                  No checks recorded for this camera yet.
                                </p>
                              ) : (
                                <ul className="space-y-1">
                                  {(historyQuery.data?.checks ?? []).map((entry) => (
                                    <li key={entry.id} className="flex justify-between gap-3">
                                      <span>{new Date(entry.checked_at).toLocaleString()}</span>
                                      <span
                                        className={
                                          entry.ok ? "text-primary" : "text-destructive"
                                        }
                                      >
                                        {entry.ok ? "Answered" : "No answer"}
                                        {entry.latency_ms !== null
                                          ? ` · ${entry.latency_ms} ms`
                                          : ""}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <CameraEditDialog
        open={dialogOpen}
        draft={draft}
        saving={saveMutation.isPending}
        onOpenChange={setDialogOpen}
        onSave={(value) => saveMutation.mutate(value)}
      />
    </AppLayout>
  );
}
