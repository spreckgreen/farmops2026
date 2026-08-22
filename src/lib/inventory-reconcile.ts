import type { Asset } from "@/components/dashboard/types";

export const INVENTORY_CSV_COLUMNS = [
  "id",
  "name",
  "description",
  "item_type",
  "location",
  "quantity",
  "min_quantity",
  "status",
  "barcode",
  "tags",
] as const;

const STATUSES = ["available", "in_use", "maintenance", "retired"];

export interface ParsedRow {
  id?: string;
  name?: string;
  description?: string;
  item_type?: string;
  location?: string;
  quantity?: string;
  min_quantity?: string;
  status?: string;
  barcode?: string;
  tags?: string;
}

export interface AssetPatch {
  name: string;
  description: string;
  item_type: string | null;
  location: string;
  quantity: number;
  min_quantity: number;
  status: string;
  barcode: string | null;
  tags: string[];
}

export interface PlanEntry {
  matchedBy: "id" | "barcode" | "name" | null;
  existing: Asset | null;
  patch: AssetPatch;
  changedFields: string[];
}

export interface ReconcilePlan {
  creates: PlanEntry[];
  updates: PlanEntry[];
  unchanged: PlanEntry[];
  /** Existing rows that were not present in the imported file. */
  missing: Asset[];
  skipped: number;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const num = (v: string | undefined, fallback: number) => {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

export function rowToPatch(row: ParsedRow): AssetPatch {
  return {
    name: (row.name ?? "").trim() || "Unnamed",
    description: (row.description ?? "").trim(),
    item_type: (row.item_type ?? "").trim() || null,
    location: (row.location ?? "").trim(),
    quantity: num(row.quantity, 0),
    min_quantity: num(row.min_quantity, 0),
    status: STATUSES.includes(norm(row.status)) ? norm(row.status) : "available",
    barcode: (row.barcode ?? "").trim() || null,
    tags: (row.tags ?? "")
      .split(/[;|]/)
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

function diff(existing: Asset, patch: AssetPatch): string[] {
  const changed: string[] = [];
  if ((existing.name ?? "") !== patch.name) changed.push("name");
  if ((existing.description ?? "") !== patch.description) changed.push("description");
  if ((existing.item_type ?? null) !== patch.item_type) changed.push("item_type");
  if ((existing.location ?? "") !== patch.location) changed.push("location");
  if ((existing.quantity ?? 0) !== patch.quantity) changed.push("quantity");
  if ((existing.min_quantity ?? 0) !== patch.min_quantity) changed.push("min_quantity");
  if (existing.status !== patch.status) changed.push("status");
  if ((existing.barcode ?? null) !== patch.barcode) changed.push("barcode");
  const a = (existing.tags ?? []).join(";");
  if (a !== patch.tags.join(";")) changed.push("tags");
  return changed;
}

/**
 * Reconcile imported CSV rows against current inventory.
 * Match precedence: id → barcode → name (case-insensitive).
 * Each existing row can only be matched once, so duplicated CSV names create new rows.
 */
export function reconcileInventory(rows: ParsedRow[], assets: Asset[]): ReconcilePlan {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const byBarcode = new Map<string, Asset>();
  const byName = new Map<string, Asset>();
  for (const a of assets) {
    const b = norm(a.barcode);
    if (b && !byBarcode.has(b)) byBarcode.set(b, a);
    const n = norm(a.name);
    if (n && !byName.has(n)) byName.set(n, a);
  }

  const used = new Set<string>();
  const plan: ReconcilePlan = {
    creates: [],
    updates: [],
    unchanged: [],
    missing: [],
    skipped: 0,
  };

  for (const row of rows) {
    const hasContent = Object.values(row).some((v) => (v ?? "").trim() !== "");
    if (!hasContent) {
      plan.skipped += 1;
      continue;
    }
    const patch = rowToPatch(row);
    let existing: Asset | null = null;
    let matchedBy: PlanEntry["matchedBy"] = null;

    const id = (row.id ?? "").trim();
    if (id && byId.has(id) && !used.has(id)) {
      existing = byId.get(id)!;
      matchedBy = "id";
    }
    if (!existing && patch.barcode) {
      const cand = byBarcode.get(norm(patch.barcode));
      if (cand && !used.has(cand.id)) {
        existing = cand;
        matchedBy = "barcode";
      }
    }
    if (!existing) {
      const cand = byName.get(norm(patch.name));
      if (cand && !used.has(cand.id)) {
        existing = cand;
        matchedBy = "name";
      }
    }

    if (!existing) {
      plan.creates.push({ matchedBy: null, existing: null, patch, changedFields: [] });
      continue;
    }

    used.add(existing.id);
    const changedFields = diff(existing, patch);
    const entry: PlanEntry = { matchedBy, existing, patch, changedFields };
    if (changedFields.length === 0) plan.unchanged.push(entry);
    else plan.updates.push(entry);
  }

  plan.missing = assets.filter((a) => !used.has(a.id));
  return plan;
}
