// Generated Mermaid diagram viewer. Diagrams are views over the authoritative
// records — nothing here writes electrical data.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DIAGRAM_LABELS,
  DIAGRAM_TYPES,
  STATE_FILTERS,
  STATE_FILTER_LABELS,
  type DiagramType,
  type StateFilter,
} from "@/lib/electrical-mermaid";
import { generateElectricalDiagram } from "@/lib/electrical-diagrams.functions";
import { Copy, Download, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/electrical/diagrams")({
  head: () => ({
    meta: [
      { title: "Electrical Topology Diagrams | Bostead FarmOps" },
      {
        name: "description",
        content:
          "Generate Mermaid topology diagrams from the FarmOps electrical records: panels, raceways, junction boxes, branch runs and loads.",
      },
      { property: "og:title", content: "Electrical Topology Diagrams | Bostead FarmOps" },
      {
        property: "og:description",
        content:
          "Deterministic Mermaid diagrams generated from authoritative panel, raceway, junction box, branch run and load records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiagramsPage,
});

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function MermaidView({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "neutral" });
        const id = `d${Math.random().toString(36).slice(2)}`;
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <p className="text-sm text-destructive">
        This diagram could not be rendered: {error}. The Mermaid source below is still valid to
        copy.
      </p>
    );
  }
  return <div ref={ref} className="overflow-auto [&_svg]:max-w-none" />;
}

function DiagramsPage() {
  const [type, setType] = useState<DiagramType>("whole_system");
  const [state, setState] = useState<StateFilter>("all");
  const [focus, setFocus] = useState("");
  const [panel, setPanel] = useState("");
  const [building, setBuilding] = useState("");
  const [grid, setGrid] = useState("");
  const [circuitGroup, setCircuitGroup] = useState("");
  const [environment, setEnvironment] = useState("");

  const filters = useMemo(
    () => ({
      type,
      state,
      ...(focus ? { focus } : {}),
      ...(panel ? { panel } : {}),
      ...(building ? { building } : {}),
      ...(grid ? { grid } : {}),
      ...(circuitGroup ? { circuitGroup } : {}),
      ...(environment ? { environment } : {}),
    }),
    [type, state, focus, panel, building, grid, circuitGroup, environment],
  );

  const q = useQuery({
    queryKey: ["electrical-diagram", filters],
    queryFn: () => generateElectricalDiagram({ data: filters }),
  });

  const options = q.data?.options;
  const focusOptions =
    type === "single_panel"
      ? (options?.panels ?? [])
      : type === "raceway"
        ? (options?.raceways ?? [])
        : type === "jbox"
          ? (options?.jboxes ?? [])
          : [];
  const needsFocus = focusOptions.length > 0 || ["single_panel", "raceway", "jbox"].includes(type);

  const source = q.data?.mermaid ?? "";
  const errors = (q.data?.issues ?? []).filter((i) => i.severity === "error");
  const warnings = (q.data?.issues ?? []).filter((i) => i.severity === "warning");

  const copy = async () => {
    await navigator.clipboard.writeText(source);
    toast.success("Mermaid source copied");
  };
  const download = () => {
    const blob = new Blob([source], { type: "text/vnd.mermaid" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `farmops-electrical-${type}${focus ? `-${focus}` : ""}.mmd`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Diagram</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Diagram type
                <select
                  className={selectClass}
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as DiagramType);
                    setFocus("");
                  }}
                >
                  {DIAGRAM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DIAGRAM_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Installation state
                <select
                  className={selectClass}
                  value={state}
                  onChange={(e) => setState(e.target.value as StateFilter)}
                >
                  {STATE_FILTERS.map((s) => (
                    <option key={s} value={s}>
                      {STATE_FILTER_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>

              {needsFocus ? (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Focus record
                  <select
                    className={selectClass}
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {focusOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Panel
                <select
                  className={selectClass}
                  value={panel}
                  onChange={(e) => setPanel(e.target.value)}
                >
                  <option value="">All panels</option>
                  {(options?.panels ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Building
                <select
                  className={selectClass}
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                >
                  <option value="">All buildings</option>
                  {(options?.buildings ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Grid
                <select className={selectClass} value={grid} onChange={(e) => setGrid(e.target.value)}>
                  <option value="">All grids</option>
                  {(options?.grids ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Circuit group
                <select
                  className={selectClass}
                  value={circuitGroup}
                  onChange={(e) => setCircuitGroup(e.target.value)}
                >
                  <option value="">All circuit groups</option>
                  {(options?.circuitGroups ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Infrastructure type
                <select
                  className={selectClass}
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                >
                  <option value="">All environments</option>
                  {(options?.environments ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copy} disabled={!source}>
                  <Copy className="h-4 w-4 mr-1" /> Copy source
                </Button>
                <Button variant="outline" size="sm" onClick={download} disabled={!source}>
                  <Download className="h-4 w-4 mr-1" /> Download .mmd
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Generated view only. Mermaid diagrams are not a substitute for stamped electrical
              drawings, one-line diagrams or code-required construction documents.
            </p>
          </CardContent>
        </Card>

        {q.data?.issues.length ? (
          <Card className="border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Topology validation
                <Badge variant="outline">{errors.length} errors</Badge>
                <Badge variant="outline">{warnings.length} warnings</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {q.data.issues.map((i, n) => (
                  <li key={`${i.code}-${n}`} className="flex items-start gap-2">
                    <Badge variant={i.severity === "error" ? "destructive" : "secondary"}>
                      {i.code.replace(/_/g, " ")}
                    </Badge>
                    <span className={i.severity === "error" ? "" : "text-muted-foreground"}>
                      {i.message}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {DIAGRAM_LABELS[type]}
              {focus ? ` · ${focus}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : q.error ? (
              <p className="text-sm text-destructive">
                {q.error instanceof Error ? q.error.message : "Could not generate the diagram."}
              </p>
            ) : (
              <MermaidView source={source} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mermaid source</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea readOnly value={source} rows={14} className="font-mono text-xs" />
          </CardContent>
        </Card>
      </div>
    </ElectricalGate>
  );
}
