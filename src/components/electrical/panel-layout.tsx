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
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
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
  consumedSlotIndex,
  expectedBreakerNumber,
  freeBreakerSlots,
  multiPoleDuplicates,
  nextExitOrder,
  resolvePanelLayout,
  unrecordedBreakerSlots,
} from "@/lib/electrical-panel-layout";
import { PANEL_EXIT_SIDES } from "@/lib/electrical";
import { breakerRelationshipLabel } from "@/lib/electrical-breaker-reference";

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
  const circuitGroups = (q.data?.circuitGroups ?? []) as Row[];
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
        circuitGroups={circuitGroups}
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

/**
 * Direct field-correction editor for one recorded slot. Amps and notes are
 * typed verbatim from field verification — nothing is derived from label text,
 * and a blank amperage stays unknown rather than becoming a guess.
 */
function BreakerRowEditor({
  panel,
  row,
  onDone,
}: {
  panel: Row;
  row: Row;
  onDone: () => void;
}) {
  const save = useServerFn(saveBreakerPosition);
  const [poles, setPoles] = useState(String(Number(row["poles"] ?? 1)));
  const [amps, setAmps] = useState(row["ocp_amps"] == null ? "" : String(row["ocp_amps"]));
  const [label, setLabel] = useState(String(row["label"] ?? ""));
  const [notes, setNotes] = useState(String(row["notes"] ?? ""));

  const update = useMutation({
    mutationFn: async () =>
      save({
        data: {
          id: String(row["id"]),
          panel_uuid: String(panel["id"]),
          side: String(row["side"]),
          position: Number(row["position"]),
          breaker_number:
            row["breaker_number"] == null ? null : Number(row["breaker_number"]),
          poles: Number(poles) || 1,
          label: label.trim() || null,
          ocp_amps: amps.trim() === "" ? null : Number(amps),
          notes: notes.trim() || null,
          // Preserve recorded wiring links / status: this editor only corrects
          // physical breaker facts, and the server does a full-row update.
          circuit_group_uuid: row["circuit_group_uuid"]
            ? String(row["circuit_group_uuid"])
            : null,
          load_uuid: row["load_uuid"] ? String(row["load_uuid"]) : null,
          install_status: row["install_status"] ? String(row["install_status"]) : null,
        },
      }),
    onSuccess: () => {
      toast.success(`${String(row["side"])} ${String(row["position"])} updated.`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid w-full gap-2 rounded-md border border-border bg-muted/30 p-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <Label className="text-xs">Poles</Label>
        <Input
          inputMode="numeric"
          value={poles}
          onChange={(e) => setPoles(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Breaker amps (A)</Label>
        <Input
          inputMode="numeric"
          placeholder="leave blank if unverified"
          value={amps}
          onChange={(e) => setAmps(e.target.value.replace(/[^\d.]/g, ""))}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Label / served load</Label>
        <Input
          value={label}
          placeholder="leave blank while the load is unidentified"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Field note</Label>
        <Input
          value={notes}
          placeholder='e.g. "loose wire; dining room"'
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex items-end gap-2 lg:col-span-4">
        <Button size="sm" disabled={update.isPending} onClick={() => update.mutate()}>
          {update.isPending ? "Saving…" : "Save correction"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function BreakerPositions({
  panel,
  rows,
  circuitGroups,
  onChanged,
}: {
  panel: Row;
  rows: Row[];
  circuitGroups: Row[];
  onChanged: () => void;
}) {
  // Derived, display-only: PNL-<panel>-B<n> → CG-<site>-<seq> [description].
  // The authoritative identity stays panel UUID + physical position.
  const groupById = useMemo(() => {
    const map = new Map<string, Row>();
    for (const g of circuitGroups) map.set(String(g["id"]), g);
    return map;
  }, [circuitGroups]);
  const relationshipFor = (r: Row): string | null => {
    const group = r["circuit_group_uuid"] ? groupById.get(String(r["circuit_group_uuid"])) : null;
    return breakerRelationshipLabel({
      panel_id: panel["panel_id"] == null ? null : String(panel["panel_id"]),
      breaker_number: r["breaker_number"] as number | null,
      circuit_group_id: group ? String(group["circuit_group_id"]) : null,
      description: group?.["description"] == null ? null : String(group["description"]),
    });
  };
  const layout = useMemo(() => resolvePanelLayout(panel), [panel]);
  const free = useMemo(() => freeBreakerSlots(layout, rows), [layout, rows]);
  // Gaps in the panel's observed range: recorded slots stop at the highest
  // captured position, so 29/31 or Right 2/4 never silently disappear.
  const missing = useMemo(() => unrecordedBreakerSlots(layout, rows), [layout, rows]);

  // Consistency check: one record per physical breaker, so slots consumed by a
  // multi-pole breaker (Right 19 = 38/40 consumes Right 20) must stay empty.
  const consumed = useMemo(() => consumedSlotIndex(layout, rows), [layout, rows]);
  const duplicates = useMemo(() => multiPoleDuplicates(layout, rows), [layout, rows]);
  const duplicateIds = useMemo(
    () => new Set(duplicates.map((d) => d.id).filter(Boolean) as string[]),
    [duplicates],
  );
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
  const [amps, setAmps] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const suggestedBreaker = expectedBreakerNumber(layout, side, Number(position));

  const consumedBy = consumed.get(`${side}#${Number(position)}`);

  const add = useMutation({
    mutationFn: async () => {
      if (consumedBy) {
        throw new Error(
          `${side} ${Number(position)} is consumed by the multi-pole breaker at ${consumedBy.ownerLabel}${consumedBy.ownerBreakers ? ` (${consumedBy.ownerBreakers})` : ""} — that one record already covers this slot.`,
        );
      }
      return save({
        data: {
          panel_uuid: String(panel["id"]),
          side,
          position: Number(position),
          poles: Number(poles) || 1,
          breaker_number: suggestedBreaker,
          circuit_group_uuid: group || null,
          label: label.trim() || null,
          ocp_amps: amps.trim() === "" ? null : Number(amps),
          notes: notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(`${side} ${position} recorded.`);
      setGroup("");
      setLabel("");
      setAmps("");
      setNotes("");
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
        {duplicates.length ? (
          <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {duplicates.length} duplicate slot record{duplicates.length === 1 ? "" : "s"} on a
              multi-pole breaker
            </div>
            {duplicates.map((d) => (
              <div
                key={`${d.side}-${d.position}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="text-muted-foreground">{d.message}</span>
                {d.id ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete the duplicate ${d.side} ${d.position} row? The ${d.ownerLabel} record keeps covering this slot.`,
                        )
                      ) {
                        del.mutate({ table: "breaker_position", id: d.id! });
                      }
                    }}
                  >
                    Delete {d.side} {d.position}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {missing.length ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
            <div className="text-sm font-medium">
              {missing.length} slot{missing.length === 1 ? "" : "s"} with no record yet
            </div>
            <p className="text-xs text-muted-foreground">
              Slots consumed by a multi-pole breaker are excluded. Click one to prefill the add
              form below.
            </p>
            <div className="flex flex-wrap gap-1">
              {missing.map((s) => (
                <Button
                  key={`${s.side}-${s.position}`}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSide(s.side);
                    setPosition(String(s.position));
                  }}
                >
                  {s.side} {s.position} · breaker {s.breaker}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">
            No breaker positions recorded yet. Each row below is one physical space.
          </p>
        ) : (
          <div className="space-y-1 text-sm">
            {rows.map((r) => (
              <div key={String(r["id"])} className="space-y-2 border-b border-border py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">
                    {String(r["side"])} {String(r["position"])}
                  </span>
                  <Badge variant="outline">breaker {String(r["breaker_number"] ?? "—")}</Badge>
                  {relationshipFor(r) ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {relationshipFor(r)}
                    </span>
                  ) : null}
                  {duplicateIds.has(String(r["id"])) ? (
                    <Badge variant="destructive">duplicate of a multi-pole slot</Badge>
                  ) : null}
                  <span className="text-muted-foreground">
                    {Number(r["poles"] ?? 1)}-pole ·{" "}
                    {r["ocp_amps"] == null ? "amps unknown" : `${String(r["ocp_amps"])} A`}
                    {r["label"] ? ` · ${String(r["label"])}` : " · load unidentified"}
                  </span>
                  {r["notes"] ? (
                    <span className="text-xs text-muted-foreground italic">
                      {String(r["notes"])}
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditing((cur) => (cur === String(r["id"]) ? null : String(r["id"])))
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        if (confirm(`Remove ${String(r["side"])} ${String(r["position"])}?`)) {
                          del.mutate({ table: "breaker_position", id: String(r["id"]) });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {editing === String(r["id"]) ? (
                  <BreakerRowEditor
                    panel={panel}
                    row={r}
                    onDone={() => {
                      setEditing(null);
                      onChanged();
                    }}
                  />
                ) : null}
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
            <Label className="text-xs">Breaker amps (A, optional)</Label>
            <Input
              inputMode="numeric"
              placeholder="blank stays unknown"
              value={amps}
              onChange={(e) => setAmps(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">Field note (optional)</Label>
            <Input
              value={notes}
              placeholder='e.g. "loose wire; dining room"'
              onChange={(e) => setNotes(e.target.value)}
            />
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
              disabled={!position || add.isPending || Boolean(consumedBy)}
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
