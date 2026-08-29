// Built-in naming / design standards for an initialized electrical install.
//
// The `electrical_naming_standards` table is the display source, but the
// Standards page must never render blank on a freshly initialized environment,
// so these canonical entries are used as a fallback and to fill gaps by key.
// They document convention only — they never change stable IDs or records.

export interface StandardEntry {
  key: string;
  title: string;
  body: string;
  sort_order: number;
}

export const BUILT_IN_STANDARDS: readonly StandardEntry[] = [
  {
    key: "id_formats",
    title: "Entity ID formats",
    body:
      "Farm Shop load FS-### (FS-097). Pump House load PH-### (PH-028, legacy suffixes PH-019a/PH-019b). " +
      "Boiler load BL-### (BL-004). House load HSE-## . Panel PNL-<building>-<role> (PNL-FS-CRIT). " +
      "Raceway CON-### (CON-030). Junction box JB-### (JB-014). Branch run BR-### (BR-057). " +
      "Stable IDs are permanent: they are never renamed or renumbered, and they carry no physical attributes.",
    sort_order: 10,
  },
  {
    key: "raceway_continuity",
    title: "Continuous raceway rule",
    body:
      "A CON-### is one continuous physical raceway between actual accessible endpoints (panel, junction box, " +
      "handhole, or equipment). Changing size, status, or measured length never splits or renames a raceway.",
    sort_order: 20,
  },
  {
    key: "waypoints",
    title: "Waypoint vs endpoint",
    body:
      "Bends, sweeps, trench direction changes, and geographic route changes with no physically installed, " +
      "accessible box are route waypoints on the raceway. Only real planned or installed accessible junction " +
      "boxes receive a JB-### record.",
    sort_order: 30,
  },
  {
    key: "environments",
    title: "Interior and site raceways",
    body:
      "Interior and exterior raceways share one canonical raceway dataset. The environment field " +
      "(INTERIOR, SITE_UNDERGROUND, SITE_EXPOSED) separates them — never duplicate records per environment.",
    sort_order: 40,
  },
  {
    key: "panel_exit",
    title: "Panel raceway physical exit convention",
    body:
      "Standing in front of and facing a panel, physical raceway exit assignment starts at the lower-right " +
      "corner and proceeds counterclockwise. Exit order and exit side are physical position only: changing an " +
      "exit position never renames a Conduit ID.",
    sort_order: 50,
  },
  {
    key: "farm_shop_walk",
    title: "Farm Shop installation walk",
    body:
      "A6 is the northeast (NE) corner. The perimeter walk begins at A6 and travels clockwise, outside-in; " +
      "inner rectangles follow the same convention. The walk order is an installation sequence only and never " +
      "changes stable Load IDs.",
    sort_order: 60,
  },
  {
    key: "circuit_groups",
    title: "Circuit group derivation",
    body:
      "Circuit groups are engineering values owned by the canonical workbook and are derived from the " +
      "Load_Master circuit group ID and description columns — there is no separate Circuit Groups worksheet. " +
      "A group is created once and shared by every load that references it; loads with no resolvable group " +
      "are reported, never guessed.",
    sort_order: 65,
  },
  {
    key: "breaker_positions",
    title: "Breaker position convention",
    body:
      "Circuit assignment records both the electrical breaker/circuit number and the field-visible physical " +
      "position (Left/Right plus index). Two circuit groups may not share one breaker number in the same panel.",
    sort_order: 70,
  },
  {
    key: "labels",
    title: "Label conventions",
    body:
      "Five label classes: load/device/circuit, panel/breaker, raceway/conduit, junction box, and branch run. " +
      "Label state tracks queued, printed, and installed, with an explicit reprint flag when the record changes " +
      "after printing.",
    sort_order: 80,
  },
  {
    key: "authority",
    title: "Authority boundary",
    body:
      "The canonical ODS remains the engineering release authority for voltage, amperage, demand, circuit " +
      "grouping, and engineering assignment. FarmOps owns raceways, junction boxes, branch runs, measured / " +
      "as-built lengths, install status, labels, physical exits, and field notes.",
    sort_order: 90,
  },
];

/**
 * Stable-ID reference table. This ships with the application rather than
 * depending on a data seed, so a fresh or existing installation always renders
 * the reference rows with no manual entry and no duplication risk.
 */
export interface StableIdReferenceRow {
  entity: string;
  format: string;
  example: string;
  notes: string;
}

export const STABLE_ID_REFERENCE: readonly StableIdReferenceRow[] = [
  {
    entity: "Farm Shop Load",
    format: "FS-###",
    example: "FS-097",
    notes: "Stable load ID",
  },
  {
    entity: "Pump House Load",
    format: "PH-###",
    example: "PH-028",
    notes: "Stable load ID (legacy split suffixes PH-019a / PH-019b are permitted)",
  },
  {
    entity: "Boiler Load",
    format: "BL-###",
    example: "BL-003",
    notes: "Stable load ID",
  },
  {
    entity: "House Load",
    format: "HSE-##",
    example: "HSE-12",
    notes: "Stable load ID — House convention is explicit, never a catch-all",
  },
  {
    entity: "Panel",
    format: "PNL-*",
    example: "PNL-FS-NE",
    notes: "Stable panel ID",
  },
  {
    entity: "Raceway",
    format: "CON-###",
    example: "CON-030",
    notes: "Continuous physical raceway",
  },
  {
    entity: "Junction Box",
    format: "JB-###",
    example: "JB-014",
    notes: "Actual accessible physical box only",
  },
  {
    entity: "Branch Run",
    format: "BR-###",
    example: "BR-057",
    notes: "Downstream wiring path",
  },
];

/** Merge database rows with the built-in set, preferring stored rows by key. */
export function mergeStandards(rows: Record<string, unknown>[]): StandardEntry[] {
  const merged = new Map<string, StandardEntry>();
  for (const entry of BUILT_IN_STANDARDS) merged.set(entry.key, entry);
  for (const row of rows) {
    const key = String(row["key"] ?? "").trim();
    const title = String(row["title"] ?? "").trim();
    const body = String(row["body"] ?? "").trim();
    if (!key || !title || !body) continue;
    merged.set(key, {
      key,
      title,
      body,
      sort_order: Number(row["sort_order"] ?? merged.get(key)?.sort_order ?? 999) || 999,
    });
  }
  return [...merged.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key),
  );
}
