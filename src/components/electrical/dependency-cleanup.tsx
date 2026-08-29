// Guided cleanup for the delete dependency breakdown.
//
// Walks one blocking reference at a time and offers the two safe resolutions:
// unlink the reference, or reassign it to another record of the same kind.
// Only the FK column is written — read-only ODS/legacy design refs are never
// rewritten here, and no record is deleted or recreated.
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  electricalEntityOptions,
  resolveElectricalReference,
} from "@/lib/electrical.functions";
import { ENTITIES } from "@/lib/electrical-entities";
import type { DependencyReport } from "@/lib/electrical-dependents";
import type { ElectricalEntityKind } from "@/lib/electrical";
import { EntitySelect } from "@/components/electrical/entity-select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ExternalLink, Link2Off, Wand2 } from "lucide-react";

interface Step {
  kind: ElectricalEntityKind;
  title: string;
  fkColumn: string;
  fieldLabel: string;
  rowId: string;
  stableId: string;
  description: string | null;
}

function stepsFrom(report: DependencyReport): Step[] {
  return report.groups.flatMap((g) =>
    g.rows.map((r) => ({
      kind: g.kind,
      title: g.title,
      fkColumn: g.fkColumn,
      fieldLabel: g.fieldLabel,
      rowId: r.id,
      stableId: r.stableId,
      description: r.description,
    })),
  );
}

export function DependencyCleanup({
  report,
  targetKind,
  targetId,
  singular,
  onNavigate,
  onResolved,
}: {
  report: DependencyReport;
  /** Kind of the record being deleted — reassignment targets share it. */
  targetKind: ElectricalEntityKind;
  /** Row id of the record being deleted; excluded from reassignment options. */
  targetId: string;
  singular: string;
  onNavigate: () => void;
  onResolved: () => void;
}) {
  const qc = useQueryClient();
  const steps = useMemo(() => stepsFrom(report), [report]);
  const [index, setIndex] = useState(0);
  const [replacement, setReplacement] = useState("");

  const fetchOptions = useServerFn(electricalEntityOptions);
  const options = useQuery({
    queryKey: ["electrical", "options", targetKind],
    queryFn: () => fetchOptions({ data: { kinds: [targetKind] } }),
  });

  const resolve = useServerFn(resolveElectricalReference);
  const apply = useMutation({
    mutationFn: async (vars: { step: Step; targetId: string | null }) =>
      resolve({
        data: {
          kind: vars.step.kind,
          id: vars.step.rowId,
          fkColumn: vars.step.fkColumn,
          targetId: vars.targetId,
        },
      }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.targetId
          ? `${vars.step.stableId}: ${vars.step.fieldLabel} reassigned`
          : `${vars.step.stableId}: ${vars.step.fieldLabel} unlinked`,
      );
      setReplacement("");
      void qc.invalidateQueries({ queryKey: ["electrical"] });
      onResolved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const step = steps[Math.min(index, steps.length - 1)];
  if (!step) return null;

  const choices = (options.data?.[targetKind] ?? []).filter((o) => o.id !== targetId);
  const done = report.groups.length ? steps.length : 0;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4" />
          Guided cleanup
        </p>
        <Badge variant="secondary">
          {index + 1} of {steps.length}
        </Badge>
      </div>
      <Progress value={((index + 1) / Math.max(done, 1)) * 100} className="h-1.5" />

      <div className="space-y-1 text-sm">
        <p>
          <span className="text-muted-foreground">{step.title} · </span>
          <Link
            to="/electrical/item/$kind/$id"
            params={{ kind: step.kind, id: step.rowId }}
            className="inline-flex items-center gap-1 font-mono text-primary underline-offset-2 hover:underline"
            onClick={onNavigate}
          >
            {step.stableId || step.rowId}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
        {step.description ? (
          <p className="text-muted-foreground">{step.description}</p>
        ) : null}
        <p className="text-muted-foreground">
          Field <span className="font-medium text-foreground">{step.fieldLabel}</span> points at this{" "}
          {singular}. Unlink it, or reassign it to another{" "}
          {ENTITIES[targetKind].singular}.
        </p>
      </div>

      <EntitySelect
        label={`Reassign ${step.fieldLabel} to`}
        hint="Legacy ODS design references are left untouched."
        options={choices}
        loading={options.isPending}
        value={replacement}
        onChange={setReplacement}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={apply.isPending}
          onClick={() => apply.mutate({ step, targetId: null })}
        >
          <Link2Off className="h-4 w-4" />
          Unlink
        </Button>
        <Button
          size="sm"
          disabled={apply.isPending || !replacement}
          onClick={() => apply.mutate({ step, targetId: replacement })}
        >
          {apply.isPending ? "Saving…" : "Reassign"}
        </Button>
        {steps.length > 1 ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={apply.isPending}
            onClick={() => {
              setReplacement("");
              setIndex((i) => (i + 1) % steps.length);
            }}
          >
            Skip
          </Button>
        ) : null}
      </div>
    </div>
  );
}
