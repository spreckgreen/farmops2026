// Critical-load study for PNL-FS-CRIT and standby generator sizing.
//
// Source of truth is the master load list (electrical_loads). Nothing here
// writes a record and nothing is written back to the canonical ODS.
//
// Honesty rules baked into this module:
// - The imported `critical` / `backup_eligible` / `continuous_load` booleans are
//   uniformly `true` on every master-load row today, so they carry no
//   information. `booleanFlagUsable` detects that and the study then classifies
//   candidates from named evidence (recorded text) instead of pretending the
//   flag is engineering fact.
// - Every candidate carries its evidence and a tier. Selection is the reader's:
//   the study recomputes sizing from whatever set is selected.
// - Missing volts / amps / VA is reported as a gap, never filled in.

export const NOT_IN_RECORD = "NOT IN RECORD";

export interface MasterLoadRow {
  load_id: string | null;
  description: string | null;
  area: string | null;
  grid: string | null;
  count: number | null;
  volts: number | null;
  amps: number | null;
  connected_va: number | null;
  demand_va: number | null;
  phase: string | null;
  critical: boolean | null;
  future: boolean | null;
  continuous_load: boolean | null;
  backup_eligible: boolean | null;
  backup_priority: string | null;
  backup_panel: string | null;
  load_shed_group: string | null;
  suggested_panel: string | null;
  install_status: string | null;
  notes: string | null;
}

export type CriticalTier =
  | "T1_water_heat"
  | "T2_food_preservation"
  | "T3_comms_security"
  | "T4_egress_lighting"
  | "T5_comfort_hvac"
  | "not_critical";

export const TIER_LABELS: Record<CriticalTier, string> = {
  T1_water_heat: "T1 — Water, heat & life safety",
  T2_food_preservation: "T2 — Food preservation",
  T3_comms_security: "T3 — Comms, network & security",
  T4_egress_lighting: "T4 — Egress & minimum lighting",
  T5_comfort_hvac: "T5 — Comfort / conditioning",
  not_critical: "Not a critical-panel candidate",
};

/** Tiers selected by default for the PNL-FS-CRIT study. */
export const DEFAULT_TIERS: CriticalTier[] = [
  "T1_water_heat",
  "T2_food_preservation",
  "T3_comms_security",
  "T4_egress_lighting",
];

const RULES: { tier: CriticalTier; why: string; re: RegExp }[] = [
  {
    tier: "T1_water_heat",
    why: "Water supply / hydronic heat / freeze protection",
    re: /\b(well\s*pump|pressure\s*tank|sump|septic|effluent|booster\s*pump|recirculat\w*\s*pump|circulator|boiler|hydronic|heat\s*trace|freeze)\b/i,
  },
  {
    tier: "T2_food_preservation",
    why: "Food preservation load",
    re: /\b(freezer|refrigerat\w*|fridge|cooler|milk\s*tank|incubat\w*|brooder)\b/i,
  },
  {
    tier: "T3_comms_security",
    why: "Comms, network, security or control equipment",
    re: /\b(fiber|switch|router|eero|wifi|wi-fi|network|rack|ups|nvr|server|poe|camera|ring|alarm|radio|repeater|antenna|starlink|modem|controller)\b/i,
  },
  {
    tier: "T4_egress_lighting",
    why: "Egress / perimeter lighting",
    re: /\b(egress|exit\s*light|goose\s*neck|outside\s*light|man\s*door|overhead\s*led|security\s*light)\b/i,
  },
  {
    tier: "T5_comfort_hvac",
    why: "Conditioning / air movement",
    re: /\b(mini[\s-]*split|fan\s*coil|air\s*handler|exhaust\s*fan|erv|hrv|dehumidif\w*)\b/i,
  },
];

const CRIT_TEXT = /\b(crit|critical|pnl-fs-crit|backup|standby|generator|gen\s*set|transfer|microgrid)\b/i;

/** Motor-ish loads that dominate generator starting (surge) requirements. */
const MOTOR =
  /\b(pump|compressor|mini[\s-]*split|fan|blower|motor|garage\s*door|auger|grinder|saw|welder|chiller|condenser)\b/i;

/**
 * A boolean column is only usable as evidence when the master list actually
 * varies. All-true / all-false across every row is an import artifact.
 */
export function booleanFlagUsable(rows: MasterLoadRow[], field: keyof MasterLoadRow): boolean {
  const values = rows.map((r) => r[field]).filter((v) => typeof v === "boolean") as boolean[];
  if (values.length < 2) return false;
  return values.some((v) => v) && values.some((v) => !v);
}

export interface CriticalCandidate {
  load_id: string;
  description: string;
  area: string | null;
  grid: string | null;
  tier: CriticalTier;
  evidence: string[];
  /** Connected VA for the whole quantity, or null when the record has none. */
  va: number | null;
  volts: number | null;
  amps: number | null;
  quantity: number;
  /** True when this load is treated as continuous (3 h or more) by the study. */
  continuous: boolean;
  /** True when the load has a motor/compressor start characteristic. */
  motor: boolean;
  install_status: string | null;
  /** Recorded fields that are missing and block real sizing. */
  gaps: string[];
  selectedByDefault: boolean;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function classify(text: string): { tier: CriticalTier; why: string | null } {
  for (const rule of RULES) if (rule.re.test(text)) return { tier: rule.tier, why: rule.why };
  return { tier: "not_critical", why: null };
}

export function buildCandidates(rows: MasterLoadRow[]): {
  candidates: CriticalCandidate[];
  flagUsable: { critical: boolean; backup_eligible: boolean; continuous_load: boolean };
} {
  const flagUsable = {
    critical: booleanFlagUsable(rows, "critical"),
    backup_eligible: booleanFlagUsable(rows, "backup_eligible"),
    continuous_load: booleanFlagUsable(rows, "continuous_load"),
  };

  const candidates = rows.map((row) => {
    const description = (row.description ?? "").trim();
    const evidenceText = [
      description,
      row.area ?? "",
      row.notes ?? "",
      row.load_shed_group ?? "",
      row.backup_panel ?? "",
      row.backup_priority ?? "",
      row.suggested_panel ?? "",
    ].join(" · ");
    const { tier, why } = classify(evidenceText);
    const evidence: string[] = [];
    if (why) evidence.push(`${why} — matched recorded text.`);
    if (flagUsable.critical && row.critical === true) {
      evidence.push("Master list marks this load Critical.");
    }
    if (flagUsable.backup_eligible && row.backup_eligible === true) {
      evidence.push("Master list marks this load backup-eligible.");
    }
    for (const [label, value] of [
      ["Load shed group", row.load_shed_group],
      ["Backup panel", row.backup_panel],
      ["Suggested panel", row.suggested_panel],
    ] as const) {
      if (value && CRIT_TEXT.test(value)) evidence.push(`${label}: "${value}" names standby/critical intent.`);
    }

    const volts = num(row.volts);
    const amps = num(row.amps);
    const quantity = Math.max(1, num(row.count) ?? 1);
    const recordedVa = num(row.connected_va);
    const perUnit =
      recordedVa !== null && recordedVa > 0
        ? recordedVa
        : volts !== null && amps !== null && volts > 0 && amps > 0
          ? volts * amps
          : null;
    const va = perUnit === null ? null : Math.round(perUnit * quantity * 10) / 10;

    const gaps: string[] = [];
    if (volts === null || volts === 0) gaps.push("no recorded voltage");
    if (amps === null) gaps.push("no recorded amps");
    if (va === null) gaps.push("no connected VA — contributes 0 to sizing");
    if (!row.load_shed_group || /^tbd$/i.test(row.load_shed_group)) gaps.push("load shed group is TBD");
    if (!row.backup_priority || /^tbd$/i.test(row.backup_priority)) gaps.push("backup priority is TBD");

    const motor = MOTOR.test(description);
    const continuous = flagUsable.continuous_load
      ? row.continuous_load === true
      : tier === "T3_comms_security" ||
        tier === "T4_egress_lighting" ||
        tier === "T2_food_preservation";

    return {
      load_id: row.load_id ?? NOT_IN_RECORD,
      description: description || NOT_IN_RECORD,
      area: row.area ?? null,
      grid: row.grid ?? null,
      tier,
      evidence,
      va,
      volts,
      amps,
      quantity,
      continuous,
      motor,
      install_status: row.install_status ?? null,
      gaps,
      selectedByDefault: DEFAULT_TIERS.includes(tier) || evidence.some((e) => /standby\/critical intent/.test(e)),
    } satisfies CriticalCandidate;
  });

  candidates.sort((a, b) => (b.va ?? 0) - (a.va ?? 0) || a.load_id.localeCompare(b.load_id));
  return { candidates, flagUsable };
}

// --- sizing -----------------------------------------------------------------

export const PANEL_BUS_SIZES = [60, 100, 125, 150, 200, 225];
export const GENERATOR_KW_SIZES = [
  8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30, 36, 38, 45, 48, 60,
];

/** Assumptions are shown to the reader; nothing here is a code calculation. */
export const SIZING_ASSUMPTIONS = {
  panelVolts: 240,
  continuousFactor: 1.25,
  powerFactor: 0.9,
  motorStartMultiplier: 3,
  generatorHeadroom: 1.25,
};

export function nextSize(value: number, sizes: number[]): number | null {
  for (const s of sizes) if (s >= value) return s;
  return null;
}

export interface CriticalSizing {
  selectedCount: number;
  loadsWithoutVa: number;
  connectedVa: number;
  continuousVa: number;
  nonContinuousVa: number;
  /** Non-continuous + 125% of continuous. */
  demandVa: number;
  demandAmps240: number;
  recommendedBusAmps: number | null;
  largestMotor: { load_id: string; description: string; va: number } | null;
  /** Running kVA/kW the generator must carry. */
  runningKva: number;
  runningKw: number;
  /** Running kVA with the largest motor at its starting multiple. */
  startingKva: number;
  recommendedGeneratorKw: number | null;
  drivenBy: "running" | "motor_starting";
  tierTotals: { tier: CriticalTier; count: number; va: number }[];
  shedTiers: { tier: CriticalTier; label: string; cumulativeVa: number }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function sizeCriticalPanel(selected: CriticalCandidate[]): CriticalSizing {
  const connectedVa = selected.reduce((s, c) => s + (c.va ?? 0), 0);
  const continuousVa = selected.filter((c) => c.continuous).reduce((s, c) => s + (c.va ?? 0), 0);
  const nonContinuousVa = connectedVa - continuousVa;
  const demandVa = nonContinuousVa + continuousVa * SIZING_ASSUMPTIONS.continuousFactor;
  const demandAmps240 = demandVa / SIZING_ASSUMPTIONS.panelVolts;

  const motors = selected.filter((c) => c.motor && (c.va ?? 0) > 0);
  motors.sort((a, b) => (b.va ?? 0) - (a.va ?? 0));
  const biggest = motors[0];
  const largestMotor = biggest
    ? { load_id: biggest.load_id, description: biggest.description, va: biggest.va ?? 0 }
    : null;

  const runningKva = demandVa / 1000;
  const runningKw = runningKva * SIZING_ASSUMPTIONS.powerFactor;
  const startingKva = largestMotor
    ? (demandVa - largestMotor.va + largestMotor.va * SIZING_ASSUMPTIONS.motorStartMultiplier) / 1000
    : runningKva;

  const runningRequirementKw = runningKw * SIZING_ASSUMPTIONS.generatorHeadroom;
  const startingRequirementKw = startingKva * SIZING_ASSUMPTIONS.powerFactor;
  const requiredKw = Math.max(runningRequirementKw, startingRequirementKw);

  const tierMap = new Map<CriticalTier, { count: number; va: number }>();
  for (const c of selected) {
    const entry = tierMap.get(c.tier) ?? { count: 0, va: 0 };
    entry.count += 1;
    entry.va += c.va ?? 0;
    tierMap.set(c.tier, entry);
  }
  const order: CriticalTier[] = [
    "T1_water_heat",
    "T2_food_preservation",
    "T3_comms_security",
    "T4_egress_lighting",
    "T5_comfort_hvac",
    "not_critical",
  ];
  const tierTotals = order
    .filter((t) => tierMap.has(t))
    .map((t) => ({ tier: t, count: tierMap.get(t)!.count, va: r1(tierMap.get(t)!.va) }));

  let cumulative = 0;
  const shedTiers = tierTotals.map((t) => {
    cumulative += t.va;
    return { tier: t.tier, label: TIER_LABELS[t.tier], cumulativeVa: r1(cumulative) };
  });

  return {
    selectedCount: selected.length,
    loadsWithoutVa: selected.filter((c) => c.va === null).length,
    connectedVa: r1(connectedVa),
    continuousVa: r1(continuousVa),
    nonContinuousVa: r1(nonContinuousVa),
    demandVa: r1(demandVa),
    demandAmps240: r1(demandAmps240),
    recommendedBusAmps: nextSize(demandAmps240, PANEL_BUS_SIZES),
    largestMotor,
    runningKva: r1(runningKva),
    runningKw: r1(runningKw),
    startingKva: r1(startingKva),
    recommendedGeneratorKw: nextSize(requiredKw, GENERATOR_KW_SIZES),
    drivenBy: startingRequirementKw > runningRequirementKw ? "motor_starting" : "running",
    tierTotals,
    shedTiers,
  };
}

export function criticalLoadsCsv(rows: CriticalCandidate[]): string {
  const head = [
    "load_id",
    "description",
    "area",
    "grid",
    "tier",
    "quantity",
    "volts",
    "amps",
    "connected_va",
    "continuous",
    "motor_start",
    "install_status",
    "evidence",
    "gaps",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) =>
    [
      r.load_id,
      r.description,
      r.area ?? "",
      r.grid ?? "",
      TIER_LABELS[r.tier],
      r.quantity,
      r.volts ?? "",
      r.amps ?? "",
      r.va ?? "",
      r.continuous ? "yes" : "no",
      r.motor ? "yes" : "no",
      r.install_status ?? "",
      r.evidence.join(" | "),
      r.gaps.join(" | "),
    ]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...body].join("\n");
}
