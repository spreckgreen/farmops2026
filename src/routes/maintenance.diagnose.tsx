import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  diagnoseSymptom,
  createRecordFromDiagnosis,
  type Diagnosis,
} from "@/lib/maintenance-symptom.functions";
import {
  Stethoscope,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  PackageX,
  BookOpen,
  CalendarClock,
} from "lucide-react";
import { AiProgressStages } from "@/components/ai-progress-stages";
import { useAiJobProgress } from "@/hooks/use-ai-job-progress";
import { toast } from "sonner";


export const Route = createFileRoute("/maintenance/diagnose")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Diagnose Symptom — Bostead Farms" },
      {
        name: "description",
        content:
          "Describe a machine issue in plain English; get the matching maintenance procedure and parts list.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DiagnosePage,
});

function ConfidenceBadge({ level }: { level: Diagnosis["confidence"] }) {
  const style =
    level === "high"
      ? "bg-primary/20 text-primary border-primary/40"
      : level === "medium"
        ? "bg-yellow-500/15 text-yellow-600 border-yellow-500/40"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style}`}
    >
      {level} confidence
    </span>
  );
}

function DiagnosePage() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [history, setHistory] = useState<{ q: string; r: Diagnosis }[]>([]);

  const diagnoseFn = useServerFn(diagnoseSymptom);
  const createFn = useServerFn(createRecordFromDiagnosis);

  const abortRef = useRef<AbortController | null>(null);
  const jobProgress = useAiJobProgress("maintenance.diagnose");
  const diagMut = useMutation({
    mutationFn: () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      jobProgress.start();
      return diagnoseFn({ data: { text: text.trim() }, signal: controller.signal });
    },
    onSuccess: (r) => {
      jobProgress.stop();
      setResult(r);
      setHistory((h) => [{ q: text.trim(), r }, ...h].slice(0, 10));
    },
    onError: (e) => {
      jobProgress.stop();
      if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) return;
      toast.error(e instanceof Error ? e.message : "Diagnosis failed");
    },
  });
  const cancelDiagnose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    jobProgress.stop();
    diagMut.reset();
    toast.message("Request canceled");
  };


  const createMut = useMutation({
    mutationFn: async () => {
      if (!result?.suggestedRecord) throw new Error("No suggested record to create");
      const asset = result.suspectedAssets[0];
      return createFn({
        data: {
          title: result.suggestedRecord.title,
          service_type: result.suggestedRecord.service_type,
          description: result.suggestedRecord.description,
          asset_id: asset?.id ?? null,
          asset_name: asset?.name ?? null,
          procedure_name: result.matchedProcedureName,
        },
      });
    },
    onSuccess: () => {
      toast.success("Maintenance record created");
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create record"),
  });

  const canSubmit = text.trim().length >= 3 && !diagMut.isPending;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
            <Link to="/maintenance" className="hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Maintenance
            </Link>
            <span>·</span>
            <Link to="/maintenance/forecast" className="hover:text-foreground">
              Forecast
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Stethoscope className="h-7 w-7 text-primary" />
            Symptom → procedure
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Describe the problem. The model matches it against your procedures and inventory —
            no invented parts, no guessing.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='e.g. "Tractor #2 hydraulic lift is slow and whining under load"'
              className="min-h-[100px] font-mono text-sm"
              maxLength={2000}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{text.length}/2000</span>
              <Button
                onClick={() => diagMut.mutate()}
                disabled={!canSubmit}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {diagMut.isPending ? "Diagnosing…" : "Diagnose"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {(diagMut.isPending || diagMut.isSuccess || jobProgress.active) && (
          <AiProgressStages
            active={diagMut.isPending || jobProgress.active}
            done={diagMut.isSuccess}
            startedAt={jobProgress.startedAt}
            stages={[
              { id: "prepare", label: "Indexing procedures & inventory", estSeconds: 1 },
              { id: "ai", label: "Matching symptom with AI", estSeconds: 10 },
              { id: "format", label: "Assembling parts list", estSeconds: 1 },
            ]}
            onCancel={cancelDiagnose}
          />
        )}


        {result && (
          <Card
            className={
              result.confidence === "low"
                ? "border-muted"
                : "border-primary/40"
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                {result.matchedProcedureName ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span>Matched:</span>
                    <span className="font-mono">{result.matchedProcedureName}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <span>No confident procedure match</span>
                  </>
                )}
                <ConfidenceBadge level={result.confidence} />
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {result.model} · {result.latencyMs}ms
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground italic">{result.reasoning}</p>

              {result.suspectedAssets.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Suspected assets
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {result.suspectedAssets.map((a) => (
                      <li key={a.id}>{a.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <BookOpen className="h-3 w-3" /> In stock
                  </div>
                  {result.partsFromInventory.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No inventory parts identified.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {result.partsFromInventory.map((p, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between text-xs rounded border border-border bg-card/50 px-2 py-1"
                        >
                          <span>
                            {p.name}
                            {p.quantity != null && (
                              <span className="text-muted-foreground"> × {p.quantity}</span>
                            )}
                          </span>
                          <span
                            className={
                              p.in_stock
                                ? "text-primary text-[10px] font-semibold"
                                : "text-destructive text-[10px] font-semibold"
                            }
                          >
                            {p.in_stock ? "OK" : "LOW"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                    <PackageX className="h-3 w-3" /> Not in inventory
                  </div>
                  {result.partsMissing.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Nothing extra needed.</p>
                  ) : (
                    <ul className="space-y-1">
                      {result.partsMissing.map((p, i) => (
                        <li
                          key={i}
                          className="text-xs rounded border border-border bg-card/50 px-2 py-1"
                        >
                          <div className="font-medium">{p.name}</div>
                          <div className="text-[11px] text-muted-foreground">{p.reason}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {result.suggestedRecord && (
                <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" /> Proposed maintenance record
                  </div>
                  <div className="text-sm font-medium">{result.suggestedRecord.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {result.suggestedRecord.service_type}
                  </div>
                  <p className="text-xs whitespace-pre-wrap">
                    {result.suggestedRecord.description}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => createMut.mutate()}
                    disabled={createMut.isPending}
                  >
                    {createMut.isPending ? "Creating…" : "Create maintenance record"}
                  </Button>
                </div>
              )}

              {result.candidatesConsidered.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Procedures considered ({result.candidatesConsidered.length})
                  </summary>
                  <ul className="mt-1 pl-4 list-disc text-muted-foreground">
                    {result.candidatesConsidered.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {history.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent diagnoses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setText(h.q);
                    setResult(h.r);
                  }}
                  className="block w-full text-left text-xs rounded px-2 py-1 hover:bg-accent"
                >
                  <span className="text-muted-foreground mr-2">
                    {h.r.matchedProcedureName ?? "(no match)"}
                  </span>
                  <span className="truncate">{h.q}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
