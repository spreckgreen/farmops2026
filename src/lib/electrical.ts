// Pure helpers for the Electrical Infrastructure module.
//
// The conventions encoded here are the ones the requirements document says must
// not drift:
//  - stable IDs never encode mutable physical attributes;
//  - a panel's raceway exit order starts lower-right and runs counterclockwise;
//  - the Farm Shop field walk starts at A6 (NE) and runs clockwise, outside-in;
//  - interior and site raceways are one dataset filtered by environment.
//
// Infrastructure (rack / power asset / device) naming rules are NOT declared
// here: they live in `electrical-infrastructure-standards.ts` so the Standards
// page, forms, validators, QA and ID generators share one definition.

import {
  INFRA_ROLE_CODES,
  canonicalInfrastructurePattern,
  checkInfrastructureId,
  infrastructureShape,
  legacyInfrastructurePattern,
  type InfrastructureKind,
} from "./electrical-infrastructure-standards";
import { checkCircuitGroupId } from "./electrical-breaker-reference";


export const INSTALL_STATUSES = [
  "planned",
  "material_ready",
  "rough_in_started",
  "raceway_installed",
  "conductors_installed",
  "device_side_connected",
  "source_side_connected",
  "tested",
  "complete",
  "as_built_verified",
] as const;
export type InstallStatus = (typeof INSTALL_STATUSES)[number];

export function installStatusLabel(value: string): string {
  const map: Record<string, string> = {
    planned: "Planned",
    material_ready: "Material Ready",
    rough_in_started: "Rough-In Started",
    raceway_installed: "Raceway Installed",
    conductors_installed: "Conductors/Cable Installed",
    device_side_connected: "Device Side Connected",
    source_side_connected: "Panel/Source Side Connected",
    tested: "Tested",
    complete: "Complete",
    as_built_verified: "As-Built Verified",
  };
  return map[value] ?? value;
}

export const RACEWAY_ENVIRONMENTS = [
  "INTERIOR",
  "SITE_UNDERGROUND",
  "SITE_EXTERIOR",
  "BUILDING_TRANSITION",
] as const;
export type RacewayEnvironment = (typeof RACEWAY_ENVIRONMENTS)[number];

export function isSiteEnvironment(env: string): boolean {
  return env === "SITE_UNDERGROUND" || env === "SITE_EXTERIOR";
}

export const LABEL_STATUSES = ["none", "queued", "printed", "installed", "reprint"] as const;

export const LABEL_CLASSES = [
  "load_device_circuit",
  "panel_breaker",
  "raceway_conduit",
  "junction_box",
  "branch_run",
] as const;
export type LabelClass = (typeof LABEL_CLASSES)[number];

export const ENDPOINT_TYPES = [
  "panel",
  "junction_box",
  "equipment",
  "handhole",
  "load",
  "other",
] as const;
export type EndpointType = (typeof ENDPOINT_TYPES)[number];

// ---------------------------------------------------------------- stable IDs

export type ElectricalEntityKind =
  | "load"
  | "circuit_group"
  | "panel"
  | "feeder"
  | "raceway"
  | "jbox"
  | "branch"
  // FarmOps-native infrastructure entities. They have no canonical ODS
  // counterpart and are never added to the workbook to force equivalence.
  | "rack"
  | "power_asset"
  | "device";

/**
 * Entities FarmOps owns outright. They are legitimate infrastructure /
 * as-built / planning extensions and have no canonical ODS counterpart, so they
 * are never added to the workbook to force validation equivalence.
 */
export const FARMOPS_NATIVE_KINDS = new Set<ElectricalEntityKind>([
  "rack",
  "power_asset",
  "device",
]);

/**
 * Phase 4.4a lossless capture column. Every ODS-backed entity carries it: any
 * populated canonical workbook column that has no dedicated FarmOps field is
 * stored here verbatim, keyed by its exact workbook header, so canonical
 * engineering information is preserved instead of reported as semantic loss.
 * Written only by the workbook import; never hand-edited.
 */
export const ODS_EXTRAS_FIELD = "ods_extras";

/**
 * Reserved entry inside the lossless-capture JSON that records where each
 * preserved value came from: worksheet, exact header, and 1-based worksheet
 * column. Without it a preserved value cannot be traced back to its canonical
 * meaning, and two columns carrying the same header text are indistinguishable.
 */
export const ODS_EXTRAS_SOURCE_KEY = "__source";

export interface OdsExtrasSource {
  sheet: string;
  header: string;
  column: number;
}

/**
 * The JSON key for one preserved column. The exact workbook header is used as
 * the key so the common case stays human-readable; a header text that appears
 * more than once on the same worksheet is suffixed with its worksheet column
 * number so neither duplicate overwrites the other.
 */
export function odsExtrasEntryKey(header: string, columnIndex: number, duplicate: boolean): string {
  const h = header.trim();
  return duplicate ? `${h}#${columnIndex + 1}` : h;
}

/**
 * Phase 4.4a defect fix: one FarmOps record is described by several canonical
 * worksheets (Load_Master, circuit-group and installation sheets all key on the
 * same load). Writing the capture column wholesale meant the last sheet
 * imported erased the keys preserved by the earlier ones, which the validator
 * correctly reported as semantic loss on an existing record. Capture is
 * therefore merged: every previously preserved entry and its source identity is
 * kept, the incoming run wins for a key it actually carries, and collision-safe
 * `Header#<column>` keys are never collapsed onto their bare header.
 */
export function mergeOdsExtras(existing: unknown, next: unknown): string | null {
  const a = parseOdsExtras(existing) ?? (typeof existing === "object" && existing ? (existing as Record<string, unknown>) : null);
  const b = parseOdsExtras(next) ?? (typeof next === "object" && next ? (next as Record<string, unknown>) : null);
  if (!a && !b) return null;
  const values = new Map<string, string>();
  const sources = new Map<string, OdsExtrasSource>();
  for (const src of [a, b]) {
    if (!src) continue;
    const meta = src[ODS_EXTRAS_SOURCE_KEY];
    for (const [key, v] of Object.entries(src)) {
      if (key === ODS_EXTRAS_SOURCE_KEY) continue;
      if (typeof v === "string") values.set(key, v);
    }
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      for (const [key, m] of Object.entries(meta as Record<string, unknown>)) {
        if (!m || typeof m !== "object") continue;
        const s = m as Partial<OdsExtrasSource>;
        if (!s.header) continue;
        sources.set(key, {
          sheet: String(s.sheet ?? ""),
          header: String(s.header),
          column: Number(s.column ?? 0),
        });
      }
    }
  }
  if (!values.size) return null;
  const keys = [...values.keys()].sort();
  const out: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, values.get(k)!]));
  const src = Object.fromEntries(
    keys.filter((k) => sources.has(k)).map((k) => [k, sources.get(k)!]),
  );
  if (Object.keys(src).length) out[ODS_EXTRAS_SOURCE_KEY] = src;
  return JSON.stringify(out);
}

/** Parse a stored lossless-capture value; unparseable capture is not evidence. */
export function parseOdsExtras(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Every value preserved for one worksheet column, resolved by source identity
 * first (worksheet + exact header) and then by key shape, so duplicate headers
 * and later key-format changes still prove byte-identical preservation.
 */
export function preservedOdsValues(
  extras: Record<string, unknown> | null,
  sheet: string,
  header: string,
): string[] {
  if (!extras) return [];
  const wanted = header.trim();
  const source = extras[ODS_EXTRAS_SOURCE_KEY];
  const out: string[] = [];
  const take = (key: string) => {
    const v = extras[key];
    if (typeof v === "string") out.push(v);
  };
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, meta] of Object.entries(source as Record<string, unknown>)) {
      if (!meta || typeof meta !== "object") continue;
      const m = meta as Partial<OdsExtrasSource>;
      if (String(m.header ?? "").trim() !== wanted) continue;
      // A worksheet name is only used to narrow when it is recorded.
      if (m.sheet && sheet && String(m.sheet).trim() !== sheet.trim()) continue;
      take(key);
    }
  }
  // Exact-header key, plus the `Header#<column>` duplicate form.
  for (const key of Object.keys(extras).sort()) {
    if (key === ODS_EXTRAS_SOURCE_KEY) continue;
    const base = key.replace(/#\d+$/, "").trim();
    if (base === wanted) take(key);
  }
  return [...new Set(out)];
}

/**
 * Every preserved entry for one worksheet column, with the key it is stored
 * under and the source identity that proves what it is. Diagnostics need the
 * key, not just the value, to say whether capture is missing or merely
 * differently keyed.
 */
export function preservedOdsEntries(
  extras: Record<string, unknown> | null,
  sheet: string,
  header: string,
): { key: string; value: string; bySource: boolean }[] {
  if (!extras) return [];
  const wanted = header.trim();
  const out = new Map<string, { key: string; value: string; bySource: boolean }>();
  const source = extras[ODS_EXTRAS_SOURCE_KEY];
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, meta] of Object.entries(source as Record<string, unknown>)) {
      if (!meta || typeof meta !== "object") continue;
      const m = meta as Partial<OdsExtrasSource>;
      if (String(m.header ?? "").trim() !== wanted) continue;
      if (m.sheet && sheet && String(m.sheet).trim() !== sheet.trim()) continue;
      const v = extras[key];
      if (typeof v === "string") out.set(key, { key, value: v, bySource: true });
    }
  }
  for (const key of Object.keys(extras).sort()) {
    if (key === ODS_EXTRAS_SOURCE_KEY || out.has(key)) continue;
    if (key.replace(/#\d+$/, "").trim() !== wanted) continue;
    const v = extras[key];
    if (typeof v === "string") out.set(key, { key, value: v, bySource: false });
  }
  return [...out.values()];
}

/** Non-reserved keys actually present in a record's lossless capture. */
export function odsExtrasKeys(extras: Record<string, unknown> | null): string[] {
  if (!extras) return [];
  return Object.keys(extras)
    .filter((k) => k !== ODS_EXTRAS_SOURCE_KEY)
    .sort();
}

/** True when the capture carries worksheet/header/column source identity. */
export function odsExtrasHasSourceMetadata(extras: Record<string, unknown> | null): boolean {
  const s = extras?.[ODS_EXTRAS_SOURCE_KEY];
  return Boolean(s && typeof s === "object" && !Array.isArray(s) && Object.keys(s).length > 0);
}



/**
 * Reusable power-distribution equipment types. The type is *data*: a new type
 * never requires a new table, and nothing here is specific to ham radio.
 */
export const POWER_ASSET_TYPES = [
  "AC_DC_POWER_SUPPLY",
  "UPS",
  "PDU",
  "DC_DISTRIBUTION",
] as const;
export type PowerAssetType = (typeof POWER_ASSET_TYPES)[number];

export function powerAssetTypeLabel(value: string): string {
  const map: Record<string, string> = {
    AC_DC_POWER_SUPPLY: "AC→DC power supply",
    UPS: "UPS",
    PDU: "PDU",
    DC_DISTRIBUTION: "DC distribution",
  };
  return map[value] ?? value;
}

/** AC / DC on either side of a power asset. Unknown stays unset, never guessed. */
export const CURRENT_TYPES = ["AC", "DC"] as const;

/** Suggested rack roles. Free text is still accepted for unforeseen roles. */
export const RACK_ROLES = [...Object.keys(INFRA_ROLE_CODES), "OTHER"] as const;

/** Suggested device roles; the list is advisory, not a schema constraint. */
export const DEVICE_ROLES = [
  "NETWORK",
  "RADIO",
  "SERVER",
  "SENSOR",
  "CONTROL",
  "APPLIANCE",
  "OTHER",
] as const;


/**
 * Which entity table an endpoint type resolves to. `null` means the endpoint is
 * a physical thing FarmOps does not model as its own record (a piece of
 * equipment, a handhole, "other"), so no FK can be demanded for it.
 */
export const ENDPOINT_ENTITY_KIND: Record<EndpointType, ElectricalEntityKind | null> = {
  panel: "panel",
  junction_box: "jbox",
  load: "load",
  equipment: null,
  handhole: null,
  other: null,
};

export function endpointTypeForKind(kind: ElectricalEntityKind): EndpointType | null {
  if (kind === "panel") return "panel";
  if (kind === "jbox") return "junction_box";
  if (kind === "load") return "load";
  return null;
}

const ID_PATTERNS: Record<ElectricalEntityKind, RegExp | null> = {
  // Loads get their own dedicated check (see checkLoadId) because each building
  // prefix is a separate controlled convention.
  load: null,
  circuit_group: null,
  panel: /^PNL-[A-Z0-9]+(-[A-Z0-9]+)*$/,
  // Feeders: FDR-### is the FarmOps convention. Feeder rows imported from the
  // canonical workbook keep whatever ID they were released with.
  feeder: /^FDR-\d{3}$/,
  // Raceways: CON-### is the canonical stable ID for EVERY raceway type. The
  // construction (EMT, FLEX/FMC/LFMC, PVC, underground, sleeve, …) is the typed
  // `raceway_type` attribute and is never encoded into the identity, so a
  // planned EMT run that is installed as flex keeps its CON-### ID. EMT-###
  // remains accepted only because records created under the short-lived
  // EMT-### rule are never renamed.
  raceway: /^(CON|EMT)-\d{3,}$/,
  // Hierarchical convention: a junction box encodes its raceway path, and a
  // branch encodes its raceway path plus the junction box it originates from.
  jbox: /^JB-\d{3}-\d{2}$/,
  branch: /^BR-\d{3}-\d{2}-\d{2}$/,
  // Infrastructure conventions come from the shared standards module.
  rack: canonicalInfrastructurePattern("rack"),
  power_asset: canonicalInfrastructurePattern("power_asset"),
  device: canonicalInfrastructurePattern("device"),
};

/** Legacy shapes kept valid (with a warning) so imported records never break. */
const LEGACY_ID_PATTERNS: Partial<Record<ElectricalEntityKind, RegExp>> = {
  jbox: /^JB-\d{3,}(-\d{2,})*$/,
  branch: /^BR-\d{3,}(-\d{2,})*$/,
  // Workbook-released feeder identifiers such as FD-1 or F-SERVICE-01.
  feeder: /^(FDR|FD|F)-[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/,
  rack: legacyInfrastructurePattern("rack") ?? undefined,
  power_asset: legacyInfrastructurePattern("power_asset") ?? undefined,
  device: legacyInfrastructurePattern("device") ?? undefined,
};

export const HIERARCHICAL_ID_SHAPES: Record<string, string> = {
  raceway: "CON-###",
  jbox: "JB-###-##",
  branch: "BR-###-##-##",
  feeder: "FDR-###",
  rack: infrastructureShape("rack"),
  power_asset: infrastructureShape("power_asset"),
  device: infrastructureShape("device"),
};

const INFRASTRUCTURE_KINDS: readonly InfrastructureKind[] = ["rack", "power_asset", "device"];

export function isInfrastructureKind(kind: string): kind is InfrastructureKind {
  return (INFRASTRUCTURE_KINDS as readonly string[]).includes(kind);
}

/**
 * Next sequential ID for a site/role scoped infrastructure convention, e.g.
 * nextScopedId("RACK", "FS", "NET", ["RACK-FS-NET-01"]) -> "RACK-FS-NET-02".
 */
export function nextScopedId(
  prefix: string,
  site: string,
  role: string,
  existing: string[],
): string {
  const p = (prefix ?? "").trim().toUpperCase();
  const st = (site ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rl = (role ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!p || !st || !rl) return "";
  const head = `${p}-${st}-${rl}-`;
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${head}(\\d{2,})$`).exec((id ?? "").trim().toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${head}${String(max + 1).padStart(2, "0")}`;
}


export interface ParsedHierarchicalId {
  prefix: "EMT" | "CON" | "JB" | "BR";
  /** Three-digit raceway / path number, e.g. 104. */
  path: string;
  /** Two-digit junction box sequence along the path (JB / BR only). */
  jbox: string | null;
  /** Two-digit branch sequence within the originating junction box. */
  branch: string | null;
}

/** Parse a canonical hierarchical ID. Returns null for anything non-conforming. */
export function parseHierarchicalId(raw: string): ParsedHierarchicalId | null {
  const id = (raw ?? "").trim().toUpperCase();
  let m = /^(EMT|CON)-(\d{3})$/.exec(id);
  if (m) return { prefix: m[1] as "EMT" | "CON", path: m[2], jbox: null, branch: null };
  m = /^JB-(\d{3})-(\d{2})$/.exec(id);
  if (m) return { prefix: "JB", path: m[1], jbox: m[2], branch: null };
  m = /^BR-(\d{3})-(\d{2})-(\d{2})$/.exec(id);
  if (m) return { prefix: "BR", path: m[1], jbox: m[2], branch: m[3] };
  return null;
}

/** The junction box ID a canonical branch ID says it originates from. */
export function encodedBranchOrigin(branchId: string): string | null {
  const p = parseHierarchicalId(branchId);
  if (!p || p.prefix !== "BR" || !p.jbox) return null;
  return `JB-${p.path}-${p.jbox}`;
}

/** The raceway path number encoded in a junction box or branch ID. */
export function encodedPathNumber(id: string): string | null {
  const p = parseHierarchicalId(id);
  return p ? p.path : null;
}

/**
 * Compare an encoded parent against the actual linked parent stable ID.
 * Returns null when there is nothing to compare (no encoding, or no link).
 */
export function encodedParentMismatch(
  childId: string,
  linkedParentId: string | null | undefined,
): { encoded: string; linked: string } | null {
  const encoded = encodedBranchOrigin(childId);
  const linked = (linkedParentId ?? "").trim().toUpperCase();
  if (!encoded || !linked) return null;
  return encoded === linked ? null : { encoded, linked };
}

/** Next junction box ID along a raceway path: JB-104-01, JB-104-02, … */
export function nextJboxId(pathNumber: string | number, existing: string[]): string {
  const path = String(pathNumber ?? "").replace(/\D/g, "").padStart(3, "0").slice(-3);
  if (!/^\d{3}$/.test(path)) return "";
  let max = 0;
  for (const id of existing) {
    const p = parseHierarchicalId(id ?? "");
    if (p?.prefix === "JB" && p.path === path && p.jbox) max = Math.max(max, Number(p.jbox));
  }
  return `JB-${path}-${String(max + 1).padStart(2, "0")}`;
}

/** Next branch ID originating from a junction box: BR-104-02-01, BR-104-02-02, … */
export function nextBranchId(jboxId: string, existing: string[]): string {
  const parent = parseHierarchicalId(jboxId);
  if (!parent || parent.prefix !== "JB" || !parent.jbox) return "";
  let max = 0;
  for (const id of existing) {
    const p = parseHierarchicalId(id ?? "");
    if (p?.prefix === "BR" && p.path === parent.path && p.jbox === parent.jbox && p.branch) {
      max = Math.max(max, Number(p.branch));
    }
  }
  return `BR-${parent.path}-${parent.jbox}-${String(max + 1).padStart(2, "0")}`;
}



/** Building prefixes that are legitimate for load IDs. */
export const LOAD_ID_PREFIXES: Record<string, string> = {
  FS: "Farm Shop",
  PH: "Pump House",
  BL: "Boiler",
  HSE: "House",
};

/**
 * FS/PH/BL use three digits; an optional lowercase suffix letter covers split
 * loads that already exist in the canonical spreadsheet (PH-019a / PH-019b).
 */
const LOAD_BUILDING_ID = /^(FS|PH|BL)-\d{3}[a-z]?$/;
/** The House convention is modelled explicitly rather than being a catch-all. */
const LOAD_HOUSE_ID = /^HSE-\d{2,3}[a-z]?$/;

/**
 * Controlled exception list for pre-existing load IDs that predate the
 * conventions above. Adding to this list is a deliberate, reviewable act — an
 * unknown ID is never silently waved through as "probably a House ID".
 */
export const LEGACY_LOAD_IDS: readonly string[] = [];

export interface IdCheck {
  ok: boolean;
  /** Non-blocking note for IDs that are legal but outside the main convention. */
  warning?: string;
  error?: string;
}

export function checkLoadId(raw: string): IdCheck {
  const id = (raw ?? "").trim();
  if (!id) return { ok: false, error: "A load ID is required." };
  if (LOAD_BUILDING_ID.test(id)) return { ok: true };
  if (LOAD_HOUSE_ID.test(id)) return { ok: true };
  if (LEGACY_LOAD_IDS.includes(id)) {
    return { ok: true, warning: `${id} is on the controlled legacy exception list.` };
  }
  const prefix = /^([A-Za-z]+)/.exec(id)?.[1]?.toUpperCase() ?? "";
  if (prefix in LOAD_ID_PREFIXES) {
    const shape = prefix === "HSE" ? "HSE-##" : `${prefix}-###`;
    return {
      ok: false,
      error: `${id} is a malformed ${LOAD_ID_PREFIXES[prefix]} load ID — expected ${shape}.`,
    };
  }
  return {
    ok: false,
    error: `${id} does not use a known load prefix (${Object.keys(LOAD_ID_PREFIXES).join(", ")}).`,
  };
}

/**
 * `mode: "create"` refuses legacy-only namespaces outright: `EMT-###` stays
 * readable for pre-existing raceways (never renamed) but no *new* EMT-### ID
 * may be created — `CON-###` is the canonical raceway identity for every
 * raceway type, with EMT/FLEX/PVC recorded as the raceway type instead.
 */
export function checkStableId(
  kind: ElectricalEntityKind,
  raw: string,
  opts: { mode?: "create" | "existing" } = {},
): IdCheck {
  const id = (raw ?? "").trim();
  if (!id) return { ok: false, error: "A stable ID is required." };
  if (/\s/.test(id)) return { ok: false, error: "Stable IDs cannot contain spaces." };
  if (kind === "load") return checkLoadId(id);
  // Circuit groups carry a permanent CG-<site>-<sequence> identity that never
  // encodes a breaker. Existing records are never renamed, so a non-compliant
  // ID that already exists is reported as a warning instead of an error.
  if (kind === "circuit_group") {
    const check = checkCircuitGroupId(id);
    if (check.ok) return { ok: true };
    if (opts.mode === "existing") return { ok: true, warning: check.error };
    return { ok: false, error: check.error };
  }
  // Infrastructure IDs get the shared standards validator, which reports the
  // offending token plus a compliant example instead of "invalid ID".
  if (isInfrastructureKind(kind)) {
    const check = checkInfrastructureId(kind, id, { mode: opts.mode });
    return { ok: check.ok, error: check.error, warning: check.warning };
  }
  const pattern = ID_PATTERNS[kind];
  if (!pattern) return { ok: true };
  if (pattern.test(id)) {
    if (kind === "raceway" && id.toUpperCase().startsWith("EMT-")) {
      if (opts.mode === "create") {
        return {
          ok: false,
          error: `${id} uses the legacy EMT-### namespace, which is compatibility-only for pre-existing records. New raceways must use the canonical ID CON-### for every raceway type — record EMT/FLEX/PVC/underground in Raceway type instead.`,
        };
      }
      return {
        ok: true,
        warning: `${id} encodes a raceway material in its stable ID. The canonical raceway ID is CON-### for every raceway type (EMT, FLEX, PVC, underground) — record the construction in Raceway type instead. Existing IDs are never renamed.`,
      };
    }
    return { ok: true };
  }
  const legacy = LEGACY_ID_PATTERNS[kind];
  if (legacy?.test(id)) {
    return {
      ok: true,
      warning: `${id} predates the hierarchical convention (${HIERARCHICAL_ID_SHAPES[kind]}). Existing IDs are never renamed, but new records must use the current format.`,
    };
  }
  const shape = HIERARCHICAL_ID_SHAPES[kind];
  return {
    ok: false,
    error: shape
      ? `${id} does not match the required format ${shape} for this record type.`
      : `${id} does not match the required format for this record type.`,
  };
}

export function nextStableId(kind: ElectricalEntityKind, existing: string[]): string {
  const ids = (existing ?? []).map((id) => (id ?? "").trim().toUpperCase());
  if (kind === "raceway") {
    let max = 0;
    for (const id of ids) {
      const m = /^(?:EMT|CON)-(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `CON-${String(max + 1).padStart(3, "0")}`;
  }
  if (kind === "feeder") {
    let max = 0;
    for (const id of ids) {
      const m = /^(?:FDR|FD|F)-(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `FDR-${String(max + 1).padStart(3, "0")}`;
  }
  if (kind === "jbox") {
    // Without an explicit parent path, continue the highest path already in use.
    let path = "001";
    for (const id of ids) {
      const p = parseHierarchicalId(id);
      if (p?.prefix === "JB" && p.path > path) path = p.path;
      const m = /^JB-(\d{3,})/.exec(id);
      if (m && m[1].slice(-3) > path) path = m[1].slice(-3);
    }
    return nextJboxId(path, ids);
  }
  if (kind === "branch") {
    let parent = "";
    for (const id of ids) {
      const p = parseHierarchicalId(id);
      if (p?.prefix === "BR" && p.jbox) {
        const candidate = `JB-${p.path}-${p.jbox}`;
        if (candidate > parent) parent = candidate;
      }
    }
    return nextBranchId(parent || "JB-001-01", ids);
  }
  return "";
}



// ------------------------------------------------------- panel exit ordering

export const PANEL_EXIT_SIDES = [
  "Lower Right",
  "Right",
  "Upper Right",
  "Top",
  "Upper Left",
  "Left",
  "Lower Left",
  "Bottom",
] as const;

/**
 * Facing the panel: exits are numbered from the lower-right corner and proceed
 * counterclockwise (up the right side, across the top, down the left side, then
 * across the bottom). Returned order is the canonical sort for exit positions.
 */
export function panelExitSideOrder(side: string | null | undefined): number {
  const idx = PANEL_EXIT_SIDES.indexOf((side ?? "") as (typeof PANEL_EXIT_SIDES)[number]);
  return idx === -1 ? PANEL_EXIT_SIDES.length : idx;
}

export function sortByPanelExit<T extends { exit_order?: number | null; exit_side?: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.exit_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.exit_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return panelExitSideOrder(a.exit_side) - panelExitSideOrder(b.exit_side);
  });
}

// --------------------------------------------------------- breaker positions

export interface BreakerPosition {
  side: "Left" | "Right";
  index: number;
  /** Electrical breaker number: odd numbers left, even numbers right. */
  breaker: number;
  label: string;
}

/**
 * Positions derive from the panel's own space count — never assume 48.
 * A 48-space panel yields Left 1-24 and Right 1-24.
 */
export function panelPositions(spaces: number | null | undefined): BreakerPosition[] {
  const total = Math.max(0, Math.floor(Number(spaces ?? 0)));
  if (!total) return [];
  const perSide = Math.ceil(total / 2);
  const out: BreakerPosition[] = [];
  for (let i = 1; i <= perSide; i++) {
    out.push({ side: "Left", index: i, breaker: 2 * i - 1, label: `Left ${i}` });
    if (out.length < total) {
      out.push({ side: "Right", index: i, breaker: 2 * i, label: `Right ${i}` });
    }
  }
  return out.slice(0, total);
}

export function breakerToPosition(
  breaker: number,
  spaces: number | null | undefined,
): BreakerPosition | null {
  return panelPositions(spaces).find((p) => p.breaker === breaker) ?? null;
}

/** Two circuits cannot occupy the same breaker number in the same panel. */
export function findBreakerConflicts(
  rows: { circuit_group_id: string; panel_uuid: string | null; breaker_number: number | null }[],
): { panel_uuid: string; breaker_number: number; ids: string[] }[] {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.panel_uuid || r.breaker_number == null) continue;
    const key = `${r.panel_uuid}#${r.breaker_number}`;
    seen.set(key, [...(seen.get(key) ?? []), r.circuit_group_id]);
  }
  const out: { panel_uuid: string; breaker_number: number; ids: string[] }[] = [];
  for (const [key, ids] of seen) {
    if (ids.length > 1) {
      const [panel_uuid, breaker] = key.split("#");
      out.push({ panel_uuid, breaker_number: Number(breaker), ids });
    }
  }
  return out;
}

// ------------------------------------------------------- Farm Shop field walk

export interface GridCell {
  raw: string;
  /** Letters run north -> south, so 'A' is the north row. */
  row: number;
  /** Numbers run west -> east, so the highest number is the east column. */
  col: number;
}

export function parseGrid(raw: string | null | undefined): GridCell | null {
  const token = (raw ?? "").trim().toUpperCase();
  const m = /^([A-Z]+)\s*-?\s*(\d+)$/.exec(token);
  if (!m) return null;
  let row = 0;
  for (const ch of m[1]) row = row * 26 + (ch.charCodeAt(0) - 64);
  return { raw: token, row, col: Number(m[2]) };
}

/**
 * Farm Shop installation walk order: A6 is the NE corner, the perimeter walk
 * starts there and travels clockwise, then continues outside-in as a
 * rectangular spiral with each inner ring starting on its NE side.
 *
 * This is a display/print/installation ordering only — it never affects IDs.
 */
export function farmShopWalkOrder(grids: (string | null | undefined)[]): string[] {
  const cells: GridCell[] = [];
  for (const g of grids) {
    const c = parseGrid(g);
    if (c && !cells.some((x) => x.raw === c.raw)) cells.push(c);
  }
  if (!cells.length) return [];

  const remaining = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  const order: string[] = [];

  while (remaining.size) {
    const live = [...remaining.values()];
    const minRow = Math.min(...live.map((c) => c.row));
    const maxRow = Math.max(...live.map((c) => c.row));
    const minCol = Math.min(...live.map((c) => c.col));
    const maxCol = Math.max(...live.map((c) => c.col));

    const ring: GridCell[] = [];
    const take = (row: number, col: number) => {
      const hit = remaining.get(`${row}:${col}`);
      if (hit && !ring.includes(hit)) ring.push(hit);
    };

    // Clockwise from the NE corner: south down the east edge, west along the
    // south edge, north up the west edge, east along the north edge.
    for (let r = minRow; r <= maxRow; r++) take(r, maxCol);
    for (let c = maxCol - 1; c >= minCol; c--) take(maxRow, c);
    for (let r = maxRow - 1; r >= minRow; r--) take(r, minCol);
    for (let c = minCol + 1; c <= maxCol - 1; c++) take(minRow, c);

    if (!ring.length) {
      // Nothing on the bounding ring (sparse interior) — fall back to the
      // remaining cells so the loop always terminates.
      for (const c of live) ring.push(c);
    }
    for (const c of ring) {
      order.push(c.raw);
      remaining.delete(`${c.row}:${c.col}`);
    }
  }

  return order;
}

// ------------------------------------------------------------- completion math

/**
 * Parse a Complete % cell from the canonical workbook or a form field.
 *
 * Spreadsheet cells reach us as display text or as the raw stored value, so all
 * of these must land on the same integer percent:
 *   ""  " "  "n/a"  "TBD"   -> null (unknown, never 0)
 *   "65"  "65 %"  " 65% "   -> 65
 *   "0.65"  ".65"           -> 65   (ODS percentage cells store the fraction)
 *   "1"  "1.0"              -> 100  (a stored fraction of 1 is 100%)
 *   "100%"  "100"           -> 100
 *   "1,00" style separators  -> commas stripped before parsing
 *   "65.4%"                 -> 65   (rounded to a whole percent)
 *   "-10"  "250"            -> clamped to 0 / 100
 * A percent sign is authoritative: "0.5%" is half a percent, not 50.
 */
export function parsePercent(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const hasSign = s.includes("%");
  const cleaned = s.replace(/[%\s,]/g, "");
  if (!cleaned || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  // Without an explicit sign, a value in (0, 1] is a stored fraction.
  const pct = !hasSign && n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function completionFromStatus(status: string): number {
  const scale: Record<string, number> = {
    planned: 0,
    material_ready: 10,
    rough_in_started: 25,
    raceway_installed: 45,
    conductors_installed: 60,
    device_side_connected: 75,
    source_side_connected: 85,
    tested: 95,
    complete: 100,
    as_built_verified: 100,
  };
  return scale[status] ?? 0;
}

/**
 * Legacy imports put engineering design text ("Design Basis", "Planning
 * Assumption", a whole sentence) into install_status, which the database
 * rejects on any later write. Normalising never discards that text: the caller
 * moves it into notes with `mergeLegacyStatusNote`.
 */
export function normalizeInstallStatus(raw: unknown): {
  status: InstallStatus;
  legacy: string | null;
} {
  const s = String(raw ?? "").trim();
  if (!s) return { status: "planned", legacy: null };
  const key = s.toLowerCase().replace(/[\s/-]+/g, "_");
  if ((INSTALL_STATUSES as readonly string[]).includes(key))
    return { status: key as InstallStatus, legacy: null };
  return { status: "planned", legacy: s };
}

/** Preserve legacy status text as a notes line, exactly once. */
export function mergeLegacyStatusNote(notes: unknown, legacy: string | null): string | null {
  const current = String(notes ?? "").trim();
  if (!legacy) return current || null;
  if (current.includes(legacy)) return current;
  const line = `Design basis (from spreadsheet status): ${legacy}`;
  return current ? `${current}\n${line}` : line;
}


// ------------------------------------------------------- controlled vocabularies
// Mirrors public.electrical_allowed() in the database. The database is the
// integrity boundary; this copy exists so the UI and server functions can
// explain a rejection before the write is attempted.
export const CONTROLLED_VALUES: Record<string, readonly string[]> = {
  install_status: INSTALL_STATUSES,
  label_status: LABEL_STATUSES,
  label_class: LABEL_CLASSES,
  environment: RACEWAY_ENVIRONMENTS,
  source_endpoint_type: ENDPOINT_TYPES,
  dest_endpoint_type: ENDPOINT_TYPES,
  exit_side: PANEL_EXIT_SIDES,
};

export function checkControlledValue(column: string, value: unknown): string | null {
  const allowed = CONTROLLED_VALUES[column];
  if (!allowed) return null;
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (allowed.includes(v)) return null;
  return `${v} is not an allowed ${column.replace(/_/g, " ")} value.`;
}

/**
 * Next free physical exit order for a panel. Exit order is a physical attribute
 * of where a raceway leaves the enclosure — it is deliberately separate from the
 * Conduit ID and changing it never renames CON-###.
 */
export function nextPanelExitOrder(existing: (number | null | undefined)[]): number {
  let max = 0;
  for (const n of existing) if (typeof n === "number" && Number.isFinite(n)) max = Math.max(max, n);
  return max + 1;
}
