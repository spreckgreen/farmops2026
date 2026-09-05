// DEMO-ONLY clickable site mock-up for the public sample farm page.
//
// Reads nothing from the database — every value comes from the DEMO- prefixed
// fixture modules.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MapPin } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DEMO_BUILDINGS,
  DEMO_MODULES,
  DEMO_SITE_EXTENT,
  demoBuildingCounts,
  type DemoBuilding,
  type DemoRecord,
} from "@/lib/demo-sample-site";
import { DEMO_LOADS } from "@/lib/demo-sample-farm";

const TONE_VARIANT: Record<DemoRecord["tone"], "default" | "secondary" | "destructive" | "outline"> =
  {
    ok: "secondary",
    due: "default",
    attention: "destructive",
    planned: "outline",
  };

function SiteMap({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { widthFt, depthFt } = DEMO_SITE_EXTENT;
  return (
    <svg
      viewBox={`-10 -10 ${widthFt + 20} ${depthFt + 20}`}
      className="w-full rounded-lg border border-border bg-card"
      role="img"
      aria-label="Demo site plan with five buildings"
    >
      <rect
        x={-10}
        y={-10}
        width={widthFt + 20}
        height={depthFt + 20}
        fill="var(--muted)"
        opacity={0.25}
      />
      {DEMO_BUILDINGS.map((b) => {
        const active = selected === b.id;
        return (
          <g
            key={b.id}
            onClick={() => onSelect(active ? null : b.id)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={b.xFt}
              y={b.yFt}
              width={b.widthFt}
              height={b.depthFt}
              fill={active ? "var(--primary)" : "var(--card)"}
              fillOpacity={active ? 0.25 : 1}
              stroke={active ? "var(--primary)" : "var(--foreground)"}
              strokeWidth={active ? 2 : 1}
            />
            <text
              x={b.xFt + b.widthFt / 2}
              y={b.yFt + b.depthFt / 2}
              textAnchor="middle"
              fontSize={9}
              fill="var(--foreground)"
            >
              {b.code}
            </text>
            <text
              x={b.xFt + b.widthFt / 2}
              y={b.yFt + b.depthFt / 2 + 11}
              textAnchor="middle"
              fontSize={7}
              fill="var(--muted-foreground)"
            >
              {b.widthFt}′ × {b.depthFt}′
            </text>
          </g>
        );
      })}
      <text x={0} y={depthFt + 16} fontSize={8} fill="var(--muted-foreground)">
        North is up · {widthFt}′ × {depthFt}′ of the demo site shown
      </text>
    </svg>
  );
}

function RecordRow({
  record,
  building,
  open,
  onToggle,
}: {
  record: DemoRecord;
  building: DemoBuilding | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-t border-border first:border-t-0">
      <button
        className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-muted/40"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>
          <span className="text-sm font-medium">{record.title}</span>
          <span className="block text-xs text-muted-foreground">
            {record.id} · {building?.name ?? "site"} · {record.grid}
          </span>
        </span>
        <Badge variant={TONE_VARIANT[record.tone]} className="shrink-0">
          {record.status}
        </Badge>
      </button>
      {open ? (
        <ul className="space-y-1 px-3 pb-3 text-xs text-muted-foreground">
          {record.detail.map((line) => (
            <li key={line} className="flex gap-2">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DemoSiteExplorer() {
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const building = DEMO_BUILDINGS.find((b) => b.id === buildingId) ?? null;

  const counts = useMemo(
    () => (building ? demoBuildingCounts(building.id) : null),
    [building],
  );
  const electricalCount = building?.id === "DEMO-BLDG-1" ? DEMO_LOADS.length : 0;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">The whole sample site</h2>
        <p className="text-sm text-muted-foreground">
          Tap a building to narrow every list below to that building, then tap any line to open its
          example record.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <SiteMap
          selected={buildingId}
          onSelect={(id) => {
            setBuildingId(id);
            setOpenRecord(null);
          }}
        />
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          {building ? (
            <>
              <div>
                <p className="text-sm font-medium">{building.name}</p>
                <p className="text-xs text-muted-foreground">
                  {building.code} · {building.widthFt}′ × {building.depthFt}′ ·{" "}
                  {building.gridCellFt}′ cells, {building.gridLabel}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">{building.note}</p>
              <ul className="space-y-1 text-sm">
                {electricalCount ? (
                  <li>{electricalCount} electrical items</li>
                ) : null}
                {counts
                  ? DEMO_MODULES.filter((m) => counts[m.key] > 0).map((m) => (
                      <li key={m.key}>
                        {counts[m.key]} {m.label.toLowerCase()} records
                      </li>
                    ))
                  : null}
              </ul>
              <Button size="sm" variant="outline" onClick={() => setBuildingId(null)}>
                Show the whole site
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Whole site</p>
              <p className="text-sm text-muted-foreground">
                Five buildings, each with its own location grid, sharing one set of records. Nothing
                here is real equipment — it is example data so you can click through how the modules
                fit together.
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {DEMO_BUILDINGS.map((b) => (
                  <li key={b.id}>
                    <button className="hover:underline" onClick={() => setBuildingId(b.id)}>
                      {b.code} — {b.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue={DEMO_MODULES[0]!.key} className="space-y-3">
        <TabsList className="flex-wrap">
          {DEMO_MODULES.map((m) => (
            <TabsTrigger key={m.key} value={m.key}>
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {DEMO_MODULES.map((m) => {
          const rows = building
            ? m.records.filter((r) => r.buildingId === building.id)
            : m.records;
          return (
            <TabsContent key={m.key} value={m.key} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{m.blurb}</p>
                <Button asChild size="sm" variant="outline">
                  <Link to={m.to}>
                    {m.label} deck
                    <ArrowUpRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              {rows.length ? (
                <ul className="rounded-lg border border-border bg-card">
                  {rows.map((r) => (
                    <RecordRow
                      key={r.id}
                      record={r}
                      building={DEMO_BUILDINGS.find((b) => b.id === r.buildingId)}
                      open={openRecord === r.id}
                      onToggle={() => setOpenRecord(openRecord === r.id ? null : r.id)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No {m.label.toLowerCase()} example records at {building?.name}. Choose another
                  building, or show the whole site.
                </p>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}
