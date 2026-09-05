// Define a building's starting location grid from dimensions, a standard shape
// or an uploaded drawing. Nothing is written until Save is pressed, and every
// assumption the reader had to make is shown before saving.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  SHAPE_TEMPLATES,
  WALK_PATTERNS,
  bearingDescription,
  compassPoint,
  defineBuildingGrid,
  gridCorners,
  rotateToNorthUp,
  templateOutline,
} from "@/lib/building-grid";
import type { ShapeTemplate, WalkPattern } from "@/lib/building-grid";
import {
  drawingKind,
  importDrawing,
  methodForKind,
} from "@/lib/building-drawing-import";
import type { ImportResult, ImportedOutline } from "@/lib/building-drawing-import";
import type { PointFt } from "@/lib/site-plan";
import {
  deleteBuildingGrid,
  listBuildingGrids,
  saveBuildingGrid,
} from "@/lib/building-grid.functions";

type Source = "SHAPE" | "DRAWING";

const NEW_SITE = "__new__";

function numberOrNull(value: string): number | null {
  const parsed = Number(value);
  return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
}

export function BuildingGridDefiner() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listBuildingGrids);
  const saveFn = useServerFn(saveBuildingGrid);
  const deleteFn = useServerFn(deleteBuildingGrid);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const saved = useQuery({ queryKey: ["building-grids"], queryFn: () => listFn() });

  const [siteId, setSiteId] = useState<string>(NEW_SITE);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteAddress, setNewSiteAddress] = useState("");

  const [buildingName, setBuildingName] = useState("");
  const [source, setSource] = useState<Source>("SHAPE");
  const [shape, setShape] = useState<ShapeTemplate>("RECTANGLE");
  const [lengthFt, setLengthFt] = useState("");
  const [widthFt, setWidthFt] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [notchLength, setNotchLength] = useState("");
  const [notchWidth, setNotchWidth] = useState("");
  const [extensionWidth, setExtensionWidth] = useState("");
  const [extensionDepth, setExtensionDepth] = useState("");
  const [leanToDepth, setLeanToDepth] = useState("");
  const [leanToLength, setLeanToLength] = useState("");

  const [cellFt, setCellFt] = useState("8");
  const [bearing, setBearing] = useState("90");
  const [walkPattern, setWalkPattern] = useState<WalkPattern>("CLOCKWISE");
  const [walkStart, setWalkStart] = useState("");
  const [notes, setNotes] = useState("");

  const [importState, setImportState] = useState<ImportResult | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importText, setImportText] = useState("");
  const [feetPerUnit, setFeetPerUnit] = useState("1");
  const [chosenOutline, setChosenOutline] = useState<ImportedOutline | null>(null);

  const outlineFt: PointFt[] = useMemo(() => {
    if (source === "DRAWING") return chosenOutline?.points ?? [];
    return templateOutline(shape, {
      lengthFt: Number(lengthFt),
      widthFt: Number(widthFt),
      heightFt: numberOrNull(heightFt),
      notchLengthFt: numberOrNull(notchLength),
      notchWidthFt: numberOrNull(notchWidth),
      extensionWidthFt: numberOrNull(extensionWidth),
      extensionDepthFt: numberOrNull(extensionDepth),
      leanToDepthFt: numberOrNull(leanToDepth),
      leanToLengthFt: numberOrNull(leanToLength),
    });
  }, [
    source,
    chosenOutline,
    shape,
    lengthFt,
    widthFt,
    heightFt,
    notchLength,
    notchWidth,
    extensionWidth,
    extensionDepth,
    leanToDepth,
    leanToLength,
  ]);

  const definitionMethod = useMemo(() => {
    if (source === "DRAWING") return methodForKind(drawingKind(importFileName));
    return shape === "RECTANGLE" ? "ENTERED_DIMENSIONS" : "STANDARD_SHAPE";
  }, [source, importFileName, shape]);

  const derived = useMemo(
    () =>
      defineBuildingGrid({
        buildingName: buildingName || "Building",
        definitionMethod,
        shapeTemplate: source === "SHAPE" ? shape : null,
        outlineFt,
        heightFt: numberOrNull(heightFt),
        cellFt: numberOrNull(cellFt),
        lengthAxisBearing: numberOrNull(bearing) ?? 90,
        walkStartCell: walkStart || null,
        walkPattern,
      }),
    [buildingName, definitionMethod, source, shape, outlineFt, heightFt, cellFt, bearing, walkStart, walkPattern],
  );

  const corners = derived ? gridCorners(derived.grid) : [];

  const save = useMutation({
    mutationFn: async () => {
      if (!derived) throw new Error("Enter the building size before saving.");
      if (!buildingName.trim()) throw new Error("Give the building a name.");
      return saveFn({
        data: {
          site_plan_id: siteId === NEW_SITE ? null : siteId,
          new_site_name: siteId === NEW_SITE ? newSiteName : null,
          new_site_address: siteId === NEW_SITE ? newSiteAddress : null,
          building_name: buildingName.trim(),
          definition_method: definitionMethod,
          shape_template: source === "SHAPE" ? shape : null,
          height_ft: numberOrNull(heightFt),
          outline_ft: derived.outlineFt,
          footprint_sqft: derived.footprintSqFt,
          perimeter_ft: derived.perimeterFt,
          fit_length_ft: derived.lengthFt,
          fit_width_ft: derived.widthFt,
          north_offset_degrees: derived.lengthAxisBearing,
          grid_cell_ft: derived.grid.cellFt,
          grid_rows: derived.grid.rows,
          grid_columns: derived.grid.columns,
          grid_row_labels: derived.grid.rowLabels.join(","),
          grid_column_labels: derived.grid.columnLabels.join(","),
          walk_start_cell: derived.walk.startCell,
          walk_finish_cell: derived.walk.finishCell,
          walk_pattern: derived.walk.pattern,
          source_file_name: source === "DRAWING" ? importFileName : null,
          source_scale_note: source === "DRAWING" ? (chosenOutline?.note ?? null) : null,
          notes: notes.trim() || null,
        },
      });
    },
    onSuccess: (result) => {
      toast.success(`${buildingName} grid saved — ${derived?.grid.firstCell} to ${derived?.grid.lastCell}.`);
      if (result?.site_plan_id) setSiteId(result.site_plan_id);
      void queryClient.invalidateQueries({ queryKey: ["building-grids"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Could not save."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Building grid removed.");
      void queryClient.invalidateQueries({ queryKey: ["building-grids"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Could not remove."),
  });

  async function handleFile(file: File | null) {
    if (!file) return;
    setImportFileName(file.name);
    setChosenOutline(null);
    const kind = drawingKind(file.name);
    const text = kind === "PDF" ? "" : await file.text();
    setImportText(text);
    const result = importDrawing(file.name, text, { feetPerUnit: numberOrNull(feetPerUnit) });
    setImportState(result);
    if (result.outlines.length > 0) setChosenOutline(result.outlines[0]!);
  }

  function rescale() {
    if (!importFileName) return;
    const result = importDrawing(importFileName, importText, {
      feetPerUnit: numberOrNull(feetPerUnit),
    });
    setImportState(result);
    setChosenOutline(result.outlines[0] ?? null);
  }

  const sites = saved.data?.sites ?? [];
  const buildings = saved.data?.buildings ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Site</CardTitle>
          <CardDescription>
            Add this grid to a site you already have, or start a new site. A new site becomes its
            starting location grid system.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_SITE}>New site…</SelectItem>
                {sites.map((site: { id: string; site_name: string }) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.site_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {siteId === NEW_SITE ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="new-site-name">New site name</Label>
                <Input
                  id="new-site-name"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  placeholder="Meadow Ridge"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-site-address">Address (optional)</Label>
                <Input
                  id="new-site-address"
                  value={newSiteAddress}
                  onChange={(e) => setNewSiteAddress(e.target.value)}
                  placeholder="Street, town"
                />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Building and size</CardTitle>
          <CardDescription>
            Name the building, then either type its size or read it from a drawing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="building-name">Building name</Label>
              <Input
                id="building-name"
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
                placeholder="Pump House"
              />
            </div>
            <div className="space-y-1">
              <Label>Size comes from</Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SHAPE">Typed dimensions / standard shape</SelectItem>
                  <SelectItem value="DRAWING">Uploaded drawing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="height-ft">Wall height (ft)</Label>
              <Input
                id="height-ft"
                inputMode="decimal"
                value={heightFt}
                onChange={(e) => setHeightFt(e.target.value)}
                placeholder="10"
              />
            </div>
          </div>

          {source === "SHAPE" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Shape</Label>
                  <Select value={shape} onValueChange={(v) => setShape(v as ShapeTemplate)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHAPE_TEMPLATES.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {SHAPE_TEMPLATES.find((s) => s.value === shape)?.help}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="length-ft">Length (ft)</Label>
                  <Input
                    id="length-ft"
                    inputMode="decimal"
                    value={lengthFt}
                    onChange={(e) => setLengthFt(e.target.value)}
                    placeholder="60"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="width-ft">Width (ft)</Label>
                  <Input
                    id="width-ft"
                    inputMode="decimal"
                    value={widthFt}
                    onChange={(e) => setWidthFt(e.target.value)}
                    placeholder="40"
                  />
                </div>
              </div>

              {shape === "L_SHAPE" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="notch-length">Missing corner — along length (ft)</Label>
                    <Input id="notch-length" inputMode="decimal" value={notchLength} onChange={(e) => setNotchLength(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="notch-width">Missing corner — across width (ft)</Label>
                    <Input id="notch-width" inputMode="decimal" value={notchWidth} onChange={(e) => setNotchWidth(e.target.value)} />
                  </div>
                </div>
              ) : null}

              {shape === "T_SHAPE" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="ext-width">Extension width (ft)</Label>
                    <Input id="ext-width" inputMode="decimal" value={extensionWidth} onChange={(e) => setExtensionWidth(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ext-depth">Extension depth (ft)</Label>
                    <Input id="ext-depth" inputMode="decimal" value={extensionDepth} onChange={(e) => setExtensionDepth(e.target.value)} />
                  </div>
                </div>
              ) : null}

              {shape === "LEAN_TO" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="lean-depth">Lean-to depth (ft)</Label>
                    <Input id="lean-depth" inputMode="decimal" value={leanToDepth} onChange={(e) => setLeanToDepth(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lean-length">Lean-to run along the wall (ft)</Label>
                    <Input id="lean-length" inputMode="decimal" value={leanToLength} onChange={(e) => setLeanToLength(e.target.value)} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="drawing-file">Drawing file</Label>
                  <Input
                    id="drawing-file"
                    ref={fileInput}
                    type="file"
                    accept=".csv,.json,.txt,.svg,.dxf,.pdf"
                    onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Corner list (.csv/.json in feet), SVG or DXF can be measured. A PDF page has to
                    be typed in or traced instead.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="feet-per-unit">Feet per drawing unit</Label>
                  <div className="flex gap-2">
                    <Input
                      id="feet-per-unit"
                      inputMode="decimal"
                      value={feetPerUnit}
                      onChange={(e) => setFeetPerUnit(e.target.value)}
                    />
                    <Button type="button" variant="outline" onClick={rescale} disabled={!importFileName}>
                      Apply
                    </Button>
                  </div>
                </div>
              </div>

              {importState?.warnings.length ? (
                <ul className="space-y-1 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  {importState.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              ) : null}

              {importState && importState.outlines.length > 0 ? (
                <div className="space-y-1">
                  <Label>Shape to use</Label>
                  <div className="flex flex-wrap gap-2">
                    {importState.outlines.map((outline, index) => (
                      <Button
                        key={`${outline.label}-${index}`}
                        type="button"
                        size="sm"
                        variant={chosenOutline === outline ? "default" : "outline"}
                        onClick={() => setChosenOutline(outline)}
                      >
                        {outline.label} — {outline.lengthFt.toFixed(1)}′ × {outline.widthFt.toFixed(1)}′
                      </Button>
                    ))}
                  </div>
                  {chosenOutline ? (
                    <p className="text-xs text-muted-foreground">{chosenOutline.note}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Grid, north and walk-around</CardTitle>
          <CardDescription>
            Cell size is per building. The bearing is the direction you walk from column 1 toward
            the last column.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="cell-ft">Grid cell (ft)</Label>
              <Input id="cell-ft" inputMode="decimal" value={cellFt} onChange={(e) => setCellFt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bearing">Length runs toward (° from north)</Label>
              <Input id="bearing" inputMode="decimal" value={bearing} onChange={(e) => setBearing(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                {compassPoint(Number(bearing) || 0)} · {bearingDescription(Number(bearing) || 0)}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Walk pattern</Label>
              <Select value={walkPattern} onValueChange={(v) => setWalkPattern(v as WalkPattern)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WALK_PATTERNS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Walk starts at</Label>
              <Select value={walkStart || (corners[0]?.ref ?? "")} onValueChange={setWalkStart}>
                <SelectTrigger>
                  <SelectValue placeholder="Corner" />
                </SelectTrigger>
                <SelectContent>
                  {corners.map((corner) => (
                    <SelectItem key={corner.ref} value={corner.ref}>
                      {corner.ref}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="grid-notes">Notes</Label>
            <Textarea
              id="grid-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How the dimensions were taken, doors, anything the next person needs."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">4. Preview and save</CardTitle>
          <CardDescription>Nothing is saved until you press Save this grid.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!derived ? (
            <p className="text-sm text-muted-foreground">
              Enter a length and width, or pick a shape from a drawing, to see the grid.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">
                  {derived.lengthFt.toFixed(1)}′ × {derived.widthFt.toFixed(1)}′
                  {derived.heightFt ? ` × ${derived.heightFt.toFixed(1)}′ H` : ""}
                </Badge>
                <Badge variant="secondary">{derived.footprintSqFt.toFixed(0)} sq ft</Badge>
                <Badge variant="secondary">
                  Grid {derived.grid.firstCell}–{derived.grid.lastCell} ({derived.grid.rows} × {derived.grid.columns} at {derived.grid.cellFt}′)
                </Badge>
                <Badge variant="secondary">
                  Walk {derived.walk.startCell} → {derived.walk.finishCell} ({derived.walk.cells.length} cells)
                </Badge>
              </div>

              <GridPreview
                outline={derived.outlineFt}
                bearing={derived.lengthAxisBearing}
                rows={derived.grid.rows}
                columns={derived.grid.columns}
                cellFt={derived.grid.cellFt}
              />

              <p className="text-xs text-muted-foreground">{derived.orientationNote}</p>
              <p className="text-xs text-muted-foreground">
                Walk order: {derived.walk.cells.slice(0, 14).join(" → ")}
                {derived.walk.cells.length > 14 ? ` → … → ${derived.walk.finishCell}` : ""}
              </p>

              {derived.gaps.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  {derived.gaps.map((gap) => (
                    <li key={gap}>• {gap}</li>
                  ))}
                </ul>
              ) : null}

              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save this grid"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved building grids</CardTitle>
          <CardDescription>Every grid defined for your sites.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {saved.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!saved.isLoading && buildings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No building grids defined yet.</p>
          ) : null}
          {sites.map((site: { id: string; site_name: string }) => {
            const rows = buildings.filter((b: { site_plan_id: string }) => b.site_plan_id === site.id);
            if (rows.length === 0) return null;
            return (
              <div key={site.id} className="space-y-1">
                <p className="text-sm font-medium">{site.site_name}</p>
                <ul className="space-y-1">
                  {rows.map((row: Record<string, any>) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs"
                    >
                      <span>
                        <span className="font-medium">{row.building_name ?? row.temp_name}</span>{" "}
                        {row.fit_length_ft ?? "?"}′ × {row.fit_width_ft ?? "?"}′
                        {row.height_ft ? ` × ${row.height_ft}′ H` : ""} · grid {row.grid_rows ?? "?"} ×{" "}
                        {row.grid_columns ?? "?"} at {row.grid_cell_ft}′
                        {row.walk_start_cell ? ` · walk ${row.walk_start_cell} → ${row.walk_finish_cell}` : ""}
                        {row.north_offset_degrees !== null && row.north_offset_degrees !== undefined
                          ? ` · length runs ${compassPoint(Number(row.north_offset_degrees))}`
                          : ""}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(String(row.id))}
                        disabled={remove.isPending}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function GridPreview({
  outline,
  bearing,
  rows,
  columns,
  cellFt,
}: {
  outline: PointFt[];
  bearing: number;
  rows: number;
  columns: number;
  cellFt: number;
}) {
  const rotated = rotateToNorthUp(outline, bearing);
  const xs = rotated.map((p) => p.x);
  const ys = rotated.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1;
  const height = Math.max(...ys) - minY || 1;
  const pad = Math.max(width, height) * 0.12;

  // Grid frame in the building's own axes, rotated the same way.
  const frame = rotateToNorthUp(
    [
      { x: 0, y: 0 },
      { x: columns * cellFt, y: 0 },
      { x: columns * cellFt, y: rows * cellFt },
      { x: 0, y: rows * cellFt },
    ],
    bearing,
  );
  const gridLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let c = 1; c < columns; c += 1) {
    const [a, b] = rotateToNorthUp(
      [
        { x: c * cellFt, y: 0 },
        { x: c * cellFt, y: rows * cellFt },
      ],
      bearing,
    );
    gridLines.push({ x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y });
  }
  for (let r = 1; r < rows; r += 1) {
    const [a, b] = rotateToNorthUp(
      [
        { x: 0, y: r * cellFt },
        { x: columns * cellFt, y: r * cellFt },
      ],
      bearing,
    );
    gridLines.push({ x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y });
  }

  const allX = [...xs, ...frame.map((p) => p.x)];
  const allY = [...ys, ...frame.map((p) => p.y)];
  const vbX = Math.min(...allX) - pad;
  const vbY = Math.min(...allY) - pad;
  const vbW = Math.max(...allX) - vbX + pad;
  const vbH = Math.max(...allY) - vbY + pad;

  return (
    <div className="rounded-md border bg-card p-2">
      <svg
        viewBox={`${vbX} ${-(vbY + vbH)} ${vbW} ${vbH}`}
        className="h-64 w-full"
        role="img"
        aria-label="Building outline with its reference grid, north up"
      >
        <g transform="scale(1,-1)">
          <polygon
            points={frame.map((p) => `${p.x},${p.y}`).join(" ")}
            className="fill-muted/40 stroke-muted-foreground"
            strokeWidth={vbW / 400}
          />
          {gridLines.map((line, i) => (
            <line
              key={i}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              className="stroke-muted-foreground/40"
              strokeWidth={vbW / 600}
            />
          ))}
          <polygon
            points={rotated.map((p) => `${p.x},${p.y}`).join(" ")}
            className="fill-primary/15 stroke-primary"
            strokeWidth={vbW / 250}
          />
        </g>
      </svg>
      <p className="pt-1 text-center text-xs text-muted-foreground">North is up</p>
    </div>
  );
}
