// AI model picker for any OpenAI-compatible endpoint (richer metadata + pull
// support for Ollama). Extracted from the self-host page so all AI runtime
// controls live together on Admin → AI runtime.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getAiModelPickerState,
  setAiModel,
  pullAiModel,
} from "@/lib/ai-models.functions";
import {
  ModelSuitabilityBadge,
  ModelSuitabilityPanel,
} from "@/components/model-suitability";
import {
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  Download,
  Save,
} from "lucide-react";
function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function ModelPickerCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(getAiModelPickerState);
  const saveFn = useServerFn(setAiModel);
  const pullFn = useServerFn(pullAiModel);

  const state = useQuery({
    queryKey: ["ai-model-picker"],
    queryFn: () => listFn(),
    staleTime: 30 * 1000,
  });

  const [selected, setSelected] = useState<string>("");
  const [pullInput, setPullInput] = useState<string>("");

  const save = useMutation({
    mutationFn: (model: string) => saveFn({ data: { model } }),
    onSuccess: (res) => {
      toast.success(`AI model set to ${res.model}`);
      qc.invalidateQueries({ queryKey: ["ai-model-picker"] });
      qc.invalidateQueries({ queryKey: ["self-host-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pull = useMutation({
    mutationFn: (model: string) => pullFn({ data: { model } }),
    onSuccess: (res) => {
      toast.success(`Pulled ${res.model}`);
      setPullInput("");
      qc.invalidateQueries({ queryKey: ["ai-model-picker"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = state.data;
  // Precedence: user typed in this session > saved current > self-hosted default.
  // This guarantees the picker always lands on the self-hosted default when the
  // operator hasn't explicitly chosen anything else.
  const effective = selected || s?.currentModel || s?.defaultModel || "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI model picker
          {s?.isBundledDefault && (
            <Badge variant="secondary" className="ml-2">
              Self-hosted (default)
            </Badge>
          )}
          {s?.isOllama && !s?.isBundledDefault && (
            <Badge variant="secondary" className="ml-2">
              Ollama
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Endpoint:{" "}
          <code>{s?.baseUrl ?? "(none configured)"}</code>
          {s?.isBundledDefault && (
            <span className="ml-1 text-emerald-700 dark:text-emerald-400">
              (bundled)
            </span>
          )}
          {" · "}Current model:{" "}
          <code>{s?.currentModel ?? "(provider default)"}</code>
          {s && !s.currentModel?.length && s.defaultModel && (
            <span className="ml-1">
              → defaults to <code>{s.defaultModel}</code>
            </span>
          )}
        </div>

        {state.isLoading && (
          <div className="text-sm text-muted-foreground">
            Loading available models…
          </div>
        )}

        {s && !state.isLoading && (
          <>
            {s.error && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100">
                <div className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Couldn't list models
                </div>
                <div className="mt-1 font-mono text-xs">{s.error}</div>
                <div className="mt-1 text-xs">
                  You can still type a model id manually below.
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                {s.models.length > 0 ? (
                  <Select
                    value={effective}
                    onValueChange={setSelected}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a model…" />
                    </SelectTrigger>
                    <SelectContent>
                      {s.models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="font-mono">{m.id}</span>
                          {m.size ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {formatBytes(m.size)}
                              {m.detail ? ` · ${m.detail}` : ""}
                            </span>
                          ) : null}
                          <ModelSuitabilityBadge model={m} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                ) : (
                  <Input
                    placeholder="Model id (e.g. llama3.2:3b)"
                    value={effective}
                    onChange={(e) => setSelected(e.target.value)}
                  />
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => state.refetch()}
                title="Refresh model list"
                disabled={state.isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 ${state.isFetching ? "animate-spin" : ""}`}
                />
              </Button>
              <Button
                variant="ghost"
                onClick={() => setSelected(s.defaultModel)}
                disabled={effective === s.defaultModel || save.isPending}
                title={`Reset selection to self-hosted default (${s.defaultModel})`}
              >
                Self-hosted default
              </Button>
              <Button
                onClick={() => effective && save.mutate(effective)}
                disabled={
                  !effective ||
                  effective === s.currentModel ||
                  save.isPending
                }
              >
                <Save className="h-4 w-4 mr-1" />
                {save.isPending ? "Saving…" : "Save as active"}
              </Button>
            </div>

            {effective && (
              <ModelSuitabilityPanel
                model={
                  s.models.find((m) => m.id === effective) ?? { id: effective }
                }
                showActions={s.isOllama || s.isBundledDefault}
                onModelChanged={(m) => {
                  setSelected(m);
                  qc.invalidateQueries({ queryKey: ["ai-model-picker"] });
                  qc.invalidateQueries({ queryKey: ["self-host-config"] });
                }}
              />

            )}

            <p className="text-xs text-muted-foreground">
              Persists <code>CUSTOM_AI_MODEL</code> to the encrypted secrets
              vault (shared scope). Overrides the environment variable on
              this deployment without a redeploy.
            </p>


            {s.isOllama && (
              <div className="pt-3 border-t space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Pull a new Ollama model
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    className="flex-1"
                    placeholder="qwen2.5:3b, llama3.1:8b, phi3:mini…"
                    value={pullInput}
                    onChange={(e) => setPullInput(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => pullInput.trim() && pull.mutate(pullInput.trim())}
                    disabled={!pullInput.trim() || pull.isPending}
                  >
                    {pull.isPending ? "Pulling…" : "Pull"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Downloads via Ollama's <code>/api/pull</code>. Small models
                  are a few GB; the request stays open until the pull
                  finishes (up to 10 minutes).
                </p>
              </div>
            )}

            {s.models.length > 0 && (
              <div className="pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {s.models.length} model{s.models.length === 1 ? "" : "s"} available
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
