import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import {
  electricalTopology,
  deleteWaypoint,
  listWaypoints,
  saveWaypoint,
} from "@/lib/electrical.functions";
import {
  installStatusLabel,
  panelPositions,
  type ElectricalEntityKind,
} from "@/lib/electrical";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { DeleteDependencyDialog } from "@/components/electrical/delete-dependency-dialog";
import { PanelLayoutPanels } from "@/components/electrical/panel-layout";
import { LoadCurrentSemanticsPanel } from "@/components/electrical/load-current-semantics-panel";
import {
  JboxRacewayTopology,
  RacewayJunctionPoints,
} from "@/components/electrical/raceway-path";



export const Route = createFileRoute("/electrical/item/$kind/$id")({
  component: ItemPage,
  errorComponent: ({ error }) => (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">{error.message}</CardContent>
    </Card>
  ),
  notFoundComponent: () => (
    <Card>
      <CardContent className="py-6 text-sm text-muted-foreground">Record not found.</CardContent>
    </Card>
  ),
  beforeLoad: ({ params }) => {
    if (!ENTITY_KINDS.includes(params.kind as ElectricalEntityKind)) throw notFound();
  },
  head: ({ params }) => {
    const def = ENTITIES[params.kind as ElectricalEntityKind];
    const title = `${def?.singular ?? "Record"} detail — Bostead Farms`;
    const description = `Linked topology, install status and field notes for one electrical ${def?.singular ?? "record"}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
});

function ItemPage() {
  const { kind, id } = Route.useParams();
  return (
    <ElectricalGate>
      <Detail kind={kind as ElectricalEntityKind} id={id} />
    </ElectricalGate>
  );
}

function Detail({ kind, id }: { kind: ElectricalEntityKind; id: string }) {
  const def = ENTITIES[kind];
  const navigate = useNavigate();

  const fetcher = useServerFn(electricalTopology);
  const q = useQuery({
    queryKey: ["electrical", "topology", kind, id],
    queryFn: () => fetcher({ data: { kind, id } }),
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );

  // Nothing below may assume a topology exists: a legacy imported record can
  // have no relationships, no space count and no as-built links at all.
  const record = q.data?.record ?? null;
  const related = q.data?.related ?? [];
  const warnings = q.data?.warnings ?? [];
  if (!record)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Record not found.
        </CardContent>
      </Card>
    );
  const positions = kind === "panel" ? panelPositions(record["spaces"] as number | null) : [];
  const progress = displayCompletionPercent(
    record["install_status"] as string | null,
    record["completion_percent"] as number | null,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/electrical/$kind" params={{ kind }}>
            <ArrowLeft className="h-4 w-4" />
            {def.title}
          </Link>
        </Button>
        <span className="font-mono text-lg">{String(record[def.stableIdField] ?? "")}</span>
        <Badge variant="outline">
          {installStatusLabel(String(record["install_status"] ?? "planned"))}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1">
            <Link to="/electrical/$kind" params={{ kind }} search={{ edit: id }}>
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </Button>
          <DeleteDependencyDialog
            kind={kind}
            id={id}
            label={String(record[def.stableIdField] ?? "")}
            singular={def.singular}
            onDeleted={() => void navigate({ to: "/electrical/$kind", params: { kind } })}
          />

        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Record</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {def.fields.map((f) => {
                const value = record[f.key];
                if (value == null || value === "" || value === false) return null;
                // The inventory asset link is shown by name, pointing at the
                // Asset record that owns manufacturer, serial, cost, warranty
                // and maintenance — never as a raw id.
                if (f.kind === "asset") {
                  return (
                    <div key={f.key} className="contents">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd>
                        <Link to="/inventory" className="underline underline-offset-2">
                          {String(record["asset_ref"] ?? "") || "Linked asset"}
                        </Link>
                      </dd>
                    </div>
                  );
                }
                // Already rendered as the link above.
                if (f.key === "asset_ref" && record["asset_uuid"]) return null;
                // Complete % is a reading of the recorded stage, not an
                // independent number, so it always matches the stage shown
                // above it.
                if (f.key === "completion_percent") return null;
                return (
                  <div key={f.key} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd>
                      {f.kind === "bool"
                        ? "Yes"
                        : f.key === "install_status"
                          ? installStatusLabel(String(value))
                          : String(value)}
                    </dd>
                  </div>
                );
              })}
              {def.fields.some((f) => f.key === "completion_percent") && progress.percent != null ? (
                <div className="contents">
                  <dt className="text-muted-foreground">Complete %</dt>
                  <dd>
                    {progress.percent}%
                    <span className="ml-1 text-xs text-muted-foreground">
                      {progress.source === "stage"
                        ? `matches stage ${installStatusLabel(String(record["install_status"] ?? "planned"))}`
                        : "recorded value"}
                    </span>
                    {progress.stale ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (an older saved number disagreed and was ignored)
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connected records</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {!related.length ? (
              <p className="text-muted-foreground">
                Nothing links to this record yet. Endpoints are matched on stable IDs.
              </p>
            ) : (
              related.map((r, i) => (
                <div key={`${r.kind}-${r.stable_id}-${i}`} className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="font-mono">
                    {r.stable_id}
                  </Badge>
                  <span className="text-muted-foreground">{r.relation}</span>
                  <span>{r.label}</span>
                </div>
              ))
            )}
            {warnings.length ? (
              <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/40 p-2">
                <p className="text-xs font-medium">
                  Some relationship lookups were unavailable — the record above is unaffected.
                </p>
                {warnings.map((w, i) => (
                  <p key={`${w.kind}-${w.column}-${i}`} className="text-xs text-muted-foreground">
                    {w.message}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>

        </Card>
      </div>

      {kind === "load" ? (
        <LoadCurrentSemanticsPanel
          record={record as Record<string, unknown>}
          stableId={String(record[def.stableIdField] ?? "")}
        />
      ) : null}

      {kind === "raceway" ? <RacewayJunctionPoints racewayId={id} /> : null}
      {kind === "jbox" ? (
        <JboxRacewayTopology
          racewayUuid={(record["raceway_uuid"] as string | null) ?? null}
          racewayRef={(record["raceway_ref"] as string | null) ?? null}
          sequence={(record["raceway_sequence"] as number | null) ?? null}
        />
      ) : null}

      {kind === "panel" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Breaker positions ({positions.length} spaces)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!positions.length ? (
              <p className="text-sm text-muted-foreground">
                Set the panel's space count to generate positions — the layout is derived from
                this panel, never assumed.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 text-sm font-mono">
                <div>
                  {positions
                    .filter((p) => p.side === "Left")
                    .map((p) => (
                      <div key={p.breaker} className="border-b border-border py-0.5">
                        {p.label} · breaker {p.breaker}
                      </div>
                    ))}
                </div>
                <div>
                  {positions
                    .filter((p) => p.side === "Right")
                    .map((p) => (
                      <div key={p.breaker} className="border-b border-border py-0.5">
                        {p.label} · breaker {p.breaker}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {kind === "panel" ? <PanelLayoutPanels panelUuid={id} /> : null}

      {kind === "raceway" ? <Waypoints racewayId={id} /> : null}
    </div>
  );
}

function Waypoints({ racewayId }: { racewayId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listWaypoints);
  const save = useServerFn(saveWaypoint);
  const remove = useServerFn(deleteWaypoint);
  const [grid, setGrid] = useState("");
  const [direction, setDirection] = useState("");
  // Inline edit buffer for one existing waypoint at a time.
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ sequence: "1", grid: "", direction: "", notes: "" });

  const q = useQuery({
    queryKey: ["electrical", "waypoints", racewayId],
    queryFn: () => list({ data: { raceway_id: racewayId } }),
  });

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["electrical", "waypoints", racewayId] });

  const add = useMutation({
    mutationFn: async () =>
      save({
        data: {
          raceway_id: racewayId,
          sequence: (q.data?.length ?? 0) + 1,
          grid: grid || undefined,
          direction: direction || undefined,
        },
      }),
    onSuccess: () => {
      setGrid("");
      setDirection("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async (id: string) =>
      save({
        data: {
          id,
          raceway_id: racewayId,
          sequence: Math.max(1, Number(draft.sequence) || 1),
          grid: draft.grid || undefined,
          direction: draft.direction || undefined,
          notes: draft.notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Waypoint updated");
      setEditId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Waypoint deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (w: Record<string, unknown>) => {
    setEditId(String(w["id"]));
    setDraft({
      sequence: String(w["sequence"] ?? 1),
      grid: String(w["grid"] ?? ""),
      direction: String(w["direction"] ?? ""),
      notes: String(w["notes"] ?? ""),
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Path waypoints</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Bends, turns and elevation changes along this continuous raceway. A turn is a
          waypoint — never invent a junction box for it.
        </p>
        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ol className="space-y-2 text-sm">
            {(q.data ?? []).map((w) =>
              editId === String(w["id"]) ? (
                <li key={String(w["id"])} className="space-y-2 rounded-md border p-2">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="w-20"
                      type="number"
                      min={1}
                      value={draft.sequence}
                      onChange={(e) => setDraft((d) => ({ ...d, sequence: e.target.value }))}
                    />
                    <Input
                      className="w-28"
                      placeholder="Grid"
                      value={draft.grid}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, grid: e.target.value.toUpperCase() }))
                      }
                    />
                    <Input
                      className="flex-1 min-w-[160px]"
                      placeholder="Direction / note"
                      value={draft.direction}
                      onChange={(e) => setDraft((d) => ({ ...d, direction: e.target.value }))}
                    />
                  </div>
                  <Input
                    placeholder="Notes"
                    value={draft.notes}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate(String(w["id"]))}
                    >
                      {update.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                      Cancel
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={String(w["id"])} className="flex items-center gap-2">
                  <Badge variant="outline">{String(w["sequence"])}</Badge>
                  <span className="font-mono">{String(w["grid"] ?? "—")}</span>
                  <span className="text-muted-foreground">{String(w["direction"] ?? "")}</span>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(w)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Delete waypoint ${String(w["sequence"])}?`)) {
                        del.mutate(String(w["id"]));
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </li>
              ),
            )}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-28"
            placeholder="Grid"
            value={grid}
            onChange={(e) => setGrid(e.target.value.toUpperCase())}
          />
          <Input
            className="flex-1 min-w-[160px]"
            placeholder="Direction / note (e.g. 90° up to ceiling)"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          />
          <Button
            className="gap-1"
            disabled={add.isPending || (!grid && !direction)}
            onClick={() => add.mutate()}
          >
            <Plus className="h-4 w-4" />
            Add waypoint
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

