// Pure helpers for the Electrical Infrastructure module.
//
// The conventions encoded here are the ones the requirements document says must
// not drift:
//  - stable IDs never encode mutable physical attributes;
//  - a panel's raceway exit order starts lower-right and runs counterclockwise;
//  - the Farm Shop field walk starts at A6 (NE) and runs clockwise, outside-in;
//  - interior and site raceways are one dataset filtered by environment.

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
  | "raceway"
  | "jbox"
  | "branch";

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
  // Raceways: EMT-### is the current convention. CON-### is the pre-existing
  // ODS-derived convention and stays valid — stable IDs are never renamed.
  raceway: /^(EMT|CON)-\d{3,}$/,
  // Hierarchical convention: a junction box encodes its raceway path, and a
  // branch encodes its raceway path plus the junction box it originates from.
  jbox: /^JB-\d{3}-\d{2}$/,
  branch: /^BR-\d{3}-\d{2}-\d{2}$/,
};

/** Legacy shapes kept valid (with a warning) so imported records never break. */
const LEGACY_ID_PATTERNS: Partial<Record<ElectricalEntityKind, RegExp>> = {
  jbox: /^JB-\d{3,}(-\d+)*$/,
  branch: /^BR-\d{3,}(-\d+)*$/,
};

export const HIERARCHICAL_ID_SHAPES: Record<string, string> = {
  raceway: "EMT-###",
  jbox: "JB-###-##",
  branch: "BR-###-##-##",
};

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

export function checkStableId(kind: ElectricalEntityKind, raw: string): IdCheck {
  const id = (raw ?? "").trim();
  if (!id) return { ok: false, error: "A stable ID is required." };
  if (/\s/.test(id)) return { ok: false, error: "Stable IDs cannot contain spaces." };
  if (kind === "load") return checkLoadId(id);
  const pattern = ID_PATTERNS[kind];
  if (!pattern) return { ok: true };
  if (pattern.test(id)) return { ok: true };
  return { ok: false, error: `${id} does not match the required format for this record type.` };
}

export function nextStableId(kind: ElectricalEntityKind, existing: string[]): string {
  const prefix =
    kind === "raceway" ? "CON" : kind === "jbox" ? "JB" : kind === "branch" ? "BR" : "";
  if (!prefix) return "";
  let max = 0;
  for (const id of existing) {
    // Nested IDs (JB-104-01) count against their parent number only.
    const m = new RegExp(`^${prefix}-(\\d+)(?:-\\d+)*$`).exec((id ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;

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
