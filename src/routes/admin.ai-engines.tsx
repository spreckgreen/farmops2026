import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAiEngines,
  setAiEngines,
  testAiEngineConnection,
} from "@/lib/ai-engines.functions";
import type { EngineTestResult } from "@/lib/ai-engine-test.server";
import { tierForModel } from "@/lib/model-tiers";
import {
  AI_ENGINE_DEFS,
  engineFieldErrors,
  type AiEngineId,
  type EngineFieldErrors,
} from "@/lib/ai-engines";

import {
  ArrowLeft,
  Cloud,
  Server,
  Sparkles,
  CheckCircle2,
  Loader2,
  PlugZap,
  RotateCcw,

  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/admin/ai-engines")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI engines — Bostead" },
      {
        name: "description",
        content:
          "Configure Bostead's self-hosted, Ollama Cloud and OpenAI-compatible cloud engines.",
      },
      { property: "og:title", content: "AI engines — Bostead" },
      {
        property: "og:description",
        content:
          "Configure the AI engines that power Bostead's reports, schedules and knowledge base.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiEnginesPage,
});

function RequirementBadge({
  requirement,
}: {
  requirement: "required" | "optional" | "not-needed";
}) {
  if (requirement === "required")
    return (
      <Badge variant="destructive" className="text-[10px] uppercase">
        required
      </Badge>
    );
  if (requirement === "optional")
    return (
      <Badge variant="secondary" className="text-[10px] uppercase">
        optional — default supplied
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] uppercase">
      not needed
    </Badge>
  );
}

interface TargetDraft {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  keyTouched: boolean;
  model: string;
}


const emptyDraft: TargetDraft = {
  enabled: true,
  baseUrl: "",
  apiKey: "",
  keyTouched: false,
  model: "",
};

type Drafts = Record<AiEngineId, TargetDraft>;

const emptyDrafts = (): Drafts => ({
  local: { ...emptyDraft },
  ollama_cloud: { ...emptyDraft },
  other_cloud: { ...emptyDraft },
});

function AiEnginesPage() {
  const load = useServerFn(getAiEngines);
  const save = useServerFn(setAiEngines);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-engines"],
    queryFn: () => load({}),
  });

  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [cloudDefault, setCloudDefault] = useState<AiEngineId>("other_cloud");

  useEffect(() => {
    if (!data) return;
    const next = emptyDrafts();
    for (const def of AI_ENGINE_DEFS) {
      const stored = data.config.engines[def.id];
      next[def.id] = {
        enabled: stored.enabled,
        // Nothing saved yet → pre-fill the known-good default so the operator
        // only has to correct it, never type it from scratch.
        baseUrl: stored.baseUrl ?? def.defaultBaseUrl ?? "",
        apiKey: "",
        keyTouched: false,
        model: stored.model ?? def.defaultModel ?? "",
      };
    }
    setDrafts(next);
    setCloudDefault(data.config.cloudDefault);
  }, [data]);


  const [tests, setTests] = useState<Partial<Record<AiEngineId, EngineTestResult>>>({});
  const [testing, setTesting] = useState<AiEngineId | null>(null);
  const runTest = useServerFn(testAiEngineConnection);

  const testEngine = async (id: AiEngineId) => {
    const d = drafts[id];
    setTesting(id);
    try {
      const result = await runTest({
        data: {
          id,
          baseUrl: d.baseUrl.trim() || null,
          apiKey: d.keyTouched ? d.apiKey : null,
          model: d.model.trim() || null,
        },
      });
      setTests((prev) => ({ ...prev, [id]: result }));
      // "Better" is the default pick: apply it automatically when the operator
      // has no model set, or the one they set isn't served here. Any tier can
      // still be chosen (or typed) afterwards.
      const recommended = result.recommendedModel ?? null;
      if (recommended && (!d.model.trim() || result.modelFound === false)) {
        patch(id, { model: recommended });
        toast.info(`Set model to ${recommended} (Better tier). You can change it.`);
      }
      if (result.ok) toast.success(`${result.title}: ${result.message}`);
      else toast.error(result.title);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setTests((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          title: "Test could not run",
          message,
          hint: null,
          baseUrl: null,
          model: null,
          modelsSeen: [],
          modelFound: null,
          latencyMs: null,
          httpStatus: null,
        },
      }));
      toast.error(message);
    } finally {
      setTesting(null);
    }
  };

  const patch = (id: AiEngineId, value: Partial<TargetDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...value } }));

  const buildPayload = (source: Drafts, cloud: AiEngineId) => ({
    cloudDefault: cloud,
    engines: Object.fromEntries(
      AI_ENGINE_DEFS.map((def) => {
        const d = source[def.id];
        return [
          def.id,
          {
            enabled: d.enabled,
            baseUrl: d.baseUrl.trim() || null,
            // null keeps the stored key; "" clears it (used by "Reset to defaults").
            apiKey: d.keyTouched ? d.apiKey : null,
            model: d.model.trim() || null,
          },
        ];
      }),
    ),
  });

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<AiEngineId, EngineFieldErrors>>
  >({});

  /**
   * Client-side mirror of the server rule: only switched-on engines are
   * checked, and only fields with no usable default can fail.
   */
  const checkDrafts = (source: Drafts) => {
    const problems: Partial<Record<AiEngineId, EngineFieldErrors>> = {};
    for (const def of AI_ENGINE_DEFS) {
      const d = source[def.id];
      if (!d.enabled) continue;
      const errors = engineFieldErrors(def.id, {
        baseUrl: d.baseUrl,
        model: d.model,
        apiKey: d.keyTouched ? d.apiKey : null,
        // An untouched field with a key already stored still counts as present.
        hasApiKey: d.keyTouched
          ? Boolean(d.apiKey.trim())
          : Boolean(data?.config.engines[def.id].hasApiKey),
      });
      if (Object.keys(errors).length > 0) problems[def.id] = errors;
    }
    return problems;
  };

  const saveMutation = useMutation({
    mutationFn: (override?: Drafts) =>
      save({ data: buildPayload(override ?? drafts, cloudDefault) }),
    onSuccess: (result) => {
      if ("fieldErrors" in result && result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
      if (result.ok === false) {
        toast.error("message" in result ? result.message : "Could not save engines");
        return;
      }
      const warnings = "warnings" in result ? (result.warnings ?? []) : [];
      toast.success("AI engine configuration saved");
      // The server may move the cloud default to an engine that is actually
      // usable — mirror that in the picker so the UI matches what was stored.
      if ("config" in result && result.config?.cloudDefault)
        setCloudDefault(result.config.cloudDefault);
      for (const w of warnings) toast.warning(w);
      void qc.invalidateQueries({ queryKey: ["ai-engines"] });
      void qc.invalidateQueries({ queryKey: ["ai-routing"] });
    },

    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save engines"),
  });

  /** Validate the enabled engines first, then save. */
  const submit = (override?: Drafts) => {
    const source = override ?? drafts;
    const problems = checkDrafts(source);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      const first = Object.values(problems)[0] ?? {};
      toast.error(Object.values(first)[0] ?? "Fix the highlighted fields first.");
      return;
    }
    saveMutation.mutate(source);
  };

  /**
   * One-click restore for a single card: puts the known-good base URL + model
   * back, and clears any stored key — including keys inherited from an older
   * config — by sending an explicit empty string. Saved immediately so the
   * runtime stops using the old credential right away.
   */
  const resetEngine = (id: AiEngineId) => {
    const def = AI_ENGINE_DEFS.find((e) => e.id === id)!;
    const reset: TargetDraft = {
      // A reset cloud engine has no key, so switch it off rather than failing
      // save-time validation for a slot the operator just cleared.
      enabled: def.apiKeyRequirement === "required" ? false : drafts[id].enabled,
      baseUrl: def.defaultBaseUrl ?? "",
      apiKey: "",
      keyTouched: true,
      model: def.defaultModel ?? "",
    };
    const next: Drafts = { ...drafts, [id]: reset };
    setDrafts(next);
    setTests((prev) => ({ ...prev, [id]: undefined }));
    setFieldErrors((prev) => ({ ...prev, [id]: undefined }));
    submit(next);
  };



  const defaultEngines = AI_ENGINE_DEFS;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>

        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6" />
            AI engines
          </h1>
          <p className="text-sm text-muted-foreground">
            Three engines run side by side — self-hosted local, Ollama Cloud and another
            OpenAI-compatible cloud provider. Each AI feature picks one in{" "}
            <Link to="/settings/self-host" className="underline underline-offset-2">
              Self-host settings
            </Link>
            .
          </p>
        </header>

        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">Loading engine configuration…</p>
        ) : (
          <>
            {AI_ENGINE_DEFS.map((def) => {
              const d = drafts[def.id];
              const stored = data.config.engines[def.id];
              const status = data.availability[def.id];
              return (
                <Card key={def.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {def.placement === "local" ? (
                        <Server className="h-4 w-4" />
                      ) : (
                        <Cloud className="h-4 w-4" />
                      )}
                      {def.label}
                      <Badge variant={status.available ? "secondary" : "outline"}>
                        {!d.enabled
                          ? "off"
                          : status.available
                            ? "ready"
                            : "not configured"}
                      </Badge>
                      {data.config.cloudDefault === def.id && (
                        <Badge>cloud default</Badge>
                      )}
                      <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
                        <Label htmlFor={`${def.id}-enabled`}>
                          {d.enabled ? "On" : "Off"}
                        </Label>
                        <Switch
                          id={`${def.id}-enabled`}
                          checked={d.enabled}
                          onCheckedChange={(v) => patch(def.id, { enabled: v })}
                        />
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {def.description}
                      {status.available ? (
                        <>
                          {" "}
                          Effective now: <code>{status.baseUrl}</code> ·{" "}
                          <code>{status.model}</code>
                        </>
                      ) : null}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saveMutation.isPending}
                        onClick={() => resetEngine(def.id)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset to defaults
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Restores{" "}
                        <code>{def.defaultBaseUrl ?? "no base URL"}</code>
                        {def.defaultModel ? (
                          <>
                            {" "}
                            and <code>{def.defaultModel}</code>
                          </>
                        ) : null}
                        , clears any stored or inherited API key, and saves immediately.
                      </span>
                    </div>

                    {!d.enabled && (
                      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                        Switched off. Everything below stays saved — no AI feature will use
                        this engine until you switch it back on. Connection tests still run.
                      </p>
                    )}
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor={`${def.id}-base`}>Base URL</Label>
                        <RequirementBadge requirement={def.baseUrlRequirement} />
                        {def.defaultBaseUrl && d.baseUrl !== def.defaultBaseUrl && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() =>
                              patch(def.id, { baseUrl: def.defaultBaseUrl ?? "" })
                            }
                          >
                            Reset to default
                          </Button>
                        )}
                      </div>
                      <Input
                        id={`${def.id}-base`}
                        placeholder={def.defaultBaseUrl ?? "https://…/v1"}
                        value={d.baseUrl}
                        onChange={(e) => patch(def.id, { baseUrl: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">{def.baseUrlReason}</p>
                      {fieldErrors[def.id]?.baseUrl && (
                        <p className="text-xs font-medium text-destructive">
                          {fieldErrors[def.id]?.baseUrl}
                        </p>
                      )}

                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor={`${def.id}-key`}>API key</Label>
                        <RequirementBadge requirement={def.apiKeyRequirement} />
                        {stored.hasApiKey && <Badge variant="secondary">stored</Badge>}
                      </div>
                      <Input
                        id={`${def.id}-key`}
                        type="password"
                        autoComplete="off"
                        disabled={def.apiKeyRequirement === "not-needed"}
                        placeholder={
                          def.apiKeyRequirement === "not-needed"
                            ? "no key needed — handled automatically"
                            : stored.hasApiKey
                              ? "•••••• (leave blank to keep the stored key)"
                              : def.id === "ollama_cloud"
                                ? "Ollama Cloud key from ollama.com → Settings → Keys"
                                : "provider key, e.g. sk-… for OpenAI"
                        }
                        value={d.apiKey}
                        onChange={(e) =>
                          patch(def.id, { apiKey: e.target.value, keyTouched: true })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {def.apiKeyReason}
                        {def.apiKeyWhere ? ` Get one at ${def.apiKeyWhere}.` : ""}
                      </p>
                      {fieldErrors[def.id]?.apiKey && (
                        <p className="text-xs font-medium text-destructive">
                          {fieldErrors[def.id]?.apiKey}
                        </p>
                      )}

                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label htmlFor={`${def.id}-model`}>Model</Label>
                        <RequirementBadge requirement={def.modelRequirement} />
                        {def.defaultModel && d.model !== def.defaultModel && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => patch(def.id, { model: def.defaultModel ?? "" })}
                          >
                            Reset to default
                          </Button>
                        )}
                      </div>
                      <Input
                        id={`${def.id}-model`}
                        className="font-mono text-xs"
                        placeholder={def.defaultModel ?? "gpt-4.1-mini"}
                        value={d.model}
                        onChange={(e) => patch(def.id, { model: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">{def.modelReason}</p>
                      {fieldErrors[def.id]?.model && (
                        <p className="text-xs font-medium text-destructive">
                          {fieldErrors[def.id]?.model}
                        </p>
                      )}

                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void testEngine(def.id)}
                        disabled={testing !== null}
                      >
                        {testing === def.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <PlugZap className="h-4 w-4" />
                        )}
                        {testing === def.id ? "Testing…" : "Test connection"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Checks the base URL, key and model without saving.
                      </span>
                    </div>

                    {tests[def.id] && (
                      <div
                        className={`rounded-md border p-3 text-sm space-y-1 ${
                          tests[def.id]?.ok
                            ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-destructive/40 bg-destructive/5"
                        }`}
                      >
                        <p className="flex items-center gap-2 font-medium">
                          {tests[def.id]?.ok ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          {tests[def.id]?.title}
                          {tests[def.id]?.latencyMs !== null && (
                            <span className="text-xs font-normal text-muted-foreground">
                              {tests[def.id]?.latencyMs} ms
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground">{tests[def.id]?.message}</p>
                        {tests[def.id]?.hint && (
                          <p className="text-xs text-muted-foreground">
                            {tests[def.id]?.hint}
                          </p>
                        )}
                        {(tests[def.id]?.tiers?.ranked.length ?? 0) > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium">Models available</p>
                            <div className="flex flex-wrap gap-2">
                              {tests[def.id]?.tiers?.ranked
                                .slice(0, 12)
                                .map((m) => {
                                  const tier = tierForModel(
                                    m.id,
                                    tests[def.id]!.tiers!,
                                  );
                                  const active = d.model.trim() === m.id;
                                  return (
                                    <button
                                      key={m.id}
                                      type="button"
                                      onClick={() => patch(def.id, { model: m.id })}
                                      title={m.reason}
                                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono transition ${
                                        active
                                          ? "border-primary bg-primary/10"
                                          : "hover:bg-muted/60"
                                      }`}
                                    >
                                      {m.id}
                                      {tier && (
                                        <Badge
                                          variant={
                                            tier === "better"
                                              ? "default"
                                              : tier === "good"
                                                ? "secondary"
                                                : "outline"
                                          }
                                          className="text-[10px]"
                                        >
                                          {tier === "better"
                                            ? "Better"
                                            : tier === "good"
                                              ? "Good"
                                              : "Best"}
                                        </Badge>
                                      )}
                                    </button>
                                  );
                                })}
                            </div>
                            {(tests[def.id]?.tiers?.ranked.length ?? 0) > 12 && (
                              <p className="text-xs text-muted-foreground">
                                +{(tests[def.id]?.tiers?.ranked.length ?? 0) - 12}{" "}
                                more not shown.
                              </p>
                            )}
                          </div>
                        )}
                        {tests[def.id]?.tiers?.better && (
                          <div className="space-y-2 rounded-md border bg-background/60 p-2">
                            <p className="text-xs font-medium">
                              Recommended for cloud AI features
                              <span className="ml-1 font-normal text-muted-foreground">
                                — Better is the default; pick another tier any time.
                              </span>
                            </p>
                            <div className="grid gap-2 sm:grid-cols-3">
                              {(
                                [
                                  ["good", "Good", "Cheapest that can still do the job"],
                                  ["better", "Better", "Recommended default"],
                                  ["best", "Best", "Highest capability offered here"],
                                ] as const
                              ).map(([tier, label, blurb]) => {
                                const pick = tests[def.id]?.tiers?.[tier];
                                if (!pick) return null;
                                const active = d.model.trim() === pick.id;
                                return (
                                  <button
                                    key={tier}
                                    type="button"
                                    onClick={() => patch(def.id, { model: pick.id })}
                                    className={`rounded-md border p-2 text-left transition ${
                                      active
                                        ? "border-primary bg-primary/10"
                                        : "hover:bg-muted/60"
                                    }`}
                                  >
                                    <span className="flex items-center gap-1 text-xs font-semibold">
                                      {label}
                                      {tier === "better" && (
                                        <span className="rounded bg-muted px-1 text-[10px] font-normal uppercase">
                                          default
                                        </span>
                                      )}
                                    </span>
                                    <span className="mt-1 block truncate font-mono text-xs">
                                      {pick.id}
                                    </span>
                                    <span className="mt-1 block text-[11px] text-muted-foreground">
                                      {blurb}. {pick.reason}.
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Tiers are ranked from the models this provider reports. Click one
                              to use it, or type any other id in the Model field above.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {def.id === "local" && data.envCustomAi.baseUrl && (
                      <p className="text-xs text-muted-foreground">
                        Deploy env <code>CUSTOM_AI_BASE_URL={data.envCustomAi.baseUrl}</code>{" "}
                        is used when the base URL above is blank.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cloud default</CardTitle>
                <CardDescription>
                  Choose Self-hosted to prevent cloud AI from being used. Otherwise, this
                  engine handles features set to “Cloud default” and fallback from local AI.
                  Disabled engines are never used.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="cloud-default">Cloud default engine</Label>
                  <Select
                    value={cloudDefault}
                    onValueChange={(v) => setCloudDefault(v as AiEngineId)}
                  >
                    <SelectTrigger id="cloud-default" className="w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {defaultEngines.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.id === "local" ? "Self-hosted only" : e.label}
                          {data.availability[e.id].available ? "" : " (not configured)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => submit()}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save engines"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
