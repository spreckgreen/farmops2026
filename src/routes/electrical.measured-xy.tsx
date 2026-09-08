// Measured field X/Y entry — record instrument measurements per record, stage
// them as one field-audit batch, preview the exact changes, then apply.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Ruler, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  applyElectricalAuditBatch,
  importElectricalAuditBatch,
  setElectricalAuditItemApproval,
  type AuditBatchPreview,
} from "@/lib/electrical-audit-batch.functions";
import {
  MEASURED_XY_ENTITY_KINDS,
  buildMeasuredXyManifest,
  emptyMeasuredXyRow,
  measuredXyKindTitle,
  measuredXyManifestText,
  suggestMeasuredXyBatchId,
  validateMeasuredXyRow,
  type MeasuredXyEntryHeader,
  type MeasuredXyEntryRow,
} from "@/lib/electrical-measured-xy-entry";
import {
  MEASURED_XY_METHODS,
  MEASURED_XY_METHOD_LABEL,
  type MeasuredXyMethod,
} from "@/lib/electrical-measured-xy";
import type { AuditEntityKind } from "@/lib/electrical-audit-batch";

export const Route = createFileRoute("/electrical/measured-xy")({
  component: MeasuredXyPage,
  head: () => ({
    meta: [
      { title: "Measured Field Coordinates — Bostead Farms" },
      {
        name: "description",
        content:
          "Record measured field X/Y coordinates for panels, junction boxes, loads and switch banks, stage them as one field-audit batch, preview every change and apply it.",
      },
      { property: "og:title", content: "Measured Field Coordinates — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Instrument-measured coordinate entry with audit staging, per-record preview and guarded batch apply.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const today = () => new Date().toISOString().slice(0, 10);

function MeasuredXyPage() {
  const [header, setHeader] = useState<MeasuredXyEntryHeader>(() => ({
    batchId: suggestMeasuredXyBatchId("FS"),
    title: "Measured field X/Y coordinates",
    observedDate: today(),
    building: "Farm Shop",
    scope: "Measured field X/Y coordinates",
    source: "FarmOps measured X/Y entry screen",
  }));
  const [rows, setRows] = useState<MeasuredXyEntryRow[]>([emptyMeasuredXyRow("r1")]);
  const [preview, setPreview] = useState<AuditBatchPreview | null>(null);
  const [reason, setReason] = useState("");

  const setRow = (id: string, patch: Partial<MeasuredXyEntryRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const build = useMemo(() => buildMeasuredXyManifest(header, rows), [header, rows]);
  const errorsById = useMemo(
    () => new Map(build.rowErrors.map((r) => [r.id, r.errors])),
    [build.rowErrors],
  );

  const stageFn = useServerFn(importElectricalAuditBatch);
  const approveFn = useServerFn(setElectricalAuditItemApproval);
  const applyFn = useServerFn(applyElectricalAuditBatch);

  const stage = useMutation({
    mutationFn: async () => {
      if (!build.ok || !build.manifest) throw new Error("Fix the highlighted entries first.");
      return stageFn({ data: { manifest: measuredXyManifestText(build.manifest) } });
    },
    onSuccess: (p) => {
      setPreview(p);
      toast.success(`${p.batch.batch_id} staged — nothing has been written yet.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const readyKeys = useMemo(
    () => (preview?.items ?? []).filter((i) => i.disposition === "ready").map((i) => i.item_key),
    [preview],
  );

  const apply = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Stage the batch first.");
      if (!readyKeys.length) throw new Error("No measurement is ready to apply.");
      if (reason.trim().length < 3) throw new Error("Give a reason for the record.");
      await approveFn({
        data: { batch_id: preview.batch.batch_id, item_keys: readyKeys, approved: true },
      });
      return applyFn({
        data: {
          batch_id: preview.batch.batch_id,
          statement: `I measured these coordinates on site and accept them as the field-authoritative location for ${readyKeys.length} record(s).`,
          reason: reason.trim(),
          confirm: true as const,
        },
      });
    },
    onSuccess: (p) => {
      setPreview(p);
      toast.success(`${p.batch.batch_id} applied — measured coordinates are now plotted.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      emptyMeasuredXyRow(`r${Date.now()}`, {
        entityKind: prev.at(-1)?.entityKind ?? "load",
        method: prev.at(-1)?.method ?? "TAPE",
        datum: prev.at(-1)?.datum ?? "",
        measuredBy: prev.at(-1)?.measuredBy ?? "",
        measuredAt: prev.at(-1)?.measuredAt ?? "",
      }),
    ]);

  return (
    <ElectricalGate>
      <div className="space-y-3">
        <header>
          <h1 className="text-lg font-semibold">Measured field coordinates</h1>
          <p className="text-sm text-muted-foreground">
            A measured X/Y is an instrument reading taken on site. It is the highest-authority
            location statement FarmOps recognises: it outranks a verified post, interval or grid
            cell and every design coordinate, and it is the only source shown as a measured
            coordinate. Entries are staged as one field audit, previewed record by record, and
            written only when you apply them.
          </p>
        </header>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Batch</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="mxy-batch">Batch ID</Label>
              <Input
                id="mxy-batch"
                value={header.batchId}
                onChange={(e) => setHeader({ ...header, batchId: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mxy-title">Title</Label>
              <Input
                id="mxy-title"
                value={header.title}
                onChange={(e) => setHeader({ ...header, title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mxy-date">Observed date</Label>
              <Input
                id="mxy-date"
                value={header.observedDate}
                placeholder="2026-09-08"
                onChange={(e) => setHeader({ ...header, observedDate: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mxy-building">Building</Label>
              <Input
                id="mxy-building"
                value={header.building}
                onChange={(e) => setHeader({ ...header, building: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="mxy-scope">Scope</Label>
              <Input
                id="mxy-scope"
                value={header.scope}
                onChange={(e) => setHeader({ ...header, scope: e.target.value })}
              />
            </div>
            {build.headerErrors.length ? (
              <ul className="sm:col-span-3 list-disc pl-5 text-xs text-destructive">
                {build.headerErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Measurements ({rows.length})</CardTitle>
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add measurement
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row, i) => {
              const errs = errorsById.get(row.id) ?? validateMeasuredXyRow(row);
              return (
                <div key={row.id} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Line {i + 1}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                      disabled={rows.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div>
                      <Label className="text-xs">Record type</Label>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={row.entityKind}
                        onChange={(e) =>
                          setRow(row.id, { entityKind: e.target.value as AuditEntityKind })
                        }
                      >
                        {MEASURED_XY_ENTITY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {measuredXyKindTitle(k)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Stable ID</Label>
                      <Input
                        value={row.stableId}
                        placeholder="FS-035"
                        onChange={(e) => setRow(row.id, { stableId: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">X (ft east)</Label>
                      <Input
                        value={row.x}
                        inputMode="decimal"
                        placeholder="42.5"
                        onChange={(e) => setRow(row.id, { x: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Y (ft south)</Label>
                      <Input
                        value={row.y}
                        inputMode="decimal"
                        placeholder="18"
                        onChange={(e) => setRow(row.id, { y: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Method</Label>
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={row.method}
                        onChange={(e) =>
                          setRow(row.id, { method: e.target.value as MeasuredXyMethod })
                        }
                      >
                        {MEASURED_XY_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {MEASURED_XY_METHOD_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Accuracy ± ft</Label>
                      <Input
                        value={row.accuracyFt}
                        inputMode="decimal"
                        placeholder="0.25"
                        onChange={(e) => setRow(row.id, { accuracyFt: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Datum / origin</Label>
                      <Input
                        value={row.datum}
                        placeholder="Grid origin A1, NW slab corner"
                        onChange={(e) => setRow(row.id, { datum: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Measured on</Label>
                      <Input
                        value={row.measuredAt}
                        placeholder={header.observedDate || "2026-09-08"}
                        onChange={(e) => setRow(row.id, { measuredAt: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Measured by</Label>
                      <Input
                        value={row.measuredBy}
                        onChange={(e) => setRow(row.id, { measuredBy: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Label className="text-xs">Evidence</Label>
                      <Input
                        value={row.evidence}
                        placeholder="Tape from NW slab corner, two passes, photo IMG_2210"
                        onChange={(e) => setRow(row.id, { evidence: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <Label className="text-xs">Notes</Label>
                      <Input
                        value={row.notes}
                        onChange={(e) => setRow(row.id, { notes: e.target.value })}
                      />
                    </div>
                  </div>
                  {errs.length ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
                      {errs.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => stage.mutate()} disabled={!build.ok || stage.isPending}>
                <Upload className="mr-1 h-4 w-4" />
                {stage.isPending ? "Staging…" : "Stage batch and preview"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Staging writes nothing to a record — it validates each measurement against the live
                record and shows the exact change.
              </span>
            </div>
          </CardContent>
        </Card>

        {preview ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Ruler className="h-4 w-4" />
                {preview.batch.batch_id} — {preview.batch.status}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2 text-xs">
                {preview.items.map((item) => (
                  <li key={item.item_key} className="rounded border border-border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">
                        {item.target_stable_id ?? item.item_key}
                      </span>
                      <Badge variant={item.disposition === "ready" ? "default" : "secondary"}>
                        {item.disposition}
                      </Badge>
                      <span className="text-muted-foreground">{item.operation}</span>
                    </div>
                    {item.changes.length ? (
                      <div className="mt-1 text-muted-foreground">
                        {item.changes.map((c) => (
                          <div key={c.column}>
                            {c.column}: {String(c.before ?? "—")} → {String(c.after ?? "—")}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {item.messages.length ? (
                      <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                        {item.messages.map((m, k) => (
                          <li key={k}>{m.text}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>

              {preview.applied ? (
                <p className="text-xs text-muted-foreground">
                  Applied. The measured points now plot as measured coordinates on the{" "}
                  <Link className="underline" to="/electrical/grid-map">
                    grid map
                  </Link>
                  .
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="mxy-reason" className="text-xs">
                    Reason for the record
                  </Label>
                  <Textarea
                    id="mxy-reason"
                    rows={2}
                    value={reason}
                    placeholder="Laser survey of Farm Shop NW wall devices, 2026-09-08."
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    onClick={() => apply.mutate()}
                    disabled={apply.isPending || !readyKeys.length}
                  >
                    <ShieldCheck className="mr-1 h-4 w-4" />
                    {apply.isPending
                      ? "Applying…"
                      : `Approve and apply ${readyKeys.length} measurement(s)`}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Only measurements marked ready can be applied. Anything held stays unapplied and
                    can be reviewed on the{" "}
                    <Link className="underline" to="/electrical/audit-batches">
                      audit batches
                    </Link>{" "}
                    screen.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </ElectricalGate>
  );
}
