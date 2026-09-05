// FARMOPS-ELEC-LOGICAL-PANEL-V1 — one shared model for logical vs physical panels.
//
// A *physical* panel is panelboard equipment: an enclosure, a bus, breaker
// spaces, a feeder. A *logical* panel is a grouping policy — critical-load and
// load-shedding membership — that is HOSTED on a physical panel. It has no bus,
// no enclosure, no feeder, no breaker spaces and no independent capacity.
//
// The two relationships mean different things and must both be able to exist on
// the same record at the same time:
//
//   Physical supply:    PNL-FS-NE → breaker position → circuit group → load
//   Logical assignment: load / circuit → PNL-FS-CRIT → critical + load-shed policy
//
// Stable IDs are permanent. Moving a circuit into or out of a logical panel
// changes only `logical_panel_uuid` / `logical_panel_ref`; it never touches the
// breaker position, the circuit-group ID, the physical panel or any stable ID.
export const LOGICAL_PANEL_MODEL_VERSION = "electrical-logical-panel-1";

export type PanelKind = "physical" | "logical";
export const PANEL_KINDS: readonly PanelKind[] = ["physical", "logical"] as const;

/** The columns a logical assignment is allowed to write. Nothing else. */
export const LOGICAL_ASSIGNMENT_COLUMNS = [
  "logical_panel_uuid",
  "logical_panel_ref",
] as const;

/** Columns that describe physical panelboard capacity — never on a logical panel. */
export const PHYSICAL_CAPACITY_COLUMNS = [
  "spaces",
  "circuits",
  "breaker_columns",
  "positions_per_column",
  "bus_rating_amps",
  "feeder_source",
] as const;

/** Canonical export / API / AI field names. */
export const PHYSICAL_PANEL_FIELD = "physical_panel_reference";
export const LOGICAL_PANEL_FIELD = "logical_panel_reference";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

export interface PanelKindRow {
  id: string;
  panel_id: string;
  panel_kind?: unknown;
  physical_panel_uuid?: unknown;
  logical_panel_note?: unknown;
  spaces?: unknown;
  circuits?: unknown;
  breaker_columns?: unknown;
  positions_per_column?: unknown;
  bus_rating_amps?: unknown;
  feeder_source?: unknown;
}

export function panelKind(row: Row | PanelKindRow): PanelKind {
  return str((row as Row).panel_kind) === "logical" ? "logical" : "physical";
}

export const isLogicalPanel = (row: Row | PanelKindRow): boolean => panelKind(row) === "logical";
export const isPhysicalPanel = (row: Row | PanelKindRow): boolean => panelKind(row) === "physical";

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "PNL-FS-CRIT (logical) → hosted on PNL-FS-NE (physical)" */
export function logicalPanelDisplay(logicalId: string, hostPhysicalId: string | null): string {
  const host = str(hostPhysicalId);
  return `${str(logicalId)} (logical) → hosted on ${host || "NOT IN RECORD"} (physical)`;
}

/** Display for any panel row, resolving its host through the panel list. */
export function panelKindDisplay(row: Row, panels: Row[]): string {
  const id = str(row.panel_id) || str(row.stable_id);
  if (!isLogicalPanel(row)) return `${id} (physical)`;
  const host = panels.find((p) => str(p.id) === str(row.physical_panel_uuid));
  return logicalPanelDisplay(id, host ? str(host.panel_id) || str(host.stable_id) : null);
}

/** Reference pair used by exports, API payloads, audit diffs and AI answers. */
export function panelReferenceFields(
  physicalPanelId: string | null,
  logicalPanelId: string | null,
): Record<string, string | null> {
  return {
    [PHYSICAL_PANEL_FIELD]: str(physicalPanelId) || null,
    [LOGICAL_PANEL_FIELD]: str(logicalPanelId) || null,
  };
}

// ---------------------------------------------------------------------------
// Assignment — relationship only, never identity or the physical path
// ---------------------------------------------------------------------------

export interface LogicalAssignment {
  logical_panel_uuid: string | null;
  logical_panel_ref: string | null;
}

/**
 * The exact patch for moving a load/circuit into (or, with `null`, out of) a
 * logical panel. Only the two logical columns appear, so a caller physically
 * cannot disturb the breaker, circuit group, panel or stable ID.
 */
export function logicalAssignmentPatch(
  logicalPanel: { id: string; panel_id: string } | null,
): LogicalAssignment {
  if (!logicalPanel) return { logical_panel_uuid: null, logical_panel_ref: null };
  return {
    logical_panel_uuid: str(logicalPanel.id),
    logical_panel_ref: str(logicalPanel.panel_id),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type LogicalPanelViolationCode =
  | "LOGICAL_PANEL_HAS_BREAKER_POSITIONS"
  | "LOGICAL_PANEL_USED_AS_PHYSICAL_SOURCE"
  | "LOGICAL_PANEL_HAS_PHYSICAL_CAPACITY"
  | "LOGICAL_PANEL_MISSING_HOST"
  | "LOGICAL_PANEL_HOST_NOT_PHYSICAL"
  | "LOGICAL_PANEL_CIRCULAR_HOST"
  | "PHYSICAL_PANEL_HOSTED_ON_PANEL"
  | "LOGICAL_ASSIGNMENT_NOT_LOGICAL_PANEL"
  | "DUPLICATED_ACROSS_PANELS";

export interface LogicalPanelViolation {
  code: LogicalPanelViolationCode;
  panel: string;
  message: string;
}

export interface LogicalPanelValidationInput {
  panels: Row[];
  positions?: Row[];
  circuitGroups?: Row[];
  raceways?: Row[];
  feeders?: Row[];
  branchRuns?: Row[];
  loads?: Row[];
}

/** Whole-model check. Pure: reports problems, never repairs records. */
export function validateLogicalPanelModel(
  input: LogicalPanelValidationInput,
): LogicalPanelViolation[] {
  const out: LogicalPanelViolation[] = [];
  const byUuid = new Map<string, Row>();
  for (const p of input.panels) byUuid.set(str(p.id), p);
  const name = (row: Row | undefined, uuid: string): string =>
    row ? str(row.panel_id) || str(row.stable_id) || uuid : uuid;

  for (const p of input.panels) {
    const uuid = str(p.id);
    const id = name(p, uuid);
    const host = str(p.physical_panel_uuid);

    if (!isLogicalPanel(p)) {
      if (host) {
        out.push({
          code: "PHYSICAL_PANEL_HOSTED_ON_PANEL",
          panel: id,
          message: `${id} is physical panelboard equipment, so it cannot be hosted on another panel.`,
        });
      }
      continue;
    }

    if (!host) {
      out.push({
        code: "LOGICAL_PANEL_MISSING_HOST",
        panel: id,
        message: `${id} is a logical panel but records no hosting physical panel.`,
      });
    } else if (host === uuid) {
      out.push({
        code: "LOGICAL_PANEL_CIRCULAR_HOST",
        panel: id,
        message: `${id} cannot be hosted on itself.`,
      });
    } else {
      const hostRow = byUuid.get(host);
      if (!hostRow || isLogicalPanel(hostRow)) {
        out.push({
          code: "LOGICAL_PANEL_HOST_NOT_PHYSICAL",
          panel: id,
          message: `${id} must be hosted on a physical panel, not ${
            hostRow ? `${name(hostRow, host)} (logical)` : "a panel that is not on record"
          }.`,
        });
      } else if (str(hostRow.physical_panel_uuid) === uuid) {
        out.push({
          code: "LOGICAL_PANEL_CIRCULAR_HOST",
          panel: id,
          message: `${id} and ${name(hostRow, host)} host each other.`,
        });
      }
    }

    const capacity = PHYSICAL_CAPACITY_COLUMNS.filter((c) => {
      const v = (p as Row)[c];
      return v !== null && v !== undefined && String(v).trim() !== "";
    });
    if (capacity.length > 0) {
      out.push({
        code: "LOGICAL_PANEL_HAS_PHYSICAL_CAPACITY",
        panel: id,
        message: `${id} is logical and has no enclosure, bus, feeder or breaker capacity of its own; recorded on ${capacity.join(
          ", ",
        )}.`,
      });
    }

    if ((input.positions ?? []).some((r) => str(r.panel_uuid) === uuid)) {
      out.push({
        code: "LOGICAL_PANEL_HAS_BREAKER_POSITIONS",
        panel: id,
        message: `${id} is logical and cannot hold breaker positions; they belong to its hosting physical panel.`,
      });
    }

    const sourceHits: string[] = [];
    if ((input.circuitGroups ?? []).some((r) => str(r.panel_uuid) === uuid)) {
      sourceHits.push("circuit group");
    }
    if (
      (input.raceways ?? []).some(
        (r) => str(r.source_panel_uuid) === uuid || str(r.dest_panel_uuid) === uuid,
      )
    ) {
      sourceHits.push("raceway");
    }
    if (
      (input.feeders ?? []).some(
        (r) => str(r.source_panel_uuid) === uuid || str(r.dest_panel_uuid) === uuid,
      )
    ) {
      sourceHits.push("feeder");
    }
    if ((input.branchRuns ?? []).some((r) => str(r.source_panel_uuid) === uuid)) {
      sourceHits.push("branch run");
    }
    if (sourceHits.length > 0) {
      out.push({
        code: "LOGICAL_PANEL_USED_AS_PHYSICAL_SOURCE",
        panel: id,
        message: `${id} is logical and cannot be the authoritative physical source of: ${sourceHits.join(
          ", ",
        )}.`,
      });
    }
  }

  for (const table of [input.loads ?? [], input.circuitGroups ?? []]) {
    for (const row of table) {
      const target = str(row.logical_panel_uuid);
      if (!target) continue;
      const panel = byUuid.get(target);
      if (!panel || !isLogicalPanel(panel)) {
        out.push({
          code: "LOGICAL_ASSIGNMENT_NOT_LOGICAL_PANEL",
          panel: name(panel, target),
          message: `${
            str(row.load_id) || str(row.circuit_group_id) || str(row.stable_id) || "record"
          } assigns a logical panel that is ${panel ? "physical" : "not on record"}.`,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Derived logical-panel summary — never its own capacity, never double counted
// ---------------------------------------------------------------------------

export interface LogicalPanelMember {
  /** Stable ID of the member circuit group, or the load when no group exists. */
  id: string;
  kind: "circuit_group" | "load";
  /** Physical panel that actually supplies it, or null when unresolved. */
  physicalPanel: string | null;
  /** Physical breaker reference, e.g. PNL-FS-NE-B7, or null when unresolved. */
  breakerReference: string | null;
  /** Circuit-group UUID used to de-duplicate members. */
  circuitUuid: string | null;
  connectedVa: number | null;
  completionPercent: number | null;
  gaps: string[];
}

export interface LogicalPanelSummary {
  id: string;
  kind: "logical";
  hostPhysicalPanel: string | null;
  display: string;
  note: string | null;
  members: LogicalPanelMember[];
  /** Distinct circuits (deduplicated) that make up this grouping. */
  circuitCount: number;
  loadCount: number;
  /** Summed only over distinct members; null when nothing is recorded. */
  derivedConnectedVa: number | null;
  /** Mean of recorded member completion; null when nothing is recorded. */
  derivedCompletionPercent: number | null;
  /** Members whose physical breaker or circuit group is still unresolved. */
  unresolvedMembers: number;
  /** Hard invariant: a logical panel never adds to physical panel totals. */
  countsTowardPhysicalTotals: false;
  capacityBasis: string;
}

export interface LogicalPanelSummaryInput {
  panel: Row;
  panels: Row[];
  loads?: Row[];
  circuitGroups?: Row[];
  positions?: Row[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Roll up a logical panel from its member circuits on the hosting physical
 * panel. Every number here is DERIVED; the logical panel stores none of it.
 */
export function logicalPanelSummary(input: LogicalPanelSummaryInput): LogicalPanelSummary {
  const uuid = str(input.panel.id);
  const id = str(input.panel.panel_id) || str(input.panel.stable_id);
  const hostRow = input.panels.find((p) => str(p.id) === str(input.panel.physical_panel_uuid));
  const host = hostRow ? str(hostRow.panel_id) || str(hostRow.stable_id) : null;

  const panelById = new Map<string, Row>();
  for (const p of input.panels) panelById.set(str(p.id), p);
  const positionByCircuit = new Map<string, Row>();
  for (const pos of input.positions ?? []) {
    const cu = str(pos.circuit_group_uuid);
    if (cu && !positionByCircuit.has(cu)) positionByCircuit.set(cu, pos);
  }
  const groupByUuid = new Map<string, Row>();
  for (const g of input.circuitGroups ?? []) groupByUuid.set(str(g.id), g);

  const physicalFor = (group: Row | undefined): { panel: string | null; breaker: string | null } => {
    if (!group) return { panel: null, breaker: null };
    const panelRow = panelById.get(str(group.panel_uuid));
    const panelId = panelRow ? str(panelRow.panel_id) || str(panelRow.stable_id) : null;
    const pos = positionByCircuit.get(str(group.id));
    const number = pos ? str(pos.position) : "";
    return {
      panel: panelId,
      breaker: panelId && number ? `${panelId}-B${number}` : null,
    };
  };

  const members: LogicalPanelMember[] = [];
  const seenCircuits = new Set<string>();

  for (const g of input.circuitGroups ?? []) {
    if (str(g.logical_panel_uuid) !== uuid) continue;
    const gu = str(g.id);
    if (gu && seenCircuits.has(gu)) continue;
    if (gu) seenCircuits.add(gu);
    const phys = physicalFor(g);
    const gaps: string[] = [];
    if (!phys.panel) gaps.push("physical panel unresolved");
    if (!phys.breaker) gaps.push("physical breaker position unresolved");
    members.push({
      id: str(g.circuit_group_id) || str(g.stable_id) || gu,
      kind: "circuit_group",
      physicalPanel: phys.panel,
      breakerReference: phys.breaker,
      circuitUuid: gu || null,
      connectedVa: num(g.connected_va),
      completionPercent: num(g.completion_percent),
      gaps,
    });
  }

  for (const l of input.loads ?? []) {
    if (str(l.logical_panel_uuid) !== uuid) continue;
    const cu = str(l.circuit_group_uuid);
    // A load whose circuit is already a member is the SAME circuit: never a
    // second entry, so its demand and count are not added twice.
    if (cu && seenCircuits.has(cu)) continue;
    if (cu) seenCircuits.add(cu);
    const phys = physicalFor(cu ? groupByUuid.get(cu) : undefined);
    const gaps: string[] = [];
    if (!cu) gaps.push("circuit group unresolved");
    if (!phys.panel) gaps.push("physical panel unresolved");
    if (!phys.breaker) gaps.push("physical breaker position unresolved");
    members.push({
      id: str(l.load_id) || str(l.stable_id),
      kind: "load",
      physicalPanel: phys.panel,
      breakerReference: phys.breaker,
      circuitUuid: cu || null,
      connectedVa: num(l.connected_va),
      completionPercent: num(l.completion_percent),
      gaps,
    });
  }

  const va = members.map((m) => m.connectedVa).filter((v): v is number => v !== null);
  const pct = members.map((m) => m.completionPercent).filter((v): v is number => v !== null);

  return {
    id,
    kind: "logical",
    hostPhysicalPanel: host,
    display: logicalPanelDisplay(id, host),
    note: str(input.panel.logical_panel_note) || null,
    members,
    circuitCount: members.filter((m) => m.kind === "circuit_group").length,
    loadCount: members.filter((m) => m.kind === "load").length,
    derivedConnectedVa: va.length > 0 ? va.reduce((a, b) => a + b, 0) : null,
    derivedCompletionPercent:
      pct.length > 0 ? Math.round(pct.reduce((a, b) => a + b, 0) / pct.length) : null,
    unresolvedMembers: members.filter((m) => m.gaps.length > 0).length,
    countsTowardPhysicalTotals: false,
    capacityBasis: host
      ? `Derived from member circuits on ${host}; the logical panel has no bus, spaces or feeder of its own.`
      : "Hosting physical panel NOT IN RECORD; no capacity can be derived.",
  };
}

/** Every logical panel in the model, with its derived rollup. */
export function logicalPanelSummaries(
  input: Omit<LogicalPanelSummaryInput, "panel">,
): LogicalPanelSummary[] {
  return input.panels
    .filter(isLogicalPanel)
    .map((panel) => logicalPanelSummary({ ...input, panel }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Diagram: dashed grouping beside the hosting physical panel — never a bus
// ---------------------------------------------------------------------------

const nodeKey = (prefix: string, value: string): string =>
  `${prefix}_${(value || "unknown").replace(/[^A-Za-z0-9]/g, "_")}`;
const clean = (value: string): string => value.replace(/["<>|]/g, " ").trim();

/**
 * Mermaid fragment: a dashed subgraph grouping the logical panel's member
 * circuits, each labelled with its REAL physical breaker reference and linked
 * back to the hosting physical panel node.
 */
export function logicalPanelMermaidLines(
  summary: LogicalPanelSummary,
  hostNodeId: string,
): string[] {
  const group = nodeKey("LGP", summary.id);
  const lines: string[] = [
    `  subgraph ${group}["${clean(summary.display)}"]`,
    "    direction TB",
  ];
  if (summary.members.length === 0) {
    const empty = nodeKey("LGPX", summary.id);
    lines.push(`    ${empty}["no member circuits recorded"]`);
  }
  summary.members.forEach((m, i) => {
    const node = nodeKey(`LGM${i}`, m.id);
    const text = [
      m.id,
      m.breakerReference ? `breaker ${m.breakerReference}` : "physical breaker NOT IN RECORD",
      m.physicalPanel ? `on ${m.physicalPanel}` : "physical panel NOT IN RECORD",
    ]
      .map(clean)
      .join("\\n");
    lines.push(`    ${node}("${text}")`);
  });
  lines.push("  end");
  lines.push(`  ${group} -.-> ${hostNodeId}`);
  lines.push(`  style ${group} stroke-dasharray: 6 4`);
  return lines;
}

/** Standing caption so no reader mistakes a logical panel for equipment. */
export const LOGICAL_PANEL_CAPTION =
  "Dashed grouping = logical panel (critical-load / load-shedding policy). It is not a panelboard: every circuit shown is supplied by, and listed under, its real physical breaker.";
