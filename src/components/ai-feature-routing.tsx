// Per-feature AI routing panel: choose local (self-hosted Ollama) vs hosted
// Lovable AI for each AI feature area, with an optional per-area model override.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_FEATURE_AREAS,
  type AiAreaChoice,
  type AiAreaDef,
  type AiAreaId,
  type AiRoutingConfig,
} from "@/lib/ai-feature-areas";
import { getAiRouting, resetAiRouting, setAiRouting } from "@/lib/ai-routing.functions";

const GROUP_ORDER: AiAreaDef["group"][] = [
  "Summaries",
  "Knowledge",
  "Service schedule",
  "Food preservation",
  "Diagnostics",
];

const LOAD_LABEL: Record<AiAreaDef["load"], string> = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
};

export function AiFeatureRouting() {
  const queryClient = useQueryClient();
  const load = useServerFn(getAiRouting);
  const save = useServerFn(setAiRouting);
  const reset = useServerFn(resetAiRouting);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-routing"],
    queryFn: () => load({}),
  });

  const [draft, setDraft] = useState<AiRoutingConfig | null>(null);

  useEffect(() => {
    if (data?.config) setDraft(data.config);
  }, [data?.config]);

  const saveMut = useMutation({
    mutationFn: (config: AiRoutingConfig) => save({ data: config }),
    onSuccess: () => {
      toast.success("Feature routing saved");
      queryClient.invalidateQueries({ queryKey: ["ai-routing"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save routing"),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({}),
    onSuccess: (res) => {
      setDraft(res.config as AiRoutingConfig);
      toast.success("Restored recommended defaults");
      queryClient.invalidateQueries({ queryKey: ["ai-routing"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not reset routing"),
  });

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      areas: AI_FEATURE_AREAS.filter((a) => a.group === group),
    })).filter((g) => g.areas.length > 0);
  }, []);

  const setArea = (id: AiAreaId, patch: { backend?: AiAreaChoice; model?: string | null }) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev.areas[id] ?? { backend: "default" as AiAreaChoice, model: null };
      return {
        ...prev,
        areas: { ...prev.areas, [id]: { ...current, ...patch } },
      };
    });
  };

  const hostedAvailable = data?.hostedAvailable ?? false;
  const localModel = data?.activeLocalModel ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Feature AI routing</CardTitle>
        <p className="text-sm text-muted-foreground">
          Send light work to your local model and heavy work (weekly through yearly
          reports, manuals, consultant chat) to hosted AI. Local model:{" "}
          <span className="font-mono">{localModel ?? "not set"}</span>
          {hostedAvailable ? "" : " — hosted AI is not configured yet."}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading || !draft ? (
          <p className="text-sm text-muted-foreground">Loading routing…</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="auto-fallback">Auto-fallback to hosted AI</Label>
                <p className="text-xs text-muted-foreground">
                  When a local call errors or looks truncated, rerun it on hosted AI
                  once and tell you it happened.
                </p>
              </div>
              <Switch
                id="auto-fallback"
                checked={draft.autoFallback}
                onCheckedChange={(v) =>
                  setDraft((prev) => (prev ? { ...prev, autoFallback: v } : prev))
                }
              />
            </div>

            {grouped.map(({ group, areas }) => (
              <div key={group} className="space-y-3">
                <h3 className="text-sm font-semibold">{group}</h3>
                <div className="space-y-3">
                  {areas.map((area) => {
                    const route =
                      draft.areas[area.id] ?? { backend: "default" as AiAreaChoice, model: null };
                    const offRecommendation =
                      route.backend !== "default" && route.backend !== area.recommended;
                    return (
                      <div
                        key={area.id}
                        className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{area.label}</span>
                            <Badge variant="outline">{LOAD_LABEL[area.load]}</Badge>
                            <Badge variant="secondary">
                              recommended: {area.recommended}
                            </Badge>
                            {offRecommendation && route.backend === "local" && area.load === "heavy" ? (
                              <Badge variant="destructive">
                                needs ≥ {Math.round(area.minContext / 1024)}k context
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">{area.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={route.backend}
                            onValueChange={(v) =>
                              setArea(area.id, { backend: v as AiAreaChoice })
                            }
                          >
                            <SelectTrigger className="w-[130px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Global default</SelectItem>
                              <SelectItem value="local">Local</SelectItem>
                              <SelectItem value="hosted">Hosted</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            className="w-[190px] font-mono text-xs"
                            placeholder="model override (optional)"
                            value={route.model ?? ""}
                            onChange={(e) =>
                              setArea(area.id, { model: e.target.value.trim() || null })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => draft && saveMut.mutate(draft)}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? "Saving…" : "Save routing"}
              </Button>
              <Button
                variant="outline"
                onClick={() => resetMut.mutate()}
                disabled={resetMut.isPending}
              >
                Restore recommended defaults
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
