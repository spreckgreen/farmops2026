// Electrical topology pack: pick topology views from a collapsible
// Service → Panel → Junction box → Raceway → Load tree and export them as
// HTML, SVG or PDF. Read-only view over the authoritative records.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { CollapsibleGroup } from "@/components/electrical/collapsible-section";
import { generateElectricalDiagram } from "@/lib/electrical-diagrams.functions";
import {
  STATE_FILTERS,
  STATE_FILTER_LABELS,
  type StateFilter,
} from "@/lib/electrical-mermaid";
import {
  TOPOLOGY_TREE,
  topologyFilename,
  topologyHtml,
  topologyNode,
  type TopologyTreeNode,
} from "@/lib/electrical-topology-tree";
import { FileCode2, FileImage, Printer, Download } from "lucide-react";

const MERMAID_URL = "https://esm.sh/mermaid@11.17.2";
const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground";

export const Route = createFileRoute("/electrical/topology")({
  component: TopologyPage,
  head: () => ({
    meta: [
      { title: "Electrical Topology Pack — Bostead Farms" },
      {
        name: "description",
        content:
          "Select and export electrical topology views — service, panel, raceway, junction box and load diagrams — as HTML, SVG or PDF.",
      },
      { property: "og:title", content: "Electrical Topology Pack — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Pick the topology views worth printing and export them as a self-contained HTML, SVG or PDF pack.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const PRINT_CSS = `
@media print {
  body:has(.topology-pack) header,
  body:has(.topology-pack) nav,
  body:has(.topology-pack) .topology-no-print { display: none !important; }
  body:has(.topology-pack) .topology-pack { max-width: none; padding: 0; }
  .topology-figure { break-inside: avoid; page-break-inside: avoid; }
  @page { size: letter landscape; margin: 0.5in; }
}
`;

interface Figure {
  title: string;
  svg: string;
  mermaid: string;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Renders one selected topology view and hands its SVG up for the exports. */
function TopologyFigure({
  node,
  focus,
  state,
  onFigure,
}: {
  node: TopologyTreeNode;
  focus: string;
  state: StateFilter;
  onFigure: (key: string, figure: Figure | null) => void;
}) {
  const fetcher = useServerFn(generateElectricalDiagram);
  const q = useQuery({
    queryKey: ["electrical", "topology", node.type, focus, state],
    queryFn: () =>
      fetcher({ data: { type: node.type, state, ...(focus ? { focus } : {}) } }),
  });
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = q.data?.mermaid ?? "";
  const key = `${node.type}${focus ? `:${focus}` : ""}`;
  const title = focus ? `${node.label} — ${focus}` : node.label;

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = (await import(/* @vite-ignore */ MERMAID_URL)) as { default?: unknown };
        const mermaid = (mod.default ?? mod) as {
          initialize: (c: Record<string, unknown>) => void;
          render: (id: string, src: string) => Promise<{ svg: string }>;
        };
        // htmlLabels:false keeps every label as native <text>, so exported SVGs
        // open correctly outside a browser (foreignObject HTML does not).
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "loose",
          flowchart: { htmlLabels: false },
        });
        const out = await mermaid.render(`tp-${node.type}-${Date.now()}`, source);
        if (cancelled) return;
        setSvg(out.svg);
        setError(null);
        onFigure(key, { title, svg: out.svg, mermaid: source });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  useEffect(() => () => onFigure(key, null), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="topology-figure space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {node.focus && !focus ? (
        <p className="text-xs text-muted-foreground">
          Pick a focus record above to render this view.
        </p>
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : error ? (
        <pre className="overflow-x-auto rounded-md border border-border p-2 text-[10px]">
          {source}
        </pre>
      ) : svg ? (
        <div
          className="overflow-x-auto rounded-md border border-border bg-card p-2 [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </div>
  );
}

function TopologyPage() {
  return (
    <ElectricalGate>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <TopologyPack />
    </ElectricalGate>
  );
}

function TopologyPack() {
  const fetcher = useServerFn(generateElectricalDiagram);
  const optionsQuery = useQuery({
    queryKey: ["electrical", "topology", "options"],
    queryFn: () => fetcher({ data: { type: "whole_system", state: "all" } }),
  });
  const options = optionsQuery.data?.options;

  const [state, setState] = useState<StateFilter>("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({
    whole_system: true,
    site: true,
  });
  const [focusByType, setFocusByType] = useState<Record<string, string>>({});
  const [figures, setFigures] = useState<Record<string, Figure>>({});
  const generatedAt = useMemo(() => new Date().toISOString(), []);

  const chosen = TOPOLOGY_TREE.flatMap((g) => g.nodes).filter((n) => selected[n.type]);
  const figureList = Object.values(figures);

  const focusOptions = (node: TopologyTreeNode): string[] =>
    node.focus ? ((options?.[node.focus] as string[] | undefined) ?? []) : [];

  const onFigure = (key: string, figure: Figure | null) =>
    setFigures((prev) => {
      if (!figure) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (prev[key]?.svg === figure.svg) return prev;
      return { ...prev, [key]: figure };
    });

  const requireFigures = () => {
    if (figureList.length === 0) {
      toast.error("Nothing rendered yet — select a topology view and wait for it to draw.");
      return false;
    }
    return true;
  };

  const exportHtml = () => {
    if (!requireFigures()) return;
    saveBlob(
      new Blob([topologyHtml(generatedAt, figureList)], { type: "text/html" }),
      topologyFilename(generatedAt, "html"),
    );
    toast.success("HTML topology pack downloaded");
  };

  const exportSvgs = () => {
    if (!requireFigures()) return;
    figureList.forEach((f, i) => {
      const name = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      setTimeout(
        () =>
          saveBlob(
            new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${f.svg}`], {
              type: "image/svg+xml",
            }),
            `bostead-electrical-${name}.svg`,
          ),
        i * 250,
      );
    });
    toast.success(`Exporting ${figureList.length} SVG file(s)`);
  };

  const exportMermaid = () => {
    if (!requireFigures()) return;
    const text = figureList.map((f) => `%% ${f.title}\n${f.mermaid}`).join("\n\n");
    saveBlob(new Blob([text], { type: "text/vnd.mermaid" }), topologyFilename(generatedAt, "mmd"));
    toast.success("Mermaid sources downloaded");
  };

  return (
    <div className="topology-pack space-y-4">
      <Card className="topology-no-print">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Topology pack</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Pick only the topology views that are worth printing — the tree follows the reading
            order service → panel → junction box → raceway → load. Exporting never changes a
            record.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
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
            <Button size="sm" variant="outline" onClick={exportHtml}>
              <FileCode2 className="mr-1.5 h-4 w-4" />
              Download HTML
            </Button>
            <Button size="sm" variant="outline" onClick={exportSvgs}>
              <FileImage className="mr-1.5 h-4 w-4" />
              Download SVG
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print / save PDF
            </Button>
            <Button size="sm" variant="outline" onClick={exportMermaid}>
              <Download className="mr-1.5 h-4 w-4" />
              Mermaid source
            </Button>
            <Badge variant="secondary">{figureList.length} rendered</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="topology-no-print">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Select topology views</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {TOPOLOGY_TREE.map((group, i) => (
            <CollapsibleGroup
              key={group.key}
              title={`${group.label} — ${group.hint}`}
              defaultOpen={i === 0}
            >
              {group.nodes.map((node) => {
                const opts = focusOptions(node);
                return (
                  <div key={node.type} className="space-y-1">
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={!!selected[node.type]}
                        onCheckedChange={(v) =>
                          setSelected((prev) => ({ ...prev, [node.type]: v === true }))
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{node.label}</span>
                        <span className="block text-xs text-muted-foreground">{node.hint}</span>
                      </span>
                    </label>
                    {node.focus && selected[node.type] ? (
                      <select
                        className={`${selectClass} ml-6`}
                        value={focusByType[node.type] ?? ""}
                        onChange={(e) =>
                          setFocusByType((prev) => ({ ...prev, [node.type]: e.target.value }))
                        }
                      >
                        <option value="">Select focus record…</option>
                        {opts.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
            </CollapsibleGroup>
          ))}
        </CardContent>
      </Card>

      {chosen.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No topology views selected yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Selected topology views</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {chosen.map((node) => (
              <TopologyFigure
                key={`${node.type}:${focusByType[node.type] ?? ""}`}
                node={topologyNode(node.type) ?? node}
                focus={node.focus ? (focusByType[node.type] ?? "") : ""}
                state={state}
                onFigure={onFigure}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
