// Phase 4.3 — normalized panel breaker positions and panel raceway exits.
//
// Pure, deterministic helpers: no database, no DOM, so every rule here is unit
// testable. Two hard rules from the roadmap are encoded:
//  - a panel's breaker capacity comes from that panel's own configuration
//    (spaces / breaker columns / positions per column) and is never assumed;
//  - physical exit ORDER is an attribute of the panel penetration, completely
//    separate from the CON-### identity of the raceway that leaves.
import { PANEL_EXIT_SIDES } from "@/lib/electrical";

export const BREAKER_SIDES = ["Left", "Right"] as const;
export type BreakerSide = (typeof BREAKER_SIDES)[number];

/**
 * Canonical column name for a recorded breaker slot.
 *
 * Imported and hand-entered rows arrive as "left", "LEFT", "L", "A" / "right",
 * "R", "B" — all the same physical column. Everything downstream (numbering,
 * capacity, QA) compares against "Left" / "Right", so a stored "left 1" must
 * not read as an unknown column. Anything unrecognised is returned trimmed so
 * the caller can still report it rather than silently relabel it.
 */
export function normalizeBreakerSide(value: unknown): string {
  const raw = String(value ?? "").trim();
  const key = raw.toLowerCase();
  if (key === "left" || key === "l" || key === "a" || key === "odd") return "Left";
  if (key === "right" || key === "r" || key === "b" || key === "even") return "Right";
  return raw;
}

export interface PanelLayout {
  /** 1 for a single-column (stacked) panel, 2 for a normal two-column panel. */
  columns: 1 | 2;
  /** Physical positions per column. */
  positionsPerColumn: number;
  /** Total breaker spaces the panel can hold. */
  totalSpaces: number;
  /** Which sides are physically available in this panel. */
  sides: BreakerSide[];
}

function int(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Resolve one panel's own breaker configuration.
 *
 * Example: a 30-space, two-column panel (`spaces: 30`) yields
 * `{ columns: 2, positionsPerColumn: 15, totalSpaces: 30 }` — Left 1-15 and
 * Right 1-15. An explicit `positions_per_column` always wins over the derived
 * value, because some panels are configured asymmetrically.
 */
export function resolvePanelLayout(panel: Record<string, unknown>): PanelLayout {
  const columnsRaw = int(panel["breaker_columns"]);
  const columns: 1 | 2 = columnsRaw === 1 ? 1 : 2;
  const perColumn = int(panel["positions_per_column"]);
  const spaces = int(panel["spaces"]) ?? 0;
  const positionsPerColumn =
    perColumn && perColumn > 0 ? perColumn : Math.max(0, Math.ceil(spaces / columns));
  return {
    columns,
    positionsPerColumn,
    totalSpaces: positionsPerColumn * columns,
    sides: columns === 1 ? ["Left"] : ["Left", "Right"],
  };
}

/**
 * The breaker number a physical position carries.
 * Two-column panel: odd numbers run down the left, even down the right
 * (Left 3 → breaker 5, Right 3 → breaker 6). Single column: 1, 2, 3, …
 */
export function expectedBreakerNumber(
  layout: PanelLayout,
  side: string,
  position: number,
): number | null {
  if (!Number.isFinite(position) || position < 1) return null;
  if (layout.columns === 1) return position;
  return normalizeBreakerSide(side) === "Right" ? position * 2 : position * 2 - 1;
}

export interface BreakerSlot {
  side: BreakerSide;
  position: number;
  breaker: number;
  label: string;
}

/** Every physical slot in a panel, in field-walk order (Left 1, Right 1, …). */
export function panelBreakerSlots(layout: PanelLayout): BreakerSlot[] {
  const out: BreakerSlot[] = [];
  for (let p = 1; p <= layout.positionsPerColumn; p++) {
    for (const side of layout.sides) {
      const breaker = expectedBreakerNumber(layout, side, p);
      if (breaker == null) continue;
      out.push({ side, position: p, breaker, label: `${side} ${p}` });
    }
  }
  return out;
}

/**
 * A physical slot that a multi-pole breaker occupies beyond its own record.
 *
 * Example: `Right 19` recorded with `poles: 2` is breaker 38/40, so `Right 20`
 * (breaker 40) is consumed by it. One physical breaker is always ONE record on
 * the lower-numbered slot; the consumed slot must not carry its own row.
 */
export interface ConsumedSlot {
  side: string;
  position: number;
  /** Row UUID of the multi-pole breaker that consumes this slot. */
  ownerId: string | null;
  /** "Right 19" — the owning record's slot. */
  ownerLabel: string;
  /** Breaker numbers the owner spans, e.g. "38/40". */
  ownerBreakers: string;
}

function slotKey(side: string, position: number): string {
  return `${side}#${position}`;
}

/** Slots consumed by multi-pole breakers, keyed "Side#Position". */
export function consumedSlotIndex(
  layout: PanelLayout,
  rows: Record<string, unknown>[],
): Map<string, ConsumedSlot> {
  const out = new Map<string, ConsumedSlot>();
  for (const row of rows) {
    const side = normalizeBreakerSide(row["side"]) || "Left";
    const position = int(row["position"]);
    const poles = int(row["poles"]) ?? 1;
    if (position == null || position < 1 || poles < 2) continue;
    const breakers: string[] = [];
    for (let i = 0; i < poles; i++) {
      const n = expectedBreakerNumber(layout, side, position + i);
      if (n != null) breakers.push(String(n));
    }
    const owner: Omit<ConsumedSlot, "side" | "position"> = {
      ownerId: row["id"] ? String(row["id"]) : null,
      ownerLabel: `${side} ${position}`,
      ownerBreakers: breakers.join("/"),
    };
    for (let i = 1; i < poles; i++) {
      const consumed = position + i;
      out.set(slotKey(side, consumed), { side, position: consumed, ...owner });
    }
  }
  return out;
}

export interface MultiPoleDuplicate extends ConsumedSlot {
  /** Row UUID of the offending duplicate record occupying the consumed slot. */
  id: string | null;
  message: string;
}

/**
 * Records sitting in a slot already consumed by a multi-pole breaker — the
 * "duplicate Right 20" case. Reporting only: callers decide whether to delete.
 */
export function multiPoleDuplicates(
  layout: PanelLayout,
  rows: Record<string, unknown>[],
): MultiPoleDuplicate[] {
  const consumed = consumedSlotIndex(layout, rows);
  const out: MultiPoleDuplicate[] = [];
  for (const row of rows) {
    const side = normalizeBreakerSide(row["side"]) || "Left";
    const position = int(row["position"]);
    if (position == null) continue;
    const hit = consumed.get(slotKey(side, position));
    const rowId = row["id"] ? String(row["id"]) : null;
    if (!hit || (hit.ownerId && rowId && hit.ownerId === rowId)) continue;
    out.push({
      ...hit,
      id: rowId,
      message: `${side} ${position} is already consumed by the ${hit.ownerBreakers ? `${hit.ownerBreakers} ` : ""}multi-pole breaker recorded at ${hit.ownerLabel} — one physical breaker is one record, so this duplicate row should be deleted.`,
    });
  }
  return out;
}

/** Slots with no breaker-position record yet, excluding multi-pole consumed slots. */
export function freeBreakerSlots(
  layout: PanelLayout,
  rows: Record<string, unknown>[],
): BreakerSlot[] {
  const taken = new Set(
    rows.map((r) => `${normalizeBreakerSide(r["side"]) || "Left"}#${int(r["position"]) ?? ""}`),
  );
  const consumed = consumedSlotIndex(layout, rows);
  return panelBreakerSlots(layout).filter(
    (s) => !taken.has(slotKey(s.side, s.position)) && !consumed.has(slotKey(s.side, s.position)),
  );
}

/**
 * Slots inside the panel's *observed* range that carry no record yet.
 *
 * Same as freeBreakerSlots when the panel's own configuration is known. When
 * `spaces` / `positions_per_column` are still blank (capacity never captured),
 * the range is inferred from the highest recorded position instead of assuming
 * a 48-space panel, so gaps like PNL-H1 breakers 29/31 (Left 15/16) and 2/4
 * (Right 1/2) still surface. Slots consumed by a multi-pole breaker are never
 * reported — Right 7 stays covered by the 12/14 record.
 */
export function unrecordedBreakerSlots(
  layout: PanelLayout,
  rows: Record<string, unknown>[],
): BreakerSlot[] {
  if (layout.positionsPerColumn > 0) return freeBreakerSlots(layout, rows);
  let maxPosition = 0;
  const sides = new Set<BreakerSide>();
  for (const r of rows) {
    const p = int(r["position"]);
    if (p != null) maxPosition = Math.max(maxPosition, p);
    const side = normalizeBreakerSide(r["side"]);
    if (side === "Right") sides.add("Right");
    else if (side === "Left") sides.add("Left");
  }
  if (!maxPosition) return [];
  const inferred: PanelLayout = {
    columns: sides.has("Right") ? 2 : 1,
    positionsPerColumn: maxPosition,
    totalSpaces: maxPosition * (sides.has("Right") ? 2 : 1),
    sides: sides.has("Right") ? ["Left", "Right"] : ["Left"],
  };
  return freeBreakerSlots(inferred, rows);
}

/** Next unused physical exit order for a panel (1-based, never reuses a gap end). */
export function nextExitOrder(rows: Record<string, unknown>[]): number {
  let max = 0;
  for (const r of rows) {
    const n = int(r["exit_order"]);
    if (n != null) max = Math.max(max, n);
  }
  return max + 1;
}

// ------------------------------------------------------------------ QA checks

export const PANEL_LAYOUT_CODES = [
  "breaker_slot_duplicate",
  "breaker_number_duplicate",
  "breaker_slot_out_of_range",
  "breaker_number_mismatch",
  "breaker_slot_unassigned",
  "breaker_slot_double_assigned",
  "breaker_slot_consumed_duplicate",
  "panel_exit_order_duplicate",
  "panel_exit_invalid_side",
  "panel_exit_unlinked",
  "panel_exit_raceway_mismatch",
  "panel_layout_unknown_panel",
] as const;
export type PanelLayoutCode = (typeof PANEL_LAYOUT_CODES)[number];

export interface PanelLayoutFinding {
  code: PanelLayoutCode;
  severity: "error" | "warning";
  /** Panel stable ID the finding belongs to — never a UUID. */
  panelId: string;
  /** Row UUID of the offending child record, for deep links. */
  id: string | null;
  message: string;
}

export interface PanelLayoutInput {
  /** Panel rows: `id`, `panel_id`, `spaces`, `breaker_columns`, `positions_per_column`. */
  panels: Record<string, unknown>[];
  positions: Record<string, unknown>[];
  exits: Record<string, unknown>[];
  /** Raceways, used to confirm an exit's raceway actually touches the panel. */
  raceways?: Record<string, unknown>[];
}

function str(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

/**
 * Validate breaker positions and panel exits. Reporting only: nothing here
 * writes, and a merely *incomplete* record (an unassigned space, an exit with
 * no raceway linked yet) is a warning — errors are reserved for provably
 * contradictory data such as two circuits in one physical slot.
 */
export function validatePanelLayout(input: PanelLayoutInput): PanelLayoutFinding[] {
  const out: PanelLayoutFinding[] = [];
  const panelById = new Map(
    input.panels.filter((p) => p["id"]).map((p) => [String(p["id"]), p]),
  );
  const racewayById = new Map(
    (input.raceways ?? []).filter((r) => r["id"]).map((r) => [String(r["id"]), r]),
  );
  const panelId = (uuid: string) => {
    const p = panelById.get(uuid);
    return p ? str(p, "panel_id") : "";
  };

  // ------------------------------------------------------- breaker positions
  const slotSeen = new Map<string, string[]>();
  const numberSeen = new Map<string, string[]>();
  for (const row of input.positions) {
    const panelUuid = str(row, "panel_uuid");
    const panel = panelById.get(panelUuid);
    const pid = panelId(panelUuid);
    const rowId = row["id"] ? String(row["id"]) : null;
    if (!panel) {
      out.push({
        code: "panel_layout_unknown_panel",
        severity: "error",
        panelId: pid,
        id: rowId,
        message: `A breaker position is linked to a panel that no longer exists.`,
      });
      continue;
    }
    const layout = resolvePanelLayout(panel);
    const side = normalizeBreakerSide(row["side"]) || "Left";
    const position = int(row["position"]);
    const label = `${pid} ${side} ${position ?? "?"}`;

    if (position == null || position < 1) {
      out.push({
        code: "breaker_slot_out_of_range",
        severity: "error",
        panelId: pid,
        id: rowId,
        message: `${pid}: a breaker position has no physical position number.`,
      });
    } else {
      slotSeen.set(`${panelUuid}#${side}#${position}`, [
        ...(slotSeen.get(`${panelUuid}#${side}#${position}`) ?? []),
        label,
      ]);
      if (layout.totalSpaces && position > layout.positionsPerColumn) {
        out.push({
          code: "breaker_slot_out_of_range",
          severity: "error",
          panelId: pid,
          id: rowId,
          message: `${label} is beyond this panel's configuration (${layout.positionsPerColumn} positions per column, ${layout.totalSpaces} spaces).`,
        });
      }
      if (!layout.sides.includes(side as BreakerSide)) {
        out.push({
          code: "breaker_slot_out_of_range",
          severity: "error",
          panelId: pid,
          id: rowId,
          message: `${label}: this panel has no "${side}" column.`,
        });
      }
    }

    const breaker = int(row["breaker_number"]);
    if (breaker != null) {
      numberSeen.set(`${panelUuid}#${breaker}`, [
        ...(numberSeen.get(`${panelUuid}#${breaker}`) ?? []),
        label,
      ]);
      const expected = position == null ? null : expectedBreakerNumber(layout, side, position);
      if (expected != null && expected !== breaker) {
        out.push({
          code: "breaker_number_mismatch",
          severity: "warning",
          panelId: pid,
          id: rowId,
          message: `${label} is recorded as breaker ${breaker}; this panel's numbering puts that position at breaker ${expected}.`,
        });
      }
    }

    const group = str(row, "circuit_group_uuid");
    const load = str(row, "load_uuid");
    if (group && load) {
      out.push({
        code: "breaker_slot_double_assigned",
        severity: "error",
        panelId: pid,
        id: rowId,
        message: `${label} is assigned to both a circuit group and a load — one physical breaker serves one of them.`,
      });
    }
    if (!group && !load) {
      out.push({
        code: "breaker_slot_unassigned",
        severity: "warning",
        panelId: pid,
        id: rowId,
        message: `${label} has no circuit group or load assigned yet.`,
      });
    }
  }

  for (const [key, labels] of slotSeen) {
    if (labels.length > 1) {
      out.push({
        code: "breaker_slot_duplicate",
        severity: "error",
        panelId: panelId(key.split("#")[0]!),
        id: null,
        message: `${labels.length} records occupy the same physical breaker slot (${labels[0]}).`,
      });
    }
  }
  for (const [key, labels] of numberSeen) {
    if (labels.length > 1) {
      const [uuid, breaker] = key.split("#");
      out.push({
        code: "breaker_number_duplicate",
        severity: "error",
        panelId: panelId(uuid!),
        id: null,
        message: `Breaker ${breaker} in ${panelId(uuid!) || "this panel"} is claimed by ${labels.length} records (${labels.join(", ")}).`,
      });
    }
  }

  // One record per consumed multi-pole slot: a 2-pole breaker at Right 19
  // (38/40) means Right 20 must not carry its own row.
  const positionsByPanel = new Map<string, Record<string, unknown>[]>();
  for (const row of input.positions) {
    const uuid = str(row, "panel_uuid");
    if (!panelById.has(uuid)) continue;
    positionsByPanel.set(uuid, [...(positionsByPanel.get(uuid) ?? []), row]);
  }
  for (const [uuid, rows] of positionsByPanel) {
    const pid = panelId(uuid);
    const panel = panelById.get(uuid)!;
    for (const dup of multiPoleDuplicates(resolvePanelLayout(panel), rows)) {
      out.push({
        code: "breaker_slot_consumed_duplicate",
        severity: "error",
        panelId: pid,
        id: dup.id,
        message: `${pid}: ${dup.message}`,
      });
    }
  }

  // ------------------------------------------------------------- panel exits
  const orderSeen = new Map<string, string[]>();
  for (const row of input.exits) {
    const panelUuid = str(row, "panel_uuid");
    const pid = panelId(panelUuid);
    const rowId = row["id"] ? String(row["id"]) : null;
    if (!panelById.has(panelUuid)) {
      out.push({
        code: "panel_layout_unknown_panel",
        severity: "error",
        panelId: pid,
        id: rowId,
        message: `A panel raceway exit is linked to a panel that no longer exists.`,
      });
      continue;
    }
    const order = int(row["exit_order"]);
    const label = `${pid} exit ${order ?? "?"}`;
    if (order == null || order < 1) {
      out.push({
        code: "panel_exit_order_duplicate",
        severity: "error",
        panelId: pid,
        id: rowId,
        message: `${pid}: a raceway exit has no physical exit order.`,
      });
    } else {
      orderSeen.set(`${panelUuid}#${order}`, [
        ...(orderSeen.get(`${panelUuid}#${order}`) ?? []),
        label,
      ]);
    }

    const side = str(row, "exit_side");
    if (side && !(PANEL_EXIT_SIDES as readonly string[]).includes(side)) {
      out.push({
        code: "panel_exit_invalid_side",
        severity: "error",
        panelId: pid,
        id: rowId,
        message: `${label}: "${side}" is not a recognised exit side (${PANEL_EXIT_SIDES.join(", ")}).`,
      });
    }

    const racewayUuid = str(row, "raceway_uuid");
    if (!racewayUuid) {
      const ref = str(row, "raceway_ref");
      out.push({
        code: "panel_exit_unlinked",
        severity: "warning",
        panelId: pid,
        id: rowId,
        message: ref
          ? `${label} references ${ref} in text but no raceway record is linked yet.`
          : `${label} has no raceway linked yet.`,
      });
    } else {
      const raceway = racewayById.get(racewayUuid);
      if (raceway && racewayById.size) {
        const touches =
          str(raceway, "source_panel_uuid") === panelUuid ||
          str(raceway, "dest_panel_uuid") === panelUuid;
        if (!touches) {
          out.push({
            code: "panel_exit_raceway_mismatch",
            severity: "error",
            panelId: pid,
            id: rowId,
            message: `${label} is linked to raceway ${str(raceway, "conduit_id")}, which neither starts nor ends at ${pid}.`,
          });
        }
      }
    }
  }

  for (const [key, labels] of orderSeen) {
    if (labels.length > 1) {
      out.push({
        code: "panel_exit_order_duplicate",
        severity: "error",
        panelId: panelId(key.split("#")[0]!),
        id: null,
        message: `${labels.length} raceway exits share physical exit order ${key.split("#")[1]} (${labels[0]}).`,
      });
    }
  }

  return out.sort(
    (a, b) =>
      a.panelId.localeCompare(b.panelId) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
}

export function panelLayoutSummary(findings: PanelLayoutFinding[]) {
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };
}
