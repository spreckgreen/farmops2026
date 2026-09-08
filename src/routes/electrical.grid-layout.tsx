// Grid Layout — the site defines its own grid lines, posts and intervals here.
// Everything that plots a record resolves against this definition instead of the
// frozen design drawing.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GRID_INTERVAL_KINDS,
  GRID_WALLS,
  INTERVAL_KIND_LABEL,
  intervalEnds,
  normalizeGridDefinition,
  setActiveGridGeometry,
  validateGridGeometry,
  type GridGeometry,
} from "@/lib/electrical-grid-definition";
import {
  getGridDefinition,
  saveGridDefinition,
} from "@/lib/electrical-grid-definition.functions";

export const Route = createFileRoute("/electrical/grid-layout")({
  component: GridLayoutPage,
  head: () => ({
    meta: [
      { title: "Grid Layout — Define Grid Lines, Posts & Intervals" },
      {
        name: "description",
        content:
          "Define your own grid lines, perimeter posts and named intervals so FarmOps records plot from your site geometry instead of the original design drawing.",
      },
      { property: "og:title", content: "Grid Layout — Define Grid Lines, Posts & Intervals" },
      {
        property: "og:description",
        content:
          "Owner-maintained grid geometry: row and column lines, posts and named intervals that every plotted record resolves against.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

interface LineRow {
  axis: "ROW" | "COLUMN";
  label: string;
  offset_ft: string;
}
interface PostRow {
  post_ref: string;
  wall: string;
  is_corner: boolean;
  x_ft: string;
  y_ft: string;
}
interface IntervalRow {
  interval_ref: string;
  kind: "POST_SPAN" | "LINE_SPAN";
  from_ref: string;
  to_ref: string;
}

interface Draft {
  name: string;
  scope_note: string;
  width: string;
  depth: string;
  notes: string;
  lines: LineRow[];
  posts: PostRow[];
  intervals: IntervalRow[];
}

const n = (v: string) => {
  const x = Number(String(v).trim());
  return Number.isFinite(x) ? x : 0;
};

function draftFrom(g: GridGeometry): Draft {
  return {
    name: g.name,
    scope_note: g.scopeNote ?? "",
    width: String(g.widthFt),
    depth: String(g.depthFt),
    notes: g.notes ?? "",
    lines: [
      ...g.rows.map((r) => ({ axis: "ROW" as const, label: r.label, offset_ft: String(r.offsetFt) })),
      ...g.cols.map((c) => ({
        axis: "COLUMN" as const,
        label: c.label,
        offset_ft: String(c.offsetFt),
      })),
    ],
    posts: g.posts.map((p) => ({
      post_ref: p.ref,
      wall: p.wall ?? "",
      is_corner: p.corner,
      x_ft: String(p.xFt),
      y_ft: String(p.yFt),
    })),
    intervals: g.intervals.map((i) => ({
      interval_ref: i.ref,
      kind: i.kind,
      from_ref: i.fromRef,
      to_ref: i.toRef,
    })),
  };
}

function geometryFromDraft(d: Draft): GridGeometry {
  return normalizeGridDefinition({
    definition_id: "GRID-01",
    name: d.name,
    scope_note: d.scope_note,
    envelope_width_ft: n(d.width),
    envelope_depth_ft: n(d.depth),
    notes: d.notes,
    lines: d.lines.map((l) => ({ axis: l.axis, label: l.label, offset_ft: n(l.offset_ft) })),
    posts: d.posts.map((p) => ({
      post_ref: p.post_ref,
      wall: p.wall || null,
      is_corner: p.is_corner,
      x_ft: n(p.x_ft),
      y_ft: n(p.y_ft),
    })),
    intervals: d.intervals.map((i) => ({
      interval_ref: i.interval_ref,
      kind: i.kind,
      from_ref: i.from_ref,
      to_ref: i.to_ref,
    })),
  });
}

function GridLayoutPage() {
  const load = useServerFn(getGridDefinition);
  const save = useServerFn(saveGridDefinition);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["grid-definition"], queryFn: () => load() });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (data) {
      setDraft(draftFrom(data.geometry));
      setActiveGridGeometry(data.uuid ? data.geometry : null);
    }
  }, [data]);

  const geometry = useMemo(() => (draft ? geometryFromDraft(draft) : null), [draft]);
  const issues = useMemo(() => (geometry ? validateGridGeometry(geometry) : []), [geometry]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      return save({
        data: {
          name: draft.name.trim() || "Site grid",
          scope_note: draft.scope_note.trim() || null,
          envelope_width_ft: n(draft.width),
          envelope_depth_ft: n(draft.depth),
          notes: draft.notes.trim() || null,
          lines: draft.lines
            .filter((l) => l.label.trim())
            .map((l) => ({
              axis: l.axis,
              label: l.label.trim().toUpperCase(),
              offset_ft: n(l.offset_ft),
            })),
          posts: draft.posts
            .filter((p) => p.post_ref.trim())
            .map((p) => ({
              post_ref: p.post_ref.trim().toUpperCase(),
              wall: (p.wall || null) as never,
              is_corner: p.is_corner,
              x_ft: n(p.x_ft),
              y_ft: n(p.y_ft),
            })),
          intervals: draft.intervals
            .filter((i) => i.interval_ref.trim())
            .map((i) => ({
              interval_ref: i.interval_ref.trim().toUpperCase(),
              kind: i.kind,
              from_ref: i.from_ref.trim().toUpperCase(),
              to_ref: i.to_ref.trim().toUpperCase(),
            })),
        },
      });
    },
    onSuccess: () => {
      toast.success("Grid saved. Records now plot from this layout.");
      void qc.invalidateQueries({ queryKey: ["grid-definition"] });
      void qc.invalidateQueries({ queryKey: ["electrical-grid-operational"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save the grid."),
  });

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Grid layout</h1>
            <p className="text-xs text-muted-foreground">
              Define your own grid lines, posts and intervals. Everything that plots a record uses
              this layout instead of the original design drawing.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/electrical">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Overview
            </Link>
          </Button>
        </div>

        {isLoading || !draft || !geometry ? (
          <p className="text-sm text-muted-foreground">Loading the grid layout…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Area and envelope</CardTitle>
                  <CardDescription>
                    The outline everything is measured inside, in feet.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="grid-name">Name</Label>
                    <Input
                      id="grid-name"
                      value={draft.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grid-scope">Applies to</Label>
                    <Input
                      id="grid-scope"
                      placeholder="Farm Shop building envelope"
                      value={draft.scope_note}
                      onChange={(e) => patch({ scope_note: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grid-width">Width, west → east (ft)</Label>
                    <Input
                      id="grid-width"
                      inputMode="decimal"
                      value={draft.width}
                      onChange={(e) => patch({ width: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grid-depth">Depth, north → south (ft)</Label>
                    <Input
                      id="grid-depth"
                      inputMode="decimal"
                      value={draft.depth}
                      onChange={(e) => patch({ depth: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="grid-notes">Notes</Label>
                    <Textarea
                      id="grid-notes"
                      rows={2}
                      value={draft.notes}
                      onChange={(e) => patch({ notes: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">Grid lines</CardTitle>
                    <CardDescription>
                      Row lines run north → south, column lines west → east. The offset is measured
                      from the north wall (rows) or the west wall (columns).
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patch({
                        lines: [...draft.lines, { axis: "ROW", label: "", offset_ft: "0" }],
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add line
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {draft.lines.map((l, i) => (
                    <div key={`line-${i}`} className="flex flex-wrap items-center gap-2">
                      <Select
                        value={l.axis}
                        onValueChange={(v) =>
                          patch({
                            lines: draft.lines.map((row, idx) =>
                              idx === i ? { ...row, axis: v as LineRow["axis"] } : row,
                            ),
                          })
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ROW">Row</SelectItem>
                          <SelectItem value="COLUMN">Column</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label="Line label"
                        className="w-24"
                        placeholder="A"
                        value={l.label}
                        onChange={(e) =>
                          patch({
                            lines: draft.lines.map((row, idx) =>
                              idx === i ? { ...row, label: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="Offset in feet"
                        className="w-28"
                        inputMode="decimal"
                        value={l.offset_ft}
                        onChange={(e) =>
                          patch({
                            lines: draft.lines.map((row, idx) =>
                              idx === i ? { ...row, offset_ft: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground">ft</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove line ${l.label || i + 1}`}
                        onClick={() =>
                          patch({ lines: draft.lines.filter((_, idx) => idx !== i) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">Posts and poles</CardTitle>
                    <CardDescription>
                      A post you define here wins over the position FarmOps used to derive from the
                      drawing.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patch({
                        posts: [
                          ...draft.posts,
                          { post_ref: "", wall: "", is_corner: false, x_ft: "0", y_ft: "0" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add post
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {draft.posts.map((p, i) => (
                    <div key={`post-${i}`} className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Post reference"
                        className="w-28"
                        placeholder="06SE"
                        value={p.post_ref}
                        onChange={(e) =>
                          patch({
                            posts: draft.posts.map((row, idx) =>
                              idx === i ? { ...row, post_ref: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <Select
                        value={p.wall || "none"}
                        onValueChange={(v) =>
                          patch({
                            posts: draft.posts.map((row, idx) =>
                              idx === i ? { ...row, wall: v === "none" ? "" : v } : row,
                            ),
                          })
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue placeholder="Wall" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No wall</SelectItem>
                          {GRID_WALLS.map((w) => (
                            <SelectItem key={w} value={w}>
                              {w}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label="Post X in feet"
                        className="w-24"
                        inputMode="decimal"
                        value={p.x_ft}
                        onChange={(e) =>
                          patch({
                            posts: draft.posts.map((row, idx) =>
                              idx === i ? { ...row, x_ft: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="Post Y in feet"
                        className="w-24"
                        inputMode="decimal"
                        value={p.y_ft}
                        onChange={(e) =>
                          patch({
                            posts: draft.posts.map((row, idx) =>
                              idx === i ? { ...row, y_ft: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={p.is_corner}
                          onChange={(e) =>
                            patch({
                              posts: draft.posts.map((row, idx) =>
                                idx === i ? { ...row, is_corner: e.target.checked } : row,
                              ),
                            })
                          }
                        />
                        corner
                      </label>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove post ${p.post_ref || i + 1}`}
                        onClick={() =>
                          patch({ posts: draft.posts.filter((_, idx) => idx !== i) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">Named intervals</CardTitle>
                    <CardDescription>
                      A run between two posts or two grid cells. A record whose location is one of
                      these names plots at the interval midpoint and keeps interval precision.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patch({
                        intervals: [
                          ...draft.intervals,
                          { interval_ref: "", kind: "POST_SPAN", from_ref: "", to_ref: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add interval
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {draft.intervals.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No named intervals yet. Add one, for example NORTH-RUN-01 between posts 20NW
                      and 26NE.
                    </p>
                  ) : null}
                  {draft.intervals.map((iv, i) => (
                    <div key={`interval-${i}`} className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Interval name"
                        className="w-40"
                        placeholder="NORTH-RUN-01"
                        value={iv.interval_ref}
                        onChange={(e) =>
                          patch({
                            intervals: draft.intervals.map((row, idx) =>
                              idx === i ? { ...row, interval_ref: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <Select
                        value={iv.kind}
                        onValueChange={(v) =>
                          patch({
                            intervals: draft.intervals.map((row, idx) =>
                              idx === i ? { ...row, kind: v as IntervalRow["kind"] } : row,
                            ),
                          })
                        }
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GRID_INTERVAL_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {INTERVAL_KIND_LABEL[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label="From"
                        className="w-28"
                        placeholder={iv.kind === "POST_SPAN" ? "20NW" : "A1"}
                        value={iv.from_ref}
                        onChange={(e) =>
                          patch({
                            intervals: draft.intervals.map((row, idx) =>
                              idx === i ? { ...row, from_ref: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="To"
                        className="w-28"
                        placeholder={iv.kind === "POST_SPAN" ? "26NE" : "A9"}
                        value={iv.to_ref}
                        onChange={(e) =>
                          patch({
                            intervals: draft.intervals.map((row, idx) =>
                              idx === i ? { ...row, to_ref: e.target.value } : row,
                            ),
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        {(() => {
                          const g = geometry.intervals.find(
                            (x) => x.ref === iv.interval_ref.trim().toUpperCase(),
                          );
                          const ends = g ? intervalEnds(geometry, g) : null;
                          return ends
                            ? `midpoint ${((ends.from.xFt + ends.to.xFt) / 2).toFixed(1)} / ${(
                                (ends.from.yFt + ends.to.yFt) / 2
                              ).toFixed(1)} ft`
                            : "ends not defined yet";
                        })()}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove interval ${iv.interval_ref || i + 1}`}
                        onClick={() =>
                          patch({ intervals: draft.intervals.filter((_, idx) => idx !== i) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="lg:sticky lg:top-4">
                <CardHeader>
                  <CardTitle className="text-base">Preview</CardTitle>
                  <CardDescription>
                    {geometry.rows.length} row lines, {geometry.cols.length} column lines,{" "}
                    {geometry.posts.length} posts, {geometry.intervals.length} named intervals.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <GridPreview geometry={geometry} />
                  {issues.length ? (
                    <ul className="space-y-1 text-xs text-destructive">
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      This layout is usable. Saving it changes how records plot everywhere.
                    </p>
                  )}
                  <Button
                    className="w-full"
                    disabled={mutation.isPending || issues.some((i) => !i.startsWith("Interval"))}
                    onClick={() => mutation.mutate()}
                  >
                    <Save className="mr-1 h-4 w-4" />
                    {mutation.isPending ? "Saving…" : "Save grid layout"}
                  </Button>
                  <Button asChild className="w-full" size="sm" variant="outline">
                    <Link to="/electrical/grid-map">Open the grid map</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </ElectricalGate>
  );
}

function GridPreview({ geometry }: { geometry: GridGeometry }) {
  const w = geometry.widthFt || 1;
  const h = geometry.depthFt || 1;
  const pad = 14;
  const vw = 100 + pad * 2;
  const vh = (h / w) * 100 + pad * 2;
  const px = (xFt: number) => pad + (xFt / w) * 100;
  const py = (yFt: number) => pad + (yFt / w) * 100;

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      className="w-full rounded border bg-card"
      role="img"
      aria-label="Preview of the defined grid layout"
    >
      <rect
        x={pad}
        y={pad}
        width={100}
        height={(h / w) * 100}
        className="fill-muted/40 stroke-foreground"
        strokeWidth={0.6}
      />
      {geometry.cols.map((c) => (
        <g key={`c-${c.label}`}>
          <line
            x1={px(c.offsetFt)}
            y1={pad}
            x2={px(c.offsetFt)}
            y2={py(h)}
            className="stroke-primary/50"
            strokeWidth={0.3}
          />
          <text x={px(c.offsetFt)} y={pad - 3} textAnchor="middle" fontSize={3.4} fill="currentColor">
            {c.label}
          </text>
        </g>
      ))}
      {geometry.rows.map((r) => (
        <g key={`r-${r.label}`}>
          <line
            x1={pad}
            y1={py(r.offsetFt)}
            x2={px(w)}
            y2={py(r.offsetFt)}
            className="stroke-primary/50"
            strokeWidth={0.3}
          />
          <text x={pad - 3} y={py(r.offsetFt) + 1.2} textAnchor="end" fontSize={3.4} fill="currentColor">
            {r.label}
          </text>
        </g>
      ))}
      {geometry.intervals.map((iv) => {
        const ends = intervalEnds(geometry, iv);
        if (!ends) return null;
        return (
          <line
            key={`i-${iv.ref}`}
            x1={px(ends.from.xFt)}
            y1={py(ends.from.yFt)}
            x2={px(ends.to.xFt)}
            y2={py(ends.to.yFt)}
            className="stroke-accent-foreground"
            strokeWidth={0.8}
            strokeDasharray="2 1.5"
          />
        );
      })}
      {geometry.posts.map((p) => (
        <circle
          key={`p-${p.ref}`}
          cx={px(p.xFt)}
          cy={py(p.yFt)}
          r={p.corner ? 1.5 : 1}
          className={p.corner ? "fill-destructive" : "fill-primary"}
        />
      ))}
    </svg>
  );
}
