// Pure helpers for inventory part dependencies (bill of materials).
//
// Example: "Boiler manifold" is built from 2 × "1in copper tee",
// 4 × "1in copper elbow", 1 × "manifold weldment". Those rows live in
// public.inventory_components; this module does the math and the safety
// checks (no cycles) with no I/O so it can be unit tested.

export interface BomComponentRow {
  id: string;
  componentItemId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  /** Quantity of the component needed to make ONE parent. */
  quantity: number;
  /** Component stock currently on hand. */
  onHand: number;
  /** Component unit cost, when known. */
  unitCost: number | null;
  notes: string | null;
}

export interface BomRollup {
  /** Sum of quantity x unit_cost across components with a known cost. */
  materialCost: number;
  /** Components missing a unit cost — makes materialCost a floor, not a total. */
  componentsMissingCost: number;
  /** How many whole parents current stock can build (min over components). */
  buildableUnits: number;
  /** Components that block a build right now, with the shortfall per unit. */
  shortfalls: Array<{ name: string; needed: number; onHand: number; short: number }>;
}

/** Cost + buildability rollup for one parent's direct components. */
export function rollupBom(rows: BomComponentRow[]): BomRollup {
  let materialCost = 0;
  let componentsMissingCost = 0;
  let buildableUnits = rows.length > 0 ? Infinity : 0;
  const shortfalls: BomRollup["shortfalls"] = [];

  for (const r of rows) {
    if (r.unitCost == null) componentsMissingCost += 1;
    else materialCost += r.unitCost * r.quantity;

    const perUnit = r.quantity > 0 ? Math.floor(r.onHand / r.quantity) : 0;
    buildableUnits = Math.min(buildableUnits, Math.max(0, perUnit));

    if (r.onHand < r.quantity) {
      shortfalls.push({
        name: r.name,
        needed: r.quantity,
        onHand: r.onHand,
        short: Number((r.quantity - r.onHand).toFixed(4)),
      });
    }
  }

  return {
    materialCost: Number(materialCost.toFixed(2)),
    componentsMissingCost,
    buildableUnits: Number.isFinite(buildableUnits) ? buildableUnits : 0,
    shortfalls,
  };
}

/** How many of each component a build of `units` parents consumes. */
export function requirementsFor(rows: BomComponentRow[], units: number): Array<{
  componentItemId: string;
  name: string;
  needed: number;
  onHand: number;
  short: number;
}> {
  const n = Math.max(0, Math.floor(units));
  return rows.map((r) => {
    const needed = Number((r.quantity * n).toFixed(4));
    return {
      componentItemId: r.componentItemId,
      name: r.name,
      needed,
      onHand: r.onHand,
      short: Number(Math.max(0, needed - r.onHand).toFixed(4)),
    };
  });
}

/**
 * True when adding parent -> child would create a loop, e.g. manifold is made
 * from a weldment and someone then says the weldment is made from the manifold.
 * `edges` maps a parent id to the component ids it already uses.
 */
export function createsCycle(
  edges: Map<string, string[]>,
  parentId: string,
  childId: string,
): boolean {
  if (parentId === childId) return true;
  // Walk down from the prospective child; if we reach the parent, it's a loop.
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === parentId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of edges.get(node) ?? []) stack.push(next);
  }
  return false;
}

export function formatQty(n: number, unit?: string | null): string {
  const num = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
  return unit ? `${num} ${unit}` : num;
}
