// Field audit sheet: turns the install-progress snapshot into a flat, walk-order
// checklist that can be worked through on a tablet while standing in the shop.
//
// Pure presentation logic. It never invents a record, a panel relationship or an
// engineering value: rows exist only for records that already exist, and a row
// whose panel is unknown is grouped as unassigned rather than guessed onto a panel.
import type {
  InstallCircuit,
  InstallLoad,
  InstallPanel,
  InstallPosition,
  InstallProgressSnapshot,
} from "@/lib/electrical-install-progress.functions";
import { INSTALL_STATUSES } from "@/lib/electrical-install-progress.functions";
import { breakerDisplay } from "@/lib/electrical-breaker-reference";

export type AuditTargetKind = "panel" | "position" | "circuit" | "load";

/** Ordered install stages, oldest → most complete. Mirrors INSTALL_STATUSES. */
export const STAGE_ORDER: readonly string[] = INSTALL_STATUSES;

/** Plain-language explanation of each stage, shown as helper text in the field. */
export const STAGE_HELP: Record<string, string> = {
  planned: "On the drawings but no work has started.",
  material_ready: "Parts and materials are on site and staged for this item.",
  rough_in_started: "Physical work has begun — layout, supports or first runs.",
  raceway_installed: "Conduit, EMT or tray is mounted and run.",
  conductors_installed: "Wire is pulled through the raceway, end to end.",
  device_side_connected: "Terminated at the load or device end.",
  source_side_connected: "Terminated at the panel or source end.",
  tested: "Continuity, insulation or function checks passed.",
  complete: "Installed, connected, tested and in service.",
  as_built_verified: "Field-verified against the finished installation — final state.",
};

/** The stages worth a one-tap button in the field. */
export const QUICK_STAGES: readonly string[] = [
  "rough_in_started",
  "conductors_installed",
  "tested",
  "complete",
  "as_built_verified",
];

/** Stages that count a row as finished for progress rollups. */
export const DONE_STAGES: readonly string[] = ["complete", "as_built_verified"];

export const UNASSIGNED_GROUP = "Not assigned to a panel";

export interface AuditSheetRow {
  key: string;
  kind: AuditTargetKind;
  uuid: string;
  /** Stable, human ID of the underlying record (PNL-…, CG-…, FS-…). */
  ref: string;
  title: string;
  subtitle: string;
  panelId: string | null;
  panelUuid: string | null;
  status: string;
  /** Position of `status` in STAGE_ORDER, or null when the status is off-scheme. */
  stageIndex: number | null;
  percent: number | null;
  notes: string;
  done: boolean;
  /** Present for loads only: applied field verification state, when recorded. */
  verification: string | null;
}

export interface AuditSheetGroup {
  panelId: string;
  panelUuid: string | null;
  panelLabel: string;
  rows: AuditSheetRow[];
  progress: AuditProgress;
}

export interface AuditProgress {
  total: number;
  done: number;
  /** Mean stage completion across rows, 0-100. Null when there is nothing to score. */
  percent: number | null;
  byStage: Record<string, number>;
  offScheme: number;
}

export interface AuditSheetFilter {
  panelId?: string | null;
  kinds?: AuditTargetKind[] | null;
  hideDone?: boolean;
  query?: string | null;
}

export interface AuditSheet {
  groups: AuditSheetGroup[];
  overall: AuditProgress;
  rowCount: number;
  /** Panel options for the sheet's panel picker, in walk order. */
  panelOptions: { panelId: string; panelUuid: string | null; label: string }[];
}

const txt = (v: unknown) => (v == null ? "" : String(v)).trim();
const stageIndexOf = (status: unknown) => {
  const i = STAGE_ORDER.indexOf(txt(status));
  return i < 0 ? null : i;
};

export const stageLabel = (status: unknown) => txt(status).replace(/_/g, " ") || "not recorded";

/** Next stage after `status`, or null at the end of the scheme / off-scheme. */
export function nextStage(status: unknown): string | null {
  const i = stageIndexOf(status);
  if (i == null || i >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[i + 1]!;
}

function progressOf(rows: AuditSheetRow[]): AuditProgress {
  const byStage: Record<string, number> = {};
  let scored = 0;
  let sum = 0;
  let offScheme = 0;
  for (const r of rows) {
    const key = r.status || "not recorded";
    byStage[key] = (byStage[key] ?? 0) + 1;
    if (r.stageIndex == null) offScheme += 1;
    else {
      scored += 1;
      sum += r.stageIndex / (STAGE_ORDER.length - 1);
    }
  }
  return {
    total: rows.length,
    done: rows.filter((r) => r.done).length,
    percent: scored ? Math.round((sum / scored) * 1000) / 10 : null,
    byStage,
    offScheme,
  };
}

function panelRow(p: InstallPanel): AuditSheetRow {
  const status = txt(p.install_status);
  return {
    key: `panel:${p.id}`,
    kind: "panel",
    uuid: p.id,
    ref: p.panel_id,
    title: p.panel_id,
    subtitle: [txt(p.description), txt(p.building), p.spaces == null ? "" : `${p.spaces} spaces`]
      .filter(Boolean)
      .join(" · "),
    panelId: p.panel_id,
    panelUuid: p.id,
    status,
    stageIndex: stageIndexOf(status),
    percent: p.completion_percent ?? null,
    notes: txt(p.notes),
    done: DONE_STAGES.includes(status),
    verification: null,
  };
}

function positionRow(pos: InstallPosition, panel: InstallPanel | undefined): AuditSheetRow {
  const status = txt(pos.install_status);
  const breaker = panel
    ? breakerDisplay({
        panel_id: panel.panel_id,
        breaker_number: pos.breaker_number,
        side: pos.side,
        position: pos.position,
      }).label
    : null;
  return {
    key: `position:${pos.id}`,
    kind: "position",
    uuid: pos.id,
    ref: breaker ?? `${panel?.panel_id ?? "?"} ${pos.side} ${pos.position}`,
    title: breaker ?? `${pos.side} ${pos.position}`,
    subtitle: [
      `${pos.side} ${pos.position}`,
      `${pos.poles}-pole`,
      pos.ocp_amps == null ? "" : `${pos.ocp_amps}A`,
      txt(pos.label),
      pos.circuit_group_uuid ? "" : "no circuit group linked",
    ]
      .filter(Boolean)
      .join(" · "),
    panelId: panel?.panel_id ?? null,
    panelUuid: pos.panel_uuid,
    status,
    stageIndex: stageIndexOf(status),
    percent: null,
    notes: txt(pos.notes),
    done: DONE_STAGES.includes(status),
    verification: null,
  };
}

function circuitRow(
  c: InstallCircuit,
  panel: InstallPanel | undefined,
  derived?: CircuitGroupStateResult,
): AuditSheetRow {
  const recorded = txt(c.install_status);
  // A circuit group displays complete only when its breaker assignment is
  // complete AND every audited connected load is at least complete; otherwise it
  // displays configured or partially complete. Assignment alone never cascades.
  const status = derived
    ? derived.state === "complete"
      ? "complete"
      : recorded
    : recorded;
  const breaker = panel
    ? breakerDisplay({ panel_id: panel.panel_id, breaker_number: c.breaker_number }).reference
    : null;
  return {
    key: `circuit:${c.id}`,
    kind: "circuit",
    uuid: c.id,
    ref: c.circuit_group_id,
    title: c.circuit_group_id,
    subtitle: [
      txt(c.description),
      breaker ?? (c.breaker_number == null ? "no breaker recorded" : `breaker ${c.breaker_number}`),
      c.circuit_rating_amps == null ? "" : `${c.circuit_rating_amps}A`,
      c.voltage == null ? "" : `${c.voltage}V`,
      derived ? derived.label : "",
    ]
      .filter(Boolean)
      .join(" · "),
    panelId: panel?.panel_id ?? null,
    panelUuid: c.panel_uuid,
    status,
    stageIndex: stageIndexOf(status),
    percent: c.completion_percent ?? null,
    notes: [txt(c.notes), derived ? derived.because : ""].filter(Boolean).join(" — "),
    done: derived ? derived.state === "complete" : DONE_STAGES.includes(status),
    verification: null,
  };
}

function loadRow(
  l: InstallLoad & { field_verification_status?: string | null; notes?: string | null },
  panel: InstallPanel | undefined,
  circuit: InstallCircuit | undefined,
): AuditSheetRow {
  const status = txt(l.install_status);
  return {
    key: `load:${l.id}`,
    kind: "load",
    uuid: l.id,
    ref: txt(l.load_id) || l.id,
    title: txt(l.load_id) || txt(l.description) || l.id,
    subtitle: [
      txt(l.description),
      txt(l.area),
      circuit ? `circuit ${circuit.circuit_group_id}` : "no circuit link",
    ]
      .filter(Boolean)
      .join(" · "),
    panelId: panel?.panel_id ?? (txt(l.suggested_panel) || null),
    panelUuid: panel?.id ?? null,
    status,
    stageIndex: stageIndexOf(status),
    percent: null,
    notes: txt(l.notes),
    done: DONE_STAGES.includes(status),
    verification: txt(l.field_verification_status) || null,
  };
}

/**
 * Build the audit sheet in walk order: panel, then its breaker positions by
 * side/position, then its circuits, then the loads on those circuits. Loads with
 * no circuit fall back to their suggested panel for grouping only — the row still
 * reports "no circuit link" so the gap stays visible.
 */
export function buildAuditSheet(
  snapshot: InstallProgressSnapshot,
  filter: AuditSheetFilter = {},
): AuditSheet {
  const panelsByUuid = new Map(snapshot.panels.map((p) => [p.id, p]));
  const panelsById = new Map(snapshot.panels.map((p) => [p.panel_id, p]));
  const circuitsByUuid = new Map(snapshot.circuits.map((c) => [c.id, c]));

  const rowsByGroup = new Map<string, AuditSheetRow[]>();
  const push = (groupKey: string, row: AuditSheetRow) => {
    const list = rowsByGroup.get(groupKey);
    if (list) list.push(row);
    else rowsByGroup.set(groupKey, [row]);
  };

  const panels = [...snapshot.panels].sort((a, b) => a.panel_id.localeCompare(b.panel_id));
  for (const p of panels) push(p.panel_id, panelRow(p));

  const positions = [...snapshot.positions].sort(
    (a, b) =>
      (panelsByUuid.get(a.panel_uuid)?.panel_id ?? "").localeCompare(
        panelsByUuid.get(b.panel_uuid)?.panel_id ?? "",
      ) ||
      txt(a.side).localeCompare(txt(b.side)) ||
      a.position - b.position,
  );
  for (const pos of positions) {
    const panel = panelsByUuid.get(pos.panel_uuid);
    push(panel?.panel_id ?? UNASSIGNED_GROUP, positionRow(pos, panel));
  }

  const circuits = [...snapshot.circuits].sort(
    (a, b) =>
      (a.breaker_number ?? Number.MAX_SAFE_INTEGER) - (b.breaker_number ?? Number.MAX_SAFE_INTEGER) ||
      a.circuit_group_id.localeCompare(b.circuit_group_id),
  );
  for (const c of circuits) {
    const panel = c.panel_uuid ? panelsByUuid.get(c.panel_uuid) : undefined;
    push(panel?.panel_id ?? UNASSIGNED_GROUP, circuitRow(c, panel));
  }

  const loads = [...snapshot.loads].sort((a, b) => txt(a.load_id).localeCompare(txt(b.load_id)));
  for (const l of loads) {
    const circuit = l.circuit_group_uuid ? circuitsByUuid.get(l.circuit_group_uuid) : undefined;
    const panel =
      (circuit?.panel_uuid ? panelsByUuid.get(circuit.panel_uuid) : undefined) ??
      panelsById.get(txt(l.suggested_panel));
    push(panel?.panel_id ?? UNASSIGNED_GROUP, loadRow(l, panel, circuit));
  }

  const kinds = filter.kinds && filter.kinds.length ? new Set(filter.kinds) : null;
  const q = txt(filter.query).toLowerCase();
  const wantPanel = txt(filter.panelId);
  const keep = (r: AuditSheetRow, groupKey: string) => {
    if (kinds && !kinds.has(r.kind)) return false;
    if (filter.hideDone && r.done) return false;
    if (wantPanel && wantPanel !== groupKey) return false;
    if (q) {
      const hay = `${r.ref} ${r.title} ${r.subtitle} ${r.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const groupKeys = [...rowsByGroup.keys()].sort((a, b) => {
    if (a === UNASSIGNED_GROUP) return 1;
    if (b === UNASSIGNED_GROUP) return -1;
    return a.localeCompare(b);
  });

  const groups: AuditSheetGroup[] = [];
  const allKept: AuditSheetRow[] = [];
  for (const key of groupKeys) {
    const rows = (rowsByGroup.get(key) ?? []).filter((r) => keep(r, key));
    if (!rows.length) continue;
    allKept.push(...rows);
    const panel = panelsById.get(key);
    groups.push({
      panelId: key,
      panelUuid: panel?.id ?? null,
      panelLabel: panel
        ? [panel.panel_id, txt(panel.description)].filter(Boolean).join(" — ")
        : key,
      rows,
      progress: progressOf(rows),
    });
  }

  return {
    groups,
    overall: progressOf(allKept),
    rowCount: allKept.length,
    panelOptions: groupKeys.map((key) => {
      const panel = panelsById.get(key);
      return {
        panelId: key,
        panelUuid: panel?.id ?? null,
        label: panel ? [panel.panel_id, txt(panel.description)].filter(Boolean).join(" — ") : key,
      };
    }),
  };
}
