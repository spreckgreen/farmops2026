// Record context builder for the Electrical AI scenarios.
//
// Why this exists: the scenario handler used to hand the model a list of field
// names that do not exist on these tables (`name`, `panel_ref`, `circuit_ref`,
// `voltage` on loads), so every load line came out empty and the model answered
// "the text lacks connection information". This module reads the REAL columns
// and resolves the uuid relationships into stable IDs, so a question like
// "what panel are the mini splits on" has an answer in the prompt.
//
// Pure functions over snapshot-shaped rows — unit tested, no I/O.

export type ElectricalRow = Record<string, unknown>;

export interface ElectricalContextInput {
  panels: ElectricalRow[];
  feeders: ElectricalRow[];
  circuitGroups: ElectricalRow[];
  loads: ElectricalRow[];
  positions: ElectricalRow[];
  /** The electrician's question, used only to rank rows for relevance. */
  question?: string;
}

export interface ElectricalContextResult {
  block: string;
  counts: Record<string, number>;
  /** Loads whose text matched the question — surfaced in the UI for audit. */
  matchedLoadIds: string[];
  /** Rough prompt size, for the cloud-cost estimate. */
  approxTokens: number;
}

const STOPWORDS = new Set([
  "the", "and", "what", "which", "where", "whats", "for", "are", "is", "was", "how",
  "many", "much", "does", "did", "do", "with", "from", "that", "this", "these", "those",
  "panel", "panels", "circuit", "circuits", "breaker", "breakers", "load", "loads",
  "please", "list", "show", "tell", "about", "on", "in", "of", "to", "a", "an", "my",
  "all", "any", "there", "have", "has", "it", "its", "power", "powered",
]);

function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** Content words from the question, stemmed; stopwords and short words dropped. */
export function questionTerms(question: string | undefined): string[] {
  if (!question) return [];
  const out = new Set<string>();
  for (const raw of question.split(/\s+/)) {
    const w = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return [...out];
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v);
}

function field(row: ElectricalRow, key: string, max = 90): string | null {
  const v = str(row[key]).trim();
  return v === "" ? null : `${key}=${v.slice(0, max)}`;
}

function line(row: ElectricalRow, keys: string[], extra: (string | null)[] = []): string {
  return [...keys.map((k) => field(row, k)), ...extra].filter(Boolean).join(" | ");
}

/** Rows whose text matches the question first, then everything else, up to cap. */
function rank(rows: ElectricalRow[], terms: string[], cap: number) {
  if (terms.length === 0) return { rows: rows.slice(0, cap), matched: [] as ElectricalRow[] };
  const scored = rows.map((row) => {
    const hay = Object.values(row).map(str).join(" ").toLowerCase();
    const words = new Set(hay.split(/[^a-z0-9]+/).map(stem));
    let score = 0;
    for (const t of terms) {
      if (words.has(t)) score += 2;
      else if (t.length >= 4 && hay.includes(t)) score += 1;
    }
    return { row, score };
  });
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const rest = scored.filter((s) => s.score === 0);
  return {
    rows: [...matched, ...rest].slice(0, cap).map((s) => s.row),
    matched: matched.map((s) => s.row),
  };
}

export function buildElectricalRecordContext(
  input: ElectricalContextInput,
): ElectricalContextResult {
  const terms = questionTerms(input.question);

  const panelByUuid = new Map<string, ElectricalRow>();
  for (const p of input.panels) panelByUuid.set(str(p.id), p);
  const panelLabel = (uuid: unknown): string | null => {
    const p = panelByUuid.get(str(uuid));
    if (!p) return null;
    const desc = str(p.description).trim();
    return `${str(p.panel_id)}${desc ? ` (${desc})` : ""}`;
  };

  const groupByUuid = new Map<string, ElectricalRow>();
  for (const g of input.circuitGroups) groupByUuid.set(str(g.id), g);

  // A load's panel can come from its circuit group, from a breaker position
  // that points at the load, or from the text reference it was imported with.
  const panelByLoadUuid = new Map<string, string>();
  for (const pos of input.positions) {
    const lu = str(pos.load_uuid);
    const label = panelLabel(pos.panel_uuid);
    if (lu && label && !panelByLoadUuid.has(lu)) panelByLoadUuid.set(lu, label);
  }

  const panelLines = input.panels.map((p) =>
    line(p, [
      "panel_id",
      "description",
      "building",
      "grid",
      "system_voltage",
      "voltage",
      "bus_rating_amps",
      "spaces",
      "circuits",
      "feeder_source",
      "install_status",
    ]),
  );

  const feederLines = input.feeders.map((f) =>
    line(
      f,
      [
        "feeder_id",
        "description",
        "source_endpoint_ref",
        "dest_endpoint_ref",
        "conductor_size",
        "conductor_material",
        "ampacity_amps",
        "ocp_rating_amps",
        "voltage",
      ],
      [
        panelLabel(f.source_panel_uuid) ? `source_panel=${panelLabel(f.source_panel_uuid)}` : null,
        panelLabel(f.dest_panel_uuid) ? `dest_panel=${panelLabel(f.dest_panel_uuid)}` : null,
      ],
    ),
  );

  const groupRank = rank(input.circuitGroups, terms, 200);
  const groupLines = groupRank.rows.map((g) =>
    line(
      g,
      [
        "circuit_group_id",
        "description",
        "breaker_number",
        "breaker_position",
        "circuit_rating_amps",
        "voltage",
        "demand_va",
        "phase",
        "install_status",
      ],
      [
        panelLabel(g.panel_uuid)
          ? `panel=${panelLabel(g.panel_uuid)}`
          : str(g.suggested_panel).trim()
            ? `suggested_panel=${str(g.suggested_panel)}`
            : null,
      ],
    ),
  );

  const loadRank = rank(input.loads, terms, 200);
  const loadLines = loadRank.rows.map((l) => {
    const group = groupByUuid.get(str(l.circuit_group_uuid)) ?? null;
    const panel =
      (group ? panelLabel(group.panel_uuid) : null) ??
      panelByLoadUuid.get(str(l.id)) ??
      null;
    return line(
      l,
      [
        "load_id",
        "description",
        "equipment_model",
        "location",
        "area",
        "count",
        "volts",
        "amps",
        "amps_semantic",
        "connected_va",
        "demand_va",
        "minimum_circuit_ampacity",
        "maximum_overcurrent_protection",
        "installed_ocp_rating",
        "dedicated",
        "source_circuit",
        "circuit_group_ref",
        "install_status",
      ],
      [
        group ? `circuit=${str(group.circuit_group_id)}` : null,
        panel ? `panel=${panel}` : null,
        !panel && str(l.suggested_panel).trim()
          ? `suggested_panel=${str(l.suggested_panel)}`
          : null,
        !panel && !str(l.suggested_panel).trim() ? "panel=UNASSIGNED IN RECORD" : null,
      ],
    );
  });

  const posLines = rank(input.positions, terms, 250).rows.map((p) =>
    line(
      p,
      ["position", "side", "poles", "ocp_amps", "label", "install_status"],
      [
        panelLabel(p.panel_uuid) ? `panel=${panelLabel(p.panel_uuid)}` : null,
        groupByUuid.get(str(p.circuit_group_uuid))
          ? `circuit=${str(groupByUuid.get(str(p.circuit_group_uuid))!.circuit_group_id)}`
          : null,
      ],
    ),
  );

  const matchedLoadIds = loadRank.matched.map((l) => str(l.load_id)).filter(Boolean);

  const block =
    (terms.length
      ? `QUESTION KEYWORDS: ${terms.join(", ")}\n` +
        `LOADS MATCHING THOSE KEYWORDS (${matchedLoadIds.length}): ${
          matchedLoadIds.slice(0, 40).join(", ") || "none"
        }\n\n`
      : "") +
    `PANELS (${input.panels.length}) — panel_id is the stable PNL-* id:\n${panelLines.join("\n")}\n\n` +
    `FEEDERS (${input.feeders.length}):\n${feederLines.join("\n") || "(none recorded)"}\n\n` +
    `CIRCUITS (${input.circuitGroups.length}, showing ${groupLines.length}) — panel= is the panel this circuit lives in:\n${groupLines.join("\n")}\n\n` +
    `LOADS (${input.loads.length}, showing ${loadLines.length}) — panel=/circuit= are resolved from the record:\n${loadLines.join("\n")}\n\n` +
    `BREAKER POSITIONS (${input.positions.length}, showing ${posLines.length}):\n${posLines.join("\n")}`;

  return {
    block,
    counts: {
      panels: input.panels.length,
      feeders: input.feeders.length,
      circuit_groups: input.circuitGroups.length,
      loads: input.loads.length,
      breaker_positions: input.positions.length,
      ...(terms.length ? { keyword_matched_loads: matchedLoadIds.length } : {}),
    },
    matchedLoadIds,
    approxTokens: Math.ceil(block.length / 4),
  };
}
