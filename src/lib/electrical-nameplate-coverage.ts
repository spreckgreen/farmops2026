// Large-load nameplate coverage: which sizeable equipment rows in
// `electrical_loads` already carry a recorded nameplate, and which do not.
//
// Pure module — the thresholds, the badge text and the coverage rules live here
// so the admin page, the server scan and the tests all agree.
//
// Example: LD-014 "Mini split — shop" at 240 V / 1920 VA is a large load; if it
// holds nameplate_manufacturer + nameplate_model + nameplate_volts + nameplate_fla_rla
// it is "recorded"; with only a model number it is "partial"; with nothing, "missing".

/** A load row as read for the coverage scan. */
export interface NameplateCoverageInput {
  id: string;
  load_id: string | null;
  description: string | null;
  location: string | null;
  area: string | null;
  volts: string | number | null;
  amps: string | number | null;
  connected_va: string | number | null;
  equipment_model: string | null;
  dedicated: boolean | null;
  equipment_fla: string | number | null;
  minimum_circuit_ampacity: string | number | null;
  maximum_overcurrent_protection: string | number | null;
  nameplate_manufacturer: string | null;
  nameplate_model: string | null;
  nameplate_serial: string | null;
  nameplate_volts: string | null;
  nameplate_phase: string | null;
  nameplate_fla_rla: string | null;
  nameplate_mca: string | null;
  nameplate_mocp: string | null;
  nameplate_source: string | null;
  nameplate_captured_at: string | null;
}

/** A load counts as "large" at or above these, on any one measure. */
export const LARGE_LOAD_VA = 1920; // 240 V × 8 A, i.e. a real appliance branch
export const LARGE_LOAD_AMPS = 15;

export type NameplateCoverageStatus = "recorded" | "partial" | "missing";

export interface NameplateCoverageItem {
  id: string;
  ref: string;
  label: string;
  location: string | null;
  /** Plain-language reasons this row was picked up by the large-load scan. */
  reasons: string[];
  /** Largest of the size signals, used for ordering worst-first. */
  sizeVa: number | null;
  amps: number | null;
  volts: string | null;
  /** Best available manufacturer/model text for an AI specification lookup. */
  searchHint: string | null;
  status: NameplateCoverageStatus;
  badge: string;
  /** Nameplate fields already on the row. */
  recorded: string[];
  /** Nameplate fields still absent. */
  missing: string[];
  source: string | null;
  capturedAt: string | null;
  /** Enough identity text (manufacturer and/or model) to attempt a lookup. */
  searchable: boolean;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t ? t : null;
}

/** Nameplate fields the coverage badge cares about, in display order. */
export const COVERAGE_FIELDS: readonly { key: keyof NameplateCoverageInput; label: string }[] = [
  { key: "nameplate_manufacturer", label: "Manufacturer" },
  { key: "nameplate_model", label: "Model" },
  { key: "nameplate_serial", label: "Serial" },
  { key: "nameplate_volts", label: "Voltage" },
  { key: "nameplate_phase", label: "Phase" },
  { key: "nameplate_fla_rla", label: "FLA / RLA" },
  { key: "nameplate_mca", label: "MCA" },
  { key: "nameplate_mocp", label: "MOCP" },
] as const;

/** Fields that must all be present before a plate counts as recorded. */
const CORE_FIELDS: (keyof NameplateCoverageInput)[] = [
  "nameplate_manufacturer",
  "nameplate_model",
  "nameplate_volts",
];

/** Why this row is in scope, or null when it is not a large load. */
export function largeLoadReasons(row: NameplateCoverageInput): string[] {
  const reasons: string[] = [];
  const va = num(row.connected_va);
  const amps = num(row.amps) ?? num(row.equipment_fla);
  const mca = num(row.minimum_circuit_ampacity);
  const mocp = num(row.maximum_overcurrent_protection);
  if (va != null && va >= LARGE_LOAD_VA) reasons.push(`${va} VA connected`);
  if (amps != null && amps >= LARGE_LOAD_AMPS) reasons.push(`${amps} A`);
  if (mca != null && mca >= LARGE_LOAD_AMPS) reasons.push(`MCA ${mca} A`);
  if (mocp != null && mocp >= 20) reasons.push(`MOCP ${mocp} A`);
  if (row.dedicated === true && (va == null || va >= 1000)) {
    reasons.push("dedicated circuit");
  }
  return reasons;
}

export function coverageStatus(row: NameplateCoverageInput): {
  status: NameplateCoverageStatus;
  recorded: string[];
  missing: string[];
} {
  const recorded: string[] = [];
  const missing: string[] = [];
  for (const f of COVERAGE_FIELDS) {
    if (text(row[f.key])) recorded.push(f.label);
    else missing.push(f.label);
  }
  const coreDone = CORE_FIELDS.every((k) => text(row[k]));
  const ratingDone = Boolean(
    text(row.nameplate_fla_rla) || text(row.nameplate_mca) || text(row.nameplate_mocp),
  );
  const status: NameplateCoverageStatus =
    coreDone && ratingDone ? "recorded" : recorded.length > 0 ? "partial" : "missing";
  return { status, recorded, missing };
}

export const COVERAGE_BADGE: Record<NameplateCoverageStatus, string> = {
  recorded: "Nameplate recorded",
  partial: "Nameplate partial",
  missing: "No nameplate",
};

/** Manufacturer/model text an AI specification lookup can work from. */
export function nameplateSearchHint(row: NameplateCoverageInput): string | null {
  const parts = [
    text(row.nameplate_manufacturer),
    text(row.nameplate_model) ?? text(row.equipment_model),
  ].filter(Boolean) as string[];
  if (parts.length === 0) {
    const model = text(row.equipment_model);
    return model ?? null;
  }
  return parts.join(" ");
}

/** Classify every large load and order it worst-coverage-first. */
export function scanNameplateCoverage(
  rows: NameplateCoverageInput[],
): NameplateCoverageItem[] {
  const rank: Record<NameplateCoverageStatus, number> = {
    missing: 0,
    partial: 1,
    recorded: 2,
  };
  const items: NameplateCoverageItem[] = [];
  for (const row of rows) {
    const reasons = largeLoadReasons(row);
    if (reasons.length === 0) continue;
    const { status, recorded, missing } = coverageStatus(row);
    const hint = nameplateSearchHint(row);
    items.push({
      id: row.id,
      ref: text(row.load_id) ?? row.id.slice(0, 8),
      label: text(row.description) ?? text(row.load_id) ?? "Unnamed load",
      location: text(row.location) ?? text(row.area),
      reasons,
      sizeVa: num(row.connected_va),
      amps: num(row.amps) ?? num(row.equipment_fla),
      volts: text(row.volts),
      searchHint: hint,
      status,
      badge: COVERAGE_BADGE[status],
      recorded,
      missing,
      source: text(row.nameplate_source),
      capturedAt: text(row.nameplate_captured_at),
      searchable: Boolean(hint && hint.length >= 3),
    });
  }
  return items.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (b.sizeVa ?? 0) - (a.sizeVa ?? 0) ||
      a.ref.localeCompare(b.ref),
  );
}

export interface NameplateCoverageSummary {
  total: number;
  recorded: number;
  partial: number;
  missing: number;
  searchable: number;
}

export function summarizeCoverage(
  items: NameplateCoverageItem[],
): NameplateCoverageSummary {
  return {
    total: items.length,
    recorded: items.filter((i) => i.status === "recorded").length,
    partial: items.filter((i) => i.status === "partial").length,
    missing: items.filter((i) => i.status === "missing").length,
    searchable: items.filter((i) => i.searchable && i.status !== "recorded").length,
  };
}

export const NAMEPLATE_LOOKUP_SYSTEM_PROMPT =
  "You look up published nameplate ratings for a specific piece of electrical equipment, for an " +
  "administrator recording a farm's electrical system of record. Use only ratings you can attribute " +
  "to the exact manufacturer and model given. If the model is ambiguous, discontinued-with-variants, " +
  "or you are not certain, every rating field is null and you explain why in `notes` — never a typical, " +
  "class-average or interpolated value. Reply with ONE JSON object and nothing else, using exactly these " +
  "keys: manufacturer, model, serial, voltage, phase, hz, fla, mca, mocp, hp, watts, sccr, lra, notes. " +
  "`serial` is always null (it is unit-specific and cannot be looked up). Values are strings as published, " +
  "or null. This is a draft for human confirmation against the physical plate; it writes no record.";

export const NAMEPLATE_LOOKUP_NOTE =
  "A specification lookup is not a plate reading: it is a draft to be confirmed against the equipment. " +
  "Recorded values land on the nameplate columns only, are stamped with their source and the administrator " +
  "who recorded them, and never overwrite adjudicated as-installed voltage, current or OCP values.";
