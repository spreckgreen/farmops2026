// Pure helpers for kit check-out / check-in.
//
// Example: "Ham Radio Field Deployment Kit" has a parts list of
// 1 x FT-891, 1 x MPAS 2.0 antenna, 2 x 20Ah battery, 4 x PL-259.
// Checking out 2 kits pulls 2/2/4/8 from stock; checking the kit back in
// puts whatever came home back on the shelf.

import type { BomComponentRow } from "@/lib/inventory-bom";

export interface DeployLinePlan {
  componentItemId: string;
  name: string;
  unit: string | null;
  /** Quantity leaving stock for this deployment. */
  quantityOut: number;
  onHand: number;
  /** How much stock is missing to cover quantityOut (0 when covered). */
  short: number;
}

const round = (n: number) => Number(n.toFixed(4));

/** What a check-out of `units` kits pulls from stock, per component. */
export function planKitCheckout(rows: BomComponentRow[], units: number): DeployLinePlan[] {
  const n = Math.max(0, units);
  return rows.map((r) => {
    const quantityOut = round(r.quantity * n);
    return {
      componentItemId: r.componentItemId,
      name: r.name,
      unit: r.unit,
      quantityOut,
      onHand: r.onHand,
      short: round(Math.max(0, quantityOut - r.onHand)),
    };
  });
}

export interface DeploymentLine {
  id: string;
  componentItemId: string | null;
  name: string;
  unit: string | null;
  quantityOut: number;
  quantityReturned: number;
}

export interface Deployment {
  id: string;
  kitItemId: string;
  kitName: string;
  label: string;
  units: number;
  status: "open" | "returned";
  checkedOutAt: string;
  returnedAt: string | null;
  notes: string | null;
  lines: DeploymentLine[];
}

/** Still-outstanding quantity on a line (never negative). */
export function outstanding(line: DeploymentLine): number {
  return round(Math.max(0, line.quantityOut - line.quantityReturned));
}

/** Total number of part units still in the field for a deployment. */
export function outstandingTotal(d: Deployment): number {
  return round(d.lines.reduce((sum, l) => sum + outstanding(l), 0));
}

/**
 * Clamp a requested return to what is actually outstanding, so a double
 * check-in can never inflate stock beyond what went out.
 */
export function clampReturn(line: DeploymentLine, requested: number): number {
  if (!(requested > 0)) return 0;
  return round(Math.min(requested, outstanding(line)));
}

/** True when every line has come home. */
export function isFullyReturned(lines: DeploymentLine[]): boolean {
  return lines.every((l) => outstanding(l) <= 0);
}
