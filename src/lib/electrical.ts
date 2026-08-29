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

// ---------------------------------------------------------------- stable IDs

export type ElectricalEntityKind =
  | "load"
  | "circuit_group"
  | "panel"
  | "raceway"
  | "jbox"
  | "branch";

const ID_PATTERNS: Record<ElectricalEntityKind, RegExp | null> = {
  // Farm Shop / Pump House / Boiler use the ### convention; House loads keep
  // their existing convention, so any non-empty token is accepted for those.
  load: /^(FS|PH|BL)-\d{3}$/,
  circuit_group: null,
  panel: /^PNL-[A-Z0-9]+(-[A-Z0-9]+)*$/,
  raceway: /^CON-\d{3,}$/,
  jbox: /^JB-\d{3,}$/,
  branch: /^BR-\d{3,}$/,
};

export interface IdCheck {
  ok: boolean;
  /** Non-blocking note for IDs that are legal but outside the main convention. */
  warning?: string;
  error?: string;
}

export function checkStableId(kind: ElectricalEntityKind, raw: string): IdCheck {
  const id = (raw ?? "").trim();
  if (!id) return { ok: false, error: "A stable ID is required." };
  if (/\s/.test(id)) return { ok: false, error: "Stable IDs cannot contain spaces." };
  const pattern = ID_PATTERNS[kind];
  if (!pattern) return { ok: true };
  if (pattern.test(id)) return { ok: true };
  if (kind === "load") {
    // House loads preserve their existing convention rather than being renamed.
    return {
      ok: true,
      warning: `${id} is outside the FS-/PH-/BL-### convention — acceptable only for pre-existing House IDs.`,
    };
  }
  return { ok: false, error: `${id} does not match the required format for this record type.` };
}

export function nextStableId(kind: ElectricalEntityKind, existing: string[]): string {
  const prefix =
    kind === "raceway" ? "CON" : kind === "jbox" ? "JB" : kind === "branch" ? "BR" : "";
  if (!prefix) return "";
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec((id ?? "").trim());
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
