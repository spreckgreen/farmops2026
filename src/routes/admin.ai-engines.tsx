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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  getAiEngines,
  setAiEngines,
  switchHostedToLovableAi,
} from "@/lib/ai-engines.functions";
import { ArrowLeft, Cloud, Server, Sparkles, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/admin/ai-engines")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI engines — Bostead" },
      {
        name: "description",
        content:
          "Configure the self-hosted (local) AI engine and the hosted AI engine used by Bostead's AI features.",
      },
      { property: "og:title", content: "AI engines — Bostead" },
      {
        property: "og:description",
        content:
          "Configure the local and hosted AI engines that power Bostead's reports, schedules and knowledge base.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiEnginesPage,
});

interface TargetDraft {
  baseUrl: string;
  apiKey: string;
  keyTouched: boolean;
  model: string;
}

const emptyDraft: TargetDraft = { baseUrl: "", apiKey: "", keyTouched: false, model: "" };

function AiEnginesPage() {
  const load = useServerFn(getAiEngines);
  const save = useServerFn(setAiEngines);
  const switchToLovable = useServerFn(switchHostedToLovableAi);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-engines"],
    queryFn: () => load({}),
  });

  const [local, setLocal] = useState<TargetDraft>(emptyDraft);
  const [hostedProvider, setHostedProvider] = useState<"lovable" | "custom">("lovable");
  const [lovableModel, setLovableModel] = useState("");
  const [custom, setCustom] = useState<TargetDraft>(emptyDraft);

  useEffect(() => {
    if (!data) return;
    setLocal({
      baseUrl: data.config.local.baseUrl ?? "",
      apiKey: "",
      keyTouched: false,
      model: data.config.local.model ?? "",
    });
    setHostedProvider(data.config.hosted.provider);
    setLovableModel(data.config.hosted.lovableModel ?? "");
    setCustom({
      baseUrl: data.config.hosted.custom.baseUrl ?? "",
      apiKey: "",
      keyTouched: false,
      model: data.config.hosted.custom.model ?? "",
    });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          local: {
            baseUrl: local.baseUrl.trim() || null,
            apiKey: local.keyTouched ? local.apiKey : null,
            model: local.model.trim() || null,
          },
          hosted: {
            provider: hostedProvider,
            lovableModel: lovableModel.trim() || null,
            custom: {
              baseUrl: custom.baseUrl.trim() || null,
              apiKey: custom.keyTouched ? custom.apiKey : null,
              model: custom.model.trim() || null,
            },
          },
        },
      }),
    onSuccess: () => {
      toast.success("AI engine configuration saved");
      void qc.invalidateQueries({ queryKey: ["ai-engines"] });
      void qc.invalidateQueries({ queryKey: ["ai-routing"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save engines"),
  });

  const lovableMutation = useMutation({
    mutationFn: () => switchToLovable({}),
    onSuccess: (result) => {
      const extras = [
        result.clearedKeys.length ? `cleared ${result.clearedKeys.join(", ")}` : null,
        result.switchedAreas.length
          ? `${result.switchedAreas.length} feature area(s) moved to hosted`
          : null,
      ].filter(Boolean);
      toast.success(
        `Hosted AI is now Lovable AI${extras.length ? ` — ${extras.join("; ")}` : ""}`,
      );
      if (result.envStillSet) {
        toast.warning(
          "CUSTOM_AI_BASE_URL / CUSTOM_AI_API_KEY are still set as deploy env vars — remove them from .env to fully stop custom routing.",
        );
      }
      void qc.invalidateQueries({ queryKey: ["ai-engines"] });
      void qc.invalidateQueries({ queryKey: ["ai-routing"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not switch to Lovable AI"),
  });

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
            Two engines run side by side. Each AI feature area picks one in{" "}
            <Link to="/settings/self-host" className="underline underline-offset-2">
              Self-host settings
            </Link>
            : “Local” uses the self-hosted engine, “Hosted” uses the hosted engine below.
          </p>
        </header>

        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">Loading engine configuration…</p>
        ) : (
          <>
            {/* Local engine */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="h-4 w-4" />
                  Self-hosted (local) engine
                </CardTitle>
                <CardDescription>
                  Any OpenAI-compatible endpoint — the bundled Ollama container by default.
                  Effective now: <code>{data.effective.local.baseUrl}</code> ·{" "}
                  <code>{data.effective.local.model}</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="local-base">Base URL</Label>
                  <Input
                    id="local-base"
                    placeholder={data.defaults.localBaseUrl}
                    value={local.baseUrl}
                    onChange={(e) => setLocal({ ...local, baseUrl: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="local-key">
                    API key {data.config.local.hasApiKey && <Badge variant="secondary">stored</Badge>}
                  </Label>
                  <Input
                    id="local-key"
                    type="password"
                    autoComplete="off"
                    placeholder={data.config.local.hasApiKey ? "•••••• (leave blank to keep)" : "ollama"}
                    value={local.apiKey}
                    onChange={(e) =>
                      setLocal({ ...local, apiKey: e.target.value, keyTouched: true })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="local-model">Model tag</Label>
                  <Input
                    id="local-model"
                    placeholder="llama3.2:3b"
                    value={local.model}
                    onChange={(e) => setLocal({ ...local, model: e.target.value })}
                  />
                </div>
                {data.envCustomAi.baseUrl && (
                  <p className="text-xs text-muted-foreground">
                    Deploy env <code>CUSTOM_AI_BASE_URL={data.envCustomAi.baseUrl}</code> is used
                    when the field above is blank.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Hosted engine */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cloud className="h-4 w-4" />
                  Hosted engine
                  <Badge variant={hostedProvider === "lovable" ? "secondary" : "outline"}>
                    {hostedProvider === "lovable" ? "Lovable AI" : "Alternative provider"}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Used by every feature area marked <strong>Hosted</strong>. Defaults to Lovable
                  AI; flip the switch to send those calls to another provider instead.
                  {data.effective.hosted ? (
                    <>
                      {" "}
                      Effective now: <code>{data.effective.hosted.baseUrl}</code> ·{" "}
                      <code>{data.effective.hosted.model}</code>
                    </>
                  ) : (
                    " Not configured — hosted areas fall back to the local engine."
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="space-y-0.5 pr-4">
                    <Label htmlFor="hosted-toggle">Use an alternative hosted provider</Label>
                    <p className="text-xs text-muted-foreground">
                      Off = Lovable AI Gateway (recommended). On = your own hosted endpoint
                      (OpenRouter, OpenAI, a remote Ollama, …).
                    </p>
                  </div>
                  <Switch
                    id="hosted-toggle"
                    checked={hostedProvider === "custom"}
                    onCheckedChange={(v) => setHostedProvider(v ? "custom" : "lovable")}
                  />
                </div>

                {hostedProvider === "lovable" ? (
                  <div className="space-y-3">
                    {!data.hasLovableApiKey && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                        <span>
                          <code>LOVABLE_API_KEY</code> is not set on the server, so hosted areas
                          currently degrade to the local engine.
                        </span>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor="lovable-model">Default Lovable AI model</Label>
                      <Input
                        id="lovable-model"
                        placeholder={data.defaults.hostedModel}
                        value={lovableModel}
                        onChange={(e) => setLovableModel(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Blank keeps each feature's built-in model choice.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="hosted-base">Base URL</Label>
                      <Input
                        id="hosted-base"
                        placeholder="https://openrouter.ai/api/v1"
                        value={custom.baseUrl}
                        onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="hosted-key">
                        API key{" "}
                        {data.config.hosted.custom.hasApiKey && (
                          <Badge variant="secondary">stored</Badge>
                        )}
                      </Label>
                      <Input
                        id="hosted-key"
                        type="password"
                        autoComplete="off"
                        placeholder={
                          data.config.hosted.custom.hasApiKey
                            ? "•••••• (leave blank to keep)"
                            : "sk-…"
                        }
                        value={custom.apiKey}
                        onChange={(e) =>
                          setCustom({ ...custom, apiKey: e.target.value, keyTouched: true })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="hosted-model">Model id</Label>
                      <Input
                        id="hosted-model"
                        placeholder="openai/gpt-4.1"
                        value={custom.model}
                        onChange={(e) => setCustom({ ...custom, model: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save engines"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => lovableMutation.mutate()}
                    disabled={lovableMutation.isPending || !data.hasLovableApiKey}
                  >
                    {lovableMutation.isPending ? "Switching…" : "Switch to Lovable AI"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  “Switch to Lovable AI” resets the hosted engine to Lovable AI, clears the
                  runtime custom-AI overrides, and routes every hosted-recommended feature area
                  back to hosted.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
