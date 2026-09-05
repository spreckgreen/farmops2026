/// <reference types="google.maps" />
// Trace building outlines on satellite imagery, then read the measured
// footprint, orientation and derived reference grid for each one.
//
// Nothing here guesses a building's identity. Sizes are measured from the traced
// corners, temporary names run largest to smallest, and any link to a structure
// the app already knows is recorded only when a person picks it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  deriveBuildings,
  suggestStructure,
  type DerivedBuilding,
  type ExistingStructure,
  type LatLng,
} from "@/lib/site-plan";
import {
  deleteSitePlan,
  geocodeSiteAddress,
  listExistingStructures,
  listSitePlans,
  saveSitePlan,
} from "@/lib/site-plan.functions";

interface TraceDraft {
  outline: LatLng[];
  done: boolean;
}

const DEFAULT_ZOOM = 20;

function feet(value: number): string {
  return `${value.toFixed(1)}′`;
}

export function SiteTracer() {
  const geocode = useServerFn(geocodeSiteAddress);
  const save = useServerFn(saveSitePlan);
  const remove = useServerFn(deleteSitePlan);
  const listStructures = useServerFn(listExistingStructures);
  const listPlans = useServerFn(listSitePlans);
  const queryClient = useQueryClient();

  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const shapesRef = useRef<Array<{ setMap: (map: google.maps.Map | null) => void }>>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [address, setAddress] = useState("");
  const [located, setLocated] = useState<{ formatted: string; lat: number; lng: number } | null>(
    null,
  );
  const [traces, setTraces] = useState<TraceDraft[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [cellFt, setCellFt] = useState(8);

  const structuresQuery = useQuery({
    queryKey: ["site-plan", "structures"],
    queryFn: () => listStructures(),
  });
  const plansQuery = useQuery({ queryKey: ["site-plan", "plans"], queryFn: () => listPlans() });

  const structures: ExistingStructure[] = structuresQuery.data?.structures ?? [];

  const derived = useMemo(
    () => deriveBuildings(traces.filter((t) => t.done).map((t) => ({ outline: t.outline })), cellFt),
    [traces, cellFt],
  );

  // ---- map bootstrap ----
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapNode.current) return;
        mapRef.current = new maps.Map(mapNode.current, {
          center: { lat: 39.5, lng: -98.35 },
          zoom: 4,
          mapTypeId: "satellite",
          tilt: 0,
          streetViewControl: false,
          fullscreenControl: true,
        });
        setMapReady(true);
      })
      .catch((error: Error) => setMapError(error.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const addCorner = useCallback((point: LatLng) => {
    setTraces((current) => {
      const next = [...current];
      const openIndex = next.findIndex((t) => !t.done);
      if (openIndex === -1) {
        next.push({ outline: [point], done: false });
        return next;
      }
      next[openIndex] = { ...next[openIndex]!, outline: [...next[openIndex]!.outline, point] };
      return next;
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const listener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      addCorner({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    return () => listener.remove();
  }, [mapReady, addCorner]);

  // ---- draw outlines, fitted frames and grids ----
  useEffect(() => {
    const map = mapRef.current;
    const maps = typeof window !== "undefined" ? window.google?.maps : undefined;
    if (!map || !maps) return;
    for (const shape of shapesRef.current) shape.setMap(null);
    shapesRef.current = [];

    const push = (shape: { setMap: (m: google.maps.Map | null) => void }) => {
      shapesRef.current.push(shape);
    };

    // in-progress trace
    const open = traces.find((t) => !t.done);
    if (open) {
      push(
        new maps.Polyline({
          path: open.outline,
          map,
          strokeColor: "#facc15",
          strokeWeight: 2,
        }),
      );
      for (const point of open.outline) {
        push(
          new maps.Marker({
            position: point,
            map,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 4,
              fillColor: "#facc15",
              fillOpacity: 1,
              strokeColor: "#111827",
              strokeWeight: 1,
            },
          }),
        );
      }
    }

    derived.buildings.forEach((building, index) => {
      const selected = activeIndex === index;
      push(
        new maps.Polygon({
          paths: building.outline,
          map,
          strokeColor: selected ? "#f97316" : "#38bdf8",
          strokeWeight: selected ? 3 : 2,
          fillColor: selected ? "#f97316" : "#38bdf8",
          fillOpacity: 0.16,
        }),
      );
      push(
        new maps.Polygon({
          paths: building.fitCorners,
          map,
          strokeColor: "#a3e635",
          strokeWeight: 1,
          strokeOpacity: 0.9,
          fillOpacity: 0,
        }),
      );
      // grid lines across the fitted frame
      const [c0, c1, c2, c3] = building.fitCorners;
      if (c0 && c1 && c2 && c3) {
        const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
        });
        const along = building.grid.columns;
        const across = building.grid.rows;
        for (let i = 1; i < along; i += 1) {
          const t = i / along;
          push(
            new maps.Polyline({
              path: [lerp(c0, c1, t), lerp(c3, c2, t)],
              map,
              strokeColor: "#a3e635",
              strokeOpacity: 0.45,
              strokeWeight: 1,
            }),
          );
        }
        for (let i = 1; i < across; i += 1) {
          const t = i / across;
          push(
            new maps.Polyline({
              path: [lerp(c0, c3, t), lerp(c1, c2, t)],
              map,
              strokeColor: "#a3e635",
              strokeOpacity: 0.45,
              strokeWeight: 1,
            }),
          );
        }
      }
      const label = building.outline[0]!;
      push(
        new maps.Marker({
          position: label,
          map,
          label: { text: building.tempName, color: "#ffffff", fontSize: "11px" },
          icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#0f172a", fillOpacity: 0.85, strokeColor: "#a3e635", strokeWeight: 1 },
          title: `${building.tempName} — ${building.footprintSqFt.toFixed(0)} sq ft`,
        }),
      );
    });
  }, [traces, derived, activeIndex]);

  const locate = useMutation({
    mutationFn: (input: { address: string }) => geocode({ data: input }),
    onSuccess: (result) => {
      setLocated({
        formatted: result.formattedAddress,
        lat: result.latitude,
        lng: result.longitude,
      });
      if (!siteName.trim()) setSiteName(result.formattedAddress.split(",")[0] ?? "Site");
      const map = mapRef.current;
      if (map) {
        map.setCenter({ lat: result.latitude, lng: result.longitude });
        map.setZoom(DEFAULT_ZOOM);
      }
      toast.success("Imagery centred on the address.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const savePlan = useMutation({
    mutationFn: () =>
      save({
        data: {
          site_name: siteName,
          address,
          formatted_address: located?.formatted ?? null,
          latitude: located?.lat ?? null,
          longitude: located?.lng ?? null,
          buildings: derived.buildings.map((building) => ({
            temp_name: building.tempName,
            size_rank: building.sizeRank,
            outline: building.outline,
            origin_latitude: building.origin.lat,
            origin_longitude: building.origin.lng,
            footprint_sqft: building.footprintSqFt,
            perimeter_ft: building.perimeterFt,
            fit_length_ft: building.fitLengthFt,
            fit_width_ft: building.fitWidthFt,
            orientation_degrees: building.orientationDegrees,
            grid_cell_ft: building.grid.cellFt,
            grid_rows: building.grid.rows,
            grid_columns: building.grid.columns,
            grid_row_labels: building.grid.rowLabels.join(","),
            grid_column_labels: building.grid.columnLabels.join(","),
            mapped_structure: mapping[building.tempName] || null,
            mapped_confidence: mapping[building.tempName] ? "OWNER_CONFIRMED" : null,
          })),
        },
      }),
    onSuccess: (result) => {
      toast.success(`Site saved with ${result.buildings} building outline(s).`);
      queryClient.invalidateQueries({ queryKey: ["site-plan", "plans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Site removed.");
      queryClient.invalidateQueries({ queryKey: ["site-plan", "plans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openTrace = traces.find((t) => !t.done) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Site outline from aerial imagery</CardTitle>
          <CardDescription>
            Find the address, then click each corner of a building on the photo. The footprint,
            orientation and reference grid are measured from the corners you trace — nothing is
            assumed from the picture.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="site-address">Address</Label>
              <Input
                id="site-address"
                value={address}
                placeholder="1234 County Road, Town, State"
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="site-name">Site name</Label>
              <Input
                id="site-name"
                value={siteName}
                placeholder="Home place"
                onChange={(event) => setSiteName(event.target.value)}
              />
            </div>
            <Button
              onClick={() => locate.mutate({ address })}
              disabled={!address.trim() || locate.isPending}
            >
              {locate.isPending ? "Finding…" : "Find the site"}
            </Button>
          </div>
          {located ? (
            <p className="text-sm text-muted-foreground">
              {located.formatted} · {located.lat.toFixed(6)}, {located.lng.toFixed(6)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTraces((c) => [...c, { outline: [], done: false }])}
              disabled={Boolean(openTrace)}
            >
              Start a building
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setTraces((current) =>
                  current.map((t) => (t.done ? t : { ...t, outline: t.outline.slice(0, -1) })),
                )
              }
              disabled={!openTrace || openTrace.outline.length === 0}
            >
              Undo last corner
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setTraces((current) => current.map((t) => (t.done ? t : { ...t, done: true })))
              }
              disabled={!openTrace || openTrace.outline.length < 3}
            >
              Finish this building
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTraces([]);
                setMapping({});
                setActiveIndex(null);
              }}
              disabled={traces.length === 0}
            >
              Clear all
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Label htmlFor="cell" className="text-xs text-muted-foreground">
                Grid cell (feet)
              </Label>
              <Input
                id="cell"
                className="h-8 w-20"
                type="number"
                min={1}
                step={1}
                value={cellFt}
                onChange={(event) => setCellFt(Math.max(1, Number(event.target.value) || 8))}
              />
            </div>
          </div>

          {mapError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {mapError}
            </div>
          ) : (
            <div
              ref={mapNode}
              className="h-[520px] w-full overflow-hidden rounded-md border bg-muted"
            />
          )}
          {openTrace ? (
            <p className="text-sm text-muted-foreground">
              Tracing a building — {openTrace.outline.length} corner(s) placed. Click the photo to
              add the next corner, then choose “Finish this building”.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click the photo to start placing corners. Buildings are named largest first, so
              BLDG-1 is always the biggest footprint on the site.
            </p>
          )}
        </CardContent>
      </Card>

      {derived.skipped.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outlines that could not be measured</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {derived.skipped.map((item) => (
              <p key={item.index}>Outline {item.index + 1}: {item.reason}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {derived.buildings.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Measured buildings</CardTitle>
              <CardDescription>
                Largest footprint first. Each building gets its own reference grid using letter rows
                and number columns.
              </CardDescription>
            </div>
            <Button
              onClick={() => savePlan.mutate()}
              disabled={savePlan.isPending || !siteName.trim() || !address.trim()}
            >
              {savePlan.isPending ? "Saving…" : "Save this site"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {derived.buildings.map((building, index) => (
              <BuildingRow
                key={building.tempName}
                building={building}
                structures={structures}
                selected={activeIndex === index}
                onSelect={() => setActiveIndex(activeIndex === index ? null : index)}
                mappedTo={mapping[building.tempName] ?? ""}
                onMap={(value) =>
                  setMapping((current) => ({ ...current, [building.tempName]: value }))
                }
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved sites</CardTitle>
          <CardDescription>Outlines already recorded for this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {(plansQuery.data?.sites ?? []).length === 0 ? (
            <p className="text-muted-foreground">No sites recorded yet.</p>
          ) : (
            (plansQuery.data?.sites ?? []).map((site: any) => {
              const rows = (plansQuery.data?.buildings ?? []).filter(
                (b: any) => b.site_plan_id === site.id,
              );
              return (
                <div key={site.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{site.site_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {site.formatted_address || site.address}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deletePlan.mutate(site.id)}
                      disabled={deletePlan.isPending}
                    >
                      Remove
                    </Button>
                  </div>
                  <Separator className="my-2" />
                  <div className="space-y-1">
                    {rows.length === 0 ? (
                      <p className="text-muted-foreground">No buildings recorded.</p>
                    ) : (
                      rows.map((row: any) => (
                        <p key={row.id} className="text-xs">
                          <span className="font-mono">{row.temp_name}</span> ·{" "}
                          {Number(row.footprint_sqft ?? 0).toFixed(0)} sq ft ·{" "}
                          {Number(row.fit_length_ft ?? 0).toFixed(0)}′ ×{" "}
                          {Number(row.fit_width_ft ?? 0).toFixed(0)}′ · grid{" "}
                          {row.grid_rows}×{row.grid_columns} at {Number(row.grid_cell_ft)}′
                          {row.mapped_structure ? ` · mapped to ${row.mapped_structure}` : ""}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BuildingRow({
  building,
  structures,
  selected,
  onSelect,
  mappedTo,
  onMap,
}: {
  building: DerivedBuilding;
  structures: ExistingStructure[];
  selected: boolean;
  onSelect: () => void;
  mappedTo: string;
  onMap: (value: string) => void;
}) {
  const suggestion = suggestStructure(building, structures);
  return (
    <div className={`rounded-md border p-3 ${selected ? "border-primary" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {building.tempName}
          </Badge>
          <span className="text-sm font-medium">
            {building.footprintSqFt.toFixed(0)} sq ft footprint
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={onSelect}>
          {selected ? "Hide on the photo" : "Highlight on the photo"}
        </Button>
      </div>
      <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <p>
          Fitted size {feet(building.fitLengthFt)} × {feet(building.fitWidthFt)} · perimeter{" "}
          {feet(building.perimeterFt)}
        </p>
        <p>
          Orientation {building.orientationDegrees.toFixed(1)}° — {building.orientationLabel}
        </p>
        <p>
          Grid {building.grid.rowLabels[0]}
          {building.grid.columnLabels[0]}–{building.grid.lastCell} ({building.grid.rows} row(s) ×{" "}
          {building.grid.columns} column(s) at {building.grid.cellFt}′)
        </p>
        <p>Corners traced: {building.outline.length}</p>
      </div>
      {building.gaps.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-600 dark:text-amber-400">
          {building.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 space-y-1">
        <Label className="text-xs">Map to a structure already in the app</Label>
        <select
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={mappedTo}
          onChange={(event) => onMap(event.target.value)}
        >
          <option value="">Keep the temporary name ({building.tempName})</option>
          {structures.map((structure) => (
            <option key={structure.name} value={structure.name}>
              {structure.name} — {structure.usedBy}
            </option>
          ))}
        </select>
        {suggestion ? (
          <p className="text-xs text-muted-foreground">
            Possible match: <span className="font-medium">{suggestion.structure.name}</span> —{" "}
            {suggestion.basis} ({suggestion.differenceNote}). Choose it above to confirm; it is never
            applied on its own.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No recorded footprint matches this size, so there is no suggested structure.
          </p>
        )}
      </div>
    </div>
  );
}
