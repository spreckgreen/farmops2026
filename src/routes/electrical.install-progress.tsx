// Install progress: record what is actually installed, panel by panel —
// panel status, breaker positions, circuits, and the loads wired to each
// circuit. These are the same records /electrical/wiring and the critical-load
// study read, so anything recorded here shows up there immediately.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PanelCompletenessCard } from "@/components/electrical/panel-completeness-card";
import { panelCompletenessFromSnapshot } from "@/lib/electrical-panel-completeness";
import { loadAuditHolds } from "@/lib/electrical-panel-completeness.functions";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { PersistedSection, setPersistedSectionsOpen } from "@/components/electrical/persisted-section";
import { GridOperationalMap } from "@/components/electrical/grid-operational-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INSTALL_STATUSES,
  LABEL_STATUSES,
  loadInstallProgress,
  savePanelInstall,
  saveBreakerPosition,
  saveCircuitInstall,
  wireLoadsToCircuit,
  type InstallCircuit,
  type InstallProgressSnapshot,
} from "@/lib/electrical-install-progress.functions";
import { Plug, RefreshCw, Save } from "lucide-react";

export const Route = createFileRoute("/electrical/install-progress")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Install Progress — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Record which panels, breakers and circuits are actually installed, and wire loads to circuits so the wiring page and critical-load study use real data.",
      },
      { property: "og:title", content: "Install Progress — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "Field entry for installed panel status, breaker positions, circuits and load connections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InstallProgressPage,
});

const statusLabel = (s: string) => s.replace(/_/g, " ");

function StatusSelect({
  value,
  onChange,
  options,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {statusLabel(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PanelForm({
  snapshot,
  panelUuid,
  onSaved,
}: {
  snapshot: InstallProgressSnapshot;
  panelUuid: string;
  onSaved: () => void;
}) {
  const panel = snapshot.panels.find((p) => p.id === panelUuid)!;
  const save = useServerFn(savePanelInstall);
  const known = (INSTALL_STATUSES as readonly string[]).includes(panel.install_status ?? "");
  const [status, setStatus] = useState(known ? panel.install_status! : "planned");
  const [labelStatus, setLabelStatus] = useState(
    (LABEL_STATUSES as readonly string[]).includes(panel.label_status ?? "")
      ? panel.label_status!
      : "none",
  );
  const [percent, setPercent] = useState(String(panel.completion_percent ?? 0));
  const [spaces, setSpaces] = useState(panel.spaces == null ? "" : String(panel.spaces));
  const [notes, setNotes] = useState(panel.notes ?? "");

  useEffect(() => {
    const ok = (INSTALL_STATUSES as readonly string[]).includes(panel.install_status ?? "");
    setStatus(ok ? panel.install_status! : "planned");
    setLabelStatus(
      (LABEL_STATUSES as readonly string[]).includes(panel.label_status ?? "")
        ? panel.label_status!
        : "none",
    );
    setPercent(String(panel.completion_percent ?? 0));
    setSpaces(panel.spaces == null ? "" : String(panel.spaces));
    setNotes(panel.notes ?? "");
  }, [panel.id, panel.install_status, panel.label_status, panel.completion_percent, panel.spaces, panel.notes]);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          panelUuid,
          installStatus: status as (typeof INSTALL_STATUSES)[number],
          labelStatus: labelStatus as (typeof LABEL_STATUSES)[number],
          completionPercent: percent,
          spaces,
          notes,
        },
      }),
    onSuccess: () => {
      toast.success(`${panel.panel_id} install state recorded`);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {!known && panel.install_status && (
        <p className="text-xs text-destructive">
          The imported install status on this panel ("{panel.install_status}") is not a recognised
          install state. Saving replaces it with the value you pick here; the original text stays in
          the record history.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="panel-status">Install state</Label>
          <StatusSelect id="panel-status" value={status} onChange={setStatus} options={INSTALL_STATUSES} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="panel-label">Label state</Label>
          <StatusSelect id="panel-label" value={labelStatus} onChange={setLabelStatus} options={LABEL_STATUSES} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="panel-percent">Complete (%)</Label>
          <Input id="panel-percent" value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="panel-spaces">Breaker spaces</Label>
          <Input id="panel-spaces" value={spaces} onChange={(e) => setSpaces(e.target.value)} inputMode="numeric" placeholder="e.g. 42" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="panel-notes">Field notes</Label>
        <Textarea id="panel-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        <Save className="mr-1.5 h-4 w-4" /> Save panel state
      </Button>
    </div>
  );
}

function CircuitForm({
  panelUuid,
  panelId,
  circuit,
  onSaved,
  onCancel,
}: {
  panelUuid: string;
  panelId: string;
  circuit: InstallCircuit | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const save = useServerFn(saveCircuitInstall);
  const [circuitId, setCircuitId] = useState(circuit?.circuit_group_id ?? "");
  const [description, setDescription] = useState(circuit?.description ?? "");
  const [breaker, setBreaker] = useState(circuit?.breaker_number == null ? "" : String(circuit.breaker_number));
  const [rating, setRating] = useState(circuit?.circuit_rating_amps == null ? "" : String(circuit.circuit_rating_amps));
  const [voltage, setVoltage] = useState(circuit?.voltage == null ? "" : String(circuit.voltage));
  const [status, setStatus] = useState(
    (INSTALL_STATUSES as readonly string[]).includes(circuit?.install_status ?? "")
      ? circuit!.install_status!
      : "planned",
  );
  const [notes, setNotes] = useState(circuit?.notes ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          circuitUuid: circuit?.id,
          panelUuid,
          circuitGroupId: circuitId.trim(),
          description,
          breakerNumber: breaker,
          ratingAmps: rating,
          voltage,
          installStatus: status as (typeof INSTALL_STATUSES)[number],
          notes,
        },
      }),
    onSuccess: () => {
      toast.success(circuit ? `${circuitId} updated` : `${circuitId} added to ${panelId}`);
      if (!circuit) {
        setCircuitId("");
        setDescription("");
        setBreaker("");
        setRating("");
        setVoltage("");
        setNotes("");
      }
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Circuit ID</Label>
          <Input value={circuitId} onChange={(e) => setCircuitId(e.target.value)} placeholder="e.g. CG-FS-NE-12" />
        </div>
        <div className="space-y-1">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. East wall receptacles" />
        </div>
        <div className="space-y-1">
          <Label>Breaker number</Label>
          <Input value={breaker} onChange={(e) => setBreaker(e.target.value)} inputMode="numeric" />
        </div>
        <div className="space-y-1">
          <Label>Breaker rating (A)</Label>
          <Input value={rating} onChange={(e) => setRating(e.target.value)} inputMode="decimal" placeholder="e.g. 20" />
        </div>
        <div className="space-y-1">
          <Label>Voltage</Label>
          <Input value={voltage} onChange={(e) => setVoltage(e.target.value)} inputMode="decimal" placeholder="e.g. 120" />
        </div>
        <div className="space-y-1">
          <Label>Install state</Label>
          <StatusSelect value={status} onChange={setStatus} options={INSTALL_STATUSES} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!circuitId.trim() || mutation.isPending}>
          <Save className="mr-1.5 h-4 w-4" /> {circuit ? "Save circuit" : "Add circuit"}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function PositionForm({
  panelUuid,
  circuits,
  onSaved,
}: {
  panelUuid: string;
  circuits: InstallCircuit[];
  onSaved: () => void;
}) {
  const save = useServerFn(saveBreakerPosition);
  const [side, setSide] = useState("Left");
  const [position, setPosition] = useState("");
  const [poles, setPoles] = useState("1");
  const [ocp, setOcp] = useState("");
  const [label, setLabel] = useState("");
  const [circuitUuid, setCircuitUuid] = useState("none");
  const [status, setStatus] = useState("conductors_installed");

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          panelUuid,
          side: side as "Left" | "Right",
          position: Number(position),
          poles: Number(poles),
          ocpAmps: ocp,
          label,
          circuitGroupUuid: circuitUuid === "none" ? null : circuitUuid,
          installStatus: status as (typeof INSTALL_STATUSES)[number],
        },
      }),
    onSuccess: () => {
      toast.success(`Position ${side} ${position} recorded`);
      setPosition("");
      setOcp("");
      setLabel("");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Side</Label>
          <StatusSelect value={side} onChange={setSide} options={["Left", "Right"]} />
        </div>
        <div className="space-y-1">
          <Label>Position</Label>
          <Input value={position} onChange={(e) => setPosition(e.target.value)} inputMode="numeric" placeholder="e.g. 12" />
        </div>
        <div className="space-y-1">
          <Label>Poles</Label>
          <StatusSelect value={poles} onChange={setPoles} options={["1", "2", "3"]} />
        </div>
        <div className="space-y-1">
          <Label>Breaker rating (A)</Label>
          <Input value={ocp} onChange={(e) => setOcp(e.target.value)} inputMode="decimal" />
        </div>
        <div className="space-y-1">
          <Label>Label text</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Install state</Label>
          <StatusSelect value={status} onChange={setStatus} options={INSTALL_STATUSES} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Circuit on this breaker</Label>
        <Select value={circuitUuid} onValueChange={setCircuitUuid}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">not linked yet</SelectItem>
            {circuits.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.circuit_group_id} {c.description ? `— ${c.description}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!position.trim() || mutation.isPending}
      >
        <Save className="mr-1.5 h-4 w-4" /> Record breaker position
      </Button>
    </div>
  );
}

function WireLoads({
  snapshot,
  panelId,
  circuits,
  onSaved,
}: {
  snapshot: InstallProgressSnapshot;
  panelId: string;
  circuits: InstallCircuit[];
  onSaved: () => void;
}) {
  const wire = useServerFn(wireLoadsToCircuit);
  const [circuitUuid, setCircuitUuid] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.loads
      .filter((l) => !l.circuit_group_uuid)
      .filter((l) =>
        q
          ? `${l.load_id ?? ""} ${l.description ?? ""} ${l.area ?? ""}`.toLowerCase().includes(q)
          : (l.suggested_panel ?? "").toUpperCase() === panelId.toUpperCase(),
      )
      .slice(0, 200);
  }, [snapshot.loads, search, panelId]);

  const mutation = useMutation({
    mutationFn: () =>
      wire({
        data: {
          circuitUuid,
          loadUuids: picked,
          installStatus: "conductors_installed",
        },
      }),
    onSuccess: (r) => {
      toast.success(`${r.updated} load(s) wired`);
      setPicked([]);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Wire to circuit</Label>
        <Select value={circuitUuid} onValueChange={setCircuitUuid}>
          <SelectTrigger>
            <SelectValue placeholder={circuits.length ? "pick a circuit" : "add a circuit first"} />
          </SelectTrigger>
          <SelectContent>
            {circuits.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.circuit_group_id} {c.description ? `— ${c.description}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search unwired loads (default: loads whose suggested panel is ${panelId})`}
      />
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No unwired load matches. Search by load ID, description or area to wire a load whose
          suggested panel is blank or different.
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-auto rounded-md border border-border p-2">
          {candidates.map((l) => (
            <label key={l.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
              <Checkbox
                checked={picked.includes(l.id)}
                onCheckedChange={(v) =>
                  setPicked((prev) => (v ? [...prev, l.id] : prev.filter((x) => x !== l.id)))
                }
              />
              <span className="font-mono text-xs">{l.load_id}</span>
              <span>{l.description}</span>
              {l.area && <Badge variant="outline">{l.area}</Badge>}
              {l.suggested_panel && <Badge variant="secondary">{l.suggested_panel}</Badge>}
            </label>
          ))}
        </div>
      )}
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!circuitUuid || picked.length === 0 || mutation.isPending}
      >
        <Plug className="mr-1.5 h-4 w-4" /> Wire {picked.length || ""} load{picked.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

function InstallProgressPage() {
  const fetchSnapshot = useServerFn(loadInstallProgress);
  const fetchHolds = useServerFn(loadAuditHolds);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["electrical", "install-progress"],
    queryFn: () => fetchSnapshot(),
  });
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const allPanels = data?.panels ?? [];
  const buildings = useMemo(
    () =>
      Array.from(new Set(allPanels.map((p) => p.building?.trim() || "Unassigned"))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [allPanels],
  );
  const panels = useMemo(
    () =>
      allPanels.filter(
        (p) => (p.building?.trim() || "Unassigned") === selectedBuilding,
      ),
    [allPanels, selectedBuilding],
  );

  useEffect(() => {
    if (!buildings.length) return;
    const saved =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem("farmops.install-progress.building.v1");
    const next = selectedBuilding && buildings.includes(selectedBuilding)
      ? selectedBuilding
      : saved && buildings.includes(saved)
        ? saved
        : buildings[0]!;
    if (next !== selectedBuilding) setSelectedBuilding(next);
  }, [buildings, selectedBuilding]);

  useEffect(() => {
    if (!selectedBuilding || !panels.length || !data) {
      if (selected) setSelected("");
      return;
    }
    if (panels.some((p) => p.id === selected)) return;

    const savedKey = `farmops.install-progress.panel.v1:${selectedBuilding}`;
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem(savedKey);
    const savedPanel = panels.find((p) => p.id === saved);
    if (savedPanel) {
      setSelected(savedPanel.id);
      return;
    }

    const circuitsByPanel = new Map<string, Set<string>>();
    for (const circuit of data.circuits) {
      if (!circuit.panel_uuid) continue;
      const ids = circuitsByPanel.get(circuit.panel_uuid) ?? new Set<string>();
      ids.add(circuit.id);
      circuitsByPanel.set(circuit.panel_uuid, ids);
    }
    const score = (panelId: string) => {
      const circuitIds = circuitsByPanel.get(panelId) ?? new Set<string>();
      const loadCount = data.loads.filter(
        (load) => load.circuit_group_uuid && circuitIds.has(load.circuit_group_uuid),
      ).length;
      const positionCount = data.positions.filter((position) => position.panel_uuid === panelId).length;
      return { loadCount, positionCount, circuitCount: circuitIds.size };
    };
    const ranked = [...panels].sort((a, b) => {
      const left = score(a.id);
      const right = score(b.id);
      return (
        right.loadCount - left.loadCount ||
        right.positionCount - left.positionCount ||
        right.circuitCount - left.circuitCount ||
        a.panel_id.localeCompare(b.panel_id)
      );
    });
    setSelected(ranked[0]!.id);
  }, [data, panels, selected, selectedBuilding]);

  const chooseBuilding = (building: string) => {
    setSelectedBuilding(building);
    setSelected("");
    setEditing(null);
    try {
      window.localStorage.setItem("farmops.install-progress.building.v1", building);
    } catch {
      // Preferences remain usable in memory when storage is unavailable.
    }
  };

  const choosePanel = (panelId: string) => {
    setSelected(panelId);
    setEditing(null);
    try {
      window.localStorage.setItem(
        `farmops.install-progress.panel.v1:${selectedBuilding}`,
        panelId,
      );
    } catch {
      // Preferences remain usable in memory when storage is unavailable.
    }
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["electrical"] });
    void refetch();
  };

  const holds = useQuery({
    queryKey: ["electrical", "audit-holds"],
    queryFn: () => fetchHolds(),
  });
  const panel = panels.find((p) => p.id === selected) ?? null;
  // Derived, never stored: recalculated from the snapshot on every read.
  const completeness = useMemo(() => {
    if (!data || !panel) return null;
    const rows = (holds.data ?? []).filter((h) => (h.panel_ref ?? "") === panel.panel_id);
    return panelCompletenessFromSnapshot(data, panel.id, {
      holds: rows.map((h) => ({
        ref: h.location ? `${h.ref} (${h.location})` : h.ref,
        reason: `${h.reason} [${h.batch_id}]`,
        kind: h.kind,
      })),
      evidenceSource: rows[0]?.batch_id ?? "stored electrical records",
    });
  }, [data, panel, holds.data]);
  const circuits = useMemo(
    () => (data?.circuits ?? []).filter((c) => c.panel_uuid === selected),
    [data, selected],
  );
  const positions = useMemo(
    () => (data?.positions ?? []).filter((p) => p.panel_uuid === selected),
    [data, selected],
  );
  const wiredLoads = useMemo(() => {
    const ids = new Set(circuits.map((c) => c.id));
    return (data?.loads ?? []).filter((l) => l.circuit_group_uuid && ids.has(l.circuit_group_uuid));
  }, [data, circuits]);

  const paneScope = `${encodeURIComponent(selectedBuilding || "none")}:${selected || "none"}`;
  const paneKeys = {
    map: `install-progress.${paneScope}.progress-map`,
    panel: `install-progress.${paneScope}.panel`,
    state: `install-progress.${paneScope}.panel-state`,
    circuits: `install-progress.${paneScope}.circuits`,
    positions: `install-progress.${paneScope}.positions`,
    wireLoads: `install-progress.${paneScope}.wire-loads`,
    wired: `install-progress.${paneScope}.wired`,
  };
  const allPaneKeys = Object.values(paneKeys);

  return (
    <ElectricalGate>
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              Install progress
              <Badge variant="outline">{panels.length} panels</Badge>
              <Badge variant="outline">{data?.circuits.length ?? 0} circuits recorded</Badge>
              <Badge variant="outline">{data?.positions.length ?? 0} breaker positions</Badge>
              <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPersistedSectionsOpen(allPaneKeys, true)}>
                Expand all
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPersistedSectionsOpen(allPaneKeys, false)}>
                Collapse all
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="space-y-1">
                <Label>Site</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted/30 px-3 text-sm">
                  Bostead Farms
                </div>
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="install-progress-building">Building</Label>
                <Select value={selectedBuilding} onValueChange={chooseBuilding}>
                  <SelectTrigger id="install-progress-building">
                    <SelectValue placeholder="Select a building" />
                  </SelectTrigger>
                  <SelectContent>
                    {buildings.map((building) => (
                      <SelectItem key={building} value={building}>
                        {building}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              What you record here is written straight to the panel, circuit, breaker-position and
              load records — the same records the wiring page and the critical-load study read. Only
              record what is actually installed; nothing here is inferred.
            </p>
          </CardContent>
        </Card>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : error ? (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              Could not read the electrical records: {(error as Error).message}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Panel selector</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex min-w-0 flex-wrap gap-2 overflow-x-auto">
                  {panels.map((p) => {
                    const panelCircuits = (data?.circuits ?? []).filter((c) => c.panel_uuid === p.id);
                    const circuitIds = new Set(panelCircuits.map((c) => c.id));
                    const loadCount = (data?.loads ?? []).filter(
                      (load) => load.circuit_group_uuid && circuitIds.has(load.circuit_group_uuid),
                    ).length;
                    const occupied = (data?.positions ?? []).filter(
                      (position) => position.panel_uuid === p.id,
                    ).length;
                    return (
                      <Button
                        key={p.id}
                        size="sm"
                        variant={p.id === selected ? "default" : "outline"}
                        onClick={() => choosePanel(p.id)}
                        title={`${loadCount} load(s), ${occupied} occupied position(s)`}
                      >
                        <span className="font-mono">{p.panel_id}</span>
                        <span className="ml-1 text-xs opacity-75">{loadCount} loads</span>
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Visual progress is read-only; recording remains in the Panel forms below. */}
            <PersistedSection storageKey={paneKeys.map} title="Visual progress map" defaultOpen>
              <GridOperationalMap key={`install-progress-map:${paneScope}`} />
            </PersistedSection>

            <PersistedSection storageKey={paneKeys.panel} title="Panel" defaultOpen>
              <div className="min-w-0 space-y-4">
                {completeness ? <PanelCompletenessCard result={completeness} /> : null}

            {panel && data ? (
              <>
                <PersistedSection
                  storageKey={paneKeys.state}
                  title={`${panel.panel_id} — installed panel state`}
                  defaultOpen
                >
                  <PanelForm snapshot={data} panelUuid={panel.id} onSaved={invalidate} />
                </PersistedSection>

                <PersistedSection
                  storageKey={paneKeys.circuits}
                  title={`Circuits on ${panel.panel_id} (${circuits.length})`}
                  defaultOpen
                >
                  <div className="space-y-2">
                    {circuits.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No circuit is recorded on this panel yet. Add the first installed circuit
                        below.
                      </p>
                    )}
                    {circuits.map((c) =>
                      editing === c.id ? (
                        <CircuitForm
                          key={c.id}
                          panelUuid={panel.id}
                          panelId={panel.panel_id}
                          circuit={c}
                          onSaved={() => {
                            setEditing(null);
                            invalidate();
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2"
                        >
                          <span className="font-mono text-xs">{c.circuit_group_id}</span>
                          <span className="text-sm">{c.description || "—"}</span>
                          {c.breaker_number != null && (
                            <Badge variant="outline">breaker {c.breaker_number}</Badge>
                          )}
                          {c.circuit_rating_amps != null && (
                            <Badge variant="outline">{c.circuit_rating_amps} A</Badge>
                          )}
                          {c.voltage != null && <Badge variant="outline">{c.voltage} V</Badge>}
                          <Badge variant="secondary">{statusLabel(c.install_status ?? "planned")}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {wiredLoads.filter((l) => l.circuit_group_uuid === c.id).length} load(s)
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c.id)}>
                            Edit
                          </Button>
                        </div>
                      ),
                    )}
                    <CircuitForm
                      panelUuid={panel.id}
                      panelId={panel.panel_id}
                      circuit={null}
                      onSaved={invalidate}
                    />
                  </div>
                </PersistedSection>

                <PersistedSection
                  storageKey={paneKeys.positions}
                  title={`Breaker positions in ${panel.panel_id} (${positions.length})`}
                >
                  <div className="space-y-2">
                    {positions.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm"
                      >
                        <Badge variant="outline">
                          {p.side} {p.position}
                        </Badge>
                        <Badge variant="outline">{p.poles}P</Badge>
                        {p.ocp_amps != null && <Badge variant="outline">{p.ocp_amps} A</Badge>}
                        <span>{p.label || "no label"}</span>
                        <Badge variant={p.circuit_group_uuid ? "secondary" : "destructive"}>
                          {p.circuit_group_uuid
                            ? circuits.find((c) => c.id === p.circuit_group_uuid)?.circuit_group_id ??
                              "circuit on another panel"
                            : "no circuit linked"}
                        </Badge>
                        <Badge variant="secondary">{statusLabel(p.install_status ?? "planned")}</Badge>
                      </div>
                    ))}
                    <PositionForm panelUuid={panel.id} circuits={circuits} onSaved={invalidate} />
                  </div>
                </PersistedSection>

                <PersistedSection
                  storageKey={paneKeys.wireLoads}
                  title={`Wire loads to a circuit (${wiredLoads.length} already wired here)`}
                >
                  <WireLoads
                    snapshot={data}
                    panelId={panel.panel_id}
                    circuits={circuits}
                    onSaved={invalidate}
                  />
                </PersistedSection>

                <PersistedSection
                  storageKey={paneKeys.wired}
                  title={`Loads wired to ${panel.panel_id} (${wiredLoads.length})`}
                >
                  {wiredLoads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No load is wired to a circuit on this panel yet, so the wiring page and the
                      critical-load study still show it as unwired.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {wiredLoads.map((l) => (
                        <div
                          key={l.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-sm"
                        >
                          <span className="font-mono text-xs">{l.load_id}</span>
                          <span>{l.description}</span>
                          <Badge variant="outline">
                            {circuits.find((c) => c.id === l.circuit_group_uuid)?.circuit_group_id}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await wireLoadsToCircuit({
                                  data: { circuitUuid: null, loadUuids: [l.id] },
                                });
                                toast.success(`${l.load_id} unwired`);
                                invalidate();
                              } catch (e) {
                                toast.error((e as Error).message);
                              }
                            }}
                          >
                            Unwire
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </PersistedSection>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No panel record exists yet for this building.
                </CardContent>
              </Card>
            )}
              </div>
            </PersistedSection>
          </>
        )}
      </div>
    </ElectricalGate>
  );
}
