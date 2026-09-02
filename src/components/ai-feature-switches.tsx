// Admin card: turn each AI feature area on or off.
//
// An "off" feature refuses to resolve a provider, so every call path (report
// generation, electrical assistant, maintenance briefing…) fails fast with a
// plain message instead of quietly spending money.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Power, PowerOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AI_FEATURE_AREAS, type AiAreaId } from "@/lib/ai-feature-areas";
import { getAiFeatureToggles, setAiFeatureToggle } from "@/lib/ai-usage.functions";
import type { AiFeatureToggle } from "@/lib/ai-usage";

export function AiFeatureSwitches() {
  const qc = useQueryClient();
  const listFn = useServerFn(getAiFeatureToggles);
  const saveFn = useServerFn(setAiFeatureToggle);
  const [busy, setBusy] = useState<AiAreaId | null>(null);

  const q = useQuery<AiFeatureToggle[]>({
    queryKey: ["admin", "ai-feature-toggles"],
    queryFn: () => listFn(),
  });

  const state = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of q.data ?? []) map.set(row.area, row.enabled);
    return map;
  }, [q.data]);

  const mut = useMutation({
    mutationFn: (vars: { area: AiAreaId; enabled: boolean }) =>
      saveFn({ data: { area: vars.area, enabled: vars.enabled } }),
    onMutate: (vars) => setBusy(vars.area),
    onSuccess: (_r, vars) => {
      toast.success(`${vars.enabled ? "Enabled" : "Turned off"} this AI feature.`);
      qc.invalidateQueries({ queryKey: ["admin", "ai-feature-toggles"] });
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setBusy(null),
  });

  const groups = useMemo(() => {
    const by = new Map<string, typeof AI_FEATURE_AREAS[number][]>();
    for (const area of AI_FEATURE_AREAS) {
      const list = by.get(area.group) ?? [];
      list.push(area);
      by.set(area.group, list);
    }
    return Array.from(by.entries());
  }, []);

  const offCount = (q.data ?? []).filter((r) => !r.enabled).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Power className="h-4 w-4" />
          AI feature switches
          {offCount > 0 && (
            <Badge variant="destructive" className="ml-1 text-[10px]">
              {offCount} off
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Turning a feature off blocks every AI call for it — self-hosted and cloud
          alike — so it can never run up a bill. Routing and model choices are kept,
          so switching it back on restores the previous setup.
        </p>

        {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {q.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(q.error as Error).message}
          </div>
        )}

        {groups.map(([group, areas]) => (
          <div key={group} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </div>
            {areas.map((area) => {
              const enabled = state.get(area.id) ?? true;
              return (
                <div
                  key={area.id}
                  className="flex items-start justify-between gap-4 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {area.label}
                      {!enabled && (
                        <Badge variant="destructive" className="text-[10px]">
                          <PowerOff className="h-3 w-3 mr-1" />
                          off
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{area.description}</div>
                    <div className="text-[11px] font-mono text-muted-foreground mt-1">
                      {area.id}
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={busy === area.id || q.isLoading}
                    onCheckedChange={(on) => mut.mutate({ area: area.id, enabled: on })}
                    aria-label={`${area.label} enabled`}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
