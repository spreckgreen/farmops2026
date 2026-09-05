// FARMOPS-ELEC-LIFECYCLE-V1 — multidimensional electrical lifecycle model.
//
// A single "status" column cannot describe design, procurement, installation,
// energization and verification at the same time. This module keeps those
// dimensions separate and derives every result from stored records; nothing here
// writes, and no panel percentage is ever treated as authoritative data.
//
// Vocabulary rules that must not drift:
//   * "Material ready" means the materials are physically on hand. It does NOT
//     mean installation has begun.
//   * Capacity utilization (occupied poles / usable positions) is NEVER project
//     completion. A 40-position panel with seven installed circuits is 17.5%
//     utilized and can still be 100% complete for a declared seven-circuit scope.
//   * Blank/spare/reserved positions never reduce installation completion. Only
//     positions that have not been classified at all reduce documentation coverage.
//   * Testing, energization and as-built verification only advance on explicit
//     accepted evidence — never by inference from a neighbouring milestone.
//   * Holds and conflicts are reported separately and never silently change a
//     percentage.

/** Ordered lifecycle milestones. Not a status ladder — each is tracked separately. */
export const ELECTRICAL_MILESTONES = [
  "planned",
  "material_ready",
  "breaker_installed",
  "raceway_installed",
  "conductors_pulled",
  "source_termination",
  "load_termination",
  "tested",
  "energized",
  "as_built_verified",
  "out_of_service",
  "retired",
] as const;
export type ElectricalMilestone = (typeof ELECTRICAL_MILESTONES)[number];

export const MILESTONE_LABELS: Record<ElectricalMilestone, string> = {
  planned: "Planned",
  material_ready: "Material ready",
  breaker_installed: "Breaker/device installed",
  raceway_installed: "Raceway or cable pathway installed",
  conductors_pulled: "Conductors pulled",
  source_termination: "Panel/source termination complete",
  load_termination: "Load termination complete",
  tested: "Tested",
  energized: "Energized",
  as_built_verified: "As-built verified",
  out_of_service: "Out of service",
  retired: "Retired/removed",
};

export const MILESTONE_HELP: Record<ElectricalMilestone, string> = {
  planned: "On the drawings or in the record; no work committed yet.",
  material_ready:
    "The required materials are physically available for installation. This does not mean installation has begun.",
  breaker_installed: "The breaker or device is physically installed in its position.",
  raceway_installed:
    "Conduit, EMT, tray or duct is installed. Mark not applicable for a cable installation that needs no raceway.",
  conductors_pulled: "Conductors are pulled end to end for this circuit.",
  source_termination: "Terminated at the panel or source end.",
  load_termination: "Terminated at the load or device end.",
  tested: "Recorded test results exist. Never inferred from installation.",
  energized: "Explicitly observed energized. Never inferred from conductor presence.",
  as_built_verified:
    "Accepted field evidence covers identity, connection and location for the finished installation.",
  out_of_service: "Installed but deliberately not in service.",
  retired: "Removed from service and from the active installation.",
};

/** Milestones counted in rollout denominators (lifecycle end-states are excluded). */
export const CIRCUIT_PROGRESS_MILESTONES: readonly ElectricalMilestone[] = [
  "material_ready",
  "breaker_installed",
  "raceway_installed",
  "conductors_pulled",
  "source_termination",
  "load_termination",
  "tested",
  "energized",
  "as_built_verified",
];

/** Milestones that only ever advance on explicit accepted evidence. */
export const EVIDENCE_ONLY_MILESTONES: readonly ElectricalMilestone[] = [
  "tested",
  "energized",
  "as_built_verified",
];

export const TERMINAL_MILESTONES: readonly ElectricalMilestone[] = [
  "out_of_service",
  "retired",
];

/**
 * `unknown` = no record yet (a visible gap). `not_applicable` = explicitly
 * declared inapplicable, and therefore excluded from every denominator.
 */
export type MilestoneState = "complete" | "pending" | "not_applicable" | "unknown";

/** Stages that mean a stored record is finished for rollup purposes. */
export const DONE_STAGES: readonly string[] = ["complete", "as_built_verified"];

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/**
 * Which milestones a stored `install_status` value proves. Deliberately
 * conservative: `complete` does not prove energization, and nothing proves
 * as-built verification except the verified status itself.
 */
export const STATUS_PROVES: Record<string, ElectricalMilestone[]> = {
  planned: ["planned"],
  material_ready: ["planned", "material_ready"],
  rough_in_started: ["planned", "material_ready"],
  raceway_installed: ["planned", "material_ready", "raceway_installed"],
  conductors_installed: [
    "planned",
    "material_ready",
    "raceway_installed",
    "conductors_pulled",
  ],
  device_side_connected: [
    "planned",
    "material_ready",
    "raceway_installed",
    "conductors_pulled",
    "load_termination",
  ],
  source_side_connected: [
    "planned",
    "material_ready",
    "raceway_installed",
    "conductors_pulled",
    "load_termination",
    "source_termination",
  ],
  tested: [
    "planned",
    "material_ready",
    "raceway_installed",
    "conductors_pulled",
    "load_termination",
    "source_termination",
    "tested",
  ],
  complete: [
    "planned",
    "material_ready",
    "raceway_installed",
    "conductors_pulled",
    "load_termination",
    "source_termination",
    "tested",
  ],
  as_built_verified: [
    "planned",
    "material_ready",
    "raceway_installed",
    "conductors_pulled",
    "load_termination",
    "source_termination",
    "tested",
    "as_built_verified",
  ],
};

export interface MilestoneDerivationInput {
  /** Stored `install_status` of the circuit group / branch record. */
  install_status?: string | null;
  /** True when a breaker position is installed and linked to this circuit. */
  breaker_installed?: boolean;
  /** Explicitly declared not-applicable milestones (e.g. direct-buried cable). */
  not_applicable?: readonly ElectricalMilestone[];
  /** Milestones proven by accepted field evidence, regardless of stored status. */
  evidence?: readonly ElectricalMilestone[];
  /** True when the object is out of service or retired. */
  out_of_service?: boolean;
  retired?: boolean;
}

export type MilestoneMap = Record<ElectricalMilestone, MilestoneState>;

/** Derive the per-milestone state of one object from its stored records. */
export function deriveMilestones(input: MilestoneDerivationInput): MilestoneMap {
  const na = new Set(input.not_applicable ?? []);
  const proven = new Set<ElectricalMilestone>(
    STATUS_PROVES[norm(input.install_status)] ?? [],
  );
  for (const m of input.evidence ?? []) proven.add(m);
  if (input.breaker_installed) proven.add("breaker_installed");

  const map = {} as MilestoneMap;
  for (const m of ELECTRICAL_MILESTONES) {
    if (na.has(m)) {
      map[m] = "not_applicable";
      continue;
    }
    if (m === "out_of_service") {
      map[m] = input.out_of_service ? "complete" : "not_applicable";
      continue;
    }
    if (m === "retired") {
      map[m] = input.retired ? "complete" : "not_applicable";
      continue;
    }
    if (proven.has(m)) {
      map[m] = "complete";
      continue;
    }
    // Evidence-only milestones stay unknown until evidence exists; the rest are
    // pending once the object is on the books at all.
    map[m] =
      EVIDENCE_ONLY_MILESTONES.includes(m) && !norm(input.install_status)
        ? "unknown"
        : EVIDENCE_ONLY_MILESTONES.includes(m)
          ? "pending"
          : norm(input.install_status)
            ? "pending"
            : "unknown";
  }
  return map;
}

// ---------------------------------------------------------------------------
// Panel positions
// ---------------------------------------------------------------------------

export const POSITION_CLASSES = [
  "active",
  "planned",
  "reserved",
  "spare",
  "unavailable",
  "unclassified",
] as const;
export type PositionClass = (typeof POSITION_CLASSES)[number];

export const POSITION_CLASS_LABELS: Record<PositionClass, string> = {
  active: "Active",
  planned: "Planned",
  reserved: "Reserved",
  spare: "Spare",
  unavailable: "Unavailable / not applicable",
  unclassified: "Not yet classified",
};

export interface PositionRecord {
  position: number;
  poles: number | null;
  label?: string | null;
  circuit_group_uuid?: string | null;
  install_status?: string | null;
  /** Explicit classification when the record carries one. */
  classification?: PositionClass | null;
}

const SPARE_WORDS = /\bspare\b|\bblank\b|\bempty\b/i;
const RESERVED_WORDS = /\breserved\b|\bfuture\b|\bhold\b/i;
const UNAVAILABLE_WORDS = /\bunavailable\b|\bnot applicable\b|\bn\/a\b|\bunusable\b/i;

/**
 * Classify one physical position from its stored record. Never guessed from a
 * neighbouring position: only this record's own fields are read.
 */
export function classifyPosition(p: PositionRecord): PositionClass {
  if (p.classification) return p.classification;
  const label = p.label ?? "";
  if (UNAVAILABLE_WORDS.test(label)) return "unavailable";
  if (RESERVED_WORDS.test(label)) return "reserved";
  if (SPARE_WORDS.test(label)) return "spare";
  if (p.circuit_group_uuid) {
    return DONE_STAGES.includes(norm(p.install_status)) ||
      norm(p.install_status) === "tested"
      ? "active"
      : norm(p.install_status)
        ? "planned"
        : "unclassified";
  }
  return "unclassified";
}

/** Poles a position occupies. A multi-pole breaker is one breaker, many poles. */
export const positionPoles = (p: PositionRecord) =>
  Math.max(1, Math.round(Number(p.poles ?? 1) || 1));

export interface CapacityResult {
  usablePositions: number;
  occupiedPositions: number;
  /** occupied physical positions / usable physical positions. */
  utilizationPercent: number;
  /** Distinct breakers, regardless of how many poles each consumes. */
  breakerCount: number;
  denominator: string;
}

/**
 * Capacity utilization only. This is never installation or project completion.
 */
export function panelCapacity(
  positions: readonly PositionRecord[],
  usablePositions: number,
): CapacityResult {
  const occupiedRecords = positions.filter((p) => {
    const c = classifyPosition(p);
    return c === "active" || c === "planned";
  });
  const occupied = occupiedRecords.reduce((n, p) => n + positionPoles(p), 0);
  const usable = Math.max(0, Math.round(usablePositions || 0));
  return {
    usablePositions: usable,
    occupiedPositions: occupied,
    utilizationPercent: usable > 0 ? Number(((occupied / usable) * 100).toFixed(1)) : 0,
    breakerCount: occupiedRecords.length,
    denominator:
      "Occupied physical positions (poles) divided by usable physical positions. Capacity only — not project completion.",
  };
}

export interface PositionClassTotals {
  totals: Record<PositionClass, number>;
  /** Positions with a record that has been classified. */
  classified: number;
  /** Physical positions with no record or no classification. */
  unclassified: number;
  /** classified positions / usable positions. */
  documentationCoveragePercent: number;
  denominator: string;
}

export function positionClassTotals(
  positions: readonly PositionRecord[],
  usablePositions: number,
): PositionClassTotals {
  const totals = Object.fromEntries(
    POSITION_CLASSES.map((c) => [c, 0]),
  ) as Record<PositionClass, number>;
  let recordedPoles = 0;
  let classifiedPoles = 0;
  for (const p of positions) {
    const c = classifyPosition(p);
    const poles = positionPoles(p);
    totals[c] += poles;
    recordedPoles += poles;
    if (c !== "unclassified") classifiedPoles += poles;
  }
  const usable = Math.max(0, Math.round(usablePositions || 0));
  const missing = Math.max(0, usable - recordedPoles);
  totals["unclassified"] += missing;
  const unclassified = totals["unclassified"];
  return {
    totals,
    classified: classifiedPoles,
    unclassified,
    documentationCoveragePercent:
      usable > 0 ? Number(((classifiedPoles / usable) * 100).toFixed(1)) : 0,
    denominator:
      "Classified physical positions divided by usable physical positions. Unclassified positions reduce documentation coverage only — never installation completion.",
  };
}

// ---------------------------------------------------------------------------
// Circuit rollout
// ---------------------------------------------------------------------------

export interface ScopedCircuit {
  circuit_group_id: string;
  /** Only declared in-scope circuits are counted in rollout. */
  in_scope: boolean;
  milestones: MilestoneMap;
  /** Connected loads with accepted field evidence, for load completion counts. */
  connectedLoads?: number;
  completedLoads?: number;
}

export interface MilestoneCount {
  milestone: ElectricalMilestone;
  label: string;
  complete: number;
  applicable: number;
  /** complete / applicable, expressed as a percentage. */
  percent: number;
  notApplicable: number;
  unknown: number;
}

export interface RolloutResult {
  inScopeCircuits: number;
  completedMilestones: number;
  applicableMilestones: number;
  /** completed applicable milestones / total applicable milestones, in-scope only. */
  rolloutPercent: number;
  counts: MilestoneCount[];
  denominator: string;
}

/**
 * Circuit rollout across declared in-scope circuits, counting only applicable
 * milestones. An unfinished circuit never changes a sibling circuit's result:
 * every circuit contributes its own milestones independently.
 */
export function circuitRollout(circuits: readonly ScopedCircuit[]): RolloutResult {
  const inScope = circuits.filter((c) => c.in_scope);
  const counts: MilestoneCount[] = [];
  let completed = 0;
  let applicable = 0;
  for (const m of CIRCUIT_PROGRESS_MILESTONES) {
    let complete = 0;
    let na = 0;
    let unknown = 0;
    for (const c of inScope) {
      const s = c.milestones[m];
      if (s === "not_applicable") na += 1;
      else if (s === "complete") complete += 1;
      else if (s === "unknown") unknown += 1;
    }
    const app = inScope.length - na;
    completed += complete;
    applicable += app;
    counts.push({
      milestone: m,
      label: MILESTONE_LABELS[m],
      complete,
      applicable: app,
      percent: app > 0 ? Number(((complete / app) * 100).toFixed(1)) : 0,
      notApplicable: na,
      unknown,
    });
  }
  return {
    inScopeCircuits: inScope.length,
    completedMilestones: completed,
    applicableMilestones: applicable,
    rolloutPercent: applicable > 0 ? Number(((completed / applicable) * 100).toFixed(1)) : 0,
    counts,
    denominator:
      "Completed applicable milestones divided by total applicable milestones for declared in-scope circuits. Not-applicable milestones are excluded from the denominator; spare positions are not counted at all.",
  };
}

// ---------------------------------------------------------------------------
// Panel rollup
// ---------------------------------------------------------------------------

export interface PanelHold {
  ref: string;
  reason: string;
  kind: "hold" | "conflict";
}

export interface PanelCompletenessInput {
  panel_id: string;
  /** Stored infrastructure stage of the panel enclosure/feeder itself. */
  infrastructure_status: string | null;
  /** Usable physical positions (panel spaces). */
  usablePositions: number;
  positions: readonly PositionRecord[];
  circuits: readonly ScopedCircuit[];
  /** Loads identified by accepted field observations for this panel. */
  identifiedLoads?: number;
  connectedLoads?: number;
  verifiedLoads?: number;
  holds?: readonly PanelHold[];
  /** Evidence source description, e.g. an audit batch ID. */
  evidenceSource?: string | null;
  calculatedAt?: string;
}

export interface PanelCompleteness {
  panel_id: string;
  /** Short operational description, e.g. "Operational — partially populated". */
  operational: string;
  infrastructure: { status: string; label: string; stage: number; of: number };
  capacity: CapacityResult;
  positionClasses: PositionClassTotals;
  rollout: RolloutResult;
  loads: {
    identified: number;
    connected: number;
    verified: number;
    percent: number;
    denominator: string;
  };
  holds: PanelHold[];
  /**
   * Optional weighted headline. Formula: the mean of the component milestone
   * percentages for in-scope circuits — identical to `rollout.rolloutPercent`.
   * It is never shown without the component metrics beside it.
   */
  weighted: { percent: number; formula: string };
  evidenceSource: string | null;
  calculatedAt: string;
  /** Every denominator, spelled out for the UI. */
  denominators: { name: string; text: string }[];
}

/**
 * Complete % is a presentation of the recorded stage — never an independently
 * typed number. Each stage on the ten-step install ladder maps to exactly one
 * percentage, so "Conductors installed" always reads 55% on every record type
 * (circuit group, panel, breaker position, load, raceway, branch run...).
 *
 * The ladder: planned 0 -> material ready 10 -> rough-in started 25 ->
 * raceway installed 40 -> conductors installed 55 -> load/device termination 70
 * -> source termination 80 -> tested 90 -> complete 100 -> as-built verified 100.
 * Material ready means the materials are on hand, so it stays near zero.
 * Out of service and retired records are not on the install ladder at all.
 */
export const STAGE_COMPLETION_PERCENT: Record<string, number> = {
  planned: 0,
  material_ready: 10,
  rough_in_started: 25,
  raceway_installed: 40,
  conductors_installed: 55,
  device_side_connected: 70,
  load_termination: 70,
  source_side_connected: 80,
  source_termination: 80,
  tested: 90,
  energized: 95,
  complete: 100,
  as_built_verified: 100,
};

/** The percentage equivalent of a recorded stage, or null when off-ladder. */
export function stageCompletionPercent(status: string | null | undefined): number | null {
  const s = norm(status ?? null);
  if (!s) return null;
  const v = STAGE_COMPLETION_PERCENT[s];
  return v == null ? null : v;
}

/**
 * What to display for a record's Complete %. The stage always wins; a stored
 * number that disagrees is reported so it can be corrected rather than shown.
 */
export function displayCompletionPercent(
  status: string | null | undefined,
  storedPercent: number | null | undefined,
): { percent: number | null; source: "stage" | "stored" | "none"; stale: boolean } {
  const derived = stageCompletionPercent(status);
  if (derived != null) {
    const stored = storedPercent == null ? null : Number(storedPercent);
    return {
      percent: derived,
      source: "stage",
      stale: stored != null && Math.round(stored) !== derived,
    };
  }
  if (storedPercent != null) {
    return { percent: Number(storedPercent), source: "stored", stale: false };
  }
  return { percent: null, source: "none", stale: false };
}

/** Infrastructure stage ladder for the panel enclosure itself. */
export const INFRASTRUCTURE_STAGES: readonly string[] = [
  "planned",
  "material_ready",
  "rough_in_started",
  "raceway_installed",
  "conductors_installed",
  "source_side_connected",
  "tested",
  "complete",
  "as_built_verified",
];

export const INFRASTRUCTURE_STAGE_LABELS: Record<string, string> = {
  planned: "Planned",
  material_ready: "Material ready",
  rough_in_started: "Rough-in started",
  raceway_installed: "Raceway installed",
  conductors_installed: "Conductors installed",
  source_side_connected: "Source termination complete",
  tested: "Tested",
  complete: "Complete",
  as_built_verified: "As-built verified",
};

export function infrastructureStage(status: string | null) {
  const s = norm(status);
  const idx = INFRASTRUCTURE_STAGES.indexOf(s);
  return {
    status: s || "unknown",
    label: INFRASTRUCTURE_STAGE_LABELS[s] ?? "Not recorded",
    stage: idx >= 0 ? idx + 1 : 0,
    of: INFRASTRUCTURE_STAGES.length,
  };
}

/**
 * Panel results are always derived — never a stored authoritative percentage.
 * Callers may cache the returned object for performance and recalculate freely.
 */
export function buildPanelCompleteness(
  input: PanelCompletenessInput,
): PanelCompleteness {
  const capacity = panelCapacity(input.positions, input.usablePositions);
  const positionClasses = positionClassTotals(input.positions, input.usablePositions);
  const rollout = circuitRollout(input.circuits);
  const infrastructure = infrastructureStage(input.infrastructure_status);
  const identified = input.identifiedLoads ?? 0;
  const connected = input.connectedLoads ?? 0;
  const verified = input.verifiedLoads ?? 0;
  const holds = [...(input.holds ?? [])];

  const populated =
    capacity.usablePositions > 0 && capacity.occupiedPositions < capacity.usablePositions
      ? "partially populated"
      : capacity.occupiedPositions > 0
        ? "fully populated"
        : "no positions occupied";
  const operationalWord =
    infrastructure.stage >= INFRASTRUCTURE_STAGES.indexOf("conductors_installed") + 1 ||
    rollout.rolloutPercent > 0
      ? "Operational"
      : "Not yet operational";
  const operational = `${operationalWord} — ${populated}`;

  return {
    panel_id: input.panel_id,
    operational,
    infrastructure,
    capacity,
    positionClasses,
    rollout,
    loads: {
      identified,
      connected,
      verified,
      percent: identified > 0 ? Number(((connected / identified) * 100).toFixed(1)) : 0,
      denominator:
        "Loads connected by accepted field evidence divided by loads identified for this panel. Held loads stay in the hold list and are never counted as connected.",
    },
    holds,
    weighted: {
      percent: rollout.rolloutPercent,
      formula:
        "weighted% = completed applicable in-scope circuit milestones ÷ total applicable in-scope circuit milestones × 100. Position capacity and documentation coverage are deliberately excluded, and this figure is never shown alone.",
    },
    evidenceSource: input.evidenceSource ?? null,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
    denominators: [
      { name: "Capacity utilization", text: capacity.denominator },
      { name: "Position documentation coverage", text: positionClasses.denominator },
      { name: "Circuit rollout", text: rollout.denominator },
      {
        name: "Load completion",
        text: "Connected identified loads divided by identified loads for this panel.",
      },
      {
        name: "Holds and conflicts",
        text: "Listed separately. A hold never changes any percentage above.",
      },
    ],
  };
}

/** Simple, readable milestone counts such as "7 of 7 breakers installed". */
export function milestoneCountLines(result: PanelCompleteness): string[] {
  const lines = result.rollout.counts
    .filter((c) => c.applicable > 0)
    .map((c) => `${c.complete} of ${c.applicable} ${c.label.toLowerCase()}`);
  if (result.loads.identified > 0) {
    lines.push(`${result.loads.connected} of ${result.loads.identified} identified loads connected`);
  }
  if (result.holds.length) {
    lines.push(`${result.holds.length} unresolved hold${result.holds.length === 1 ? "" : "s"}`);
  }
  lines.push(
    `${result.capacity.occupiedPositions} of ${result.capacity.usablePositions} positions occupied`,
  );
  const spare =
    result.positionClasses.totals["spare"] +
    result.positionClasses.totals["reserved"] +
    result.positionClasses.totals["unclassified"];
  lines.push(`${spare} positions spare, reserved or not yet classified`);
  return lines;
}
