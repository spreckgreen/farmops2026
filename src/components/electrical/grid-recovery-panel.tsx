// Farm Shop grid-map recovery validation — canonical-derived, READ-ONLY.
//
// The map here is rebuilt from the SHA-authorized canonical ODS Grid field bound
// by Contract v3, through the frozen old→new transformation, onto the corrected
// 40' x 60' A–F / 1–9 drawing. The current FarmOps grid column is shown for
// comparison only and is never used as the source of location. No location field
// is written and there is no apply path.
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSpreadsheet, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CANONICAL_ODS_PATH } from "@/lib/electrical-sor";
import {
  validateFarmShopGridRecovery,
  type GridRecoveryPayload,
} from "@/lib/electrical-grid-recovery.functions";
import {
  OVERLAY_META,
  OVERLAY_ORDER,
  deltaCsv,
  recoveryCsv,
  type RecoveryOverlay,
  type RecoveryRow,
} from "@/lib/electrical-grid-recovery";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
import planImage from "@/assets/farm-shop-grid-plan.png";
import { cn } from "@/lib/utils";

/** Plan envelope inside the drawing, measured from the grid corner markers. */
const PLAN = { left: 12.91, right: 86.4, top: 19.52, bottom: 75.97 };

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function RecoveryMap({
  rows,
  visible,
  large,
}: {
  rows: RecoveryRow[];
  visible: Set<RecoveryOverlay>;
  large: boolean;
}) {
  const [hover, setHover] = useState<RecoveryRow | null>(null);
  const shown = rows.filter((r) => r.x_pct != null && r.y_pct != null && visible.has(r.overlay));
  const unplaced = rows.filter((r) => r.x_pct == null && visible.has(r.overlay));

  return (
    <div className="space-y-2">
      <div className={cn("relative w-full", large ? "max-w-none" : "max-w-3xl")}>
        <img
          src={planImage}
          alt="Corrected Farm Shop 40 by 60 foot overhead grid plan, rows A to F north to south and columns 1 to 9 west to east"
          className="w-full h-auto rounded-md border"
        />
        <div
          className="absolute"
          style={{
            left: `${PLAN.left}%`,
            top: `${PLAN.top}%`,
            width: `${PLAN.right - PLAN.left}%`,
            height: `${PLAN.bottom - PLAN.top}%`,
          }}
        >
          {shown.map((r) => (
            <button
              key={`${r.stable_id}-${r.stack_index}`}
              type="button"
              className={cn(
                "absolute rounded-full border border-background shadow-sm focus:outline-none focus:ring-2 focus:ring-ring",
                OVERLAY_META[r.overlay].dot,
                large ? "h-3.5 w-3.5" : "h-2.5 w-2.5",
              )}
              style={{
                left: `${r.x_pct}%`,
                top: `${r.y_pct}%`,
                transform: "translate(-50%, -50%)",
              }}
              onMouseEnter={() => setHover(r)}
              onMouseLeave={() => setHover((h) => (h === r ? null : h))}
              onFocus={() => setHover(r)}
              onBlur={() => setHover((h) => (h === r ? null : h))}
              aria-label={`${r.stable_id} ${r.description}`}
            />
          ))}
        </div>
        {hover ? (
          <div className="absolute left-2 bottom-2 max-w-[92%] rounded-md border bg-background/95 p-2 text-xs shadow-lg">
            <div className="font-medium">
              {hover.stable_id} — {hover.description}
            </div>
            <div className="text-muted-foreground">
              canonical grid {hover.canonical_grid_raw} · FarmOps grid {hover.farmops_grid_current} ·
              derived {hover.derived_new_grid ?? "—"} ({hover.precision})
            </div>
            <div className="text-muted-foreground">
              {hover.x_ft == null
                ? "No canonical-derived position."
                : `${hover.x_ft} ft east, ${hover.y_ft} ft south`}
            </div>
            <div className="text-muted-foreground">{hover.disagreement_note}</div>
            {hover.evidence.length ? (
              <div className="text-muted-foreground">Evidence: {hover.evidence.join(" ")}</div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Axis lines: rows {AXIS_ROWS.map((r) => r.label).join(" ")} north→south, columns{" "}
        {AXIS_COLS.map((c) => c.label).join(" ")} west→east. Dots are placed from canonical-derived
        X/Y only. {unplaced.length} shown record(s) have no canonical-derived position and are listed
        in the table instead of being snapped onto the plan.
      </p>
    </div>
  );
}

export function GridRecoveryPanel() {
  const run = useServerFn(validateFarmShopGridRecovery);
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<GridRecoveryPayload | null>(null);
  const [visible, setVisible] = useState<Set<RecoveryOverlay>>(new Set(OVERLAY_ORDER));
  const [large, setLarge] = useState(false);
  const [filter, setFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);

  const mutation = useMutation({
    mutationFn: (vars: { file_name: string; base64: string }) =>
      run({ data: vars }) as Promise<GridRecoveryPayload>,
    onSuccess: (payload) => {
      setResult(payload);
      toast.success(
        `Rebuilt ${payload.total} record(s) from canonical Grid — ${payload.counts.FARMOPS_GRID_DISAGREES_WITH_CANONICAL} FarmOps disagreement(s), ${payload.delta.changed} of ${payload.delta.compared} migration records change.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    if (!result) return [];
    const needle = filter.trim().toLowerCase();
    return result.rows.filter(
      (r) =>
        visible.has(r.overlay) &&
        (!needle ||
          `${r.stable_id} ${r.description} ${r.canonical_grid_raw} ${r.farmops_grid_current} ${r.derived_new_grid ?? ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [result, visible, filter]);

  const deltaRows = useMemo(() => {
    if (!result) return [];
    return onlyChanged
      ? result.delta.records.filter((r) => r.changed_fields.length > 0)
      : result.delta.records;
  }, [result, onlyChanged]);

  const toggle = (o: RecoveryOverlay) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
            <div>
              <CardTitle className="text-base">
                Farm Shop grid-map recovery validation — canonical-derived, read-only
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Location comes from the canonical Grid field bound by Contract v3 in{" "}
                <span className="font-mono">{CANONICAL_ODS_PATH}</span>, transformed by the frozen
                old→new dictionaries onto the corrected 40′ × 60′ A–F / 1–9 drawing. The current
                FarmOps grid column is <strong>not</strong> treated as authoritative. No location
                field is written and there is no apply path.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  mutation.mutate({ file_name: f.name, base64: await fileToBase64(f) });
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => input.current?.click()}
                disabled={mutation.isPending}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                {mutation.isPending ? "Rebuilding…" : "Choose .ods"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!result}
                onClick={() =>
                  result &&
                  download(
                    `farm-shop-grid-recovery-${result.generated_at.slice(0, 19).replace(/[:T]/g, "-")}.csv`,
                    recoveryCsv(result.rows),
                    "text/csv",
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" />
                Recovery CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!result}
                onClick={() =>
                  result &&
                  download(
                    `farm-shop-grid-source-delta-${result.generated_at.slice(0, 19).replace(/[:T]/g, "-")}.csv`,
                    deltaCsv(result.delta.records),
                    "text/csv",
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" />
                Delta CSV
              </Button>
            </div>
          </CardHeader>
          {result ? (
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  ODS SHA <span className="font-mono ml-1">{result.ods_sha256.slice(0, 12)}…</span>
                </Badge>
                <Badge variant="outline">
                  Canonical Grid bound at physical column {result.grid_physical_column} (“
                  {result.grid_observed_header}”)
                </Badge>
                <Badge variant="outline">
                  {result.farm_shop_canonical_rows} Farm Shop canonical row(s) ·{" "}
                  {result.farm_shop_panels} panel(s) · {result.total} record(s)
                </Badge>
                <Badge variant="outline">
                  placed {result.placed} · unplaced {result.unplaced}
                </Badge>
                <Badge
                  variant={
                    result.diagnosis.verdict === "FARMOPS_IMPORT_DEFECT" ? "destructive" : "default"
                  }
                >
                  {result.diagnosis.verdict.replaceAll("_", " ")}
                </Badge>
              </div>
              <p className="text-sm">{result.diagnosis.statement}</p>
            </CardContent>
          ) : null}
        </Card>

        {result ? (
          <>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">Canonical-derived placement</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setLarge((v) => !v)}>
                  {large ? (
                    <Minimize2 className="h-4 w-4 mr-1" />
                  ) : (
                    <Maximize2 className="h-4 w-4 mr-1" />
                  )}
                  {large ? "Standard size" : "Expand"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {OVERLAY_ORDER.map((o) => (
                    <Button
                      key={o}
                      size="sm"
                      variant={visible.has(o) ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => toggle(o)}
                    >
                      <span
                        className={cn("h-2 w-2 rounded-full mr-1.5", OVERLAY_META[o].swatch)}
                        aria-hidden
                      />
                      {OVERLAY_META[o].label} ({result.counts[o]})
                    </Button>
                  ))}
                </div>
                <RecoveryMap rows={result.rows} visible={visible} large={large} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">
                  Recovery detail ({rows.length} of {result.total})
                </CardTitle>
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by ID, description or grid"
                  className="h-8 w-64 text-xs"
                />
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-2">stable_id</th>
                      <th className="py-1 pr-2">description</th>
                      <th className="py-1 pr-2">canonical_grid_raw</th>
                      <th className="py-1 pr-2">FarmOps_grid_current</th>
                      <th className="py-1 pr-2">x_ft</th>
                      <th className="py-1 pr-2">y_ft</th>
                      <th className="py-1 pr-2">derived_new_grid</th>
                      <th className="py-1 pr-2">precision</th>
                      <th className="py-1 pr-2">evidence</th>
                      <th className="py-1 pr-2">confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.stable_id}-${r.stack_index}`} className="border-t align-top">
                        <td className="py-1 pr-2 font-mono">{r.stable_id}</td>
                        <td className="py-1 pr-2">{r.description}</td>
                        <td className="py-1 pr-2 font-mono">{r.canonical_grid_raw}</td>
                        <td
                          className={cn(
                            "py-1 pr-2 font-mono",
                            r.farmops_disagrees && "text-destructive",
                          )}
                        >
                          {r.farmops_grid_current}
                        </td>
                        <td className="py-1 pr-2">{r.x_ft ?? "—"}</td>
                        <td className="py-1 pr-2">{r.y_ft ?? "—"}</td>
                        <td className="py-1 pr-2 font-mono">{r.derived_new_grid ?? "—"}</td>
                        <td className="py-1 pr-2">{r.precision}</td>
                        <td className="py-1 pr-2 max-w-[22rem]">
                          {r.evidence.length ? r.evidence.join(" ") : "—"}
                        </td>
                        <td className="py-1 pr-2">{r.confidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-base">
                    Source-of-legacy-grid delta — {result.delta.changed} of {result.delta.compared}{" "}
                    migration record(s) change
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Same frozen transformation, run twice: once with the legacy grid taken from the
                    canonical ODS and once from FarmOps. {result.delta.unchanged} record(s) are
                    identical either way.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={onlyChanged ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setOnlyChanged((v) => !v)}
                >
                  {onlyChanged ? "Showing changed only" : "Show changed only"}
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-2">stable_id</th>
                      <th className="py-1 pr-2">canonical grid</th>
                      <th className="py-1 pr-2">FarmOps grid</th>
                      <th className="py-1 pr-2">canonical position</th>
                      <th className="py-1 pr-2">FarmOps position</th>
                      <th className="py-1 pr-2">canonical derived</th>
                      <th className="py-1 pr-2">FarmOps derived</th>
                      <th className="py-1 pr-2">changed fields</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deltaRows.map((r) => (
                      <tr key={r.stable_id} className="border-t align-top">
                        <td className="py-1 pr-2 font-mono">{r.stable_id}</td>
                        <td className="py-1 pr-2 font-mono">{r.canonical_grid_raw}</td>
                        <td className="py-1 pr-2 font-mono">{r.farmops_grid_current}</td>
                        <td className="py-1 pr-2">{r.canonical_position}</td>
                        <td className="py-1 pr-2">{r.farmops_position}</td>
                        <td className="py-1 pr-2 font-mono">{r.canonical_derived_grid}</td>
                        <td className="py-1 pr-2 font-mono">{r.farmops_derived_grid}</td>
                        <td className="py-1 pr-2">
                          {r.changed_fields.length ? r.changed_fields.join(", ") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Acceptance question — cause of the incorrect map
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  FarmOps grid values disagreeing with canonical:{" "}
                  <strong>{result.diagnosis.farmops_grid_disagreements}</strong>. Canonical
                  assignments contradicting their own recorded wall designation:{" "}
                  <strong>{result.diagnosis.canonical_placement_conflicts}</strong>.
                </p>
                {result.diagnosis.conflicts.length ? (
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    {result.diagnosis.conflicts.map((c) => (
                      <li key={c.stable_id}>
                        <span className="font-mono">{c.stable_id}</span> — {c.description}:{" "}
                        {c.conflict} {c.evidence}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No canonical Grid assignment contradicts its own recorded wall designation, so
                    the canonical placements are not implicated by the evidence available in record.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
