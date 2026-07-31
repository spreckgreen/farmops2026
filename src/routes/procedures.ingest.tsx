import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { AiProgressStages } from "@/components/ai-progress-stages";
import { useAiJobProgress } from "@/hooks/use-ai-job-progress";
import { AiFeatureGate } from "@/components/ai-feature-gate";
import { handleAiJobInFlight } from "@/lib/ai-inflight-error";
import { toast } from "sonner";
import {
  ArrowLeft,
  Wand2,
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Files,
} from "lucide-react";
import {
  parseExportFiles,
  KIND_LABEL,
  MAX_ITEMS,
  type ParseResult,
  type SourceItem,
} from "@/lib/kb-ingest-parse";
import {
  ingestKbArticles,
  type IngestMode,
  type IngestResult,
} from "@/lib/kb-ingest.functions";

export const Route = createFileRoute("/procedures/ingest")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Import & Summarize KB — Bostead Farms" },
      {
        name: "description",
        content:
          "Turn a data export into summarized TinyWiki knowledge-base articles saved into your procedures.",
      },
      { property: "og:title", content: "Import & Summarize KB — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Ingest ChatGPT exports, Markdown, CSV/JSON, PDF, or Word files as TinyWiki KB articles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AiFeatureGate featureId="kb.ingest">
      <IngestPage />
    </AiFeatureGate>
  ),
});

const ACCEPT =
  ".zip,.json,.csv,.md,.markdown,.txt,.log,.html,.htm,.pdf,.docx";

function IngestPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<IngestMode>("per-item");
  const [result, setResult] = useState<IngestResult | null>(null);

  const ingestFn = useServerFn(ingestKbArticles);
  const jobProgress = useAiJobProgress("kb.ingest");

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setParsing(true);
    setResult(null);
    try {
      const res = await parseExportFiles(Array.from(files));
      setParsed(res);
      setSelected(new Set(res.items.map((i) => i.id)));
      if (!res.items.length) toast.error("No readable text found in those files.");
      else toast.success(`Found ${res.items.length} source item(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read those files");
    } finally {
      setParsing(false);
    }
  }

  const items: SourceItem[] = parsed?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.id));

  const ingestMut = useMutation({
    mutationFn: () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      jobProgress.start();
      return ingestFn({
        data: {
          mode,
          items: chosen.map((i) => ({
            id: i.id,
            title: i.title,
            kind: i.kind,
            text: i.text,
          })),
        },
        signal: controller.signal,
      });
    },
    onSuccess: (r) => {
      jobProgress.stop();
      setResult(r);
      qc.invalidateQueries({ queryKey: ["procedures"] });
      const saved = r.articles.filter((a) => a.status !== "failed").length;
      toast.success(`${saved} article(s) saved to Procedures`);
    },
    onError: (e) => {
      if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) {
        jobProgress.stop();
        return;
      }
      if (handleAiJobInFlight(e)) return;
      jobProgress.stop();
      toast.error(e instanceof Error ? e.message : "Ingest failed");
    },
  });

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    jobProgress.stop();
    ingestMut.reset();
    toast.message("Ingest canceled");
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const estSeconds = Math.max(8, chosen.length * (mode === "grouped" ? 8 : 12));

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            <Link to="/procedures" className="hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Procedures
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wand2 className="h-7 w-7 text-primary" />
            Import &amp; summarize
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Drop a data export — ChatGPT <code>conversations.json</code> or its ZIP, Markdown/text
            files, CSV/JSON records, PDFs, or Word docs. Files are read in your browser; only the
            extracted text is sent to the model, and each article is saved as a TinyWiki procedure.
          </p>
        </div>

        {/* Step 1 — files */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> 1. Choose files
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={parsing || ingestMut.isPending}
                className="gap-2"
              >
                <FileText className="h-4 w-4" />
                {parsing ? "Reading…" : "Select export files"}
              </Button>
              {parsed && (
                <span className="text-xs text-muted-foreground">
                  {items.length} item(s) found
                  {parsed.skipped.length > 0 && `, ${parsed.skipped.length} skipped`} · max{" "}
                  {MAX_ITEMS} per run
                </span>
              )}
            </div>
            {parsed && parsed.skipped.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Skipped files ({parsed.skipped.length})
                </summary>
                <ul className="mt-1 pl-4 list-disc text-muted-foreground">
                  {parsed.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-mono">{s.name}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — granularity + selection */}
        {items.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" /> 2. Article granularity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("per-item")}
                  className={`rounded-lg border p-3 text-left text-sm ${
                    mode === "per-item"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="font-medium flex items-center gap-2">
                    <Files className="h-4 w-4" /> One article per item
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Straight 1:1 summary. Predictable, best for already-focused sources.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("grouped")}
                  className={`rounded-lg border p-3 text-left text-sm ${
                    mode === "grouped"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="font-medium flex items-center gap-2">
                    <Layers className="h-4 w-4" /> Group by topic
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    An extra clustering pass merges related items into fewer, denser articles.
                  </p>
                </button>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {chosen.length} of {items.length} selected
                </span>
                <div className="flex gap-2">
                  <button
                    className="hover:text-foreground text-muted-foreground"
                    onClick={() => setSelected(new Set(items.map((i) => i.id)))}
                  >
                    Select all
                  </button>
                  <button
                    className="hover:text-foreground text-muted-foreground"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <ul className="max-h-72 overflow-y-auto divide-y divide-border rounded border border-border">
                {items.map((it) => (
                  <li key={it.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{it.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {KIND_LABEL[it.kind]} · {it.text.length.toLocaleString()} chars
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Heavy AI job · roughly {estSeconds}s
                </span>
                <Button
                  onClick={() => ingestMut.mutate()}
                  disabled={chosen.length === 0 || ingestMut.isPending}
                  className="gap-2"
                >
                  <Wand2 className="h-4 w-4" />
                  {ingestMut.isPending ? "Summarizing…" : "Summarize & save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {(ingestMut.isPending || ingestMut.isSuccess || jobProgress.active) && (
          <AiProgressStages
            active={ingestMut.isPending || jobProgress.active}
            done={ingestMut.isSuccess}
            startedAt={jobProgress.startedAt}
            stages={[
              { id: "prepare", label: "Preparing sources", estSeconds: 1 },
              ...(mode === "grouped"
                ? [{ id: "cluster", label: "Grouping sources by topic", estSeconds: 8 }]
                : []),
              { id: "ai", label: "Writing KB articles with AI", estSeconds: estSeconds },
              { id: "save", label: "Saving TinyWiki procedures", estSeconds: 2 },
            ]}
            onCancel={cancel}
          />
        )}

        {/* Step 3 — report */}
        {result && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                3. Report
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {result.model} · {result.mode === "grouped" ? "grouped" : "per item"} ·{" "}
                  {(result.latencyMs / 1000).toFixed(1)}s
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="divide-y divide-border rounded border border-border">
                {result.articles.map((a, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      {a.status === "failed" ? (
                        <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium break-words">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {a.status === "failed"
                            ? a.error
                            : `${a.status === "renamed" ? "saved under a new name" : "saved"} · ${a.chars.toLocaleString()} chars · from ${a.sources.join(", ")}`}
                        </div>
                      </div>
                      {a.status !== "failed" && (
                        <Link
                          to="/procedures"
                          className="text-xs text-primary hover:underline whitespace-nowrap"
                        >
                          Open
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {result.skipped.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc pl-5">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      {s.title} — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
