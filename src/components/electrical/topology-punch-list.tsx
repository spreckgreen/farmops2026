// Installation punch list for raceways whose as-built topology is not yet
// established. The ODS design From/To text is shown read-only beside the
// FarmOps relational selectors — nothing is ever guessed or written until the
// operator picks a record and saves.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EntitySelect } from "@/components/electrical/entity-select";
import { electricalEntityOptions, saveElectrical } from "@/lib/electrical.functions";
import type { TopologyGap, TopologySlot } from "@/lib/electrical-topology-resolve";
import { installStatusLabel } from "@/lib/electrical";
import { CheckCircle2, Wand2 } from "lucide-react";

type Kind = "panel" | "jbox";

const COLUMN: Record<"source" | "dest", Record<Kind, string>> = {
  source: { panel: "source_panel_uuid", jbox: "source_jbox_uuid" },
  dest: { panel: "dest_panel_uuid", jbox: "dest_jbox_uuid" },
};

export function TopologyPunchList({
  gaps,
  loading,
  summary,
}: {
  gaps: TopologyGap[];
  loading?: boolean;
  summary?: { raceways: number; openSlots: number; proposals: number; unresolved: number };
}) {
  const options = useServerFn(electricalEntityOptions);
  const optionsQuery = useQuery({
    queryKey: ["electrical", "options", "endpoints"],
    queryFn: () => options({ data: { kinds: ["panel", "jbox"] } }),
  });

  if (loading) return <Skeleton className="h-32 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resolve topology</CardTitle>
        <p className="text-sm text-muted-foreground">
          Raceways with engineering design values but no as-built endpoint record. Incomplete, not
          invalid — pick the physical source and destination as installation progresses.
        </p>
        {summary ? (
          <div className="flex flex-wrap gap-2 pt-1 text-sm">
            <Badge variant="secondary">{summary.raceways} raceways</Badge>
            <Badge variant="outline">{summary.openSlots} open endpoints</Badge>
            <Badge variant="outline">{summary.proposals} proposed</Badge>
            <Badge variant="outline">{summary.unresolved} need a decision</Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {!gaps.length ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Every raceway has both endpoints linked to a record.
          </p>
        ) : (
          gaps.map((gap) => (
            <GapRow
              key={gap.id}
              gap={gap}
              panels={optionsQuery.data?.["panel"] ?? []}
              jboxes={optionsQuery.data?.["jbox"] ?? []}
              loadingOptions={optionsQuery.isLoading}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function GapRow({
  gap,
  panels,
  jboxes,
  loadingOptions,
}: {
  gap: TopologyGap;
  panels: { id: string; stableId: string; label: string; context: string; installStatus: string }[];
  jboxes: { id: string; stableId: string; label: string; context: string; installStatus: string }[];
  loadingOptions: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveElectrical);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const combined = useMemo(
    () => [
      ...panels.map((o) => ({ ...o, kind: "panel" as Kind })),
      ...jboxes.map((o) => ({ ...o, kind: "jbox" as Kind })),
    ],
    [panels, jboxes],
  );

  const mutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) =>
      save({ data: { kind: "raceway", id: gap.id, values } }),
    onSuccess: () => {
      toast.success(`${gap.conduitId} topology updated`);
      void qc.invalidateQueries({ queryKey: ["electrical"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function link(slot: "source" | "dest", kind: Kind, id: string) {
    const cols = COLUMN[slot];
    mutation.mutate({ [cols[kind]]: id, [cols[kind === "panel" ? "jbox" : "panel"]]: null });
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm font-medium">{gap.conduitId}</span>
        {gap.routeGroup ? <Badge variant="outline">{gap.routeGroup}</Badge> : null}
        {gap.installStatus ? (
          <Badge variant="secondary">{installStatusLabel(gap.installStatus)}</Badge>
        ) : null}
        <span className="text-sm text-muted-foreground">{gap.description}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {gap.slots.map((slot) => (
          <SlotEditor
            key={slot.slot}
            slot={slot}
            options={combined}
            loading={loadingOptions}
            value={picked[slot.slot] ?? slot.linkedId ?? ""}
            busy={mutation.isPending}
            onPick={(id) => {
              setPicked((p) => ({ ...p, [slot.slot]: id }));
              const hit = combined.find((o) => o.id === id);
              if (hit) link(slot.slot, hit.kind, id);
            }}
            onAcceptProposal={() => {
              if (slot.proposalId && slot.proposalKind)
                link(slot.slot, slot.proposalKind, slot.proposalId);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SlotEditor({
  slot,
  options,
  loading,
  value,
  busy,
  onPick,
  onAcceptProposal,
}: {
  slot: TopologySlot;
  options: {
    id: string;
    stableId: string;
    label: string;
    context: string;
    installStatus: string;
    kind: Kind;
  }[];
  loading: boolean;
  value: string;
  busy: boolean;
  onPick: (id: string) => void;
  onAcceptProposal: () => void;
}) {
  const title = slot.slot === "source" ? "Source" : "Destination";
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{title} endpoint</p>
        <p className="text-xs text-muted-foreground">
          Design / Legacy {slot.slot === "source" ? "From" : "To"}:{" "}
          <span className="font-mono">{slot.designText || "—"}</span>
          {slot.legacyRef ? (
            <>
              {" · ref "}
              <span className="font-mono">{slot.legacyRef}</span>
            </>
          ) : null}
        </p>
      </div>
      <EntitySelect
        label={`As-built ${title.toLowerCase()} record`}
        options={options}
        loading={loading || busy}
        value={value}
        onChange={onPick}
        hint={slot.reason}
      />
      {slot.proposalId && !slot.linkedId ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={busy}
          onClick={onAcceptProposal}
        >
          <Wand2 className="h-4 w-4" />
          Use {slot.proposalStableId}
        </Button>
      ) : null}
    </div>
  );
}
