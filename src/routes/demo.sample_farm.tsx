// /demo/sample-farm — public, demo-only example farm.
//
// Reads nothing from the database. Every value comes from the DEMO- prefixed
// fixture module, so the real Farm Shop records are never involved.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, MapPin } from "lucide-react";
import {
  DEMO_CIRCUITS,
  DEMO_PANELS,
  DEMO_SITE,
  DEMO_STAGE_LABEL,
  DEMO_STAGE_PERCENT,
  demoPanelRollups,
  resolveDemoFarm,
  type DemoResolvedLoad,
} from "@/lib/demo-sample-farm";
import type { EffectiveLocationSource } from "@/lib/electrical-effective-location";

const TITLE = "Sample Farm — FarmOps Electrical Demo";
const DESCRIPTION =
  "A demo-only example farm with panels, circuits, loads and measured locations, showing the FarmOps design-to-field workflow and the shared location resolver in action. No sign-in required.";

export const Route = createFileRoute("/demo/sample_farm")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SampleFarmPage,
});

const SOURCE_COLOR: Record<EffectiveLocationSource, string> = {
  FIELD_OBSERVED_POLE_ALIGNMENT: "var(--chart-1)",
  FIELD_OBSERVED_GRID: "var(--chart-2)",
  APPROVED_DESIGN_CORNER_FACE: "var(--chart-3)",
  APPROVED_DESIGN_XY: "var(--chart-4)",
  GRID_REMAPPED: "var(--chart-5)",
  ORIGINAL_GRID: "var(--muted-foreground)",
};

const SOURCE_LABEL: Record<EffectiveLocationSource, string> = {
  FIELD_OBSERVED_POLE_ALIGNMENT: "Field observed — post alignment",
  FIELD_OBSERVED_GRID: "Field evidence accepted",
  APPROVED_DESIGN_CORNER_FACE: "Approved design — corner and face",
  APPROVED_DESIGN_XY: "Approved design — exact position",
  GRID_REMAPPED: "Remapped from the old grid",
  ORIGINAL_GRID: "Original grid only",
};

function Plan({
  rows,
  selected,
  onSelect,
}: {
  rows: DemoResolvedLoad[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const w = DEMO_SITE.widthFt;
  const d = DEMO_SITE.depthFt;
  return (
    <svg
      viewBox={`-6 -6 ${w + 12} ${d + 12}`}
      className="w-full rounded-lg border border-border bg-card"
      role="img"
      aria-label="Demo farm building plan with equipment positions"
    >
      <rect x={0} y={0} width={w} height={d} fill="var(--muted)" opacity={0.35} />
      {Array.from({ length: 8 }, (_, i) => (i + 1) * (w / 9)).map((x) => (
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={d} stroke="var(--border)" strokeWidth={0.1} />
      ))}
      {Array.from({ length: 5 }, (_, i) => (i + 1) * (d / 6)).map((y) => (
        <line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke="var(--border)" strokeWidth={0.1} />
      ))}
      <rect x={0} y={0} width={w} height={d} fill="none" stroke="var(--foreground)" strokeWidth={0.4} />
      {rows.map((r) => {
        const design = r.resolved.statements.find(
          (s) =>
            (s.source === "APPROVED_DESIGN_XY" || s.source === "APPROVED_DESIGN_CORNER_FACE") &&
            s.xFt != null,
        );
        const field = r.resolved.statements.find(
          (s) => s.source === "FIELD_OBSERVED_GRID" && s.xFt != null,
        );
        if (!design || !field) return null;
        return (
          <line
            key={`${r.load.stableId}-link`}
            x1={design.xFt!}
            y1={design.yFt!}
            x2={field.xFt!}
            y2={field.yFt!}
            stroke="var(--muted-foreground)"
            strokeWidth={0.15}
            strokeDasharray="0.6 0.6"
          />
        );
      })}
      {rows.map((r) => {
        const design = r.resolved.statements.find(
          (s) =>
            (s.source === "APPROVED_DESIGN_XY" || s.source === "APPROVED_DESIGN_CORNER_FACE") &&
            s.xFt != null &&
            s.source !== r.resolved.effective?.source,
        );
        if (!design) return null;
        return (
          <circle
            key={`${r.load.stableId}-design`}
            cx={design.xFt!}
            cy={design.yFt!}
            r={0.8}
            fill="none"
            stroke={SOURCE_COLOR[design.source]}
            strokeWidth={0.25}
          />
        );
      })}
      {rows.map((r) => {
        if (r.xFt == null || r.yFt == null) return null;
        const active = selected === r.load.stableId;
        return (
          <g
            key={r.load.stableId}
            onClick={() => onSelect(active ? null : r.load.stableId)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={r.xFt}
              cy={r.yFt}
              r={active ? 1.5 : 1}
              fill={SOURCE_COLOR[r.resolved.effective!.source]}
              stroke="var(--background)"
              strokeWidth={0.2}
            />
            {active ? (
              <text
                x={r.xFt + 2}
                y={r.yFt + 0.6}
                fontSize={1.8}
                fill="var(--foreground)"
              >
                {r.load.stableId}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function SampleFarmPage() {
  const rows = useMemo(() => resolveDemoFarm(), []);
  const rollups = useMemo(() => demoPanelRollups(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = rows.find((r) => r.load.stableId === selected) ?? null;
  const unplotted = rows.filter((r) => r.xFt == null);

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <Link to="/demo" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All demos
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{DEMO_SITE.name}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {DEMO_SITE.note} It exists so you can see how an approved design position becomes a
          confirmed field position, and how FarmOps always tells you which record it is showing
          you and why.
        </p>
      </header>

      <DemoSiteExplorer />

      <section className="space-y-1">
        <h2 className="text-lg font-medium">Electrical, in detail</h2>
        <p className="text-sm text-muted-foreground">
          The main barn's panels, circuits and items, showing how an approved design position
          becomes a confirmed field position.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">

        {rollups.map((r) => (
          <div key={r.panel.stableId} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium">{r.panel.name}</p>
            <p className="text-xs text-muted-foreground">{r.panel.stableId}</p>
            <p className="mt-2 text-sm">{r.panel.mains}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {r.circuits} circuits · {r.loads} items · {r.averagePercent}% complete
            </p>
            {r.panel.kind === "logical" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Grouping only — the same items are already counted on {r.panel.physicalPanel}.
              </p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Where everything sits</h2>
          <Plan rows={rows} selected={selected} onSelect={setSelected} />
          <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(Object.keys(SOURCE_LABEL) as EffectiveLocationSource[])
              .filter((s) => s !== "FIELD_OBSERVED_POLE_ALIGNMENT")
              .map((s) => (
                <li key={s} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: SOURCE_COLOR[s] }}
                  />
                  {SOURCE_LABEL[s]}
                </li>
              ))}
            <li className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-muted-foreground" />
              Hollow ring: the approved design position it replaced
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-medium">
            {chosen ? chosen.load.stableId : "Pick an item on the plan"}
          </h2>
          {chosen ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-medium">{chosen.load.description}</p>
              <p className="text-muted-foreground">
                {chosen.load.panel} · {chosen.load.circuit} ·{" "}
                {DEMO_STAGE_LABEL[chosen.load.stage]} ({DEMO_STAGE_PERCENT[chosen.load.stage]}%)
              </p>
              <p className="inline-flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{chosen.provenance}</span>
              </p>
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Everything on record, strongest first
                </p>
                {chosen.resolved.statements.map((s) => (
                  <div key={`${s.source}-${s.id ?? ""}`} className="text-xs">
                    <span className="font-medium">{SOURCE_LABEL[s.source]}</span>
                    {" — "}
                    {s.label ?? s.raw ?? "no value"}
                    {s.source === chosen.resolved.effective?.source ? " (shown on the plan)" : " (kept for comparison)"}
                    {s.evidence ? <span className="block text-muted-foreground">{s.evidence}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Tap any dot to see the confirmed position, the approved design position it replaced,
              and the note that was recorded in the field.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Design to field, item by item</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Item</th>
                <th className="p-2">Circuit</th>
                <th className="p-2">Approved design</th>
                <th className="p-2">Field confirmed</th>
                <th className="p-2">Shown as</th>
                <th className="p-2">Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const design = r.resolved.statements.find(
                  (s) =>
                    s.source === "APPROVED_DESIGN_XY" ||
                    s.source === "APPROVED_DESIGN_CORNER_FACE",
                );
                const field = r.resolved.statements.find((s) => s.source === "FIELD_OBSERVED_GRID");
                return (
                  <tr key={r.load.stableId} className="border-t border-border">
                    <td className="p-2">
                      <button className="text-left hover:underline" onClick={() => setSelected(r.load.stableId)}>
                        <span className="font-medium">{r.load.stableId}</span>
                        <span className="block text-xs text-muted-foreground">{r.load.description}</span>
                      </button>
                    </td>
                    <td className="p-2 text-xs">{r.load.circuit}</td>
                    <td className="p-2 text-xs">{design?.label ?? "—"}</td>
                    <td className="p-2 text-xs">{field?.label ?? "not yet walked"}</td>
                    <td className="p-2 text-xs">
                      {r.resolved.effective ? SOURCE_LABEL[r.resolved.effective.source] : "no location"}
                    </td>
                    <td className="p-2 text-xs">
                      {DEMO_STAGE_LABEL[r.load.stage]} · {DEMO_STAGE_PERCENT[r.load.stage]}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unplotted.length ? (
          <p className="text-sm text-muted-foreground">
            {unplotted.length} item(s) have no position good enough to draw, so they are listed
            rather than guessed at.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Circuits behind it</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Circuit</th>
                <th className="p-2">Panel</th>
                <th className="p-2">Breaker</th>
                <th className="p-2">Size</th>
                <th className="p-2">Type</th>
                <th className="p-2">Serves</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_CIRCUITS.map((c) => (
                <tr key={c.stableId} className="border-t border-border">
                  <td className="p-2 text-xs font-medium">{c.stableId}</td>
                  <td className="p-2 text-xs">{c.panel}</td>
                  <td className="p-2 text-xs">
                    {c.panel}-B{c.breaker}
                  </td>
                  <td className="p-2 text-xs">
                    {c.amps} A · {c.poles === 2 ? "2-pole" : "1-pole"}
                  </td>
                  <td className="p-2 text-xs">{c.classification === "dedicated" ? "Dedicated" : "Shared"}</td>
                  <td className="p-2 text-xs">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Demo data only. {DEMO_PANELS.length} panels, {DEMO_CIRCUITS.length} circuits,{" "}
          {rows.length} items.
        </p>
      </section>
    </main>
  );
}
