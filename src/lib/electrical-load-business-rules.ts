// Load_Master business rules for planned load → panel / generator assessment.
//
// These rules are stated by the owner of the record and are applied literally.
// Nothing here infers criticality, demand, phase, or a generator-backed panel
// from a description, an amp value, a VA value, or a panel name. Where a field
// is blank or TBD the rule output says so.
//
// BR-002  A shared circuit defaults to 20 A unless an explicit documented
//         circuit rating overrides it. Branch-circuit planning value only —
//         never a generator load.
// BR-003  D/S = S with a resolved Circuit Group ID is ONE logical circuit.
//         Multiple physical rows on that group are not multiple breakers.

export type LoadRow = Record<string, unknown>;

export const NOT_IN_RECORD = "NOT IN RECORD";
export const SHARED_DEFAULT_RATING_AMPS = 20;

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const isBlankOrTbd = (v: string): boolean => {
  const s = v.trim().toUpperCase();
  return s === "" || s === "TBD" || s === "N/A" || s === "-" || s === "—";
};
const num = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ *
 * Criticality: Load_Master.Critical = Y is the only source.
 * ------------------------------------------------------------------ */

export type Criticality = "CRITICAL" | "NOT CRITICAL" | "REVIEW";

export function criticality(row: LoadRow): { value: Criticality; basis: string } {
  const raw = row.critical;
  if (raw === true) return { value: "CRITICAL", basis: "Load_Master.Critical = Y" };
  if (raw === false) return { value: "NOT CRITICAL", basis: "Load_Master.Critical = N" };
  const s = str(raw).toUpperCase();
  if (s === "Y" || s === "YES" || s === "TRUE") {
    return { value: "CRITICAL", basis: "Load_Master.Critical = Y" };
  }
  if (s === "N" || s === "NO" || s === "FALSE") {
    return { value: "NOT CRITICAL", basis: "Load_Master.Critical = N" };
  }
  return { value: "REVIEW", basis: `Critical is ${s || NOT_IN_RECORD} — not Y or N` };
}

/* ------------------------------------------------------------------ *
 * Generator tier from Backup Priority (never from panel/description).
 * ------------------------------------------------------------------ */

export type GeneratorTier = "REQUIRED" | "OPTIONAL-1" | "OPTIONAL-2" | "EXCLUDE" | "REVIEW";

export function generatorTier(row: LoadRow): { tier: GeneratorTier; basis: string } {
  const raw = str(row.backup_priority);
  if (isBlankOrTbd(raw)) {
    return { tier: "REVIEW", basis: `Backup Priority is ${raw || "blank"}` };
  }
  const key = raw.toLowerCase().replace(/[\s_-]+/g, " ");
  const map: Record<string, GeneratorTier> = {
    critical: "REQUIRED",
    "nice to have": "OPTIONAL-1",
    stretch: "OPTIONAL-2",
    never: "EXCLUDE",
  };
  const tier = map[key];
  if (!tier) {
    return {
      tier: "REVIEW",
      basis: `Backup Priority "${raw}" is not one of Critical / Nice to Have / Stretch / Never`,
    };
  }
  return { tier, basis: `Backup Priority = ${raw}` };
}

/* ------------------------------------------------------------------ *
 * Demand: stated values only. Circuit Capacity Only is never converted.
 * ------------------------------------------------------------------ */

export interface DemandFacts {
  /** Demand Basis exactly as stated. */
  basis: string;
  /** Demand VA exactly as stated (null when blank/TBD). */
  demandVa: number | null;
  /** Arithmetic connected-load indicator only — not an NEC calculation. */
  connectedVa: number | null;
  /** True when the row is Demand Basis = Circuit Capacity Only. */
  circuitCapacityOnly: boolean;
  /** True when no usable demand value exists for generator sizing. */
  demandUnknown: boolean;
  notes: string[];
}

export function demandFacts(row: LoadRow): DemandFacts {
  const basisRaw = str(row.demand_basis);
  const circuitCapacityOnly = basisRaw.toLowerCase() === "circuit capacity only";
  const demandVa = isBlankOrTbd(str(row.demand_va)) ? null : num(row.demand_va);
  const connectedVa = isBlankOrTbd(str(row.connected_va)) ? null : num(row.connected_va);
  const notes: string[] = [];
  if (circuitCapacityOnly) {
    notes.push(
      "Demand Basis = Circuit Capacity Only: breaker amps must not be converted to generator VA. Actual load unknown until equipment evidence exists.",
    );
  }
  if (connectedVa != null) {
    notes.push("Connected VA is an arithmetic connected-load indicator, not an NEC panel/feeder/service/generator calculation.");
  }
  const demandUnknown = circuitCapacityOnly || demandVa == null;
  if (demandUnknown && !circuitCapacityOnly) {
    notes.push(`Demand VA is ${str(row.demand_va) || "blank"} — preserved as stated, not inferred.`);
  }
  return {
    basis: basisRaw || NOT_IN_RECORD,
    demandVa,
    connectedVa,
    circuitCapacityOnly,
    demandUnknown,
    notes,
  };
}

/** Fields that are preserved verbatim, TBD/blank included. */
export interface PreservedFacts {
  demandVa: string;
  continuousLoad: string;
  phase: string;
  generatorStartClass: string;
  generatorStartAmps: string;
}

export function preservedFacts(row: LoadRow): PreservedFacts {
  const asStated = (v: unknown): string => str(v) || NOT_IN_RECORD;
  const bool = (v: unknown): string =>
    v === true ? "Y" : v === false ? "N" : asStated(v);
  return {
    demandVa: asStated(row.demand_va),
    continuousLoad: bool(row.continuous_load),
    phase: asStated(row.phase),
    generatorStartClass: asStated(
      row.generator_start_class ?? (row as { generatorStartClass?: unknown }).generatorStartClass,
    ),
    generatorStartAmps: asStated(
      row.generator_start_amps ?? (row as { generatorStartAmps?: unknown }).generatorStartAmps,
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Physical-load view: one entry per Load_Master row.
 * ------------------------------------------------------------------ */

export interface PhysicalLoad {
  loadId: string;
  description: string;
  area: string;
  /** Design intent only. Never promoted to a generator-backed panel. */
  suggestedPanel: string;
  /** A separate concept from Suggested Panel; never auto-mapped to PNL-FS-CRIT. */
  backupPanel: string;
  dedicatedShared: "D" | "S" | "REVIEW";
  circuitGroupId: string;
  circuitResolved: boolean;
  criticality: Criticality;
  criticalityBasis: string;
  tier: GeneratorTier;
  tierBasis: string;
  demand: DemandFacts;
  preserved: PreservedFacts;
  future: string;
  installStatus: string;
  notes: string[];
}

function dedicatedShared(row: LoadRow): "D" | "S" | "REVIEW" {
  const s = str(row.dedicated_shared).toUpperCase();
  if (s === "D" || s === "DEDICATED") return "D";
  if (s === "S" || s === "SHARED") return "S";
  if (row.dedicated === true) return "D";
  if (row.dedicated === false) return "S";
  return "REVIEW";
}

export function physicalLoad(row: LoadRow): PhysicalLoad {
  const crit = criticality(row);
  const gen = generatorTier(row);
  const ds = dedicatedShared(row);
  const cgRaw = str(row.circuit_group_ref) || str(row.circuit_group_id);
  const circuitResolved = !isBlankOrTbd(cgRaw);
  const notes: string[] = [];
  if (ds === "REVIEW") {
    notes.push(`D/S is ${str(row.dedicated_shared) || "blank"} — circuit count cannot be decided from this row.`);
  }
  if (ds === "S" && !circuitResolved) {
    notes.push(
      "Shared row with blank/TBD Circuit Group ID: unresolved. It is not counted as a separate circuit.",
    );
  }
  const future = row.future === true ? "Y" : row.future === false ? "N" : str(row.future) || NOT_IN_RECORD;
  if (future === "Y") {
    notes.push("Future = Y is informational; it does not remove a critical design load from sizing.");
  }
  return {
    loadId: str(row.load_id) || NOT_IN_RECORD,
    description: str(row.description),
    area: str(row.area) || str(row.location),
    suggestedPanel: str(row.suggested_panel) || NOT_IN_RECORD,
    backupPanel: str(row.backup_panel) || NOT_IN_RECORD,
    dedicatedShared: ds,
    circuitGroupId: circuitResolved ? cgRaw : NOT_IN_RECORD,
    circuitResolved,
    criticality: crit.value,
    criticalityBasis: crit.basis,
    tier: gen.tier,
    tierBasis: gen.basis,
    demand: demandFacts(row),
    preserved: preservedFacts(row),
    future,
    installStatus: str(row.install_status) || NOT_IN_RECORD,
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * Logical-circuit view: the sizing view.
 * ------------------------------------------------------------------ */

export type LogicalCircuitKind = "DEDICATED" | "SHARED" | "UNRESOLVED";

export interface LogicalCircuit {
  /** Circuit Group ID for shared, load_id for dedicated, row id for unresolved. */
  key: string;
  kind: LogicalCircuitKind;
  /** One logical circuit = one breaker for planning. Unresolved counts as 0. */
  countsAsCircuit: boolean;
  /** BR-002 planning rating; null for dedicated rows without a stated rating. */
  plannedRatingAmps: number | null;
  ratingBasis: string;
  loads: PhysicalLoad[];
  /** Any load on the circuit is critical → the whole branch energizes. */
  includesCritical: boolean;
  /** Highest-priority tier present on the branch. */
  tier: GeneratorTier;
  /** Non-critical loads carried along because the branch is energized. */
  coLoads: string[];
  connectedVaTotal: number | null;
  demandVaTotal: number | null;
  demandUnknownLoads: string[];
  notes: string[];
}

const TIER_ORDER: GeneratorTier[] = ["REQUIRED", "OPTIONAL-1", "OPTIONAL-2", "REVIEW", "EXCLUDE"];
const strongerTier = (a: GeneratorTier, b: GeneratorTier): GeneratorTier =>
  TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b;

function statedRatingAmps(rows: LoadRow[]): number | null {
  for (const row of rows) {
    const stated =
      num((row as { circuit_rating_amps?: unknown }).circuit_rating_amps) ??
      num(row.installed_ocp_rating) ??
      num(row.design_circuit_ampacity);
    if (stated != null && stated > 0) return stated;
  }
  return null;
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * Fold physical rows into logical circuits:
 *  - D  → one circuit per row
 *  - S with a resolved Circuit Group ID → one circuit for the group (BR-003)
 *  - S with blank/TBD group → UNRESOLVED, never silently counted
 */
export function logicalCircuits(rows: LoadRow[]): LogicalCircuit[] {
  const dedicated: LogicalCircuit[] = [];
  const unresolved: LogicalCircuit[] = [];
  const groups = new Map<string, { rows: LoadRow[]; loads: PhysicalLoad[] }>();

  for (const row of rows) {
    const load = physicalLoad(row);
    if (load.dedicatedShared === "S" && load.circuitResolved) {
      const key = load.circuitGroupId;
      const bucket = groups.get(key) ?? { rows: [], loads: [] };
      bucket.rows.push(row);
      bucket.loads.push(load);
      groups.set(key, bucket);
      continue;
    }
    if (load.dedicatedShared === "S" || load.dedicatedShared === "REVIEW") {
      unresolved.push(makeCircuit(load.loadId, "UNRESOLVED", [row], [load]));
      continue;
    }
    dedicated.push(makeCircuit(load.loadId, "DEDICATED", [row], [load]));
  }

  const shared = [...groups.entries()].map(([key, b]) => makeCircuit(key, "SHARED", b.rows, b.loads));
  return [...shared, ...dedicated, ...unresolved];
}

function makeCircuit(
  key: string,
  kind: LogicalCircuitKind,
  rows: LoadRow[],
  loads: PhysicalLoad[],
): LogicalCircuit {
  const includesCritical = loads.some((l) => l.criticality === "CRITICAL");
  const tier = loads.map((l) => l.tier).reduce(strongerTier, "EXCLUDE");
  const stated = statedRatingAmps(rows);
  const notes: string[] = [];
  let plannedRatingAmps: number | null = stated;
  let ratingBasis = stated != null ? `documented circuit rating ${stated} A` : NOT_IN_RECORD;

  if (kind === "SHARED") {
    if (stated == null) {
      plannedRatingAmps = SHARED_DEFAULT_RATING_AMPS;
      ratingBasis = `BR-002 default ${SHARED_DEFAULT_RATING_AMPS} A (no documented rating)`;
    }
    notes.push(
      "BR-003: one logical circuit for this Circuit Group; the physical rows are not separate breakers.",
    );
    notes.push("Branch-circuit rating is a planning value only — it is not generator load.");
    if (includesCritical) {
      notes.push(
        "Generator-backed shared circuit: every load on the branch is included, non-critical co-loads included, because energizing the branch energizes the whole circuit.",
      );
    }
  }
  if (kind === "UNRESOLVED") {
    notes.push(
      "Shared/undetermined row with blank or TBD Circuit Group ID: unresolved. Not counted as a circuit and not summed into breaker counts.",
    );
  }

  const coLoads = includesCritical
    ? loads.filter((l) => l.criticality !== "CRITICAL").map((l) => l.loadId)
    : [];

  return {
    key,
    kind,
    countsAsCircuit: kind !== "UNRESOLVED",
    plannedRatingAmps,
    ratingBasis,
    loads,
    includesCritical,
    tier,
    coLoads,
    connectedVaTotal: sumOrNull(loads.map((l) => l.demand.connectedVa)),
    demandVaTotal: sumOrNull(loads.map((l) => l.demand.demandVa)),
    demandUnknownLoads: loads.filter((l) => l.demand.demandUnknown).map((l) => l.loadId),
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * Panel-level rollup for the topology page.
 * ------------------------------------------------------------------ */

export interface PanelRuleRollup {
  panelId: string;
  /** Rows whose Suggested Panel names this panel (design intent). */
  physical: PhysicalLoad[];
  circuits: LogicalCircuit[];
  counts: {
    physicalRows: number;
    logicalCircuits: number;
    unresolvedRows: number;
    critical: number;
    tier: Record<GeneratorTier, number>;
  };
  /** Sums are indicators only; unknown demand is reported, never filled in. */
  connectedVaTotal: number | null;
  demandVaTotal: number | null;
  demandUnknownLoads: string[];
  reviewItems: string[];
  statements: string[];
}

const matchesPanel = (value: string, panelId: string): boolean => {
  const a = value.trim().toUpperCase();
  const b = panelId.trim().toUpperCase();
  if (!a || !b) return false;
  return a === b || a.replace(/^PNL-/, "") === b.replace(/^PNL-/, "");
};

export function panelRuleRollup(panelId: string, rows: LoadRow[]): PanelRuleRollup {
  const mine = rows.filter((r) => matchesPanel(str(r.suggested_panel), panelId));
  const physical = mine.map(physicalLoad);
  const circuits = logicalCircuits(mine);
  const tier: Record<GeneratorTier, number> = {
    REQUIRED: 0,
    "OPTIONAL-1": 0,
    "OPTIONAL-2": 0,
    EXCLUDE: 0,
    REVIEW: 0,
  };
  for (const l of physical) tier[l.tier] += 1;

  const reviewItems: string[] = [];
  for (const l of physical) {
    if (l.criticality === "REVIEW") reviewItems.push(`${l.loadId}: ${l.criticalityBasis}`);
    if (l.tier === "REVIEW") reviewItems.push(`${l.loadId}: ${l.tierBasis}`);
    for (const n of l.notes) reviewItems.push(`${l.loadId}: ${n}`);
  }

  const statements = [
    `Suggested Panel = ${panelId} is design intent only. Backup Panel is a separate concept and is not promoted to PNL-FS-CRIT here — the electrician determines the final generator-backed panel arrangement, breaker count, spare spaces and load shedding.`,
    `Criticality comes only from Load_Master.Critical; generator tier comes only from Backup Priority.`,
    `Logical circuits (${circuits.filter((c) => c.countsAsCircuit).length}) are the panel/generator view: shared fixtures on one Circuit Group are one breaker, and all loads on an energized branch are summed.`,
    `Connected VA totals are arithmetic connected-load indicators, not an NEC panel, feeder, service or generator calculation.`,
  ];

  return {
    panelId,
    physical,
    circuits,
    counts: {
      physicalRows: physical.length,
      logicalCircuits: circuits.filter((c) => c.countsAsCircuit).length,
      unresolvedRows: circuits.filter((c) => c.kind === "UNRESOLVED").length,
      critical: physical.filter((l) => l.criticality === "CRITICAL").length,
      tier,
    },
    connectedVaTotal: sumOrNull(physical.map((l) => l.demand.connectedVa)),
    demandVaTotal: sumOrNull(physical.map((l) => l.demand.demandVa)),
    demandUnknownLoads: physical.filter((l) => l.demand.demandUnknown).map((l) => l.loadId),
    reviewItems: [...new Set(reviewItems)],
    statements,
  };
}

/** Human-readable rule list, shown in the UI so the rules are auditable. */
export const BUSINESS_RULES: { id: string; rule: string }[] = [
  { id: "CRIT-1", rule: "Load_Master.Critical = Y is the only source of criticality. Never inferred from panel, description, amps or VA." },
  { id: "GEN-1", rule: "Backup Priority sets generator tier: Critical → REQUIRED, Nice to Have → OPTIONAL-1, Stretch → OPTIONAL-2, Never → EXCLUDE, blank/TBD → REVIEW." },
  { id: "BR-003", rule: "D/S = D is one logical circuit per row. D/S = S with a resolved Circuit Group ID is one logical circuit; multiple physical rows are not multiple breakers." },
  { id: "GEN-2", rule: "A generator-backed shared circuit includes every load on that circuit, non-critical co-loads included, because energizing the branch energizes the whole circuit." },
  { id: "BR-003b", rule: "Shared rows with blank/TBD Circuit Group ID stay unresolved and are never silently counted as separate circuits." },
  { id: "BR-002", rule: "A shared circuit defaults to 20 A unless an explicit documented rating overrides it. Branch-circuit planning value only, not generator load." },
  { id: "VA-1", rule: "Connected VA is an arithmetic connected-load indicator only, not a final NEC panel, feeder, service or generator calculation." },
  { id: "VA-2", rule: "Demand Basis = Circuit Capacity Only is never converted from breaker amps into generator VA; the actual load stays unknown until equipment evidence exists." },
  { id: "PRESERVE-1", rule: "Demand VA, Continuous Load, Phase, Generator Start Class and Generator Start Amps are preserved exactly as stated, TBD/blank included." },
  { id: "PANEL-1", rule: "Suggested Panel is design intent. Backup Panel is a separate concept and does not automatically become PNL-FS-CRIT; the electrician determines the final generator-backed arrangement, breaker count, spare spaces and load shedding." },
  { id: "STATUS-1", rule: "Future and Installation Status are informational and do not remove a critical design load from sizing." },
];
