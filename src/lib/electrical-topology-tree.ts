// Presentation-only grouping of the generated topology views into a
// Service → Panel → Junction box → Branch/Raceway → Load reading order, so the
// topology pack can be picked from a collapsible tree. No data behaviour here.
import { DIAGRAM_LABELS, type DiagramType } from "@/lib/electrical-mermaid";

export interface TopologyTreeNode {
  type: DiagramType;
  label: string;
  /** Needs a focus record (panel, raceway, jbox, rack, power asset) to be useful. */
  focus?: "panels" | "raceways" | "jboxes" | "racks" | "powerAssets";
  hint: string;
}

export interface TopologyTreeGroup {
  key: string;
  label: string;
  hint: string;
  nodes: TopologyTreeNode[];
}

export const TOPOLOGY_TREE: TopologyTreeGroup[] = [
  {
    key: "service",
    label: "1 · Service & site",
    hint: "Utility service, interties and site-wide feeds.",
    nodes: [
      {
        type: "whole_system",
        label: DIAGRAM_LABELS.whole_system,
        hint: "Everything from the service down. Large — best on landscape paper.",
      },
      {
        type: "site",
        label: DIAGRAM_LABELS.site,
        hint: "Buildings, grids and site infrastructure.",
      },
      {
        type: "critical_power",
        label: DIAGRAM_LABELS.critical_power,
        hint: "Backed-up / critical loads only.",
      },
    ],
  },
  {
    key: "panel",
    label: "2 · Panels",
    hint: "Panel-level distribution and breaker layout.",
    nodes: [
      {
        type: "single_panel",
        label: DIAGRAM_LABELS.single_panel,
        focus: "panels",
        hint: "Pick one panel; shows its breakers and downstream runs.",
      },
      {
        type: "farm_shop",
        label: DIAGRAM_LABELS.farm_shop,
        hint: "Farm Shop distribution subtree.",
      },
    ],
  },
  {
    key: "raceway",
    label: "3 · Raceways & junction boxes",
    hint: "Physical routing between panels, boxes and devices.",
    nodes: [
      {
        type: "raceway",
        label: DIAGRAM_LABELS.raceway,
        focus: "raceways",
        hint: "Pick one raceway to trace its segments and pull points.",
      },
      {
        type: "jbox",
        label: DIAGRAM_LABELS.jbox,
        focus: "jboxes",
        hint: "Pick one junction box to see its branch runs.",
      },
    ],
  },
  {
    key: "load",
    label: "4 · Branch, load & equipment",
    hint: "Downstream equipment, racks and power dependencies.",
    nodes: [
      {
        type: "power_dependency",
        label: DIAGRAM_LABELS.power_dependency,
        focus: "powerAssets",
        hint: "Pick a power asset (UPS, PDU) to see what it carries.",
      },
      {
        type: "rack",
        label: DIAGRAM_LABELS.rack,
        focus: "racks",
        hint: "Pick a rack to see its powered devices.",
      },
      {
        type: "network",
        label: DIAGRAM_LABELS.network,
        hint: "Network topology between devices.",
      },
    ],
  },
];

export const TOPOLOGY_NODES: TopologyTreeNode[] = TOPOLOGY_TREE.flatMap((g) => g.nodes);

export function topologyNode(type: DiagramType): TopologyTreeNode | undefined {
  return TOPOLOGY_NODES.find((n) => n.type === type);
}

/** Filename stem shared by the HTML / SVG / PDF exports. */
export function topologyFilename(generatedAt: string, ext: string): string {
  const stamp = generatedAt.replace(/[:.]/g, "").replace(/Z$/, "");
  return `bostead-electrical-topology-${stamp}.${ext}`;
}

/**
 * Makes a Mermaid-rendered SVG valid as a standalone file:
 * - declares the xlink namespace Mermaid uses but never binds (otherwise the
 *   file fails XML parsing with "unbound prefix" and won't open),
 * - replaces width="100%" / max-width styling with real pixel dimensions taken
 *   from the viewBox so viewers don't render a zero-sized or blank canvas.
 */
export function standaloneSvg(svg: string): string {
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) return svg;
  let tag = open[0];
  const viewBox = tag.match(/viewBox="([\d.\-\s]+)"/)?.[1]?.trim().split(/\s+/) ?? [];
  const w = Number(viewBox[2]);
  const h = Number(viewBox[3]);

  if (!/xmlns:xlink=/.test(tag)) {
    tag = tag.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    tag = tag
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "")
      .replace(/\sstyle="[^"]*"/, "")
      .replace(/<svg\b/, `<svg width="${Math.round(w)}" height="${Math.round(h)}"`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace(open[0], tag)}`;
}

/** Self-contained HTML pack: inline SVGs, no external assets, opens offline. */
export function topologyHtml(
  generatedAt: string,
  figures: { title: string; svg: string; mermaid: string }[],
): string {
  const body = figures
    .map(
      (f) => `  <section class="figure">
    <h2>${escapeHtml(f.title)}</h2>
    <div class="svg">${f.svg}</div>
    <details><summary>Mermaid source</summary><pre>${escapeHtml(f.mermaid)}</pre></details>
  </section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bostead Farms — Electrical Topology Pack</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #1c1917; background: #fff; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #57534e; font-size: 12px; margin-bottom: 20px; }
  .figure { page-break-inside: avoid; break-inside: avoid; margin-bottom: 28px; }
  .figure h2 { font-size: 15px; margin: 0 0 6px; }
  .svg { border: 1px solid #d6d3d1; border-radius: 6px; padding: 8px; overflow: auto; }
  .svg svg { max-width: 100%; height: auto; }
  pre { font-size: 10px; overflow: auto; background: #f5f5f4; padding: 8px; border-radius: 6px; }
  summary { font-size: 12px; color: #57534e; cursor: pointer; margin-top: 6px; }
  @page { size: letter landscape; margin: 0.5in; }
</style>
</head>
<body>
<h1>Bostead Farms — Electrical Topology Pack</h1>
<p class="meta">Generated ${escapeHtml(generatedAt.replace("T", " ").slice(0, 19))} UTC · ${figures.length} diagram(s) · generated from the FarmOps electrical records; the engineering spreadsheet remains the release authority.</p>
${body}
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
