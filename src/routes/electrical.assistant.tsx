// Electrical AI assist: scenario-scoped, read-only AI help for the Electrical
// pane. Administrators see every scenario; an electrician sees only the ones
// their add-on covers. Model/engine choice is configured in Admin → AI runtime.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ELECTRICAL_AI_SCENARIOS,
  type ElectricalAiScenarioId,
} from "@/lib/electrical-ai-scenarios";
import { requestElectricalAiFeatures } from "@/lib/electrical-ai-access.functions";
import {
  listElectricalAiScenarios,
  type ElectricalAiFeatureState,
  runElectricalAiScenario,
  type ElectricalAiAnswer,
} from "@/lib/electrical-ai.functions";
import { Cpu, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/electrical/assistant")({
  component: AssistantPage,
  head: () => ({
    meta: [
      { title: "Electrical AI Assist — Bostead Farms" },
      {
        name: "description",
        content:
          "Scenario-scoped, read-only AI help for the electrical record: panel Q&A, topology explanations, finding triage and change-audit review.",
      },
      { property: "og:title", content: "Electrical AI Assist — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Ask about the as-installed electrical record. Answers only — no electrical record is ever written by AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const BASIS_LABEL: Record<string, string> = {
  admin: "Administrator — all scenarios",
  full: "Full Electrical add-on",
  field_write: "Field-write electrician",
  read_only: "Read-only electrician",
  scan: "Scanned-label access",
  none: "No electrical access",
};

function AssistantPage() {
  return (
    <ElectricalGate>
      <Assistant />
    </ElectricalGate>
  );
}

function Assistant() {
  const list = useServerFn(listElectricalAiScenarios);
  const run = useServerFn(runElectricalAiScenario);

  const { data, isLoading } = useQuery({
    queryKey: ["electrical-ai-scenarios"],
    queryFn: () => list({}),
  });

  const [selected, setSelected] = useState<ElectricalAiScenarioId | null>(null);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<ElectricalAiAnswer | null>(null);

  const allowed = useMemo(() => {
    const ids = new Set((data?.scenarios ?? []).map((s) => s.id));
    return ELECTRICAL_AI_SCENARIOS.filter((s) => ids.has(s.id));
  }, [data?.scenarios]);

  useEffect(() => {
    if (!selected && allowed.length > 0) setSelected(allowed[0]!.id);
  }, [allowed, selected]);

  const def = allowed.find((s) => s.id === selected) ?? null;
  const routing = (data?.scenarios ?? []).find((s) => s.id === selected) ?? null;

  const mutation = useMutation({
    mutationFn: () =>
      run({ data: { scenario: def!.id, text: def!.input === "none" ? undefined : text } }),
    onSuccess: (res) => setAnswer(res as ElectricalAiAnswer),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "The AI scenario could not run"),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (allowed.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No AI scenarios enabled yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Nothing is enabled for your access yet. Tick the AI features you need below
            and submit them — an administrator approves them in Admin → Users.
          </CardContent>
        </Card>
        <FeatureRequestCard features={data?.features ?? []} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Electrical AI assist
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Read-only help over the as-installed record. AI never writes an electrical
            record and never edits the canonical engineering workbook. Scenario scope
            follows your access: <Badge variant="secondary">{BASIS_LABEL[data?.basis ?? "none"]}</Badge>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {allowed.map((s) => {
              const active = s.id === selected;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelected(s.id);
                    setText("");
                    setAnswer(null);
                  }}
                  className={
                    "rounded-md border p-3 text-left transition-colors " +
                    (active ? "border-primary bg-accent" : "hover:bg-accent/50")
                  }
                >
                  <div className="text-sm font-medium">{s.label}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                </button>
              );
            })}
          </div>

          {def ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                <span>
                  Model routing: <span className="font-medium">{routing?.areaLabel}</span> →{" "}
                  {routing?.backend}
                  {routing?.model ? ` · ${routing.model}` : ""}
                </span>
                {data?.isAdmin ? (
                  <Link to="/admin/ai-runtime" className="underline">
                    Change in AI admin
                  </Link>
                ) : null}
              </div>

              {def.input === "none" ? (
                <p className="text-sm text-muted-foreground">
                  No input needed — this scenario reads the current records.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="electrical-ai-input">{def.inputLabel}</Label>
                  <Textarea
                    id="electrical-ai-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={def.placeholder}
                    rows={3}
                    maxLength={2000}
                  />
                </div>
              )}

              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || (def.input !== "none" && text.trim().length < 3)}
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running…
                  </>
                ) : (
                  "Run scenario"
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <FeatureRequestCard features={data?.features ?? []} />

      {answer ? (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Answer</CardTitle>
            <p className="text-xs text-muted-foreground">
              {answer.engineLabel} · {answer.model} · {answer.backend} ·{" "}
              {(answer.latencyMs / 1000).toFixed(1)}s
              {Object.keys(answer.contextCounts).length > 0
                ? ` · records read: ${Object.entries(answer.contextCounts)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}`
                : ""}
            </p>
            {answer.escalation ? (
              <p className="text-xs text-amber-700">{answer.escalation.detail}</p>
            ) : null}
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm">{answer.answer}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting admin approval",
  approved: "Approved",
  rejected: "Not approved",
  revoked: "Access removed",
};

/**
 * The electrician's own view of the AI feature catalogue: everything on offer,
 * what is already enabled, and a request basket for the rest. Approval is an
 * admin decision — ticking here only submits the ask.
 */
function FeatureRequestCard({ features }: { features: ElectricalAiFeatureState[] }) {
  const qc = useQueryClient();
  const submit = useServerFn(requestElectricalAiFeatures);
  const [picked, setPicked] = useState<ElectricalAiScenarioId[]>([]);
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => submit({ data: { scenarios: picked, note: note.trim() || undefined } }),
    onSuccess: () => {
      toast.success("Sent for admin approval.");
      setPicked([]);
      setNote("");
      qc.invalidateQueries({ queryKey: ["electrical-ai-scenarios"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not submit the request"),
  });

  if (features.length === 0) return null;
  const anyRequestable = features.some((f) => f.requestable);

  const toggle = (id: ElectricalAiScenarioId, on: boolean) =>
    setPicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">AI features available to you</CardTitle>
        <p className="text-sm text-muted-foreground">
          Everything the Electrical pane can do with AI. Tick what you need and submit it
          for administrator approval — approval enables the scenario only, never extra
          data access.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {ELECTRICAL_AI_SCENARIOS.map((def) => {
            const state = features.find((f) => f.id === def.id);
            if (!state) return null;
            return (
              <div key={def.id} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.includes(def.id)}
                  disabled={!state.requestable || mutation.isPending}
                  onCheckedChange={(c) => toggle(def.id, c === true)}
                  aria-label={`Request ${def.label}`}
                />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{def.label}</span>
                    {state.available ? (
                      <Badge variant="secondary">
                        {state.granted ? "Enabled by admin" : "Enabled"}
                      </Badge>
                    ) : state.requestStatus ? (
                      <Badge
                        variant={state.requestStatus === "pending" ? "outline" : "destructive"}
                      >
                        {REQUEST_STATUS_LABEL[state.requestStatus]}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not enabled</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{def.description}</p>
                  {state.decisionNote ? (
                    <p className="text-xs text-muted-foreground">
                      Admin note: {state.decisionNote}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {anyRequestable ? (
          <div className="space-y-2">
            <Label htmlFor="ai-request-note">Why you need it (optional)</Label>
            <Input
              id="ai-request-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reconciling PNL-H1 field notes this week"
              maxLength={500}
            />
            <Button
              variant="outline"
              onClick={() => mutation.mutate()}
              disabled={picked.length === 0 || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                `Request approval${picked.length ? ` (${picked.length})` : ""}`
              )}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
