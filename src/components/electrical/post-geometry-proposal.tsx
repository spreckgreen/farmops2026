// Perimeter post geometry — proposal for owner review.
//
// It shows the derived position of every post in the frozen clockwise scheme, with
// the derivation behind each one, and lets a person hand-correct a post's grid cell
// with a reconciliation note when the geometric check is uncertain. An override
// records the cell only — the frozen coordinates are never edited.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  POST_GEOMETRY_AUDIT,
  POST_GEOMETRY_CONFIRMED,
  POST_GEOMETRY_REVIEW_NOTE,
  POST_GEOMETRY_VERSION,
  PROPOSED_POST_POSITIONS,
} from "@/lib/electrical-grid-post-geometry";
import {
  GRID_CELL_CHOICES,
  postGridRows,
} from "@/lib/electrical-post-grid-override";
import {
  clearPostGridOverride,
  listPostGridOverrides,
  savePostGridOverride,
} from "@/lib/electrical-post-grid-override.functions";
import {
  postGeometryExportCsv,
  postGeometryExportFilename,
  postGeometryExportJson,
} from "@/lib/electrical-post-geometry-export";


/** Read-only download of the confirmed post callouts and their audit metadata. */
function download(kind: "json" | "csv") {
  const now = new Date();
  const body = kind === "json" ? postGeometryExportJson(now) : postGeometryExportCsv(now);
  const url = URL.createObjectURL(
    new Blob([body], { type: kind === "json" ? "application/json" : "text/csv" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = postGeometryExportFilename(kind, now);
  a.click();
  URL.revokeObjectURL(url);
}

export function PostGeometryProposal() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [cell, setCell] = useState("");
  const [note, setNote] = useState("");
  const audit = POST_GEOMETRY_AUDIT;
  const failing = audit.checks.filter((c) => !c.ok);

  const qc = useQueryClient();
  const list = useServerFn(listPostGridOverrides);
  const save = useServerFn(savePostGridOverride);
  const clear = useServerFn(clearPostGridOverride);
  const overrides = useQuery({ queryKey: ["post-grid-overrides"], queryFn: () => list() });
  const rows = postGridRows(overrides.data ?? []);
  const uncertainCount = rows.filter((r) => r.uncertainty.uncertain).length;

  const done = (msg: string) => {
    toast.success(msg);
    setEditing(null);
    setCell("");
    setNote("");
    void qc.invalidateQueries({ queryKey: ["post-grid-overrides"] });
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save that override");

  const saving = useMutation({
    mutationFn: (v: { postRef: string; gridCell: string; note: string }) => save({ data: v }),
    onSuccess: (r) => done(`Override saved for ${r.postRef}`),
    onError: fail,
  });
  const clearing = useMutation({
    mutationFn: (postRef: string) => clear({ data: { postRef } }),
    onSuccess: (r) => done(`Override removed for ${r.postRef}`),
    onError: fail,
  });

  const startEdit = (ref: string, current: string) => {
    setEditing(ref);
    setCell(current);
    setNote(rows.find((r) => r.ref === ref)?.override?.reconciliationNote ?? "");
  };


  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Perimeter post positions{" "}
          <span className="font-normal text-muted-foreground">
            ({PROPOSED_POST_POSITIONS.length} posts ·{" "}
            {POST_GEOMETRY_CONFIRMED ? "confirmed against the frozen outline" : "proposed, awaiting confirmation"})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">{POST_GEOMETRY_REVIEW_NOTE}</p>
        <p className="text-muted-foreground">
          Outline check: {audit.postCount} of {audit.expectedPostCount} posts positioned,
          ring {audit.ringLengthFt} ft against a {audit.outline.perimeterFt} ft perimeter,{" "}
          {audit.checks.length - failing.length} of {audit.checks.length} posts on the
          outline with the expected wall spacing.{" "}
          {audit.ok ? "All checks pass." : `${failing.length + audit.issues.length} check(s) need review.`}
        </p>
        {audit.issues.length ? (
          <ul className="list-disc space-y-1 pl-4 text-amber-600">
            {audit.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted-foreground">
          Derived from the corrected 60 × 40 ft outline and the frozen clockwise post
          sequence: the four recorded corner posts (01NE, 06SE, 14SW, 19NW) are fixed, and
          the posts between two corners are spaced evenly along that wall — 8.0 ft on the
          east and west walls, 7.5 ft on the north and south walls. No new measurement is
          introduced. The grid cell shown for each post is a human-readable lookup of its
          feet, never the position itself. Geometry version {POST_GEOMETRY_VERSION}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide post callouts" : "Show post callouts"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => download("csv")}>
            Download CSV report
          </Button>
          <Button size="sm" variant="outline" onClick={() => download("json")}>
            Download JSON report
          </Button>
        </div>

        <p className="text-muted-foreground">
          {uncertainCount === 0
            ? "The geometric check is certain for all 26 posts. A grid cell can still be corrected by hand when the site says otherwise; a reconciliation note is required."
            : `${uncertainCount} post(s) have an uncertain grid cell (tied between grid lines or off the outline). Correct the cell by hand with a reconciliation note.`}{" "}
          {rows.filter((r) => r.override).length
            ? `${rows.filter((r) => r.override).length} manual override(s) in effect — feet are unchanged.`
            : "No manual overrides in effect."}
        </p>

        {open ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 pr-3">Post</th>
                  <th className="py-1 pr-3">Wall</th>
                  <th className="py-1 pr-3">X ft E</th>
                  <th className="py-1 pr-3">Y ft S</th>
                  <th className="py-1 pr-3">Grid cell</th>
                  <th className="py-1 pr-3">Spacing</th>
                  <th className="py-1 pr-3">Outline</th>
                  <th className="py-1 pr-3">Basis</th>
                  <th className="py-1">Grid cell override</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <>
                    <tr key={p.ref} className="border-b last:border-0 align-top">
                      <td className="py-1 pr-3 font-mono">{p.ref}</td>
                      <td className="py-1 pr-3">
                        {p.wall}
                        {p.corner ? " (corner)" : ""}
                      </td>
                      <td className="py-1 pr-3 font-mono">{p.xFt}</td>
                      <td className="py-1 pr-3 font-mono">{p.yFt}</td>
                      <td className="py-1 pr-3 font-mono">
                        {p.effectiveGridCell}
                        {p.override ? (
                          <span className="ml-1 text-amber-600">(manual, derived {p.gridCell})</span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-3 font-mono">{p.spacingFromPreviousFt} ft</td>
                      <td className="py-1 pr-3">
                        {p.ok ? "on outline" : p.issues.join(" ")}
                        {p.uncertainty.uncertain ? (
                          <span className="ml-1 text-amber-600">uncertain</span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-3 text-muted-foreground">
                        {PROPOSED_POST_POSITIONS.find((q) => q.ref === p.ref)?.basis}
                      </td>
                      <td className="py-1">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              editing === p.ref ? setEditing(null) : startEdit(p.ref, p.effectiveGridCell)
                            }
                          >
                            {editing === p.ref ? "Cancel" : p.override ? "Edit override" : "Override cell"}
                          </Button>
                          {p.override ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={clearing.isPending}
                              onClick={() => clearing.mutate(p.ref)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                        {p.override ? (
                          <p className="mt-1 max-w-xs text-muted-foreground">
                            {p.override.reconciliationNote}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                    {editing === p.ref ? (
                      <tr key={`${p.ref}-edit`} className="border-b bg-muted/40">
                        <td colSpan={9} className="p-3">
                          <div className="space-y-2">
                            {p.uncertainty.uncertain ? (
                              <ul className="list-disc space-y-1 pl-4 text-amber-600">
                                {p.uncertainty.reasons.map((r) => (
                                  <li key={r}>{r}</li>
                                ))}
                              </ul>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-muted-foreground" htmlFor={`cell-${p.ref}`}>
                                Corrected grid cell for {p.ref}
                              </label>
                              <select
                                id={`cell-${p.ref}`}
                                className="h-8 rounded-md border bg-background px-2"
                                value={cell}
                                onChange={(e) => setCell(e.target.value)}
                              >
                                <option value="">Select a cell…</option>
                                {GRID_CELL_CHOICES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                    {c === p.gridCell ? " (derived)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <Textarea
                              aria-label={`Reconciliation note for ${p.ref}`}
                              placeholder="Why does the site differ from the derived cell? (required)"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={saving.isPending}
                                onClick={() =>
                                  saving.mutate({ postRef: p.ref, gridCell: cell, note })
                                }
                              >
                                Save override and note
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                            </div>
                            <p className="text-muted-foreground">
                              The override records the grid cell only. The post keeps its frozen
                              position ({p.xFt} ft east, {p.yFt} ft south) and no electrical record
                              is changed.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}


      </CardContent>
    </Card>
  );
}
