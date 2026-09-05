// Rooms, areas and circuits inside one building's location grid.
//
// The grid shown here is the building's own grid from Site Grids — letter rows
// across the width, number columns along the length. Clicking a cell records it
// against the room being edited; nothing is written until Save is pressed.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AREA_KINDS,
  ASSIGNMENT_BASES,
  deleteAreaCircuit,
  deleteBuildingArea,
  listBuildingAreas,
  saveAreaCircuit,
  saveBuildingArea,
} from "@/lib/building-areas.functions";

const NONE = "__none__";

function labels(value: unknown, fallbackCount: number, letters: boolean): string[] {
  const text = String(value ?? "").trim();
  if (text !== "") return text.split(",").map((part) => part.trim()).filter(Boolean);
  const count = Number(fallbackCount) || 0;
  return Array.from({ length: count }, (_, index) =>
    letters ? String.fromCharCode(65 + index) : String(index + 1),
  );
}

function cellList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

interface AreaForm {
  id: string | null;
  area_name: string;
  area_kind: string;
  floor_level: string;
  grid_cells: string;
  start_cell: string;
  end_cell: string;
  notes: string;
}

const EMPTY_AREA: AreaForm = {
  id: null,
  area_name: "",
  area_kind: "ROOM",
  floor_level: "",
  grid_cells: "",
  start_cell: "",
  end_cell: "",
  notes: "",
};

interface CircuitForm {
  id: string | null;
  circuit_group_uuid: string;
  circuit_group_ref: string;
  panel_ref: string;
  breaker_number: string;
  load_ref: string;
  assignment_basis: string;
  notes: string;
}

const EMPTY_CIRCUIT: CircuitForm = {
  id: null,
  circuit_group_uuid: NONE,
  circuit_group_ref: "",
  panel_ref: "",
  breaker_number: "",
  load_ref: "",
  assignment_basis: "DESIGN",
  notes: "",
};

export function BuildingAreasManager() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listBuildingAreas);
  const saveAreaFn = useServerFn(saveBuildingArea);
  const removeAreaFn = useServerFn(deleteBuildingArea);
  const saveCircuitFn = useServerFn(saveAreaCircuit);
  const removeCircuitFn = useServerFn(deleteAreaCircuit);

  const [buildingId, setBuildingId] = useState<string>("");
  const [areaForm, setAreaForm] = useState<AreaForm>(EMPTY_AREA);
  const [circuitAreaId, setCircuitAreaId] = useState<string | null>(null);
  const [circuitForm, setCircuitForm] = useState<CircuitForm>(EMPTY_CIRCUIT);

  const query = useQuery({
    queryKey: ["building-areas"],
    queryFn: () => listFn(),
  });

  const data = query.data as any;
  const sites: any[] = data?.sites ?? [];
  const buildings: any[] = data?.buildings ?? [];
  const areas: any[] = data?.areas ?? [];
  const circuits: any[] = data?.circuits ?? [];
  const circuitGroups: any[] = data?.circuitGroups ?? [];

  const building = useMemo(
    () => buildings.find((row) => row.id === buildingId) ?? null,
    [buildings, buildingId],
  );
  const siteName = (id: string) => sites.find((s) => s.id === id)?.site_name ?? "Site";

  const buildingAreas = useMemo(
    () => areas.filter((row) => row.site_building_id === buildingId),
    [areas, buildingId],
  );

  const rows = building ? labels(building.grid_row_labels, building.grid_rows, true) : [];
  const columns = building ? labels(building.grid_column_labels, building.grid_columns, false) : [];

  const selectedCells = cellList(areaForm.grid_cells);
  const cellOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const area of buildingAreas) {
      if (areaForm.id && area.id === areaForm.id) continue;
      for (const cell of cellList(area.grid_cells)) map.set(cell, area.area_name);
    }
    return map;
  }, [buildingAreas, areaForm.id]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["building-areas"] });

  const saveArea = useMutation({
    mutationFn: (input: any) => saveAreaFn({ data: input }),
    onSuccess: () => {
      toast.success("Room saved.");
      setAreaForm(EMPTY_AREA);
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "The room could not be saved."),
  });

  const removeArea = useMutation({
    mutationFn: (id: string) => removeAreaFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Room removed.");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "The room could not be removed."),
  });

  const saveCircuit = useMutation({
    mutationFn: (input: any) => saveCircuitFn({ data: input }),
    onSuccess: () => {
      toast.success("Circuit linked.");
      setCircuitForm(EMPTY_CIRCUIT);
      setCircuitAreaId(null);
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "The circuit could not be linked."),
  });

  const removeCircuit = useMutation({
    mutationFn: (id: string) => removeCircuitFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Circuit link removed.");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "The link could not be removed."),
  });

  // A starter layout for a simple rectangular outbuilding: rooms/bays plus one
  // planned circuit reference each. No engineering values and no breaker
  // numbers are created — those come from real records or field evidence.
  const starterPlan = useMutation({
    mutationFn: async () => {
      const panelRef = `${(building?.building_name || building?.temp_name || "BLDG")
        .toString()
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")} panel (planned)`;
      const plan = starterOutbuildingPlan(building as never, panelRef);
      let areasCreated = 0;
      let circuitsCreated = 0;
      for (const area of plan) {
        const saved: any = await saveAreaFn({
          data: {
            site_building_id: buildingId,
            area_name: area.area_name,
            area_kind: area.area_kind,
            grid_cells: area.grid_cells,
            notes: area.notes,
          },
        });
        areasCreated += 1;
        const areaId = saved?.id;
        if (!areaId) continue;
        for (const circuit of area.circuits) {
          await saveCircuitFn({
            data: {
              building_area_id: areaId,
              circuit_group_ref: circuit.circuit_group_ref,
              panel_ref: circuit.panel_ref,
              assignment_basis: "DESIGN",
              notes: circuit.notes,
            },
          });
          circuitsCreated += 1;
        }
      }
      return { areasCreated, circuitsCreated };
    },
    onSuccess: (result) => {
      toast.success(
        `Added ${result.areasCreated} areas and ${result.circuitsCreated} planned circuits.`,
      );
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "The starter plan could not be added."),
  });

  function toggleCell(cell: string) {
    const current = cellList(areaForm.grid_cells);
    const next = current.includes(cell)
      ? current.filter((item) => item !== cell)
      : [...current, cell];
    setAreaForm({ ...areaForm, grid_cells: next.join(", ") });
  }

  function editArea(area: any) {
    setAreaForm({
      id: area.id,
      area_name: area.area_name ?? "",
      area_kind: area.area_kind ?? "ROOM",
      floor_level: area.floor_level ?? "",
      grid_cells: area.grid_cells ?? "",
      start_cell: area.start_cell ?? "",
      end_cell: area.end_cell ?? "",
      notes: area.notes ?? "",
    });
  }

  function submitArea() {
    if (!buildingId) {
      toast.error("Choose a building first.");
      return;
    }
    saveArea.mutate({ ...areaForm, site_building_id: buildingId });
  }

  function submitCircuit(areaId: string) {
    saveCircuit.mutate({
      ...circuitForm,
      circuit_group_uuid: circuitForm.circuit_group_uuid === NONE ? null : circuitForm.circuit_group_uuid,
      building_area_id: areaId,
    });
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your buildings…</p>;
  }

  if (buildings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No buildings yet</CardTitle>
          <CardDescription>
            Rooms and areas sit inside a building grid, so define a building first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm">
            <Link to="/electrical/site-grids">Go to Site Grids</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Building</CardTitle>
          <CardDescription>
            Pick a building from Site Grids. Its own grid and cell size are used here — nothing is
            re-measured.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={buildingId} onValueChange={setBuildingId}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Choose a building" />
            </SelectTrigger>
            <SelectContent>
              {buildings.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {(row.building_name || row.temp_name) + " · " + siteName(row.site_plan_id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {building ? (
            <p className="text-xs text-muted-foreground">
              {Number(building.footprint_sqft ?? 0).toFixed(0)} sq ft ·{" "}
              {Number(building.fit_length_ft ?? 0).toFixed(0)}′ ×{" "}
              {Number(building.fit_width_ft ?? 0).toFixed(0)}′ · grid {rows.length}×{columns.length}{" "}
              at {Number(building.grid_cell_ft ?? 0)}′ cells
            </p>
          ) : null}
        </CardContent>
      </Card>

      {building ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {areaForm.id ? "Edit room or area" : "Add a room or area"}
              </CardTitle>
              <CardDescription>
                Click cells on the grid to record where the room is. Cells already used by another
                room are marked.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="area-name">Name</Label>
                  <Input
                    id="area-name"
                    value={areaForm.area_name}
                    placeholder="Kitchen"
                    onChange={(event) =>
                      setAreaForm({ ...areaForm, area_name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Kind</Label>
                  <Select
                    value={areaForm.area_kind}
                    onValueChange={(value) => setAreaForm({ ...areaForm, area_kind: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AREA_KINDS.map((kind) => (
                        <SelectItem key={kind.value} value={kind.value}>
                          {kind.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="area-floor">Floor or level</Label>
                  <Input
                    id="area-floor"
                    value={areaForm.floor_level}
                    placeholder="Main floor"
                    onChange={(event) =>
                      setAreaForm({ ...areaForm, floor_level: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="area-cells">Grid cells</Label>
                  <Input
                    id="area-cells"
                    value={areaForm.grid_cells}
                    placeholder="A1, A2, B1"
                    onChange={(event) =>
                      setAreaForm({ ...areaForm, grid_cells: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="area-start">Walk start cell</Label>
                  <Input
                    id="area-start"
                    value={areaForm.start_cell}
                    placeholder="A1"
                    onChange={(event) =>
                      setAreaForm({ ...areaForm, start_cell: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="area-end">Walk finish cell</Label>
                  <Input
                    id="area-end"
                    value={areaForm.end_cell}
                    placeholder="B3"
                    onChange={(event) => setAreaForm({ ...areaForm, end_cell: event.target.value })}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="area-notes">Notes</Label>
                  <Textarea
                    id="area-notes"
                    rows={2}
                    value={areaForm.notes}
                    onChange={(event) => setAreaForm({ ...areaForm, notes: event.target.value })}
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="inline-block">
                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `auto repeat(${columns.length}, minmax(2rem, 1fr))` }}
                  >
                    <div />
                    {columns.map((column) => (
                      <div key={column} className="text-center text-xs text-muted-foreground">
                        {column}
                      </div>
                    ))}
                    {rows.map((row) => (
                      <div key={row} className="contents">
                        <div className="pr-1 text-xs text-muted-foreground">{row}</div>
                        {columns.map((column) => {
                          const cell = `${row}${column}`;
                          const mine = selectedCells.includes(cell);
                          const owner = cellOwner.get(cell);
                          return (
                            <button
                              key={cell}
                              type="button"
                              title={owner ? `${cell} — ${owner}` : cell}
                              onClick={() => toggleCell(cell)}
                              className={`h-8 rounded border text-[10px] ${
                                mine
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : owner
                                    ? "border-border bg-muted text-muted-foreground"
                                    : "border-border bg-background hover:bg-accent"
                              }`}
                            >
                              {cell}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={submitArea} disabled={saveArea.isPending}>
                  {areaForm.id ? "Save changes" : "Add room"}
                </Button>
                {areaForm.id ? (
                  <Button size="sm" variant="outline" onClick={() => setAreaForm(EMPTY_AREA)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Rooms and areas in {building.building_name || building.temp_name}
              </CardTitle>
              <CardDescription>
                Each room can carry the circuits that serve it. Circuit links are relationships
                only — panel, breaker and engineering values stay with the electrical records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {buildingAreas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rooms or areas recorded for this building yet.
                </p>
              ) : (
                buildingAreas.map((area) => {
                  const links = circuits.filter((row) => row.building_area_id === area.id);
                  const open = circuitAreaId === area.id;
                  return (
                    <div key={area.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{area.area_name}</span>
                        <Badge variant="secondary">
                          {AREA_KINDS.find((k) => k.value === area.area_kind)?.label ??
                            area.area_kind}
                        </Badge>
                        {area.floor_level ? (
                          <span className="text-xs text-muted-foreground">{area.floor_level}</span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {cellList(area.grid_cells).length > 0
                            ? cellList(area.grid_cells).join(", ")
                            : "no cells recorded"}
                        </span>
                        <div className="ml-auto flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => editArea(area)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeArea.mutate(area.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                      {area.notes ? (
                        <p className="text-xs text-muted-foreground">{area.notes}</p>
                      ) : null}

                      <Separator />
                      <div className="space-y-1">
                        {links.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No circuits linked yet.</p>
                        ) : (
                          links.map((link) => (
                            <div key={link.id} className="flex items-center gap-2 text-xs">
                              <span className="font-mono">
                                {link.circuit_group_ref ?? "circuit not named"}
                              </span>
                              {link.panel_ref ? <span>· {link.panel_ref}</span> : null}
                              {link.breaker_number ? (
                                <span>· breaker {link.breaker_number}</span>
                              ) : null}
                              {link.load_ref ? <span>· {link.load_ref}</span> : null}
                              <Badge variant="outline">
                                {ASSIGNMENT_BASES.find((b) => b.value === link.assignment_basis)
                                  ?.label ?? link.assignment_basis}
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-auto h-6 px-2"
                                onClick={() => removeCircuit.mutate(link.id)}
                              >
                                Unlink
                              </Button>
                            </div>
                          ))
                        )}
                      </div>

                      {open ? (
                        <div className="space-y-2 rounded-md bg-muted/40 p-2">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="space-y-1">
                              <Label>Existing circuit</Label>
                              <Select
                                value={circuitForm.circuit_group_uuid}
                                onValueChange={(value) =>
                                  setCircuitForm({ ...circuitForm, circuit_group_uuid: value })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Not on record yet" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Not on record yet</SelectItem>
                                  {circuitGroups.map((group) => (
                                    <SelectItem key={group.id} value={group.id}>
                                      {group.circuit_group_id}
                                      {group.description ? ` — ${group.description}` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label>Circuit reference</Label>
                              <Input
                                value={circuitForm.circuit_group_ref}
                                placeholder="CG-HS-001"
                                onChange={(event) =>
                                  setCircuitForm({
                                    ...circuitForm,
                                    circuit_group_ref: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Panel</Label>
                              <Input
                                value={circuitForm.panel_ref}
                                placeholder="PNL-HS-MAIN"
                                onChange={(event) =>
                                  setCircuitForm({ ...circuitForm, panel_ref: event.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Breaker number</Label>
                              <Input
                                value={circuitForm.breaker_number}
                                inputMode="numeric"
                                placeholder="12"
                                onChange={(event) =>
                                  setCircuitForm({
                                    ...circuitForm,
                                    breaker_number: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Equipment reference</Label>
                              <Input
                                value={circuitForm.load_ref}
                                placeholder="HS-001"
                                onChange={(event) =>
                                  setCircuitForm({ ...circuitForm, load_ref: event.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Basis</Label>
                              <Select
                                value={circuitForm.assignment_basis}
                                onValueChange={(value) =>
                                  setCircuitForm({ ...circuitForm, assignment_basis: value })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSIGNMENT_BASES.map((basis) => (
                                    <SelectItem key={basis.value} value={basis.value}>
                                      {basis.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => submitCircuit(area.id)}
                              disabled={saveCircuit.isPending}
                            >
                              Link circuit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setCircuitAreaId(null);
                                setCircuitForm(EMPTY_CIRCUIT);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCircuitAreaId(area.id);
                            setCircuitForm(EMPTY_CIRCUIT);
                          }}
                        >
                          Link a circuit
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
