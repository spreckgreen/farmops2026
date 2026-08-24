import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { listInventory } from "@/lib/inventory.functions";
import {
  parseServiceManual,
  applyServiceManualImport,
  type ManualImportPlan,
  type ManualImportResult,
} from "@/lib/service-manual-import.functions";
import {
  importManualDocument,
  type ManualDocumentResult,
} from "@/lib/manual-document-import.functions";
import {
  SERVICE_MANUAL_TEMPLATE,
  manualTemplateFileName,
  usageLabel,
} from "@/lib/service-manual-template";
import {
  MANUAL_KINDS,
  MANUAL_KIND_META,
  manualPrompt,
  manualProcedureName,
  manualTemplateFor,
  type ManualKind,
} from "@/lib/manual-kinds";

import { AiFeatureGate } from "@/components/ai-feature-gate";
import { AiProgressStages } from "@/components/ai-progress-stages";
import { useAiJobProgress } from "@/hooks/use-ai-job-progress";
import { handleAiJobInFlight } from "@/lib/ai-inflight-error";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenText,
  Copy,
  Download,
  FileText,
  PackagePlus,
  Sparkles,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/maintenance/import-manual")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Import service manual — Bostead Farms" },
      {
        name: "description",
        content:
          "Import an AI-written service manual for one asset: service intervals become maintenance records and missing parts are added to inventory.",
      },
      { property: "og:title", content: "Import service manual — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Attach a service manual to an asset, then turn its intervals and parts list into records and inventory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AiFeatureGate featureId="maintenance.import-manual">
      <Page />
    </AiFeatureGate>
  ),
});

const partKey = (ivKey: string, i: number) => `${ivKey}::${i}`;
const NEW_ITEM = "__new__";

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "exact match",
  strong: "likely match",
  weak: "unsure",
  none: "no match found",
};

function Page() {
  const listInv = useServerFn(listInventory);
  const parseFn = useServerFn(parseServiceManual);
  const applyFn = useServerFn(applyServiceManualImport);
  const docFn = useServerFn(importManualDocument);


  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => listInv(),
  });

  const [assetId, setAssetId] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<ManualKind>("service_schedule");
  const [manualText, setManualText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ManualImportPlan | null>(null);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [skippedParts, setSkippedParts] = useState<Record<string, boolean>>({});
  // Per-part match decision: "" = still needs a decision, NEW_ITEM = create it,
  // otherwise the chosen inventory item id.
  const [partChoice, setPartChoice] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState(0.82);
  const [createParts, setCreateParts] = useState(true);
  const [result, setResult] = useState<ManualImportResult | null>(null);
  // Document-style manuals (operator / workshop) land as a procedure page.
  const [docName, setDocName] = useState("");
  const [overwriteDoc, setOverwriteDoc] = useState(false);
  const [docResult, setDocResult] = useState<ManualDocumentResult | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const jobProgress = useAiJobProgress("maintenance.import-manual");

  const byName = (a: (typeof inventory)[number], b: (typeof inventory)[number]) =>
    (a.name ?? a.sku ?? "").localeCompare(b.name ?? b.sku ?? "");

  const assets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return inventory
      .filter((i) =>
        !q
          ? true
          : `${i.name ?? ""} ${i.sku ?? ""} ${i.category ?? ""}`.toLowerCase().includes(q),
      )
      .sort(byName);
  }, [inventory, filter]);

  const asset = inventory.find((i) => i.id === assetId);
  const assetName = asset?.name ?? asset?.sku ?? "";

  const meta = MANUAL_KIND_META[kind];
  const isDocument = meta.target === "document";

  const prompt = useMemo(
    () =>
      manualPrompt(kind, {
        assetName: assetName || "<pick an asset>",
        category: asset?.category ?? null,
        usageTracking: asset?.usage_tracking ?? null,
        currentHours: asset?.current_hours ?? null,
        currentMiles: asset?.current_miles ?? null,
      }),
    [kind, assetName, asset?.category, asset?.usage_tracking, asset?.current_hours, asset?.current_miles],
  );

  // Default procedure name follows the asset + kind until the user edits it.
  const effectiveDocName =
    docName.trim() || (assetName ? manualProcedureName(assetName, kind === "workshop" ? "workshop" : "operator") : "");


  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File) => {
    if (file.size > 2_000_000) {
      toast.error("That file is larger than 2 MB — paste the relevant sections instead.");
      return;
    }
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      toast.error("Only .txt and .md files can be read here — for a PDF, paste the text.");
      return;
    }
    setManualText((await file.text()).slice(0, 120000));
    setFileName(file.name);
  };

  // Operator / workshop manuals: no AI pass, straight to a procedure page.
  const docMut = useMutation({
    mutationFn: async () => {
      if (!assetId) throw new Error("Pick the asset this manual belongs to");
      if (manualText.trim().length < 40) throw new Error("Paste the manual first");
      if (!effectiveDocName) throw new Error("Give the procedure page a name");
      return docFn({
        data: {
          asset_id: assetId,
          kind: kind === "workshop" ? "workshop" : "operator",
          manual_text: manualText.trim(),
          procedure_name: effectiveDocName,
          overwrite: overwriteDoc,
        },
      });
    },
    onSuccess: (r) => {
      setDocResult(r);
      toast.success(
        `${r.replaced ? "Updated" : "Saved"} "${r.name}" and linked it to ${r.asset_name}`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that manual"),
  });

  const parseMut = useMutation({

    mutationFn: async () => {
      if (!assetId) throw new Error("Pick the asset this manual belongs to");
      if (manualText.trim().length < 40) throw new Error("Paste the service manual first");
      jobProgress.start();
      return parseFn({
        data: {
          asset_id: assetId,
          manual_text: manualText.trim(),
          match_threshold: threshold,
        },
      });
    },
    onSuccess: (p) => {
      jobProgress.stop();
      if (p.intervals.length === 0) {
        toast.warning(p.summary);
        return;
      }
      setPlan(p);
      setSkipped({});
      setSkippedParts({});
      // Pre-seed decisions: confident matches are already resolved, fuzzy or
      // ambiguous ones start blank so the user has to pick.
      const seed: Record<string, string> = {};
      for (const iv of p.intervals) {
        iv.parts.forEach((part, i) => {
          seed[partKey(iv.key, i)] = part.inventory_item_id
            ? part.inventory_item_id
            : part.candidates.length > 0
              ? ""
              : NEW_ITEM;
        });
      }
      setPartChoice(seed);
      setResult(null);
    },
    onError: (e) => {
      if (handleAiJobInFlight(e)) return;
      jobProgress.stop();
      toast.error(e instanceof Error ? e.message : "Could not read that manual");
    },
  });

  const included = useMemo(
    () =>
      (plan?.intervals ?? [])
        .filter((iv) => !skipped[iv.key])
        .map((iv) => ({
          ...iv,
          parts: iv.parts
            .map((p, i) => ({ p, i }))
            .filter(({ i }) => !skippedParts[partKey(iv.key, i)])
            .map(({ p, i }) => {
              const choice = partChoice[partKey(iv.key, i)] ?? "";
              const picked = choice && choice !== NEW_ITEM ? choice : null;
              return {
                ...p,
                inventory_item_id: picked,
                matched_name:
                  p.candidates.find((c) => c.id === picked)?.label ?? p.matched_name,
                unresolved: choice === "",
              };
            }),
        })),
    [plan, skipped, skippedParts, partChoice],
  );

  const unresolved = useMemo(
    () => included.flatMap((iv) => iv.parts.filter((p) => p.unresolved)),
    [included],
  );
  const selectAll = (on: boolean) => {
    if (!plan) return;
    const ivs: Record<string, boolean> = {};
    const parts: Record<string, boolean> = {};
    for (const iv of plan.intervals) {
      ivs[iv.key] = !on;
      iv.parts.forEach((_, i) => {
        parts[partKey(iv.key, i)] = !on;
      });
    }
    setSkipped(ivs);
    setSkippedParts(parts);
  };
  const newParts = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; unit: string }>();
    for (const iv of included) {
      for (const p of iv.parts) {
        if (p.inventory_item_id) continue;
        const key = p.name.toLowerCase();
        const prev = map.get(key);
        if (!prev || p.quantity > prev.quantity)
          map.set(key, { name: p.name, quantity: p.quantity, unit: p.unit });
      }
    }
    return [...map.values()];
  }, [included]);


  const applyMut = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error("Nothing to apply");
      if (included.length === 0) throw new Error("Every interval is unchecked");
      if (unresolved.length > 0)
        throw new Error(
          `Confirm the match for ${unresolved.length} part${
            unresolved.length === 1 ? "" : "s"
          } first`,
        );
      return applyFn({
        data: {
          plan_id: plan.plan_id,
          asset_id: plan.asset_id,
          asset_name: plan.asset_name,
          create_missing_parts: createParts,
          intervals: included.map((iv) => ({
            title: iv.title,
            trigger_type: iv.trigger_type,
            interval_value: iv.interval_value,
            recurrence: iv.recurrence,
            tasks: iv.tasks,
            notes: iv.notes,
            parts: iv.parts.map((p) => ({
              name: p.name,
              quantity: p.quantity,
              unit: p.unit,
              inventory_item_id: p.inventory_item_id,
            })),
          })),
        },
      });
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success(
        `${r.results.filter((x) => x.ok).length} service record${
          r.results.filter((x) => x.ok).length === 1 ? "" : "s"
        } added` +
          (r.created_parts.length > 0
            ? `, ${r.created_parts.filter((p) => !p.reused).length} new part(s) stocked`
            : ""),
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-3.5rem)] bg-background text-foreground">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <Link
            to="/maintenance"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Maintenance
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-3">
            <BookOpenText className="h-3 w-3" /> Asset manual import
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
            Generate and import an asset manual
          </h1>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Pick the asset and the manual type — service schedule, operator manual, or
            workshop manual — copy the prompt into any AI ("make me a workshop manual for
            my Kubota L2501"), then paste the answer back here. A service schedule becomes
            maintenance records plus any missing parts in inventory; operator and workshop
            manuals become procedure pages linked to the asset.
          </p>


          {/* 1. Asset */}
          <section className="rounded-xl border border-border bg-card/40 p-6 space-y-3 mb-6">
            <h2 className="text-sm font-semibold">1. Which asset is this manual for?</h2>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, SKU, or category…"
            />
            <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-background divide-y divide-border/60">
              {assets.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="asset"
                    checked={assetId === a.id}
                    onChange={() => setAssetId(a.id)}
                    className="accent-primary"
                  />
                  <span className="flex-1 truncate">
                    {a.name ?? a.sku ?? "Unnamed"}
                    {a.category ? (
                      <span className="text-muted-foreground"> · {a.category}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {usageLabel({
                      assetName: a.name ?? "",
                      currentHours: a.current_hours ?? null,
                      currentMiles: a.current_miles ?? null,
                    })}
                  </span>
                </label>
              ))}
              {assets.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No inventory items match that filter.
                </p>
              )}
            </div>
          </section>

          {/* 2. Manual type */}
          <section className="rounded-xl border border-border bg-card/40 p-6 space-y-3 mb-6">
            <h2 className="text-sm font-semibold">2. Which manual do you want?</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {MANUAL_KINDS.map((k) => {
                const m = MANUAL_KIND_META[k];
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKind(k);
                      setPlan(null);
                      setResult(null);
                      setDocResult(null);
                    }}
                    className={`rounded-lg border p-3 text-left transition ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{m.blurb}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{meta.outcome}</p>
          </section>

          {/* 3. Template */}
          <section className="rounded-xl border border-border bg-card/40 p-6 space-y-3 mb-6">
            <h2 className="text-sm font-semibold">
              3. Ask an AI for the {meta.label.toLowerCase()}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isDocument ? (
                <>
                  This prompt pins the headings so the saved page reads cleanly as a
                  procedure — paste the answer back and it becomes a wiki page on this
                  asset.
                </>
              ) : (
                <>
                  This prompt pins the format the importer reads — the{" "}
                  <code className="text-[11px]">Service Intervals</code> bullets with
                  interval, tasks, and a parts list with quantities.
                </>
              )}
            </p>
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 text-xs whitespace-pre-wrap">
              {prompt}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(prompt);
                  toast.success("Prompt copied");
                }}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy prompt
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  download(
                    manualTemplateFor(kind) ?? SERVICE_MANUAL_TEMPLATE,
                    manualTemplateFileName(
                      `${assetName || "asset"}-${meta.label}`,
                    ),
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" /> Download blank template
              </Button>
            </div>
          </section>


          {/* 4. Paste */}
          <section className="rounded-xl border border-border bg-card/40 p-6 space-y-3 mb-6">
            <h2 className="text-sm font-semibold">4. Paste the {meta.label.toLowerCase()}</h2>
            {isDocument ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Procedure page name</span>
                  <Input
                    className="mt-1"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value.slice(0, 120))}
                    placeholder={
                      assetName
                        ? manualProcedureName(assetName, kind === "workshop" ? "workshop" : "operator")
                        : "Pick an asset first"
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={overwriteDoc}
                    onCheckedChange={(v) => setOverwriteDoc(v === true)}
                  />
                  Replace existing page
                </label>
              </div>
            ) : (
              <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Part match strictness</span>
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={2}
                  value={Math.round(threshold * 100)}
                  onChange={(e) => setThreshold(Number(e.target.value) / 100)}
                  className="h-1 w-40 accent-primary"
                />
                <span>{Math.round(threshold * 100)}%</span>
                <span>
                  — matches at or above this confidence link automatically; anything less
                  asks you to confirm.
                </span>
              </label>
            )}
            <Textarea
              value={manualText}
              onChange={(e) => {
                setManualText(e.target.value.slice(0, 120000));
                setFileName(null);
              }}
              rows={10}
              placeholder="Paste the full manual the AI returned…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.markdown"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
              />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" /> Upload .md / .txt
              </Button>
              <span className="text-xs text-muted-foreground">
                {fileName ? `${fileName} loaded — ` : ""}
                {manualText.length.toLocaleString()} characters
              </span>
              <div className="flex-1" />
              {isDocument ? (
                <Button
                  onClick={() => docMut.mutate()}
                  disabled={
                    docMut.isPending ||
                    !assetId ||
                    !effectiveDocName ||
                    manualText.trim().length < 40
                  }
                >
                  <FileText className="h-4 w-4 mr-1" />
                  {docMut.isPending ? "Saving…" : "Save as procedure"}
                </Button>
              ) : (
                <Button
                  onClick={() => parseMut.mutate()}
                  disabled={parseMut.isPending || !assetId || manualText.trim().length < 40}
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  {parseMut.isPending ? "Reading manual…" : "Read manual"}
                </Button>
              )}
            </div>
            {docResult && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {docResult.replaced ? "Updated" : "Saved"} “{docResult.name}” and linked
                  it to {docResult.asset_name}.
                </p>
                {docResult.sections.length > 0 && (
                  <p className="text-muted-foreground">
                    Sections: {docResult.sections.slice(0, 12).join(" · ")}
                    {docResult.sections.length > 12 ? " …" : ""}
                  </p>
                )}
                <Link
                  to="/procedures"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <BookOpenText className="h-3 w-3" /> Open in Procedures
                </Link>
              </div>
            )}

            {(parseMut.isPending || jobProgress.active) && (
              <AiProgressStages
                active={parseMut.isPending || jobProgress.active}
                done={parseMut.isSuccess}
                startedAt={jobProgress.startedAt}
                stages={[
                  { id: "prepare", label: "Loading asset & inventory context", estSeconds: 1 },
                  { id: "ai", label: "Extracting service intervals and parts", estSeconds: 20 },
                  { id: "format", label: "Matching parts to inventory", estSeconds: 2 },
                ]}
              />
            )}
          </section>

          {/* 5. Parsed preview (service schedule only) */}
          {plan && !isDocument && (
            <section className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    5. Parsed preview — {plan.asset_name}

                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">{plan.summary}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => selectAll(true)}>
                    Select all
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => selectAll(false)}>
                    Clear all
                  </Button>
                </div>
              </div>

              {unresolved.length > 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {unresolved.length} part{unresolved.length === 1 ? "" : "s"} need a
                    decision before this import can run — pick the inventory item it refers
                    to, or choose "Create new inventory item".
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  All part matches confirmed.
                </p>
              )}

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-10 p-2" />
                      <th className="p-2 text-left w-1/4">Interval</th>
                      <th className="p-2 text-left w-1/3">Tasks</th>
                      <th className="p-2 text-left">Parts &amp; matches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.intervals.map((iv) => {
                      const off = Boolean(skipped[iv.key]);
                      return (
                        <tr
                          key={iv.key}
                          className={`border-t border-border align-top ${off ? "opacity-50" : ""}`}
                        >
                          <td className="p-2">
                            <Checkbox
                              aria-label={`Include ${iv.title}`}
                              checked={!off}
                              onCheckedChange={(v) =>
                                setSkipped((s) => ({ ...s, [iv.key]: !v }))
                              }
                            />
                          </td>
                          <td className="p-2">
                            <p className="font-medium">{iv.title}</p>
                            <p className="text-xs text-muted-foreground">{iv.recurrence}</p>
                            {iv.notes && (
                              <p className="mt-1 text-xs italic text-muted-foreground">
                                {iv.notes}
                              </p>
                            )}
                          </td>
                          <td className="p-2">
                            {iv.tasks.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                                {iv.tasks.map((t, i) => (
                                  <li key={i}>{t}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="p-2">
                            {iv.parts.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No parts</span>
                            ) : (
                              <div className="space-y-1">
                                {iv.parts.map((p, i) => {
                                  const pk = partKey(iv.key, i);
                                  const partOff = off || Boolean(skippedParts[pk]);
                                  const choice = partChoice[pk] ?? "";
                                  const needsPick = !partOff && choice === "";
                                  const top = p.candidates[0];
                                  return (
                                    <div key={i} className="space-y-1">
                                      <label className="flex items-center gap-2 text-xs">
                                        <Checkbox
                                          aria-label={`Include part ${p.name}`}
                                          disabled={off}
                                          checked={!partOff}
                                          onCheckedChange={(v) =>
                                            setSkippedParts((s) => ({ ...s, [pk]: !v }))
                                          }
                                        />
                                        <span>
                                          {p.name} × {p.quantity} {p.unit}
                                        </span>
                                        <span
                                          className={`rounded border px-1.5 py-0.5 ${
                                            p.confidence === "exact" || p.confidence === "strong"
                                              ? "border-primary/30 bg-primary/10 text-primary"
                                              : p.confidence === "weak"
                                                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                                : "border-border bg-muted text-muted-foreground"
                                          }`}
                                        >
                                          {CONFIDENCE_LABEL[p.confidence]}
                                          {top && p.confidence !== "none"
                                            ? ` ${Math.round(top.score * 100)}%`
                                            : ""}
                                        </span>
                                      </label>
                                      {!partOff && (
                                        <div className="pl-6">
                                          <select
                                            aria-label={`Inventory match for ${p.name}`}
                                            className={`w-full rounded-md border bg-background px-2 py-1 text-xs ${
                                              needsPick
                                                ? "border-amber-500 ring-1 ring-amber-500/40"
                                                : "border-border"
                                            }`}
                                            value={choice}
                                            onChange={(e) =>
                                              setPartChoice((c) => ({
                                                ...c,
                                                [pk]: e.target.value,
                                              }))
                                            }
                                          >
                                            <option value="">
                                              {p.candidates.length > 0
                                                ? "Confirm a match…"
                                                : "Choose…"}
                                            </option>
                                            {p.candidates.map((c) => (
                                              <option key={c.id} value={c.id}>
                                                {c.label} — {Math.round(c.score * 100)}% ({c.reason})
                                              </option>
                                            ))}
                                            <option value={NEW_ITEM}>
                                              Create new inventory item "{p.name}"
                                            </option>
                                          </select>
                                          {needsPick && (
                                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                                              <AlertTriangle className="h-3 w-3" />
                                              {p.candidates.length > 1
                                                ? `${p.candidates.length} similar items — confirm which one this is`
                                                : "Confirm this fuzzy match or create a new item"}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>


              <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-sm">
                <Checkbox
                  checked={createParts}
                  onCheckedChange={(v) => setCreateParts(Boolean(v))}
                />
                <span>
                  <span className="font-medium inline-flex items-center gap-1">
                    <PackagePlus className="h-4 w-4" /> Create missing parts in inventory
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {newParts.length === 0
                      ? "Every part in this manual already matches something you stock."
                      : `${newParts.length} new item(s) will be added at 0 on hand with a reorder minimum equal to what the service needs: ` +
                        newParts
                          .map((p) => `${p.name} (${p.quantity} ${p.unit})`)
                          .join(", ")}
                  </span>
                </span>
              </label>

              {plan.citations.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Manual references</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {plan.citations.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Model: {plan.model} · {included.length} of {plan.intervals.length} interval
                  {plan.intervals.length === 1 ? "" : "s"} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setPlan(null)}>
                    Discard
                  </Button>
                  <Button
                    onClick={() => applyMut.mutate()}
                    disabled={
                      applyMut.isPending || included.length === 0 || unresolved.length > 0
                    }
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    {applyMut.isPending ? "Importing…" : "Import to this asset"}
                  </Button>
                </div>
              </div>

              {result && (
                <div className="rounded-md border border-border bg-background p-3 text-xs space-y-2">
                  <p className="font-medium">
                    Import {result.status}
                    {result.reused ? " (already applied)" : ""}
                  </p>
                  <ul className="space-y-0.5">
                    {result.results.map((r, i) => (
                      <li key={i} className={r.ok ? "" : "text-destructive"}>
                        {r.ok ? "✓" : "✗"} {r.label}
                        {!r.ok ? ` — ${r.error}` : ""}
                      </li>
                    ))}
                  </ul>
                  {result.created_parts.length > 0 && (
                    <div>
                      <p className="font-medium">Parts</p>
                      <ul className="space-y-0.5">
                        {result.created_parts.map((p) => (
                          <li key={p.id}>
                            {p.reused ? "linked existing" : "created"} · {p.name} —{" "}
                            {p.quantity_needed} {p.unit} per service
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex gap-3 pt-1">
                    <Link to="/maintenance" className="text-primary hover:underline">
                      View maintenance records
                    </Link>
                    <Link to="/inventory" className="text-primary hover:underline">
                      View inventory
                    </Link>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
