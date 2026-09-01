// Local topology for ONE panel — the only topology a scanned label may show.
//
// Pure module: it draws exclusively from the rows already returned by
// `panelSheet` for that panel (its feeders, raceways, circuits, loads and
// branch runs). It never reaches for another panel's internals: an upstream or
// downstream panel appears only as a named endpoint box, which is the same
// information the printed label already carries.
import { mermaidLabel, nodeKey } from "@/lib/electrical-mermaid";

export type LocalValue = string | number | boolean | null;
export type LocalRow = Record<string, LocalValue | unknown>;

export interface PanelLocalTopologyInput {
  panelId: string;
  description?: string | null;
  busRatingAmps?: number | string | null;
  voltageText?: string | null;
  feedersIn: LocalRow[];
  feedersOut: LocalRow[];
  raceways: LocalRow[];
  circuitGroups: LocalRow[];
  loads: LocalRow[];
  branchRuns: LocalRow[];
}

export interface PanelLocalTopology {
  mermaid: string;
  /** Counts shown next to the diagram so the reader knows what is drawn. */
  counts: { feeders_in: number; feeders_out: number; raceways: number; circuits: number; loads: number; branch_runs: number };
  /** Endpoints referenced but deliberately not expanded (other panels, boxes). */
  external_endpoints: string[];
}

const text = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
};

const num = (v: unknown): string => {
  const s = text(v);
  return s.length ? s : "";
};

/**
 * Build a Mermaid flowchart of the panel's own neighbourhood:
 * upstream feeder(s) -> PANEL -> circuits -> loads, plus raceways/branch runs
 * leaving the panel and any panels fed from it (as endpoint boxes only).
 */
export function buildPanelLocalTopology(input: PanelLocalTopologyInput): PanelLocalTopology {
  const lines: string[] = ["flowchart LR"];
  const external = new Set<string>();
  const panelNode = nodeKey("PNL", input.panelId);
  const panelLabelParts = [
    input.panelId,
    text(input.description),
    input.busRatingAmps ? `${num(input.busRatingAmps)} A bus` : "",
    text(input.voltageText),
  ].filter(Boolean);

  lines.push(`  ${panelNode}["${mermaidLabel(panelLabelParts.join("\\n"))}"]`);
  lines.push(`  style ${panelNode} stroke-width:3px`);

  // Upstream: what feeds this panel.
  input.feedersIn.forEach((f, i) => {
    const id = text(f["feeder_id"]) || `feeder-in-${i}`;
    const from = text(f["source_endpoint_ref"]) || "unknown source";
    external.add(from);
    const src = nodeKey("SRC", from);
    lines.push(`  ${src}["${mermaidLabel(from)}"]`);
    const edge = [text(f["conductor_size"]), num(f["ocp_rating_amps"]) ? `${num(f["ocp_rating_amps"])} A OCP` : ""]
      .filter(Boolean)
      .join(" · ");
    lines.push(`  ${src} -->|"${mermaidLabel([id, edge].filter(Boolean).join(" "))}"| ${panelNode}`);
  });

  // Downstream panels / equipment fed from this panel.
  input.feedersOut.forEach((f, i) => {
    const id = text(f["feeder_id"]) || `feeder-out-${i}`;
    const to = text(f["dest_endpoint_ref"]) || "unknown destination";
    external.add(to);
    const dst = nodeKey("DST", to);
    lines.push(`  ${dst}["${mermaidLabel(to)}"]`);
    lines.push(`  ${panelNode} -->|"${mermaidLabel(id)}"| ${dst}`);
  });

  // Circuits inside the panel and the loads on them.
  const groupById = new Map<string, string>();
  input.circuitGroups.forEach((g, i) => {
    const id = text(g["circuit_group_id"]) || `circuit-${i}`;
    const key = nodeKey("CG", id);
    groupById.set(id, key);
    const label = [
      id,
      text(g["description"]),
      num(g["breaker_number"]) ? `bkr ${num(g["breaker_number"])}` : "",
      num(g["circuit_rating_amps"]) ? `${num(g["circuit_rating_amps"])} A` : "",
    ]
      .filter(Boolean)
      .join("\\n");
    lines.push(`  ${key}("${mermaidLabel(label)}")`);
    lines.push(`  ${panelNode} --> ${key}`);
  });

  input.loads.forEach((l, i) => {
    const id = text(l["load_id"]) || `load-${i}`;
    const key = nodeKey("LD", id);
    const label = [
      id,
      text(l["description"]),
      [num(l["amps"]) && `${num(l["amps"])} A`, num(l["volts"]) && `${num(l["volts"])} V`]
        .filter(Boolean)
        .join(" · "),
    ]
      .filter(Boolean)
      .join("\\n");
    lines.push(`  ${key}["${mermaidLabel(label)}"]`);
    const parent = groupById.get(text(l["circuit_group_ref"]));
    lines.push(`  ${parent ?? panelNode} --> ${key}`);
  });

  // Raceways and branch runs leaving the panel, to their endpoint only.
  input.raceways.forEach((r, i) => {
    const id = text(r["conduit_id"]) || `raceway-${i}`;
    const to = text(r["dest_endpoint_ref"]) || "unterminated";
    external.add(to);
    const dst = nodeKey("RWD", to);
    lines.push(`  ${dst}[/"${mermaidLabel(to)}"/]`);
    const via = [text(r["trade_size"]), text(r["exit_side"])].filter(Boolean).join(" · ");
    lines.push(`  ${panelNode} -.->|"${mermaidLabel([id, via].filter(Boolean).join(" "))}"| ${dst}`);
  });

  input.branchRuns.forEach((b, i) => {
    const id = text(b["branch_id"]) || `branch-${i}`;
    const to = text(b["dest_endpoint_ref"]) || "unterminated";
    const dst = nodeKey("BRD", to);
    if (!input.loads.some((l) => text(l["load_id"]) === to)) {
      external.add(to);
      lines.push(`  ${dst}["${mermaidLabel(to)}"]`);
    }
    const target = input.loads.some((l) => text(l["load_id"]) === to) ? nodeKey("LD", to) : dst;
    lines.push(`  ${panelNode} -->|"${mermaidLabel(id)}"| ${target}`);
  });

  return {
    mermaid: lines.join("\n"),
    counts: {
      feeders_in: input.feedersIn.length,
      feeders_out: input.feedersOut.length,
      raceways: input.raceways.length,
      circuits: input.circuitGroups.length,
      loads: input.loads.length,
      branch_runs: input.branchRuns.length,
    },
    external_endpoints: [...external].filter((e) => e !== input.panelId).sort(),
  };
}
