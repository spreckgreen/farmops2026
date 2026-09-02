// Wiring schedule: per-panel breaker positions with their circuit labels and
// connected loads, exactly as the records prove them.
//
// Pure functions over panel/position/circuit/load rows. Nothing is inferred: a
// slot shows a circuit or a load only when a uuid link proves it, and every
// unproven relationship is emitted as a named gap.

export type WiringRow = Record<string, unknown>;

export const NOT_IN_RECORD = "NOT IN RECORD";

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number | null {
  const n = Number(str(v).trim());
  return Number.isFinite(n) ? n : null;
}

export interface WiringLoad {
  id: string;
  uuid: string;
  description: string;
  area: string;
  amps: string;
  va: string;
  status: string;
  /** How this load reached the slot: through a circuit group or directly. */
  via: "circuit" | "breaker";
}

export type SlotState = "wired" | "breaker_only" | "empty";

export interface WiringSlot {
  key: string;
  side: string;
  position: number;
  /** Panel-schedule breaker number when recorded, else the slot position. */
  breakerNumber: string;
  poles: number;
  ocpAmps: string;
  /** Circuit stable ID linked to this slot, or NOT IN RECORD. */
  circuitId: string;
  /** Field label / circuit description, or NOT IN RECORD. */
  label: string;
  status: string;
  loads: WiringLoad[];
  state: SlotState;
  gaps: string[];
}

export interface WiringPanel {
  id: string;
  uuid: string;
  description: string;
  building: string;
  spaces: string;
  status: string;
  slots: WiringSlot[];
  /** Circuits on this panel with no breaker position recorded. */
  circuitsWithoutSlot: {
    id: string;
    label: string;
    ratingAmps: string;
    loadCount: number;
  }[];
  /** Loads whose record names this panel/building but carry no slot or circuit. */
  expectedLoads: WiringLoad[];
  counts: { slots: number; wired: number; loads: number; gaps: number };
  gaps: string[];
}

export interface WiringSchedule {
  panels: WiringPanel[];
  /** Loads with no panel path at all. */
  unwiredLoads: WiringLoad[];
  totals: {
    panels: number;
    slots: number;
    wiredSlots: number;
    circuits: number;
    loads: number;
    wiredLoads: number;
    unwiredLoads: number;
    gaps: number;
  };
}

export interface WiringInput {
  panels: WiringRow[];
  circuitGroups: WiringRow[];
  loads: WiringRow[];
  positions: WiringRow[];
}

/** Accept snapshot (`uuid`/`stable_id`) or raw table (`id`/`<entity>_id`) shapes. */
function normalize(rows: WiringRow[] | undefined, stableKey: string): WiringRow[] {
  return (rows ?? []).map((row) => ({
    ...row,
    id: str(row.id).trim() || str(row.uuid).trim(),
    [stableKey]: str(row[stableKey]).trim() || str(row.stable_id).trim(),
  }));
}

function toLoad(row: WiringRow, via: WiringLoad["via"]): WiringLoad {
  return {
    id: str(row.load_id).trim() || NOT_IN_RECORD,
    uuid: str(row.id),
    description: str(row.description).trim(),
    area: str(row.area).trim() || str(row.location).trim(),
    amps: str(row.amps).trim(),
    va: str(row.connected_va).trim(),
    status: str(row.install_status).trim(),
    via,
  };
}

export function buildWiringSchedule(raw: WiringInput): WiringSchedule {
  const input: WiringInput = {
    panels: normalize(raw.panels, "panel_id"),
    circuitGroups: normalize(raw.circuitGroups, "circuit_group_id"),
    loads: normalize(raw.loads, "load_id"),
    positions: normalize(raw.positions, "position"),
  };

  const panelByUuid = new Map(input.panels.map((p) => [str(p.id), p]));
  const circuitByUuid = new Map(input.circuitGroups.map((c) => [str(c.id), c]));

  const loadsByCircuit = new Map<string, WiringRow[]>();
  const loadByUuid = new Map<string, WiringRow>();
  for (const load of input.loads) {
    loadByUuid.set(str(load.id), load);
    const cu = str(load.circuit_group_uuid);
    if (cu) {
      const list = loadsByCircuit.get(cu) ?? [];
      list.push(load);
      loadsByCircuit.set(cu, list);
    }
  }

  const positionsByPanel = new Map<string, WiringRow[]>();
  for (const pos of input.positions) {
    const pu = str(pos.panel_uuid);
    const list = positionsByPanel.get(pu) ?? [];
    list.push(pos);
    positionsByPanel.set(pu, list);
  }

  const wiredLoadUuids = new Set<string>();

  const toSlot = (pos: WiringRow): WiringSlot => {
    const circuit = circuitByUuid.get(str(pos.circuit_group_uuid)) ?? null;
    const circuitLoads = circuit ? (loadsByCircuit.get(str(circuit.id)) ?? []) : [];
    const directLoad = loadByUuid.get(str(pos.load_uuid)) ?? null;
    const loads: WiringLoad[] = [
      ...circuitLoads.map((l) => toLoad(l, "circuit")),
      ...(directLoad && !circuitLoads.some((l) => str(l.id) === str(directLoad.id))
        ? [toLoad(directLoad, "breaker")]
        : []),
    ];
    for (const l of loads) if (l.uuid) wiredLoadUuids.add(l.uuid);

    const label =
      str(pos.label).trim() || (circuit ? str(circuit.description).trim() : "") || NOT_IN_RECORD;
    const ocp = str(pos.ocp_amps).trim();
    const gaps: string[] = [];
    if (!circuit) gaps.push("no circuit group linked to this breaker (circuit_group_uuid)");
    if (loads.length === 0) gaps.push("no load connected to this breaker");
    if (!ocp) gaps.push("breaker rating not recorded (ocp_amps)");
    if (label === NOT_IN_RECORD) gaps.push("no circuit label recorded");

    const state: SlotState = loads.length > 0 ? "wired" : circuit ? "breaker_only" : "empty";
    return {
      key: str(pos.id) || `${str(pos.side)}-${str(pos.position)}`,
      side: str(pos.side).trim() || NOT_IN_RECORD,
      position: num(pos.position) ?? 0,
      breakerNumber: str(pos.breaker_number).trim() || str(pos.position).trim() || NOT_IN_RECORD,
      poles: num(pos.poles) ?? 1,
      ocpAmps: ocp,
      circuitId: circuit ? str(circuit.circuit_group_id).trim() || NOT_IN_RECORD : NOT_IN_RECORD,
      label,
      status: str(pos.install_status).trim(),
      loads,
      state,
      gaps,
    };
  };

  const panels: WiringPanel[] = input.panels
    .map((panel) => {
      const panelUuid = str(panel.id);
      const slots = (positionsByPanel.get(panelUuid) ?? [])
        .map(toSlot)
        .sort(
          (a, b) => a.side.localeCompare(b.side) || a.position - b.position,
        );
      const slotCircuitUuids = new Set(
        (positionsByPanel.get(panelUuid) ?? [])
          .map((p) => str(p.circuit_group_uuid))
          .filter(Boolean),
      );
      const circuitsWithoutSlot = input.circuitGroups
        .filter((c) => str(c.panel_uuid) === panelUuid && !slotCircuitUuids.has(str(c.id)))
        .map((c) => ({
          id: str(c.circuit_group_id).trim() || NOT_IN_RECORD,
          label: str(c.description).trim() || NOT_IN_RECORD,
          ratingAmps: str(c.circuit_rating_amps).trim(),
          loadCount: (loadsByCircuit.get(str(c.id)) ?? []).length,
        }))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

      const panelStableId = str(panel.panel_id).trim();
      const panelBuilding = str(panel.building).trim() || str(panel.grid).trim();
      const expectedLoads = input.loads
        .filter((l) => {
          if (str(l.circuit_group_uuid)) return false;
          if (wiredLoadUuids.has(str(l.id))) return false;
          const suggested = str(l.suggested_panel).trim().toUpperCase();
          if (suggested && panelStableId) return suggested.includes(panelStableId.toUpperCase());
          if (!suggested && panelBuilding) {
            return `${str(l.building)} ${str(l.grid)} ${str(l.area)}`
              .toUpperCase()
              .includes(panelBuilding.toUpperCase());
          }
          return false;
        })
        .map((l) => toLoad(l, "circuit"))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

      const gaps: string[] = [];
      if (slots.length === 0) {
        gaps.push(
          "no breaker positions recorded for this panel (electrical_breaker_positions) — its schedule is empty",
        );
      }
      if (circuitsWithoutSlot.length > 0) {
        gaps.push(
          `${circuitsWithoutSlot.length} circuit(s) on this panel have no breaker position recorded`,
        );
      }
      if (expectedLoads.length > 0) {
        gaps.push(
          `${expectedLoads.length} load(s) name this panel or its building but are wired to nothing here`,
        );
      }
      if (!str(panel.spaces).trim()) gaps.push("panel space count not recorded (spaces)");

      const wired = slots.filter((s) => s.state === "wired").length;
      const loadCount = slots.reduce((n, s) => n + s.loads.length, 0);
      const gapCount = gaps.length + slots.reduce((n, s) => n + s.gaps.length, 0);

      return {
        id: panelStableId || NOT_IN_RECORD,
        uuid: panelUuid,
        description: str(panel.description).trim(),
        building: panelBuilding,
        spaces: str(panel.spaces).trim(),
        status: str(panel.install_status).trim(),
        slots,
        circuitsWithoutSlot,
        expectedLoads,
        counts: { slots: slots.length, wired, loads: loadCount, gaps: gapCount },
        gaps,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const unwiredLoads = input.loads
    .filter((l) => !wiredLoadUuids.has(str(l.id)))
    .map((l) => toLoad(l, "circuit"))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  return {
    panels,
    unwiredLoads,
    totals: {
      panels: panels.length,
      slots: panels.reduce((n, p) => n + p.counts.slots, 0),
      wiredSlots: panels.reduce((n, p) => n + p.counts.wired, 0),
      circuits: input.circuitGroups.length,
      loads: input.loads.length,
      wiredLoads: wiredLoadUuids.size,
      unwiredLoads: unwiredLoads.length,
      gaps: panels.reduce((n, p) => n + p.counts.gaps, 0),
    },
  };
}

/** Free-text filter across panel IDs, circuit labels, breaker numbers and loads. */
export function filterWiringSchedule(schedule: WiringSchedule, query: string): WiringSchedule {
  const q = query.trim().toLowerCase();
  if (!q) return schedule;
  const loadHit = (l: WiringLoad) => `${l.id} ${l.description} ${l.area}`.toLowerCase().includes(q);
  const panels = schedule.panels
    .map((panel) => {
      const panelHit = `${panel.id} ${panel.description} ${panel.building}`
        .toLowerCase()
        .includes(q);
      if (panelHit) return panel;
      const slots = panel.slots.filter(
        (s) =>
          `${s.breakerNumber} ${s.circuitId} ${s.label}`.toLowerCase().includes(q) ||
          s.loads.some(loadHit),
      );
      const expectedLoads = panel.expectedLoads.filter(loadHit);
      if (slots.length === 0 && expectedLoads.length === 0) return null;
      return { ...panel, slots, expectedLoads };
    })
    .filter((p): p is WiringPanel => p !== null);
  return {
    ...schedule,
    panels,
    unwiredLoads: schedule.unwiredLoads.filter(loadHit),
  };
}
