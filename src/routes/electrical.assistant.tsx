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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAiSettings } from "@/hooks/use-ai-settings";
import {
  ELECTRICAL_AI_SCENARIOS,
  type ElectricalAiScenarioId,
} from "@/lib/electrical-ai-scenarios";
import { requestElectricalAiFeatures } from "@/lib/electrical-ai-access.functions";
import {
  cacheAgeLabel,
  cacheExpiryLabel,
  dropCachedAnswer,
  readCachedAnswer,
  runCostLabel,
  writeCachedAnswer,
  type CachedElectricalAnswer,
} from "@/lib/electrical-ai-cache";
import {
  estimateElectricalAiRun,
  listElectricalAiScenarios,
  type ElectricalAiEstimate,
  type ElectricalAiFeatureState,
  runElectricalAiScenario,
  type ElectricalAiAnswer,
} from "@/lib/electrical-ai.functions";

import {
  Camera,
  ChevronDown,
  CloudLightning,
  Cpu,
  DollarSign,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import {
  NAMEPLATE_IMAGE_TYPES,
  NAMEPLATE_MAX_BYTES,
} from "@/lib/electrical-nameplate";
import {
  NAMEPLATE_WRITE_FIELDS,
  NAMEPLATE_WRITE_GATE_NOTE,
} from "@/lib/electrical-nameplate-write";
import {
  listNameplateTargets,
  myNameplateWriteRequests,
  submitNameplateWriteRequest,
} from "@/lib/electrical-nameplate-write.functions";

/** Per-user on/off key for one electrical AI scenario (defaults to on). */
export function electricalAiFeatureKey(id: string) {
  return `electrical.${id}`;
}


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
  // Nameplate photo, held as a data URL so the server sees exactly what you saw.
  const [photo, setPhoto] = useState<{ dataUrl: string; name: string; kb: number } | null>(
    null,
  );
  const [answer, setAnswer] = useState<ElectricalAiAnswer | null>(null);
  // Pre-flight estimate: shown when the self-hosted model probably cannot answer
  // this question, so the user can decide whether to pay for a cloud run.
  const [offer, setOffer] = useState<ElectricalAiEstimate | null>(null);
  // Replayed 24h cache entry backing the shown answer (null = fresh run).
  const [cached, setCached] = useState<CachedElectricalAnswer | null>(null);
  // Live "running" clock so a 150s local run visibly progresses.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const { state: aiSettings, setFeature } = useAiSettings();
  const featureOn = (id: string) =>
    aiSettings.masterEnabled &&
    aiSettings.features[electricalAiFeatureKey(id)] !== false;

  const granted = useMemo(() => {
    const ids = new Set((data?.scenarios ?? []).map((s) => s.id));
    return ELECTRICAL_AI_SCENARIOS.filter((s) => ids.has(s.id));
  }, [data?.scenarios]);
  const allowed = useMemo(
    () => granted.filter((s) => featureOn(s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [granted, aiSettings],
  );

  useEffect(() => {
    if (allowed.length === 0) return;
    if (!selected || !allowed.some((s) => s.id === selected)) {
      setSelected(allowed[0]!.id);
    }
  }, [allowed, selected]);

  const def = allowed.find((s) => s.id === selected) ?? null;
  const routing = (data?.scenarios ?? []).find((s) => s.id === selected) ?? null;

  const mutation = useMutation({
    mutationFn: (opts?: { useCloud?: boolean }) =>
      run({
        data: {
          scenario: def!.id,
          text: def!.input === "none" ? undefined : text,
          ...(def!.input === "photo" && photo ? { image: photo.dataUrl } : {}),
          ...(opts?.useCloud ? { useCloud: true } : {}),
        },
      }),
    onMutate: () => {
      setStartedAt(Date.now());
      setElapsedMs(0);
    },
    onSuccess: (res) => {
      const fresh = res as ElectricalAiAnswer;
      setAnswer(fresh);
      setOffer(null);
      setCached(null);
      if (def && def.input !== "photo") writeCachedAnswer(def.id, text, fresh);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "The AI scenario could not run"),
    onSettled: () => setStartedAt(null),
  });

  const estimate = useServerFn(estimateElectricalAiRun);
  const preflight = useMutation({
    mutationFn: () =>
      estimate({
        data: { scenario: def!.id, text: def!.input === "none" ? undefined : text },
      }),
    onMutate: () => {
      setStartedAt(Date.now());
      setElapsedMs(0);
    },
    onSuccess: (res) => {
      const est = res as ElectricalAiEstimate;
      if (est.recommendCloud) setOffer(est);
      else mutation.mutate(undefined);
    },
    // Estimating is a convenience — if it fails, just run the scenario.
    onError: () => mutation.mutate(undefined),
  });

  const working = mutation.isPending || preflight.isPending;

  // Tick the elapsed clock while a query is in flight.
  useEffect(() => {
    if (!working || startedAt === null) return;
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => window.clearInterval(id);
  }, [working, startedAt]);

  const startRun = (opts?: { force?: boolean }) => {
    setOffer(null);
    // Photo scenarios have no record context to size up and are never cached.
    if (def?.input === "photo") {
      mutation.mutate(undefined);
      return;
    }
    if (!def) return;
    if (opts?.force) {
      dropCachedAnswer(def.id, text);
    } else {
      const hit = readCachedAnswer(def.id, text);
      if (hit) {
        setCached(hit);
        setAnswer(hit.answer);
        return;
      }
    }
    setCached(null);
    preflight.mutate();
  };



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
        <FeatureRequestCard
          features={data?.features ?? []}
          granted={granted.map((s) => s.id)}
          isOn={(id) => featureOn(id)}
          onToggle={(id, on) => setFeature(electricalAiFeatureKey(id), on)}
          masterOff={!aiSettings.masterEnabled}
        />
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
                    setPhoto(null);
                    setAnswer(null);
                    setOffer(null);
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

              {def.input === "photo" ? (
                <div className="space-y-2">
                  <PhotoPicker photo={photo} onChange={setPhoto} />
                  <div className="space-y-1.5">
                    <Label htmlFor="electrical-ai-input">
                      Which equipment is this? (optional)
                    </Label>
                    <Input
                      id="electrical-ai-input"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={def.placeholder}
                      maxLength={200}
                    />
                  </div>
                  {routing?.backend === "local" ? (
                    <p className="text-xs text-amber-700">
                      This feature is routed to the self-hosted engine. Photo reading
                      needs a vision model there (e.g. llava or a qwen2-vl build) —
                      otherwise route it to a cloud engine in Admin → AI runtime.
                    </p>
                  ) : null}
                </div>
              ) : def.input === "none" ? (
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

              {offer ? (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                  <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <CloudLightning className="h-4 w-4" />
                    This question may be too big for the self-hosted model
                  </div>
                  <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                    {offer.reason}
                  </p>
                  <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                    Records to send: ≈{offer.contextTokens.toLocaleString()} tokens
                    {offer.matchedLoadIds.length > 0
                      ? ` · matching loads: ${offer.matchedLoadIds.slice(0, 8).join(", ")}${
                          offer.matchedLoadIds.length > 8 ? "…" : ""
                        }`
                      : ""}
                  </p>
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                    Cloud run on {offer.hostedModel ?? "the configured cloud model"}:{" "}
                    {offer.costLabel} (billed to your AI usage)
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => mutation.mutate({ useCloud: true })}>
                      Run on cloud AI
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mutation.mutate(undefined)}
                    >
                      Run self-hosted anyway (free)
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOffer(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {working ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>
                    {preflight.isPending
                      ? "Sizing the query up…"
                      : `Query running on ${routing?.model ?? "the AI engine"}…`}
                  </span>
                  <span className="ml-auto flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    <Timer className="h-3.5 w-3.5" />
                    {(elapsedMs / 1000).toFixed(1)}s
                  </span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => startRun()}
                  disabled={
                    working ||
                    Boolean(offer) ||
                    (def.input === "photo"
                      ? !photo
                      : def.input !== "none" && text.trim().length < 3)
                  }
                >
                  {working ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {preflight.isPending ? "Estimating…" : "Running…"}
                    </>
                  ) : (
                    "Run scenario"
                  )}
                </Button>
                {cached ? (
                  <Button
                    variant="outline"
                    onClick={() => startRun({ force: true })}
                    disabled={working}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh answer
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* The answer sits directly under the query it came from; the feature list
          is secondary and follows it. */}
      {answer ? (

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              Answer
              {cached ? (
                <Badge variant="outline" className="gap-1">
                  <History className="h-3 w-3" />
                  Cached
                </Badge>
              ) : null}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {answer.engineLabel} · {answer.model} · {answer.backend} ·{" "}
              <span className="font-medium">
                {(answer.latencyMs / 1000).toFixed(1)}s
              </span>{" "}
              ·{" "}
              <span className="inline-flex items-center gap-0.5 font-medium">
                <DollarSign className="h-3 w-3" />
                {runCostLabel(answer.cost, answer.backend).replace(/^\$/, "")}
              </span>
              {answer.cost && answer.cost.metered
                ? ` · ${answer.cost.inputTokens.toLocaleString()} in / ${answer.cost.outputTokens.toLocaleString()} out tokens`
                : ""}
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
          <CardContent className="space-y-3">
            {cached ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs">
                <History className="h-3.5 w-3.5" />
                <span>
                  You asked this before — showing the saved answer from{" "}
                  {cacheAgeLabel(cached.cachedAt)} ({cacheExpiryLabel(cached.cachedAt)}).
                  Should it be refreshed?
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7"
                  disabled={working}
                  onClick={() => startRun({ force: true })}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Re-run now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setCached(null)}
                >
                  Keep cached
                </Button>
              </div>
            ) : null}
            {answer.nameplate ? (
              <NameplateDraftTable answer={answer} />
            ) : (
              <pre className="whitespace-pre-wrap break-words text-sm">{answer.answer}</pre>
            )}
            {answer.terminologyNotes && answer.terminologyNotes.length > 0 ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-medium">Wording note</p>
                <ul className="mt-1 list-disc pl-4">
                  {answer.terminologyNotes.map((n, i) => (
                    <li key={i}>
                      The answer says &ldquo;{n.matched}&rdquo;. The term used in this record is{" "}
                      {n.instead}. {n.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <FeatureRequestCard
        features={data?.features ?? []}
        granted={granted.map((s) => s.id)}
        isOn={(id) => featureOn(id)}
        onToggle={(id, on) => setFeature(electricalAiFeatureKey(id), on)}
        masterOff={!aiSettings.masterEnabled}
      />



    </div>
  );
}

/**
 * Camera / file picker for a nameplate photo. The file is downscaled to 1600px
 * before upload: a 4 MB phone photo becomes roughly 400 KB, which is far cheaper
 * per AI call and still resolves plate stamping.
 */
function PhotoPicker({
  photo,
  onChange,
}: {
  photo: { dataUrl: string; name: string; kb: number } | null;
  onChange: (value: { dataUrl: string; name: string; kb: number } | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    if (!(NAMEPLATE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Use a JPEG, PNG or WebP photo. iPhone HEIC must be converted first.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await downscaleToDataUrl(file);
      const kb = Math.round((dataUrl.length * 3) / 4 / 1024);
      if (kb * 1024 > NAMEPLATE_MAX_BYTES) {
        toast.error("That photo is too large even after downscaling.");
        return;
      }
      onChange({ dataUrl, name: file.name, kb });
    } catch {
      toast.error("That image could not be read.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="nameplate-photo">Nameplate photo</Label>
      <Input
        id="nameplate-photo"
        type="file"
        accept={NAMEPLATE_IMAGE_TYPES.join(",")}
        capture="environment"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void load(file);
        }}
      />
      <p className="text-xs text-muted-foreground">
        Fill the frame with the plate, straight on, no flash glare. Everything read
        back is a draft you confirm — nothing is written to the electrical record.
      </p>
      {busy ? (
        <p className="text-xs text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          Preparing photo…
        </p>
      ) : null}
      {photo ? (
        <div className="flex items-start gap-3 rounded-md border p-2">
          <img
            src={photo.dataUrl}
            alt={`Nameplate photo ${photo.name}`}
            className="h-24 w-24 rounded object-cover"
          />
          <div className="min-w-0 text-xs text-muted-foreground">
            <div className="flex items-center gap-1 text-foreground">
              <Camera className="h-3.5 w-3.5" />
              <span className="truncate">{photo.name}</span>
            </div>
            <div>{photo.kb} KB after downscaling</div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 h-7 px-2"
              onClick={() => onChange(null)}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Re-encode to JPEG at max 1600px on the long edge. */
async function downscaleToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Transcribed plate values, with blanks kept visible so gaps are obvious. */
function NameplateDraftTable({ answer }: { answer: ElectricalAiAnswer }) {
  const fields = answer.nameplate ?? [];
  const read = fields.filter((f) => f.id !== "notes" && f.value);
  const notes = fields.find((f) => f.id === "notes")?.value ?? null;

  const copy = () => {
    const text = read.map((f) => `${f.label}: ${f.value}`).join("\n");
    void navigator.clipboard.writeText(text);
    toast.success("Draft values copied.");
  };

  if (fields.length === 0 || read.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-amber-700">
          Nothing legible came back. Re-shoot the plate closer and straight on, or read
          the raw reply below.
        </p>
        <pre className="whitespace-pre-wrap break-words text-xs">{answer.answer}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields
          .filter((f) => f.id !== "notes")
          .map((f) => (
            <div key={f.id} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{f.label}</div>
              <div className={f.value ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                {f.value ?? "not legible"}
              </div>
              {!f.value ? <div className="text-[11px] text-muted-foreground">{f.hint}</div> : null}
            </div>
          ))}
      </div>
      {notes ? (
        <p className="text-xs text-amber-700">Model note: {notes}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          Copy draft values
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/electrical/$kind" params={{ kind: "loads" }}>
            Open loads to enter them
          </Link>
        </Button>
      </div>

      <NameplateWriteRequestForm fields={fields} />

      <p className="text-xs text-muted-foreground">
        {NAMEPLATE_WRITE_GATE_NOTE}
      </p>
    </div>
  );
}

/**
 * Ask an administrator to write the plate reading onto one equipment row.
 * Manufacturer, model, serial, voltage, phase, FLA/RLA, MCA and MOCP are the
 * writable fields; they land on the nameplate columns only after approval.
 */
function NameplateWriteRequestForm({ fields }: { fields: { id: string; label: string; value: string | null }[] }) {
  const targets = useServerFn(listNameplateTargets);
  const submit = useServerFn(submitNameplateWriteRequest);
  const mine = useServerFn(myNameplateWriteRequests);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [loadUuid, setLoadUuid] = useState("");
  const [note, setNote] = useState("");
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  const writable = useMemo(
    () =>
      NAMEPLATE_WRITE_FIELDS.map((def) => ({
        ...def,
        value: fields.find((f) => f.id === def.id)?.value ?? null,
      })).filter((f) => f.value),
    [fields],
  );

  const { data: options } = useQuery({
    queryKey: ["nameplate-targets", search],
    queryFn: () => targets({ data: search.trim() ? { search: search.trim() } : {} }),
  });

  const { data: requests } = useQuery({
    queryKey: ["nameplate-write-requests", "mine"],
    queryFn: () => mine({}),
  });

  const proposed = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of writable) if (!skipped[f.id] && f.value) out[f.id] = f.value;
    return out;
  }, [writable, skipped]);

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          loadUuid,
          proposed,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Sent to an administrator for approval. Nothing is written yet.");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["nameplate-write-requests"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "That request could not be submitted"),
  });

  if (writable.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="text-sm font-medium">Request a write to the equipment record</div>

      <div className="space-y-1">
        {writable.map((f) => (
          <label
            key={f.id}
            htmlFor={`np-write-${f.id}`}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              id={`np-write-${f.id}`}
              checked={!skipped[f.id]}
              onCheckedChange={(v) => setSkipped((p) => ({ ...p, [f.id]: v !== true }))}
            />
            <span>
              <span className="font-medium">{f.label}</span>{" "}
              <span className="text-muted-foreground">{f.value}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor="np-target-search">Equipment row</Label>
        <Input
          id="np-target-search"
          value={search}
          placeholder="Filter by load ID, description or location"
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={loadUuid}
          onChange={(e) => setLoadUuid(e.target.value)}
          aria-label="Equipment row to update"
        >
          <option value="">Select an equipment row…</option>
          {(options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.load_id} — {o.description ?? "no description"}
              {o.location ? ` (${o.location})` : ""}
            </option>
          ))}
        </select>
      </div>

      <Input
        value={note}
        maxLength={500}
        placeholder="Note for the approver (optional)"
        onChange={(e) => setNote(e.target.value)}
      />

      <Button
        size="sm"
        disabled={!loadUuid || Object.keys(proposed).length === 0 || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : null}
        Send for admin approval
      </Button>

      {(requests?.length ?? 0) > 0 ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Your recent requests</div>
          {requests!.slice(0, 5).map((r) => (
            <div key={r.id}>
              {r.load_ref ?? "load"} · {Object.keys(r.proposed).length} fields ·{" "}
              {r.status === "pending"
                ? "awaiting admin approval"
                : r.status === "approved"
                  ? `applied ${Object.keys(r.applied_fields ?? {}).length} fields`
                  : "declined"}
            </div>
          ))}
        </div>
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
function FeatureRequestCard({
  features,
  granted,
  isOn,
  onToggle,
  masterOff,
}: {
  features: ElectricalAiFeatureState[];
  /** Scenario ids you already have access to — these get an on/off switch. */
  granted: string[];
  isOn: (id: string) => boolean;
  onToggle: (id: string, on: boolean) => void;
  masterOff: boolean;
}) {
  const qc = useQueryClient();
  const submit = useServerFn(requestElectricalAiFeatures);
  const [picked, setPicked] = useState<ElectricalAiScenarioId[]>([]);
  const [featuresOpen, setFeaturesOpen] = useState(false);
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
        <button
          type="button"
          aria-expanded={featuresOpen}
          onClick={() => setFeaturesOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              featuresOpen ? "" : "-rotate-90"
            }`}
          />
          <CardTitle className="text-base">AI features available to you</CardTitle>
        </button>
        {featuresOpen ? (
          <p className="text-sm text-muted-foreground">
            Everything the Electrical pane can do with AI. Tick what you need and submit it
            for administrator approval — approval enables the scenario only, never extra
            data access.
          </p>
        ) : null}
      </CardHeader>
      {featuresOpen ? (
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
                {granted.includes(def.id) ? (
                  <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                    <Switch
                      checked={isOn(def.id)}
                      disabled={masterOff}
                      onCheckedChange={(c) => onToggle(def.id, c === true)}
                      aria-label={`Turn ${def.label} ${isOn(def.id) ? "off" : "on"}`}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {masterOff ? "AI off" : isOn(def.id) ? "On" : "Off"}
                    </span>
                  </div>
                ) : null}
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
      ) : null}
    </Card>
  );
}
