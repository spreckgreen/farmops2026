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
  migrationCsv,
  NEW_COLS,
  NEW_ROWS,
  type AxisAuditEntry,
  type GridConfidence,
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
          `${r.stable_id} ${r.description} ${r.old_grid} ${r.proposed_new_grid ?? ""}`
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
                <Input
                  placeholder="Filter by stable ID, description, old or proposed grid…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </>
            ) : null}
          </CardContent>
        </Card>

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
                      <th className="p-2">Old physical position</th>
                      <th className="p-2">Proposed new grid</th>
                      <th className="p-2">Confidence</th>
                      <th className="p-2">Mapping basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.kind}-${r.stable_id}`} className="border-t border-border align-top">
                        <td className="p-2 font-mono text-xs">{r.stable_id}</td>
                        <td className="p-2">{r.description || "—"}</td>
                        <td className="p-2 font-mono text-xs">{r.old_grid}</td>
                        <td className="p-2 text-xs">{r.old_physical_position}</td>
                        <td className="p-2 font-mono">
                          {r.proposed_new_grid ?? (
                            <span className="text-destructive">OWNER REVIEW</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant={CONF_VARIANT[r.confidence]}>{r.confidence}</Badge>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {r.mapping_basis}
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
