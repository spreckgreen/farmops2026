// Phase 4.3 — panel breaker positions and panel raceway exits.
//
// Both are first-class records, not free text: a breaker position is one
// physical slot in one panel, and an exit is one physical penetration whose
// ORDER is independent of the CON-### identity of the raceway leaving.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2 } from "lucide-react";
import { EntitySelect } from "@/components/electrical/entity-select";
import { electricalEntityOptions } from "@/lib/electrical.functions";
import {
  deletePanelLayoutRow,
  panelLayout,
  saveBreakerPosition,
  savePanelExit,
} from "@/lib/electrical-panel-layout.functions";
import {
  BREAKER_SIDES,
  expectedBreakerNumber,
  freeBreakerSlots,
  nextExitOrder,
  resolvePanelLayout,
} from "@/lib/electrical-panel-layout";
import { PANEL_EXIT_SIDES } from "@/lib/electrical";

type Row = Record<string, string | number | boolean | null>;

export function PanelLayoutPanels({ panelUuid }: { panelUuid: string }) {
  const qc = useQueryClient();
  const load = useServerFn(panelLayout);
  const q = useQuery({
    queryKey: ["electrical", "panel-layout", panelUuid],
    queryFn: () => load({ data: { panel_uuid: panelUuid } }),
  });
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["electrical", "panel-layout", panelUuid] });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.error)
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );

  const panel = (q.data?.panel ?? null) as Row | null;
  const positions = (q.data?.positions ?? []) as Row[];
  const exits = (q.data?.exits ?? []) as Row[];
  const raceways = (q.data?.raceways ?? []) as Row[];
  const findings = q.data?.findings ?? [];
  if (!panel) return null;

  return (
    <div className="space-y-3">
      {findings.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Panel layout QA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {findings.map((f, i) => (
              <p key={`${f.code}-${i}`} className="flex flex-wrap items-center gap-2">
                <Badge variant={f.severity === "error" ? "destructive" : "secondary"}>
                  {f.severity === "error" ? "Error" : "Incomplete"}
                </Badge>
                <span className="text-muted-foreground">{f.message}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <BreakerPositions
        panel={panel}
        rows={positions}
        onChanged={invalidate}
      />
      <PanelExits
        panel={panel}
        rows={exits}
        raceways={raceways}
        onChanged={invalidate}
      />
    </div>
  );
}

function useDelete(onChanged: () => void) {
  const remove = useServerFn(deletePanelLayoutRow);
  return useMutation({
    mutationFn: (input: { table: "breaker_position" | "panel_exit"; id: string }) =>
      remove({ data: input }),
    onSuccess: () => {
      toast.success("Record removed.");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function BreakerPositions({
  panel,
  rows,
  onChanged,
}: {
  panel: Row;
  rows: Row[];
  onChanged: () => void;
}) {
  const layout = useMemo(() => resolvePanelLayout(panel), [panel]);
  const free = useMemo(() => freeBreakerSlots(layout, rows), [layout, rows]);
  const save = useServerFn(saveBreakerPosition);
  const del = useDelete(onChanged);
  const optionsFn = useServerFn(electricalEntityOptions);
  const groups = useQuery({
    queryKey: ["electrical", "options", "circuit_group"],
    queryFn: () => optionsFn({ data: { kinds: ["circuit_group"] } }),
  });

  const first = free[0];
  const [side, setSide] = useState<string>(first?.side ?? "Left");
  const [position, setPosition] = useState<string>(first ? String(first.position) : "1");
  const [poles, setPoles] = useState("1");
  const [group, setGroup] = useState("");
  const [label, setLabel] = useState("");

  const suggestedBreaker = expectedBreakerNumber(layout, side, Number(position));

  const add = useMutation({
    mutationFn: async () =>
      save({
        data: {
          panel_uuid: String(panel["id"]),
          side,
          position: Number(position),
          poles: Number(poles) || 1,
          breaker_number: suggestedBreaker,
          circuit_group_uuid: group || null,
          label: label.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(`${side} ${position} recorded.`);
      setGroup("");
      setLabel("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Breaker positions ({rows.length} of {layout.totalSpaces || "?"} spaces recorded)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Capacity comes from this panel's own configuration ({layout.columns} column
          {layout.columns === 1 ? "" : "s"} × {layout.positionsPerColumn} positions) — never an
          assumed 48-space panel.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">
            No breaker positions recorded yet. Each row below is one physical space.
          </p>
        ) : (
          <div className="space-y-1 text-sm">
            {rows.map((r) => (
              <div
                key={String(r["id"])}
                className="flex flex-wrap items-center gap-2 border-b border-border py-1"
              >
                <span className="font-mono">
                  {String(r["side"])} {String(r["position"])}
                </span>
                <Badge variant="outline">breaker {String(r["breaker_number"] ?? "—")}</Badge>
                <span className="text-muted-foreground">
                  {Number(r["poles"] ?? 1)}-pole
                  {r["label"] ? ` · ${String(r["label"])}` : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive"
                  onClick={() => {
                    if (confirm(`Remove ${String(r["side"])} ${String(r["position"])}?`)) {
                      del.mutate({ table: "breaker_position", id: String(r["id"]) });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Side</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={side}
              onChange={(e) => setSide(e.target.value)}
            >
              {(layout.sides.length ? layout.sides : BREAKER_SIDES).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Position</Label>
            <Input
              inputMode="numeric"
              value={position}
              onChange={(e) => setPosition(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Poles</Label>
            <Input
              inputMode="numeric"
              value={poles}
              onChange={(e) => setPoles(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="lg:col-span-3">
            <EntitySelect
              label="Circuit group (optional)"
              hint="Leave empty while the assignment is unknown — it stays reportable rather than guessed."
              options={groups.data?.["circuit_group"] ?? []}
              loading={groups.isLoading}
              value={group}
              onChange={setGroup}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full gap-1"
              disabled={!position || add.isPending}
              onClick={() => add.mutate()}
            >
              <Plus className="h-4 w-4" />
              Add {side} {position}
              {suggestedBreaker ? ` (breaker ${suggestedBreaker})` : ""}
            </Button>
          </div>
        </div>
        {free.length ? (
          <p className="text-xs text-muted-foreground">
            {free.length} space{free.length === 1 ? "" : "s"} not recorded yet — next free:{" "}
            {free
              .slice(0, 6)
              .map((s) => s.label)
              .join(", ")}
            {free.length > 6 ? " …" : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PanelExits({
  panel,
  rows,
  raceways,
  onChanged,
}: {
  panel: Row;
  rows: Row[];
  raceways: Row[];
  onChanged: () => void;
}) {
  const save = useServerFn(savePanelExit);
  const del = useDelete(onChanged);
  const panelUuid = String(panel["id"]);

  const [order, setOrder] = useState(String(nextExitOrder(rows)));
  const [exitSide, setExitSide] = useState<string>(PANEL_EXIT_SIDES[0]);
  const [raceway, setRaceway] = useState("");
  const [trade, setTrade] = useState("");

  const racewayOptions = useMemo(
    () =>
      raceways.map((r) => ({
        id: String(r["id"]),
        stableId: String(r["conduit_id"] ?? ""),
        label:
          r["source_panel_uuid"] === panelUuid || r["dest_panel_uuid"] === panelUuid
            ? "connects to this panel"
            : "not linked to this panel",
        context: String(r["trade_size"] ?? ""),
        installStatus: "",
      })),
    [raceways, panelUuid],
  );

  const add = useMutation({
    mutationFn: async () =>
      save({
        data: {
          panel_uuid: panelUuid,
          exit_order: Number(order),
          exit_side: exitSide,
          raceway_uuid: raceway || null,
          trade_size: trade.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(`Exit ${order} recorded.`);
      setRaceway("");
      setTrade("");
      setOrder(String(Number(order) + 1));
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Panel raceway exits ({rows.length})</CardTitle>
        <p className="text-sm text-muted-foreground">
          Physical exit order starts at the lower right and runs counterclockwise. Exit order is a
          property of the penetration, not of the raceway's CON-### ID.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">No physical exits recorded yet.</p>
        ) : (
          <div className="space-y-1 text-sm">
            {rows.map((r) => {
              const rw = raceways.find((x) => String(x["id"]) === String(r["raceway_uuid"]));
              return (
                <div
                  key={String(r["id"])}
                  className="flex flex-wrap items-center gap-2 border-b border-border py-1"
                >
                  <span className="font-mono">Exit {String(r["exit_order"])}</span>
                  <Badge variant="outline">{String(r["exit_side"] ?? "side unknown")}</Badge>
                  <span className="font-mono text-muted-foreground">
                    {rw ? String(rw["conduit_id"]) : String(r["raceway_ref"] ?? "no raceway linked")}
                  </span>
                  {r["trade_size"] ? (
                    <span className="text-muted-foreground">{String(r["trade_size"])}</span>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive"
                    onClick={() => {
                      if (confirm(`Remove exit ${String(r["exit_order"])}?`)) {
                        del.mutate({ table: "panel_exit", id: String(r["id"]) });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Exit order</Label>
            <Input
              inputMode="numeric"
              value={order}
              onChange={(e) => setOrder(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Exit side</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={exitSide}
              onChange={(e) => setExitSide(e.target.value)}
            >
              {PANEL_EXIT_SIDES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Trade size (optional)</Label>
            <Input value={trade} onChange={(e) => setTrade(e.target.value)} />
          </div>
          <div className="lg:col-span-3">
            <EntitySelect
              label="Raceway (optional)"
              hint="An exit with no raceway linked yet is incomplete, not invalid."
              options={racewayOptions}
              value={raceway}
              onChange={setRaceway}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full gap-1"
              disabled={!order || add.isPending}
              onClick={() => add.mutate()}
            >
              <Plus className="h-4 w-4" />
              Add exit {order}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
