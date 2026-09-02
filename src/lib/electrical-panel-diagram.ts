// Panel diagram model: the whole distribution tree in one read-only view.
//
// Panels → feeder source → breaker positions / circuit groups → loads, with
// every unresolved link marked as an explicit gap. Pure functions over
// snapshot-shaped rows so it is unit testable and never writes a record.

export type DiagramRow = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export const NOT_IN_RECORD = "NOT IN RECORD";

export interface DiagramLoad {
  /** Stable ID, e.g. FS-082. */
  id: string;
  uuid: string;
  description: string;
  area: string;
  status: string;
  amps: string;
  va: string;
  voltage: string;
  /** Panel the record says this load is *planned* for (text only, not a link). */
  suggestedPanel: string;
  building: string;
  /** Gaps on this load's own supply path. */
  gaps: string[];
}

export interface DiagramCircuit {
  /** Stable circuit group ID, or a synthetic label for breaker-only positions. */
  id: string;
  uuid: string;
  description: string;
  breaker: string;
  ratingAmps: string;
  voltage: string;
  status: string;
  loads: DiagramLoad[];
  gaps: string[];
}

export interface DiagramPanel {
  id: string;
  uuid: string;
  description: string;
  building: string;
  voltage: string;
  busRatingAmps: string;
  /** "FDR-003 from PNL-MAIN" or NOT IN RECORD. */
  feeder: string;
  feederKnown: boolean;
  spaces: string;
  status: string;
  circuits: DiagramCircuit[];
  /** Loads pinned to this panel by a breaker position but with no circuit group. */
  directLoads: DiagramLoad[];
  /**
   * Loads the record *expects* on this panel (suggested panel text, or same
   * building/area) but which are not linked to any circuit or breaker here.
   */
  expectedLoads: DiagramLoad[];
  gaps: string[];
  loadCount: number;
  gapCount: number;
}

export interface PanelDiagram {
  panels: DiagramPanel[];
  /** Loads with no resolvable panel: the honest "not connected yet" bucket. */
  unassignedLoads: DiagramLoad[];
  /** Circuit groups whose panel_uuid does not resolve. */
  orphanCircuits: DiagramCircuit[];
  totals: {
    panels: number;
    circuits: number;
    loads: number;
    connectedLoads: number;
    unassignedLoads: number;
    gaps: number;
  };
}

export interface PanelDiagramInput {
  panels: DiagramRow[];
  feeders: DiagramRow[];
  circuitGroups: DiagramRow[];
  loads: DiagramRow[];
  positions: DiagramRow[];
}

function loadGaps(
  load: DiagramRow,
  opts: { hasCircuit: boolean; hasBreaker: boolean; hasPanel: boolean },
): string[] {
  const gaps: string[] = [];
  if (!opts.hasPanel) gaps.push("panel not assigned (circuit_group_uuid)");
  if (!opts.hasCircuit) gaps.push("circuit not assigned (circuit_group_uuid)");
  if (!opts.hasBreaker) gaps.push("breaker position not recorded");
  if (!str(load.connected_va).trim() && !str(load.amps).trim()) {
    gaps.push("no connected load recorded (connected_va / amps)");
  }
  return gaps;
}

function toLoad(
  load: DiagramRow,
  opts: { hasCircuit: boolean; hasBreaker: boolean; hasPanel: boolean },
): DiagramLoad {
  return {
    id: str(load.load_id) || NOT_IN_RECORD,
    uuid: str(load.id),
    description: str(load.description).trim(),
    area: str(load.area).trim() || str(load.location).trim(),
    status: str(load.install_status).trim(),
    amps: str(load.amps).trim(),
    va: str(load.connected_va).trim(),
    voltage: str(load.voltage_semantic).trim() || str(load.system_voltage).trim(),
    suggestedPanel: str(load.suggested_panel).trim(),
    building: str(load.building).trim() || str(load.grid).trim(),
    gaps: loadGaps(load, opts),
  };
}

/**
 * Fold the electrical records into a panel-first tree. Nothing is inferred:
 * a link exists only when the record carries the uuid that proves it.
 */
export function buildPanelDiagram(input: PanelDiagramInput): PanelDiagram {
  const panelByUuid = new Map<string, DiagramRow>();
  for (const p of input.panels) panelByUuid.set(str(p.id), p);

  const positionsByLoad = new Map<string, DiagramRow>();
  const positionsByCircuit = new Map<string, DiagramRow>();
  for (const pos of input.positions) {
    const lu = str(pos.load_uuid);
    if (lu && !positionsByLoad.has(lu)) positionsByLoad.set(lu, pos);
    const cu = str(pos.circuit_group_uuid);
    if (cu && !positionsByCircuit.has(cu)) positionsByCircuit.set(cu, pos);
  }

  const loadsByCircuit = new Map<string, DiagramRow[]>();
  const loadsByPanelDirect = new Map<string, DiagramRow[]>();
  const unassigned: DiagramLoad[] = [];

  for (const load of input.loads) {
    const cu = str(load.circuit_group_uuid);
    const pos = positionsByLoad.get(str(load.id)) ?? null;
    if (cu) {
      const list = loadsByCircuit.get(cu) ?? [];
      list.push(load);
      loadsByCircuit.set(cu, list);
      continue;
    }
    const panelUuid = pos ? str(pos.panel_uuid) : "";
    if (panelUuid && panelByUuid.has(panelUuid)) {
      const list = loadsByPanelDirect.get(panelUuid) ?? [];
      list.push(load);
      loadsByPanelDirect.set(panelUuid, list);
      continue;
    }
    unassigned.push(
      toLoad(load, { hasCircuit: false, hasBreaker: Boolean(pos), hasPanel: false }),
    );
  }

  const breakerLabel = (group: DiagramRow, pos: DiagramRow | null): string => {
    if (pos) {
      const ocp = str(pos.ocp_amps).trim();
      return `${str(pos.side)}${str(pos.position)}${ocp ? ` (${ocp}A)` : ""}`;
    }
    return str(group.breaker_number).trim() || str(group.breaker_position).trim() || NOT_IN_RECORD;
  };

  const toCircuit = (group: DiagramRow): DiagramCircuit => {
    const pos = positionsByCircuit.get(str(group.id)) ?? null;
    const breaker = breakerLabel(group, pos);
    const hasBreaker = breaker !== NOT_IN_RECORD;
    const panelKnown = panelByUuid.has(str(group.panel_uuid));
    const loads = (loadsByCircuit.get(str(group.id)) ?? []).map((l) =>
      toLoad(l, {
        hasCircuit: true,
        hasBreaker: hasBreaker || positionsByLoad.has(str(l.id)),
        hasPanel: panelKnown,
      }),
    );
    const gaps: string[] = [];
    if (!panelKnown) gaps.push("panel not linked (panel_uuid)");
    if (!hasBreaker) gaps.push("breaker position not recorded");
    if (loads.length === 0) gaps.push("no loads linked to this circuit");
    if (!str(group.circuit_rating_amps).trim()) gaps.push("no circuit rating recorded");
    return {
      id: str(group.circuit_group_id) || NOT_IN_RECORD,
      uuid: str(group.id),
      description: str(group.description).trim(),
      breaker,
      ratingAmps: str(group.circuit_rating_amps).trim(),
      voltage: str(group.voltage).trim(),
      status: str(group.install_status).trim(),
      loads,
      gaps,
    };
  };

  const circuits = input.circuitGroups.map(toCircuit);
  const circuitsByPanel = new Map<string, DiagramCircuit[]>();
  const orphanCircuits: DiagramCircuit[] = [];
  input.circuitGroups.forEach((group, i) => {
    const circuit = circuits[i]!;
    const pu = str(group.panel_uuid);
    if (pu && panelByUuid.has(pu)) {
      const list = circuitsByPanel.get(pu) ?? [];
      list.push(circuit);
      circuitsByPanel.set(pu, list);
    } else {
      orphanCircuits.push(circuit);
    }
  });

  const feederFor = (panel: DiagramRow): { label: string; known: boolean } => {
    const f = input.feeders.find((x) => str(x.dest_panel_uuid) === str(panel.id));
    if (f) {
      const src = panelByUuid.get(str(f.source_panel_uuid));
      const source = src ? str(src.panel_id) : str(f.source_endpoint_ref).trim();
      return {
        label: `${str(f.feeder_id)}${source ? ` from ${source}` : ` from ${NOT_IN_RECORD}`}`,
        known: Boolean(source),
      };
    }
    const text = str(panel.feeder_source).trim();
    if (text) return { label: `${text} (text reference only)`, known: false };
    return { label: NOT_IN_RECORD, known: false };
  };

  const panels: DiagramPanel[] = input.panels
    .map((panel) => {
      const panelCircuits = (circuitsByPanel.get(str(panel.id)) ?? []).sort((a, b) =>
        a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
      const directLoads = (loadsByPanelDirect.get(str(panel.id)) ?? []).map((l) =>
        toLoad(l, { hasCircuit: false, hasBreaker: true, hasPanel: true }),
      );
      const feeder = feederFor(panel);
      const panelStableId = str(panel.panel_id).trim();
      const panelBuilding = str(panel.building).trim() || str(panel.grid).trim();
      const expectedLoads = unassigned.filter((l) => {
        if (l.suggestedPanel && panelStableId) {
          return l.suggestedPanel.toUpperCase().includes(panelStableId.toUpperCase());
        }
        if (!l.suggestedPanel && panelBuilding) {
          return `${l.building} ${l.area}`.toUpperCase().includes(panelBuilding.toUpperCase());
        }
        return false;
      });
      const gaps: string[] = [];
      if (!feeder.known) gaps.push("feeder source not resolved (dest_panel_uuid / feeder_source)");
      if (panelCircuits.length === 0) gaps.push("no circuit groups linked to this panel");
      if (!str(panel.bus_rating_amps).trim()) gaps.push("no bus rating recorded");
      if (expectedLoads.length > 0) {
        gaps.push(
          `${expectedLoads.length} load(s) are expected on this panel but are not linked to any circuit or breaker here`,
        );
      }
      const loadCount =
        panelCircuits.reduce((n, c) => n + c.loads.length, 0) + directLoads.length;
      const gapCount =
        gaps.length +
        panelCircuits.reduce(
          (n, c) => n + c.gaps.length + c.loads.reduce((m, l) => m + l.gaps.length, 0),
          0,
        ) +
        directLoads.reduce((n, l) => n + l.gaps.length, 0);
      return {
        id: str(panel.panel_id) || NOT_IN_RECORD,
        uuid: str(panel.id),
        description: str(panel.description).trim(),
        building: str(panel.building).trim() || str(panel.grid).trim(),
        voltage: str(panel.system_voltage).trim() || str(panel.voltage).trim(),
        busRatingAmps: str(panel.bus_rating_amps).trim(),
        feeder: feeder.label,
        feederKnown: feeder.known,
        spaces: str(panel.spaces).trim(),
        status: str(panel.install_status).trim(),
        circuits: panelCircuits,
        directLoads,
        expectedLoads,
        gaps,
        loadCount,
        gapCount,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const connectedLoads = panels.reduce((n, p) => n + p.loadCount, 0);
  const gaps =
    panels.reduce((n, p) => n + p.gapCount, 0) +
    orphanCircuits.reduce(
      (n, c) => n + c.gaps.length + c.loads.reduce((m, l) => m + l.gaps.length, 0),
      0,
    ) +
    unassigned.reduce((n, l) => n + l.gaps.length, 0);

  return {
    panels,
    unassignedLoads: unassigned.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    ),
    orphanCircuits,
    totals: {
      panels: panels.length,
      circuits: circuits.length,
      loads: input.loads.length,
      connectedLoads,
      unassignedLoads: unassigned.length,
      gaps,
    },
  };
}

/** Free-text filter over the tree: keeps panels/circuits/loads that match. */
export function filterPanelDiagram(diagram: PanelDiagram, query: string): PanelDiagram {
  const q = query.trim().toLowerCase();
  if (!q) return diagram;
  const loadHit = (l: DiagramLoad) =>
    `${l.id} ${l.description} ${l.area} ${l.status}`.toLowerCase().includes(q);
  const circuitHit = (c: DiagramCircuit) =>
    `${c.id} ${c.description} ${c.breaker}`.toLowerCase().includes(q) || c.loads.some(loadHit);

  const panels = diagram.panels
    .map((p) => {
      const selfHit = `${p.id} ${p.description} ${p.building} ${p.feeder}`
        .toLowerCase()
        .includes(q);
      if (selfHit) return p;
      const circuits = p.circuits.filter(circuitHit).map((c) => ({
        ...c,
        loads: c.loads.some(loadHit) ? c.loads.filter(loadHit) : c.loads,
      }));
      const directLoads = p.directLoads.filter(loadHit);
      if (circuits.length === 0 && directLoads.length === 0) return null;
      return { ...p, circuits, directLoads };
    })
    .filter((p): p is DiagramPanel => p !== null);

  return {
    ...diagram,
    panels,
    unassignedLoads: diagram.unassignedLoads.filter(loadHit),
    orphanCircuits: diagram.orphanCircuits.filter(circuitHit),
  };
}

// ---------------------------------------------------------------------------
// Single-panel figure + plain-language reading of what the record does prove.
// ---------------------------------------------------------------------------

const key = (prefix: string, value: string): string =>
  `${prefix}_${(value || "unknown").replace(/[^A-Za-z0-9]/g, "_")}`;

const label = (value: string): string => value.replace(/["<>|]/g, " ").trim();

/** Mermaid flowchart for one panel: feeder → panel → breaker/circuit → load. */
export function panelMermaid(panel: DiagramPanel): string {
  const lines: string[] = ["flowchart LR"];
  const panelNode = key("PNL", panel.id);
  const panelText = [
    panel.id,
    panel.description,
    panel.busRatingAmps ? `${panel.busRatingAmps} A bus` : "",
    panel.voltage ? `${panel.voltage} V` : "",
  ]
    .filter(Boolean)
    .map(label)
    .join("\\n");
  const src = key("SRC", panel.feeder);
  lines.push(`  ${src}["${label(panel.feeder)}"]`);
  lines.push(`  ${panelNode}["${panelText}"]`);
  lines.push(`  ${src} --${panel.feederKnown ? ">" : ".->"} ${panelNode}`);
  lines.push(`  style ${panelNode} stroke-width:3px`);
  if (!panel.feederKnown) lines.push(`  style ${src} stroke-dasharray: 4 3`);

  panel.circuits.forEach((c, ci) => {
    const cNode = key(`CG${ci}`, c.id);
    const cText = [
      c.id,
      c.breaker === NOT_IN_RECORD ? "breaker NOT IN RECORD" : `breaker ${c.breaker}`,
      c.description,
      c.ratingAmps ? `${c.ratingAmps} A` : "",
    ]
      .filter(Boolean)
      .map(label)
      .join("\\n");
    lines.push(`  ${cNode}("${cText}")`);
    lines.push(`  ${panelNode} --> ${cNode}`);
    if (c.loads.length === 0) {
      const empty = key(`CGX${ci}`, c.id);
      lines.push(`  ${empty}["no loads linked"]`);
      lines.push(`  ${cNode} -.-> ${empty}`);
      lines.push(`  style ${empty} stroke-dasharray: 4 3`);
    }
    c.loads.forEach((l, li) => {
      const lNode = key(`LD${ci}_${li}`, l.id);
      const lText = [l.id, l.description, l.amps ? `${l.amps} A` : ""]
        .filter(Boolean)
        .map(label)
        .join("\\n");
      lines.push(`  ${lNode}["${lText}"]`);
      lines.push(`  ${cNode} --> ${lNode}`);
    });
  });

  panel.directLoads.forEach((l, i) => {
    const lNode = key(`DL${i}`, l.id);
    lines.push(`  ${lNode}["${[l.id, l.description].filter(Boolean).map(label).join("\\n")}"]`);
    lines.push(`  ${panelNode} -->|"breaker only, no circuit"| ${lNode}`);
  });

  panel.expectedLoads.forEach((l, i) => {
    const lNode = key(`EX${i}`, l.id);
    lines.push(
      `  ${lNode}["${[l.id, l.description, "expected here"].filter(Boolean).map(label).join("\\n")}"]`,
    );
    lines.push(`  ${panelNode} -.->|"not linked in record"| ${lNode}`);
    lines.push(`  style ${lNode} stroke-dasharray: 4 3`);
  });

  if (panel.circuits.length === 0 && panel.directLoads.length === 0 && panel.expectedLoads.length === 0) {
    lines.push(`  NOTHING["nothing linked to this panel yet"]`);
    lines.push(`  ${panelNode} -.-> NOTHING`);
  }
  return lines.join("\n");
}

export interface PanelReading {
  /** What the record proves today, in sentences. */
  known: string[];
  /** What is missing, and which field would close it. */
  missing: string[];
}

/** Plain-language reading of a single panel's topology and its gaps. */
export function panelReading(panel: DiagramPanel): PanelReading {
  const known: string[] = [];
  const missing: string[] = [];
  const loadsOnCircuits = panel.circuits.reduce((n, c) => n + c.loads.length, 0);

  known.push(
    `${panel.id}${panel.description ? ` (${panel.description})` : ""} is recorded${
      panel.building ? ` in ${panel.building}` : ""
    }${panel.busRatingAmps ? ` with a ${panel.busRatingAmps} A bus` : ""}${
      panel.voltage ? ` at ${panel.voltage} V` : ""
    }.`,
  );
  known.push(
    panel.feederKnown
      ? `It is fed by ${panel.feeder}, so the upstream path is traceable.`
      : `Its supply is ${panel.feeder} — the upstream path stops here.`,
  );
  known.push(
    `${panel.circuits.length} circuit group(s) are linked to it, carrying ${loadsOnCircuits} load(s); ${panel.directLoads.length} more load(s) sit on a breaker position with no circuit group.`,
  );

  if (!panel.feederKnown) {
    missing.push(
      "Upstream feeder: no feeder row points at this panel (electrical_feeders.dest_panel_uuid), so nothing proves where it gets power.",
    );
  }
  if (panel.circuits.length === 0) {
    missing.push(
      "Circuits: no circuit group carries this panel's uuid (electrical_circuit_groups.panel_uuid).",
    );
  }
  if (!panel.busRatingAmps) missing.push("Bus rating: electrical_panels.bus_rating_amps is empty.");

  const noBreaker = panel.circuits.filter((c) => c.breaker === NOT_IN_RECORD);
  if (noBreaker.length) {
    missing.push(
      `Breaker positions: ${noBreaker.map((c) => c.id).join(", ")} have no breaker recorded (electrical_breaker_positions row or breaker_number).`,
    );
  }
  const emptyCircuits = panel.circuits.filter((c) => c.loads.length === 0);
  if (emptyCircuits.length) {
    missing.push(
      `Empty circuits: ${emptyCircuits.map((c) => c.id).join(", ")} have no load linked (electrical_loads.circuit_group_uuid).`,
    );
  }
  if (panel.directLoads.length) {
    missing.push(
      `Breaker-only loads: ${panel.directLoads.map((l) => l.id).join(", ")} are on a breaker in this panel but belong to no circuit group.`,
    );
  }
  if (panel.expectedLoads.length) {
    missing.push(
      `Loads expected but unaccounted: ${panel.expectedLoads
        .map((l) => `${l.id}${l.suggestedPanel ? ` (suggested_panel = ${l.suggestedPanel})` : " (same building/area)"}`)
        .join(", ")} — set circuit_group_uuid or add a breaker position to account for them here.`,
    );
  }
  const noRating = panel.circuits.filter((c) => !c.ratingAmps);
  if (noRating.length) {
    missing.push(
      `Circuit ratings: ${noRating.map((c) => c.id).join(", ")} have no circuit_rating_amps.`,
    );
  }
  const noAmps = [...panel.circuits.flatMap((c) => c.loads), ...panel.directLoads].filter(
    (l) => !l.amps && !l.va,
  );
  if (noAmps.length) {
    missing.push(
      `Load sizing: ${noAmps.map((l) => l.id).join(", ")} have neither amps nor connected_va, so panel loading cannot be totalled.`,
    );
  }
  if (missing.length === 0) {
    missing.push("Nothing is missing: every link on this panel is proven by a record.");
  }
  return { known, missing };
}
