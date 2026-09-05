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

import { breakerDisplay } from "@/lib/electrical-breaker-reference";

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
  /** Deterministic record answer used when a small local model ignores its rows. */
  groundedLoadAnswer: string | null;
  /** Deterministic hop-by-hop trace (service → feeder → panel → breaker → circuit → load). */
  loadTraceAnswer: string | null;

  /** Rough prompt size, for the cloud-cost estimate. */
  approxTokens: number;
}

const STOPWORDS = new Set([
  "the", "and", "what", "which", "where", "whats", "for", "are", "is", "was", "how",
  "many", "much", "does", "did", "do", "with", "from", "that", "this", "these", "those",
  "panel", "panels", "circuit", "circuits", "breaker", "breakers", "load", "loads",
  "please", "list", "show", "tell", "about", "on", "in", "of", "to", "a", "an", "my",
  "all", "any", "there", "have", "has", "it", "its", "power", "powered",
  "explain", "know", "known", "today", "associated", "full", "unknown", "path",
  "route", "routed", "too", "also", "you", "your", "their", "they", "can", "will",
  // Status words appear on nearly every row, so they can never select equipment.
  "planned", "plan", "installed", "install", "existing", "future", "proposed",
  "complete", "completed", "tbd", "yes", "no", "none",
]);

/**
 * Equipment vocabulary. Field questions rarely use the word the record uses:
 * "mini-splits" must find rows described as "Mini Split SE", and asking about the
 * "ductless heat pumps" has to reach those same three rows. Synonyms are weaker
 * evidence than the words actually typed, so they are scored lower (see `rank`)
 * and are expanded from the typed words only — never from other synonyms, which
 * is how "mini-split" used to drag in every welder and fan on the farm.
 */
const SYNONYM_GROUPS: readonly { triggers: string[]; terms: string[] }[] = [
  {
    triggers: ["mini", "minisplit", "split", "ductless", "heatpump", "condenser", "hvac"],
    terms: ["mini", "split", "minisplit", "ductless", "condenser", "cassette", "ashp", "hvac"],
  },
  { triggers: ["pump", "well"], terms: ["pump", "well", "booster"] },
  {
    triggers: ["heater", "boiler", "furnace"],
    terms: ["heater", "heat", "boiler", "furnace", "element"],
  },
  {
    triggers: ["freezer", "fridge", "refrigerator", "cooler"],
    terms: ["freezer", "fridge", "refrigerator", "cooler", "walkin"],
  },
  { triggers: ["evse", "charger"], terms: ["evse", "charger", "charging"] },
  {
    triggers: ["light", "lighting", "fixture"],
    terms: ["light", "lighting", "fixture", "lamp", "highbay", "led"],
  },
  {
    triggers: ["outlet", "receptacle", "plug", "gfci"],
    terms: ["outlet", "receptacle", "plug", "gfci", "duplex", "gang"],
  },
  { triggers: ["welder"], terms: ["welder", "welding"] },
  { triggers: ["compressor"], terms: ["compressor"] },
  { triggers: ["fan", "vent", "exhaust"], terms: ["fan", "vent", "exhaust", "blower"] },
];

function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** Content words actually typed in the question, stemmed; stopwords dropped. */
export function questionTerms(question: string | undefined): string[] {
  if (!question) return [];
  const out = new Set<string>();
  const push = (word: string) => {
    const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (STOPWORDS.has(w)) return;
    const s = stem(w);
    if (s.length < 3 || STOPWORDS.has(s)) return;
    out.add(s);
  };
  for (const raw of question.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (!raw) continue;
    // "mini-split" has to match "minisplit", "mini" and "split" in the record.
    push(raw.replace(/-/g, ""));
    for (const part of raw.split("-")) push(part);
  }
  return [...out];
}

/** Equipment synonyms triggered by the typed words (never by other synonyms). */
export function questionSynonyms(terms: string[]): string[] {
  const base = new Set(terms);
  const out = new Set<string>();
  for (const group of SYNONYM_GROUPS) {
    if (!group.triggers.some((t) => base.has(stem(t)))) continue;
    for (const t of group.terms) {
      const s = stem(t);
      if (s.length >= 3 && !base.has(s)) out.add(s);
    }
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

/** Text fields that actually identify a row — numbers and uuids only add noise. */
const IDENTITY_FIELDS = [
  "load_id", "description", "equipment_model", "area", "grid", "location", "notes",
  "source_circuit", "circuit_group_ref", "suggested_panel", "panel_id", "building",
  "circuit_group_id", "label", "feeder_id", "backup_panel",
];

export interface RankTerms {
  /** Words the user typed — strong evidence. */
  terms: string[];
  /** Equipment synonyms — weak evidence on their own. */
  synonyms?: string[];
}

/**
 * Rows whose identity text matches the question first, then everything else.
 * `matched` needs real evidence: one typed word, or two synonyms — otherwise a
 * question about mini-splits "matches" all 138 loads and the answer says nothing.
 */
function rank(rows: ElectricalRow[], input: RankTerms, cap: number) {
  const { terms, synonyms = [] } = input;
  if (terms.length === 0) return { rows: rows.slice(0, cap), matched: [] as ElectricalRow[] };
  const scored = rows.map((row) => {
    const hay = IDENTITY_FIELDS.map((k) => str(row[k]))
      .join(" ")
      .toLowerCase();
    const words = new Set(hay.split(/[^a-z0-9]+/).map(stem));
    let score = 0;
    for (const t of terms) {
      if (words.has(t)) score += 3;
      else if (t.length >= 5 && hay.includes(t)) score += 2;
    }
    for (const t of synonyms) {
      if (words.has(t)) score += 1;
    }
    return { row, score };
  });
  const candidates = scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score);
  // Keep only the rows close to the best match, so a broad question does not
  // return the whole table as "matched".
  const top = candidates[0]?.score ?? 0;
  const floor = Math.max(2, top - 2);
  const matched = candidates.filter((s) => s.score >= floor);
  const rest = scored
    .filter((s) => !matched.includes(s))
    .sort((a, b) => b.score - a.score);

  return {
    rows: [...matched, ...rest].slice(0, cap).map((s) => s.row),
    matched: matched.map((s) => s.row),
  };
}

/**
 * Panels that could plausibly serve a load whose circuit is not assigned yet.
 * A planned load like FS-082 "Mini Split SE" (area "Farm Shop", grid G5.5) has no
 * circuit_group_uuid, so the honest answer is "no panel assigned; the Farm Shop
 * panels are PNL-FS1 / PNL-FS2" instead of silence.
 */
export function candidatePanelsForLoad(
  load: ElectricalRow,
  panels: ElectricalRow[],
): string[] {
  const needles = ["area", "grid", "location", "backup_panel"]
    .map((k) => str(load[k]).trim().toLowerCase())
    .filter((v) => v.length >= 3 && v !== "tbd");
  if (needles.length === 0) return [];
  const hits: string[] = [];
  for (const p of panels) {
    const hay = ["panel_id", "description", "building", "area", "grid", "location"]
      .map((k) => str(p[k]).toLowerCase())
      .join(" ");
    if (needles.some((n) => hay.includes(n))) hits.push(str(p.panel_id));
  }
  return [...new Set(hits.filter(Boolean))].slice(0, 6);
}

export interface LoadPathContext {
  panels: ElectricalRow[];
  feeders: ElectricalRow[];
  groupByUuid: Map<string, ElectricalRow>;
  panelByUuid: Map<string, ElectricalRow>;
  panelByLoadUuid: Map<string, string>;
  positionsByLoadUuid: Map<string, ElectricalRow>;
}

/**
 * One explicit chain per load: circuit → breaker → panel → feeder → source.
 * Every hop is either a stable ID or the literal string NOT IN RECORD, so the
 * model can say what is known today and where the chain stops.
 */
export function describeLoadPath(load: ElectricalRow, ctx: LoadPathContext): string {
  const group = ctx.groupByUuid.get(str(load.circuit_group_uuid)) ?? null;
  const position = ctx.positionsByLoadUuid.get(str(load.id)) ?? null;
  const panelRow =
    (group ? ctx.panelByUuid.get(str(group.panel_uuid)) : null) ??
    (position ? ctx.panelByUuid.get(str(position.panel_uuid)) : null) ??
    null;

  const circuit = group
    ? str(group.circuit_group_id)
    : str(load.circuit_group_ref).trim() || str(load.source_circuit).trim() || "NOT IN RECORD";
  const breakerPanelId = panelRow ? str(panelRow.panel_id) : "";
  const breaker = position
    ? `${
        breakerDisplay({
          panel_id: breakerPanelId,
          breaker_number: position.breaker_number as number | string | null,
          side: str(position.side),
          position: str(position.position),
        }).label
      } (${str(position.ocp_amps)}A)`
    : group && str(group.breaker_number).trim()
      ? breakerDisplay({
          panel_id: breakerPanelId,
          breaker_number: group.breaker_number as number | string | null,
        }).label
      : "NOT IN RECORD";
  const panel = panelRow
    ? str(panelRow.panel_id)
    : ctx.panelByLoadUuid.get(str(load.id)) ??
      (str(load.suggested_panel).trim() ? `${str(load.suggested_panel)} (suggested only)` : "NOT IN RECORD");

  const feeder = panelRow
    ? (() => {
        const f = ctx.feeders.find((x) => str(x.dest_panel_uuid) === str(panelRow.id));
        if (f) {
          const src =
            ctx.panelByUuid.get(str(f.source_panel_uuid)) ?? null;
          return `${str(f.feeder_id)} from ${
            src ? str(src.panel_id) : str(f.source_endpoint_ref).trim() || "NOT IN RECORD"
          }`;
        }
        return str(panelRow.feeder_source).trim() || "NOT IN RECORD";
      })()
    : "NOT IN RECORD";

  const candidates = panelRow ? [] : candidatePanelsForLoad(load, ctx.panels);

  return [
    `path: circuit=${circuit} -> breaker=${breaker} -> panel=${panel} -> feeder=${feeder}`,
    candidates.length
      ? `panels serving this area today: ${candidates.join(", ")} (not an assignment)`
      : null,
    str(load.backup_panel).trim() ? `backup_panel=${str(load.backup_panel)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

/** One hop of a load's supply path, with an explicit known/gap verdict. */
export interface LoadTraceHop {
  hop: "service / source" | "feeder" | "panel" | "breaker" | "circuit" | "load";
  value: string;
  known: boolean;
  /** Field that must be filled to close this hop, when it is a gap. */
  missingField?: string;
}

/**
 * Deterministic supply trace for one load, source-side first. Every hop is
 * either a stable ID from the record or an explicit gap naming the field that
 * would close it — nothing is inferred.
 */
export function traceLoadHops(load: ElectricalRow, ctx: LoadPathContext): LoadTraceHop[] {
  const group = ctx.groupByUuid.get(str(load.circuit_group_uuid)) ?? null;
  const position = ctx.positionsByLoadUuid.get(str(load.id)) ?? null;
  const panelRow =
    (group ? ctx.panelByUuid.get(str(group.panel_uuid)) : null) ??
    (position ? ctx.panelByUuid.get(str(position.panel_uuid)) : null) ??
    null;

  const feederRow = panelRow
    ? (ctx.feeders.find((x) => str(x.dest_panel_uuid) === str(panelRow.id)) ?? null)
    : null;
  const sourcePanel = feederRow
    ? (ctx.panelByUuid.get(str(feederRow.source_panel_uuid)) ?? null)
    : null;

  const source = sourcePanel
    ? str(sourcePanel.panel_id)
    : str(feederRow?.source_endpoint_ref ?? "").trim() ||
      str(panelRow?.feeder_source ?? "").trim();

  const hops: LoadTraceHop[] = [
    source
      ? { hop: "service / source", value: source, known: true }
      : {
          hop: "service / source",
          value: "NOT IN RECORD",
          known: false,
          missingField: "electrical_feeders.source_panel_uuid / source_endpoint_ref",
        },
    feederRow
      ? {
          hop: "feeder",
          value: `${str(feederRow.feeder_id)}${
            str(feederRow.conductor_size).trim() ? ` (${str(feederRow.conductor_size)})` : ""
          }`,
          known: true,
        }
      : {
          hop: "feeder",
          value: "NOT IN RECORD",
          known: false,
          missingField: "electrical_feeders.dest_panel_uuid",
        },
    panelRow
      ? { hop: "panel", value: str(panelRow.panel_id), known: true }
      : {
          hop: "panel",
          value: str(load.suggested_panel).trim()
            ? `${str(load.suggested_panel)} (suggested only, not an assignment)`
            : (ctx.panelByLoadUuid.get(str(load.id)) ?? "NOT IN RECORD"),
          known: false,
          missingField: "electrical_circuit_groups.panel_uuid (via the load's circuit)",
        },
    position
      ? {
          hop: "breaker",
          value: `${
            breakerDisplay({
              panel_id: panelRow ? str(panelRow.panel_id) : "",
              breaker_number: position.breaker_number as number | string | null,
              side: str(position.side),
              position: str(position.position),
            }).label
          }${str(position.ocp_amps).trim() ? ` — ${str(position.ocp_amps)}A` : ""}${
            str(position.poles).trim() ? `, ${str(position.poles)}P` : ""
          }`,
          known: true,
        }
      : group && str(group.breaker_number).trim()
        ? {
            hop: "breaker",
            value: breakerDisplay({
              panel_id: panelRow ? str(panelRow.panel_id) : "",
              breaker_number: group.breaker_number as number | string | null,
            }).label,
            known: true,
          }
        : {
            hop: "breaker",
            value: "NOT IN RECORD",
            known: false,
            missingField: "electrical_breaker_positions row for this load",
          },
    group
      ? {
          hop: "circuit",
          value: `${str(group.circuit_group_id)}${
            str(group.description).trim() ? ` — ${str(group.description)}` : ""
          }`,
          known: true,
        }
      : {
          hop: "circuit",
          value:
            str(load.circuit_group_ref).trim() ||
            str(load.source_circuit).trim() ||
            "NOT IN RECORD",
          known: false,
          missingField: "electrical_loads.circuit_group_uuid",
        },
    {
      hop: "load",
      value: `${str(load.load_id)}${
        str(load.description).trim() ? ` — ${str(load.description)}` : ""
      }`,
      known: true,
    },
  ];
  return hops;
}

/** Markdown trace for one load: source-side down to the load, gaps marked. */
export function describeLoadTrace(load: ElectricalRow, ctx: LoadPathContext): string {
  const hops = traceLoadHops(load, ctx);
  const gaps = hops.filter((h) => !h.known);
  const area = str(load.area).trim() || str(load.location).trim() || "area not recorded";
  const lines = hops.map((h, i) => {
    const indent = "  ".repeat(i);
    const mark = h.known ? "OK" : "GAP";
    return `${indent}${i === 0 ? "" : "└─ "}[${mark}] ${h.hop}: ${h.value}${
      h.known || !h.missingField ? "" : `  ← fill ${h.missingField}`
    }`;
  });
  return [
    `### ${str(load.load_id)} — ${str(load.description).trim() || "Unnamed load"} (${area})`,
    "",
    "```text",
    ...lines,
    "```",
    gaps.length
      ? `Path is **incomplete**: ${gaps.length} gap${gaps.length === 1 ? "" : "s"} (${gaps
          .map((g) => g.hop)
          .join(", ")}). Nothing above is inferred.`
      : "Path is **complete** from source to load in the record.",
    candidatePanelsForLoad(load, ctx.panels).length && gaps.some((g) => g.hop === "panel")
      ? `Panels serving this area today (candidates only, not an assignment): ${candidatePanelsForLoad(
          load,
          ctx.panels,
        ).join(", ")}`
      : null,
    str(load.backup_panel).trim() ? `Recorded backup panel: ${str(load.backup_panel)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}


export function buildElectricalRecordContext(

  input: ElectricalContextInput,
): ElectricalContextResult {
  const terms = questionTerms(input.question);
  const synonyms = questionSynonyms(terms);
  const rankTerms = { terms, synonyms };

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
      "panel_kind",
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

  const groupRank = rank(input.circuitGroups, rankTerms, 200);
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

  const loadRank = rank(input.loads, rankTerms, 200);
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

  const posLines = rank(input.positions, rankTerms, 250).rows.map((p) =>
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

  // Answer set: the matched loads, in full, each with its resolved chain. This is
  // what a load question ("which panel are the mini-splits on") is answered from,
  // so it goes FIRST and is never truncated away by the bulk sections.
  const positionsByLoadUuid = new Map<string, ElectricalRow>();
  for (const pos of input.positions) {
    const lu = str(pos.load_uuid);
    if (lu && !positionsByLoadUuid.has(lu)) positionsByLoadUuid.set(lu, pos);
  }
  const pathCtx: LoadPathContext = {
    panels: input.panels,
    feeders: input.feeders,
    groupByUuid,
    panelByUuid,
    panelByLoadUuid,
    positionsByLoadUuid,
  };
  const answerSet = loadRank.matched.slice(0, 15).map((l) => {
    const head = line(l, [
      "load_id",
      "description",
      "equipment_model",
      "area",
      "grid",
      "location",
      "count",
      "volts",
      "amps",
      "rated_current_amps",
      "rated_load_amps",
      "minimum_circuit_ampacity",
      "maximum_overcurrent_protection",
      "installed_ocp_rating",
      "dedicated",
      "future",
      "critical",
      "install_status",
      "notes",
    ]);
    return `${head}\n  ${describeLoadPath(l, pathCtx)}`;
  });
  const groundedLoadAnswer = loadRank.matched.length
    ? [
        "## Matching loads in the electrical record",
        "",
        ...loadRank.matched.slice(0, 15).map((l) => {
          const description = str(l.description).trim() || "Unnamed load";
          const area = str(l.area).trim() || str(l.location).trim() || "area not recorded";
          return `- **${str(l.load_id)} — ${description}** (${area})\n  - ${describeLoadPath(l, pathCtx)}`;
        }),
        "",
        "Any `NOT IN RECORD` hop is currently unknown; it is not an inferred assignment.",
      ].join("\n")
    : null;
  const loadTraceAnswer = loadRank.matched.length
    ? [
        "## Panel trace",
        "",
        ...loadRank.matched.slice(0, 10).map((l) => describeLoadTrace(l, pathCtx)),
        "",
        "Every `[GAP]` hop is missing from the record — it is not an inferred route.",
      ].join("\n\n")
    : null;


  const block =
    (terms.length
      ? `QUESTION KEYWORDS: ${terms.join(", ")}${synonyms.length ? ` (equipment synonyms also searched: ${synonyms.join(", ")})` : ""}\n` +
        `LOADS MATCHING THOSE KEYWORDS (${matchedLoadIds.length}): ${
          matchedLoadIds.slice(0, 25).join(", ") || "none"
        }\n\n` +
        `LOAD ANSWER SET — answer the question from THESE rows and their path lines. ` +
        `"NOT IN RECORD" means the record does not say yet; report that as unknown, ` +
        `never guess a panel or circuit:\n${
          answerSet.join("\n") || "(no load matched the question keywords)"
        }\n\n`
      : "") +
    `PANELS (${input.panels.length}) — panel_id is the stable PNL-* id. ` +
    `panel_kind=logical means it is a grouping (for example critical / backup loads) ` +
    `hosted on a physical panel, not a panelboard: never report a logical panel as ` +
    `the physical supply, and never add its demand to the host panel twice:\n${panelLines.join("\n")}\n\n` +
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
    groundedLoadAnswer,
    loadTraceAnswer,

    approxTokens: Math.ceil(block.length / 4),
  };
}
