// Field audit sheet — a tablet-first checklist for recording install progress
// while walking the job. Big tap targets, one row per real record, and each tap
// writes straight to the authoritative electrical tables.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUiChoice, useUiFlag } from "@/hooks/use-ui-preference";
import { loadInstallProgress } from "@/lib/electrical-install-progress.functions";
import { recordAuditSheetEntry } from "@/lib/electrical-audit-sheet.functions";
import { loadAuditHolds } from "@/lib/electrical-panel-completeness.functions";
import { panelCompletenessFromSnapshot } from "@/lib/electrical-panel-completeness";
import { PanelCompletenessCard } from "@/components/electrical/panel-completeness-card";
import {
  QUICK_STAGES,
  STAGE_HELP,
  STAGE_ORDER,
  buildAuditSheet,
  nextStage,
  stageLabel,
  type AuditProgress,
  type AuditSheetRow,
  type AuditTargetKind,
} from "@/lib/electrical-audit-sheet";

const KIND_CHOICES = ["all", "panel", "position", "circuit", "load"] as const;
type KindChoice = (typeof KIND_CHOICES)[number];

const KIND_LABEL: Record<AuditTargetKind, string> = {
  panel: "Panel",
  position: "Breaker",
  circuit: "Circuit",
  load: "Load",
};

function ProgressBar({ progress }: { progress: AuditProgress }) {
  const pct = progress.percent ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="block w-full space-y-1 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="What do the install stages mean?"
        >
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress.done} of {progress.total} finished ·{" "}
            {progress.percent == null ? "no staged rows to score" : `${progress.percent}% through the stages`}
            {progress.offScheme ? ` · ${progress.offScheme} with an unrecognised status` : ""}
            {" · "}
            <span className="underline underline-offset-2">what do the stages mean?</span>
          </p>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2">
        <p className="text-sm font-medium">Install stages, in order</p>
        <ol className="space-y-1.5">
          {STAGE_ORDER.map((stage, i) => {
            const count = progress.byStage[stage] ?? 0;
            return (
              <li key={stage} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 w-4 shrink-0 text-right tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <div className="min-w-0">
                  <p className="font-medium leading-tight">
                    {stageLabel(stage)}
                    {count ? (
                      <span className="ml-1 font-normal text-muted-foreground">({count} here)</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground">{STAGE_HELP[stage]}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          Tap the button on a row to move that item to its next stage.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SheetRow({
  row,
  onRecord,
  busy,
}: {
  row: AuditSheetRow;
  onRecord: (input: {
    kind: AuditTargetKind;
    uuid: string;
    installStatus?: string;
    notes?: string;
  }) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(row.notes);
  const advance = nextStage(row.status);
  return (
    <li className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="shrink-0">
              {KIND_LABEL[row.kind]}
            </Badge>
            <span className="truncate font-mono text-base font-semibold">{row.title}</span>
            {row.done ? (
              <Badge className="shrink-0 gap-1">
                <Check className="h-3 w-3" /> {stageLabel(row.status)}
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="max-w-[14rem] shrink-0 truncate"
                title={stageLabel(row.status)}
              >
                {stageLabel(row.status)}
              </Badge>
            )}
            {row.verification ? (
              <Badge variant="outline" className="shrink-0">
                field: {stageLabel(row.verification)}
              </Badge>
            ) : null}
          </div>
          {row.subtitle ? (
            <p className="text-sm text-muted-foreground">{row.subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {advance ? (
            <Button
              size="lg"
              className="h-12 min-w-[8.5rem] text-sm"
              disabled={busy}
              onClick={() =>
                onRecord({ kind: row.kind, uuid: row.uuid, installStatus: advance })
              }
            >
              <ChevronRight className="mr-1 h-4 w-4" />
              {stageLabel(advance)}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            className="h-11"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Close" : "More"}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_STAGES.map((s) => (
              <Button
                key={s}
                size="lg"
                variant={row.status === s ? "default" : "outline"}
                className="h-12 flex-1 basis-[9rem] text-sm"
                disabled={busy}
                onClick={() => onRecord({ kind: row.kind, uuid: row.uuid, installStatus: s })}
              >
                {stageLabel(s)}
              </Button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`stage-${row.key}`} className="text-xs">
                Set any stage
              </Label>
              <Select
                value={STAGE_ORDER.includes(row.status) ? row.status : undefined}
                onValueChange={(v) => onRecord({ kind: row.kind, uuid: row.uuid, installStatus: v })}
              >
                <SelectTrigger id={`stage-${row.key}`} className="h-12">
                  <SelectValue placeholder="not recorded" />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {stageLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`notes-${row.key}`} className="text-xs">
              Field note
            </Label>
            <Textarea
              id={`notes-${row.key}`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What you saw — kept with this record."
            />
            <Button
              size="lg"
              variant="secondary"
              className="h-11"
              disabled={busy || notes === row.notes}
              onClick={() => onRecord({ kind: row.kind, uuid: row.uuid, notes })}
            >
              Save note
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AuditSheet() {
  const fetcher = useServerFn(loadInstallProgress);
  const record = useServerFn(recordAuditSheetEntry);
  const queryClient = useQueryClient();
  const snapshot = useQuery({ queryKey: ["install-progress"], queryFn: () => fetcher() });

  const [panelChoice, setPanelChoice] = useState<string>("all");
  const [kindChoice, setKindChoice] = useUiChoice<KindChoice>(
    "electrical.audit_sheet.kind",
    "farmops.audit-sheet.kind",
    KIND_CHOICES,
    "all",
  );
  const [hideDone, setHideDone] = useUiFlag(
    "electrical.audit_sheet.hide_done",
    "farmops.audit-sheet.hide-done",
    false,
  );
  const [query, setQuery] = useState("");

  const save = useMutation({
    mutationFn: (input: {
      kind: AuditTargetKind;
      uuid: string;
      installStatus?: string;
      notes?: string;
    }) => record({ data: input as never }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["install-progress"] });
      toast.success("Recorded");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not record that entry"),
  });

  const sheet = useMemo(() => {
    if (!snapshot.data) return null;
    return buildAuditSheet(snapshot.data, {
      panelId: panelChoice === "all" ? null : panelChoice,
      kinds: kindChoice === "all" ? null : [kindChoice as AuditTargetKind],
      hideDone,
      query,
    });
  }, [snapshot.data, panelChoice, kindChoice, hideDone, query]);

  const holdsFetcher = useServerFn(loadAuditHolds);
  const holds = useQuery({
    queryKey: ["electrical", "audit-holds"],
    queryFn: () => holdsFetcher(),
  });

  // Panel completeness is always recalculated from the snapshot; no panel
  // percentage is stored as authoritative data.
  const completeness = useMemo(() => {
    if (!snapshot.data) return [];
    const holdRows = holds.data ?? [];
    return snapshot.data.panels
      .filter((p) => panelChoice === "all" || p.panel_id === panelChoice)
      .map((p) =>
        panelCompletenessFromSnapshot(snapshot.data!, p.id, {
          holds: holdRows
            .filter((h) => (h.panel_ref ?? "") === p.panel_id)
            .map((h) => ({
              ref: h.location ? `${h.ref} (${h.location})` : h.ref,
              reason: `${h.reason} [${h.batch_id}]`,
              kind: h.kind,
            })),
          evidenceSource:
            holdRows.find((h) => (h.panel_ref ?? "") === p.panel_id)?.batch_id ??
            "stored electrical records",
        }),
      )
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .filter((r) => r.capacity.usablePositions > 0 || r.rollout.inScopeCircuits > 0);
  }, [snapshot.data, holds.data, panelChoice]);

  const panelOptions = useMemo(
    () => (snapshot.data ? buildAuditSheet(snapshot.data).panelOptions : []),
    [snapshot.data],
  );

  if (snapshot.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (snapshot.error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive">
          {snapshot.error instanceof Error ? snapshot.error.message : "Could not load the sheet."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="sticky top-0 z-10 shadow-sm">
        <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pb-2 sm:flex sm:justify-between">
          <CardTitle className="min-w-0 truncate text-base">
            Audit sheet{" "}
            <span className="font-normal text-muted-foreground">
              {sheet ? `· ${sheet.rowCount} rows` : ""}
            </span>
          </CardTitle>
          <Button
            variant="outline"
            size="lg"
            className="h-11 shrink-0"
            onClick={() => snapshot.refetch()}
            disabled={snapshot.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${snapshot.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {sheet ? <ProgressBar progress={sheet.overall} /> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="sheet-panel" className="text-xs">
                Panel
              </Label>
              <Select value={panelChoice} onValueChange={setPanelChoice}>
                <SelectTrigger id="sheet-panel" className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All panels</SelectItem>
                  {panelOptions.map((p) => (
                    <SelectItem key={p.panelId} value={p.panelId}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sheet-kind" className="text-xs">
                Show
              </Label>
              <Select value={kindChoice} onValueChange={(v) => setKindChoice(v as KindChoice)}>
                <SelectTrigger id="sheet-kind" className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything</SelectItem>
                  <SelectItem value="panel">Panels only</SelectItem>
                  <SelectItem value="position">Breakers only</SelectItem>
                  <SelectItem value="circuit">Circuits only</SelectItem>
                  <SelectItem value="load">Loads only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sheet-search" className="text-xs">
                Find
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="sheet-search"
                  className="h-12 pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ID, description, note"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Finished rows</Label>
              <Button
                variant={hideDone ? "default" : "outline"}
                size="lg"
                className="h-12 w-full"
                onClick={() => setHideDone(!hideDone)}
              >
                {hideDone ? "Hidden" : "Shown"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {completeness.map((r) => (
        <PanelCompletenessCard key={r.panel_id} result={r} />
      ))}

      {sheet && sheet.groups.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Nothing matches these filters. Clear the search or show finished rows.
          </CardContent>
        </Card>
      ) : null}

      {sheet?.groups.map((g) => (
        <Card key={g.panelId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {g.panelLabel}{" "}
              <span className="font-normal text-muted-foreground">· {g.rows.length} rows</span>
            </CardTitle>
            <ProgressBar progress={g.progress} />
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {g.rows.map((row) => (
                <SheetRow
                  key={row.key}
                  row={row}
                  busy={save.isPending}
                  onRecord={(input) => save.mutate(input)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
