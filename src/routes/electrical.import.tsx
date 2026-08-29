import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import {
  applyOdsImport,
  previewOdsImport,
  type ImportPlan,
} from "@/lib/electrical-ods.functions";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, AlertTriangle, GitMerge } from "lucide-react";

export const Route = createFileRoute("/electrical/import")({
  component: ImportPage,
  head: () => ({
    meta: [
      { title: "Electrical ODS Import — Bostead Farms" },
      {
        name: "description",
        content:
          "Dry-run import of the engineering electrical spreadsheet with a reviewable change report before anything is written.",
      },
      { property: "og:title", content: "Electrical ODS Import — Bostead Farms" },
      {
        property: "og:description",
        content: "Reviewable dry-run import of the electrical engineering spreadsheet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ImportPage() {
  return (
    <ElectricalGate>
      <Importer />
    </ElectricalGate>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function Importer() {
  const preview = useServerFn(previewOdsImport);
  const apply = useServerFn(applyOdsImport);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const key = (sheet: string, row: number) => `${sheet}#${row}`;

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await readAsBase64(file);
      return preview({ data: { file_name: file.name, base64 } });
    },
    onSuccess: (result) => {
      setPlan(result);
      // Pre-select every row that would actually change something.
      const next = new Set<string>();
      for (const sheet of result.sheets) {
        for (const row of sheet.rows) {
          if (row.action !== "unchanged") next.add(key(sheet.sheet, row.sourceRow));
        }
      }
      setSelected(next);
      toast.success(
        `Dry run: ${result.totals.create} new, ${result.totals.update} changed, ${result.totals.unchanged} unchanged.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const rows: {
        kind: string;
        stable_id: string;
        existing_id: string | null;
        values: Record<string, string>;
      }[] = [];
      for (const sheet of plan?.sheets ?? []) {
        if (!sheet.kind) continue;
        for (const row of sheet.rows) {
          if (!selected.has(key(sheet.sheet, row.sourceRow))) continue;
          rows.push({
            kind: sheet.kind,
            stable_id: row.stableId,
            existing_id: row.existingId || null,
            values: row.values,
          });
        }
      }
      if (!rows.length) throw new Error("Select at least one row to import.");
      return apply({ data: { rows } });
    },
    onSuccess: (r) => {
      toast.success(`Imported: ${r.created} created, ${r.updated} updated.`);
      if (r.errors.length) {
        toast.error(`${r.errors.length} rows failed — see the report below.`);
      }
      setPlan(null);
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Import the engineering spreadsheet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            The .ods file stays the engineering release authority. Import is always a dry run
            first: sheets are classified, columns mapped, and every change shown before
            anything is written. Continuous raceways are never merged automatically — merges
            are proposed for you to review.
          </p>
          <label className="inline-flex items-center gap-2">
            <input
              type="file"
              accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) previewMutation.mutate(file);
                e.target.value = "";
              }}
            />
            <Button asChild variant="outline" className="gap-2">
              <span>
                <Upload className="h-4 w-4" />
                {previewMutation.isPending ? "Parsing…" : "Choose .ods file"}
              </span>
            </Button>
          </label>
        </CardContent>
      </Card>

      {plan ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Dry-run report · {plan.file_name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{plan.totals.create} create</Badge>
              <Badge variant="secondary">{plan.totals.update} update</Badge>
              <Badge variant="outline">{plan.totals.unchanged} unchanged</Badge>
              {plan.totals.warnings ? (
                <Badge variant="destructive">{plan.totals.warnings} warnings</Badge>
              ) : null}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={() => setPlan(null)}>
                  Discard
                </Button>
                <Button
                  disabled={applyMutation.isPending || !selected.size}
                  onClick={() => applyMutation.mutate()}
                >
                  {applyMutation.isPending
                    ? "Importing…"
                    : `Import ${selected.size} selected row(s)`}
                </Button>
              </div>
            </CardContent>
          </Card>

          {plan.sheets.map((sheet) => (
            <Card key={sheet.sheet}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex flex-wrap items-center gap-2">
                  {sheet.sheet}
                  {sheet.kind ? (
                    <Badge variant="outline">
                      {ENTITIES[sheet.kind as ElectricalEntityKind].title}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">not recognised — skipped</Badge>
                  )}
                  {sheet.skipped ? (
                    <span className="text-xs text-muted-foreground">
                      {sheet.skipped} row(s) skipped (no stable ID)
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {sheet.unmapped.length ? (
                  <p className="text-xs text-muted-foreground">
                    Unmapped columns (ignored): {sheet.unmapped.join(", ")}
                  </p>
                ) : null}

                {sheet.mapping?.length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Column mapping ({sheet.mapping.length} bound
                      {sheet.mapping.some((m) => m.target === "completion_percent")
                        ? ", Complete % included"
                        : ", no Complete % column found"}
                      )
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {sheet.mapping.map((m) => (
                        <li key={m.target}>
                          <span className="font-medium">{m.source}</span> →{" "}
                          <span className="font-mono">{m.target}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {sheet.rejected.length ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Rejected cells ({sheet.rejected.length}) — values that cannot belong to
                      that column, left unchanged
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {sheet.rejected.map((r, i) => (
                        <li key={`${r.stableId}-${r.column}-${i}`}>
                          <span className="font-mono">{r.stableId}</span>{" "}
                          <span className="font-mono">{r.column}</span> ={" "}
                          <span className="font-mono">{r.value}</span> — {r.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {sheet.mergeProposals.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs rounded-md border border-border p-2"
                  >
                    <GitMerge className="h-4 w-4 mt-0.5 text-amber-500" />
                    <span>{m.note}</span>
                  </div>
                ))}

                {!sheet.rows.length ? (
                  <p className="text-sm text-muted-foreground">Nothing to import from this sheet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-2 py-1.5 w-8" />
                          <th className="px-2 py-1.5 font-medium">Stable ID</th>
                          <th className="px-2 py-1.5 font-medium">Action</th>
                          <th className="px-2 py-1.5 font-medium">Changes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.rows.map((row) => {
                          const k = key(sheet.sheet, row.sourceRow);
                          return (
                            <tr key={k} className="border-t border-border align-top">
                              <td className="px-2 py-1.5">
                                <Checkbox
                                  checked={selected.has(k)}
                                  onCheckedChange={() => toggle(k)}
                                />
                              </td>
                              <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                                {row.stableId}
                              </td>
                              <td className="px-2 py-1.5">
                                <Badge
                                  variant={
                                    row.action === "create"
                                      ? "default"
                                      : row.action === "update"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {row.action}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5 space-y-1">
                                {row.action === "create" ? (
                                  <span className="text-muted-foreground text-xs">
                                    {Object.keys(row.values).length} field(s) from row{" "}
                                    {row.sourceRow}
                                  </span>
                                ) : (
                                  row.changes.map((c) => (
                                    <div key={c.column} className="text-xs">
                                      <span className="font-medium">{c.column}</span>:{" "}
                                      <span className="text-muted-foreground line-through">
                                        {c.from || "—"}
                                      </span>{" "}
                                      → <span>{c.to}</span>
                                    </div>
                                  ))
                                )}
                                {row.warnings.map((w, i) => (
                                  <div
                                    key={i}
                                    className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    {w}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
