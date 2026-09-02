// Farm Shop grid-reference migration — PREVIEW ONLY.
//
// Old grid labels are decoded into physical feet inside the 40' x 60' envelope
// and remapped onto the corrected drawing's gridlines. Nothing on this page
// writes a record; ambiguous locations are flagged for owner review.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Grid3x3, RefreshCw } from "lucide-react";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  previewFarmShopGridMigration,
  type GridMigrationPayload,
} from "@/lib/electrical-grid-migration.functions";
import {
  auditLetterAxis,
  auditNumberAxis,
  axisAuditCsv,
  coordinateDerivations,
  locationCsv,
  migrationCsv,
  NEW_COLS,
  NEW_ROWS,
  type AxisAuditEntry,
  type GridConfidence,
  type GridPrecision,
} from "@/lib/electrical-grid-migration";

export const Route = createFileRoute("/electrical/grid-migration")({
  component: GridMigrationPage,
  head: () => ({
    meta: [
      { title: "Farm Shop Grid Migration Preview — Bostead Farms" },
      {
        name: "description",
        content:
          "Preview-only remap of Farm Shop load and panel grid references from the previous drawing to the corrected 40' x 60' grid, by physical position rather than label text.",
      },
      { property: "og:title", content: "Farm Shop Grid Migration Preview — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Every Farm Shop stable ID with a grid assignment, its old physical position, the proposed corrected grid cell, confidence and mapping basis. No writes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const CONF_VARIANT: Record<GridConfidence, "default" | "secondary" | "destructive"> = {
  HIGH: "default",
  MEDIUM: "secondary",
  REVIEW: "destructive",
};

const PRECISION_VARIANT: Record<GridPrecision, "default" | "secondary" | "destructive" | "outline"> = {
  EXACT: "default",
  NEAREST: "secondary",
  INTERVAL: "destructive",
  NON_FIXED: "outline",
  UNRESOLVED: "destructive",
};

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function GridMigrationPage() {
  const load = useServerFn(previewFarmShopGridMigration);
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<GridConfidence | "">("");

  const query = useQuery({
    queryKey: ["farm-shop-grid-migration"],
    queryFn: async () => (await load()) as unknown as GridMigrationPayload,
  });

  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    const needle = filter.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!only || r.confidence === only) &&
        (!needle ||
          `${r.stable_id} ${r.description} ${r.old_grid} ${r.grid_reference ?? ""} ${r.grid_reference_precision}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [query.data, filter, only]);

  return (
    <ElectricalGate>
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Grid3x3 className="h-4 w-4" /> Farm Shop grid-reference migration (preview only)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Population: the canonical Load_Master stable IDs and Grid values already on record,
              plus the Farm Shop panels. Old labels are interpreted with the previous drawing
              (letters A–G north→south over 40 ft, numbers 1–6 west→east over 60 ft, A6 = NE
              corner), converted to feet, then matched to the corrected drawing's gridlines (rows{" "}
              {NEW_ROWS.map((r) => r.label).join("/")} at 0/8/16/24/32/40 ft, columns{" "}
              {NEW_COLS.map((c) => c.label).join("/")} at 0/8/16/24/32/40/48/56/60 ft, north up).
              Physical positions are remapped, not label strings. Nothing here writes a record.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => query.refetch()}
                disabled={query.isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
              {query.data ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => download("farm-shop-grid-migration.csv", migrationCsv(query.data.rows))}
                >
                  <Download className="h-4 w-4" /> Migration CSV
                </Button>
              ) : null}
              {query.data ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    download("farm-shop-physical-location.csv", locationCsv(query.data.rows))
                  }
                >
                  <Download className="h-4 w-4" /> Physical-location CSV
                </Button>
              ) : null}
              {(["HIGH", "MEDIUM", "REVIEW"] as GridConfidence[]).map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={only === c ? "default" : "outline"}
                  onClick={() => setOnly(only === c ? "" : c)}
                >
                  {c} · {query.data?.summary[c.toLowerCase() as "high" | "medium" | "review"] ?? 0}
                </Button>
              ))}
            </div>

            {query.isPending ? <p className="text-muted-foreground">Loading records…</p> : null}
            {query.error ? (
              <p className="text-destructive">{(query.error as Error).message}</p>
            ) : null}

            {query.data ? (
              <>
                <p className="text-muted-foreground">
                  {query.data.summary.rows} record(s) in the migration population ·{" "}
                  {query.data.population.farm_shop_loads_with_grid} Farm Shop load(s) with a grid ·{" "}
                  {query.data.population.farm_shop_panels} Farm Shop panel(s) ·{" "}
                  {query.data.summary.anchored} placed directly from a drawn feature on the corrected
                  drawing
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["EXACT", query.data.precision.exact],
                      ["NEAREST", query.data.precision.nearest],
                      ["INTERVAL", query.data.precision.interval],
                      ["NON_FIXED", query.data.precision.non_fixed],
                      ["UNRESOLVED", query.data.precision.unresolved],
                    ] as [string, number][]
                  ).map(([label, n]) => (
                    <Badge key={label} variant="outline" className="font-mono">
                      {label} · {n}
                    </Badge>
                  ))}
                  <Badge variant="destructive" className="font-mono">
                    OWNER/FIELD DECISION · {query.data.precision.decisions_required}
                  </Badge>
                  <Badge variant="secondary" className="font-mono">
                    FIELD CONFIRMATION · {query.data.precision.field_confirmation_required}
                  </Badge>
                  <Badge variant="secondary" className="font-mono">
                    EVIDENCE RESOLVED · {query.data.precision.evidence_resolved}
                  </Badge>
                </div>
                <Input
                  placeholder="Filter by stable ID, description, old or proposed grid…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </>
            ) : null}
          </CardContent>
        </Card>

        <PersistedSection
          storageKey="grid-migration-axis-audit"
          title="Coordinate audit — old/new axis dictionaries (no writes)"
          defaultOpen
        >
          <div className="space-y-4 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  download(
                    "farm-shop-grid-axis-audit.csv",
                    axisAuditCsv([...auditLetterAxis(), ...auditNumberAxis()]),
                  )
                }
              >
                <Download className="h-4 w-4" /> Axis audit CSV
              </Button>
              <span className="text-xs text-muted-foreground">
                Corrected authority: rows A=0′ B=8′ C=16′ D=24′ E=32′ F=40′ (N→S); columns 1=0′ 2=8′
                3=16′ 4=24′ 5=32′ 6=40′ 7=48′ 8=56′ 9=60′ (W→E).
              </span>
            </div>
            <AxisTable
              caption="North → south letter axis (old A–G evenly over the 40 ft depth)"
              entries={auditLetterAxis()}
            />
            <AxisTable
              caption="West → east numeric axis (old 1–6 evenly over the 60 ft length, half steps interpolated)"
              entries={auditNumberAxis()}
            />
          </div>
        </PersistedSection>

        <PersistedSection
          storageKey="grid-migration-derivations"
          title="Physical-coordinate derivations for the cases raised"
          defaultOpen
        >
          <div className="space-y-3 p-2 text-sm">
            {coordinateDerivations().map((d) => (
              <div key={d.label}>
                <p className="font-medium">{d.label}</p>
                <p className="text-muted-foreground">{d.detail}</p>
              </div>
            ))}
          </div>
        </PersistedSection>

        {query.data ? (
          <>
            <PersistedSection
              storageKey="grid-migration-rows"
              title={`Proposed grid migration (${rows.length}) — nothing is written`}
              defaultOpen
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">Stable ID</th>
                      <th className="p-2">Description</th>
                      <th className="p-2">Old grid</th>
                      <th className="p-2">x ft (E of W wall)</th>
                      <th className="p-2">y ft (S of N wall)</th>
                      <th className="p-2">Proposed grid</th>
                      <th className="p-2">Precision</th>
                      <th className="p-2">x err</th>
                      <th className="p-2">y err</th>
                      <th className="p-2">Confidence</th>
                      <th className="p-2">Review</th>
                      <th className="p-2">Provenance / evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.kind}-${r.stable_id}`} className="border-t border-border align-top">
                        <td className="p-2 font-mono text-xs">{r.stable_id}</td>
                        <td className="p-2">{r.description || "—"}</td>
                        <td className="p-2 font-mono text-xs">{r.legacy_grid || r.old_grid}</td>
                        <td className="p-2 font-mono text-xs">{r.location_x_ft ?? "—"}</td>
                        <td className="p-2 font-mono text-xs">{r.location_y_ft ?? "—"}</td>
                        <td className="p-2 font-mono">
                          {r.grid_reference ?? (
                            <span className="text-destructive">UNRESOLVED</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant={PRECISION_VARIANT[r.grid_reference_precision]}>
                            {r.grid_reference_precision}
                          </Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">{r.x_error_ft ?? "—"}</td>
                        <td className="p-2 font-mono text-xs">{r.y_error_ft ?? "—"}</td>
                        <td className="p-2">
                          <Badge variant={CONF_VARIANT[r.confidence]}>{r.confidence}</Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {r.review_required ? (
                            <span className="font-medium text-destructive">YES</span>
                          ) : (
                            "no"
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {r.grid_migration_provenance}
                          {r.supporting_evidence.map((e) => (
                            <span key={e} className="mt-1 block">
                              {e}
                            </span>
                          ))}
                          {r.review_reason ? (
                            <span className="mt-1 block font-medium text-foreground">
                              {r.review_reason}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="grid-migration-proposed-fields"
              title="Proposed nullable location fields (proposal only — nothing is created)"
            >
              <div className="space-y-2 p-2 text-sm text-muted-foreground">
                <p>
                  Physical position is the authoritative migrated location; the grid reference is its
                  human-readable representation. For Farm Shop loads and panels the proposal is:
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <span className="font-mono text-foreground">location_x_ft</span> — feet east of
                    the west wall (nullable)
                  </li>
                  <li>
                    <span className="font-mono text-foreground">location_y_ft</span> — feet south of
                    the north wall (nullable)
                  </li>
                  <li>
                    <span className="font-mono text-foreground">grid_reference</span> — derived
                    display reference, interval notation allowed (nullable)
                  </li>
                  <li>
                    <span className="font-mono text-foreground">grid_reference_precision</span> —
                    EXACT | NEAREST | INTERVAL | NON_FIXED (UNRESOLVED left null in record terms)
                  </li>
                  <li>
                    <span className="font-mono text-foreground">grid_migration_provenance</span> —
                    how the position was established
                  </li>
                </ul>
                <p>
                  The existing <span className="font-mono text-foreground">grid</span> value is
                  preserved separately as legacy audit history and is not overwritten by this model.
                </p>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="grid-migration-conventions"
              title="Grid conventions used as authority"
            >
              <div className="space-y-2 p-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Previous drawing (interpretation
                  only):</span> letters A–G run north to south across the 40 ft depth, numbers 1–6
                  run west to east across the 60 ft length, so A6 is the north-east corner and column
                  6 is the east wall — which is what the "East Wall" rows (B6, D6, E6, F6, G6)
                  record.
                </p>
                <p>
                  <span className="font-medium text-foreground">Corrected drawing (authority):</span>{" "}
                  40'-0" x 60'-0" envelope, north up. Rows A–F at 0/8/16/24/32/40 ft from the north
                  wall; columns 1–9 at 0/8/16/24/32/40/48/56/60 ft from the west wall. Drawn
                  features used directly: GD2 (3'-10½"–15'-10½" north wall), GD1
                  (24'-1½"–36'-1½" north wall), MAN DOOR (NE) at 55'-6"–58'-6", MAN DOOR (SW) on the
                  west wall at ~32 ft.
                </p>
                <p>
                  Half-step old references (C2.5, D4.5, F4.5, F5.5, G4.5, G5.5) are taken as the
                  physical midpoint between their two number lines, never as label text. A position
                  that lands midway between two corrected gridlines is left for owner review rather
                  than rounded silently.
                </p>
              </div>
            </PersistedSection>
          </>
        ) : null}
      </div>
    </ElectricalGate>
  );
}

const AXIS_STATUS_VARIANT: Record<AxisAuditEntry["status"], "default" | "secondary" | "destructive"> =
  {
    EXACT_LINE_MATCH: "default",
    NEAREST_LINE_WITHIN_TOLERANCE: "secondary",
    EQUIDISTANT_OWNER_REVIEW: "destructive",
    OUT_OF_RANGE: "destructive",
  };

function AxisTable({ caption, entries }: { caption: string; entries: AxisAuditEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <p className="pb-1 text-sm font-medium">{caption}</p>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="p-2">Old token</th>
            <th className="p-2">Interpreted physical feet</th>
            <th className="p-2">New token(s)</th>
            <th className="p-2">New physical feet</th>
            <th className="p-2">Distance / error</th>
            <th className="p-2">Mapping status</th>
            <th className="p-2">Derivation</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.axis}-${e.old_token}`} className="border-t border-border align-top">
              <td className="p-2 font-mono text-xs">{e.old_token}</td>
              <td className="p-2 font-mono text-xs">{e.old_ft}′</td>
              <td className="p-2 font-mono text-xs">
                {e.status === "EQUIDISTANT_OWNER_REVIEW"
                  ? `${e.new_tokens.join("–")} (interval)`
                  : e.new_tokens.join(", ")}
              </td>
              <td className="p-2 font-mono text-xs">{e.new_ft.map((f) => `${f}′`).join(" / ")}</td>
              <td className="p-2 font-mono text-xs">{e.distance_ft}′</td>
              <td className="p-2">
                <Badge variant={AXIS_STATUS_VARIANT[e.status]}>{e.status}</Badge>
              </td>
              <td className="p-2 text-xs text-muted-foreground">{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
