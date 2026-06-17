// Pure builders for Food Reports. No server / browser dependencies — safe to
// import from both the UI (food.reports.tsx) and the obsidian exporter
// (obsidian.functions.ts). Each builder returns markdown + CSV columns/rows
// so the same data can be downloaded, previewed, or synced to a vault.

import { rowsToCsv } from "./csv";

export type ReportSlug =
  | "yearly-food-plan"
  | "long-term-storage-plan"
  | "harvest-report"
  | "garden-layout"
  | "optimized-garden-layout";

export type CsvColumn = { key: string; label: string };

export type FoodReport = {
  slug: ReportSlug;
  title: string;
  description: string;
  markdown: string;
  csvColumns: CsvColumn[];
  csvRows: Record<string, string | number>[];
  obsidianPath: string; // relative to vault root
};

// ---------------------------------------------------------------------------
// Plant reference data (used by gap math + the optimized layout)
// ---------------------------------------------------------------------------

export const YIELD_PER_PLANT_LBS: Record<string, number> = {
  tomato: 10, tomatoes: 10,
  pepper: 3, peppers: 3,
  cucumber: 5, cucumbers: 5,
  cabbage: 3,
  squash: 8, "summer squash": 8, zucchini: 10,
  melon: 6, watermelon: 15, cantaloupe: 8,
  bean: 0.5, beans: 0.5, "common beans": 0.5,
  pea: 0.3, peas: 0.3,
  spinach: 0.5,
  basil: 0.5, herb: 0.25, herbs: 0.25,
  beet: 0.4, beets: 0.4,
  radish: 0.1, radishes: 0.1,
  carrot: 0.25, carrots: 0.25,
  onion: 0.4, onions: 0.4,
  garlic: 0.15,
  potato: 2, potatoes: 2,
  lettuce: 0.5,
  kale: 1,
  broccoli: 1,
  cauliflower: 1.5,
  corn: 0.5,
  strawberry: 1, strawberries: 1,
  blueberry: 5, blueberries: 5,
  raspberry: 2, raspberries: 2,
  "wild berries": 2,
};

// In-row spacing in inches between plants (single row). Used for the
// optimized layout (30 ft rows = 360 in).
export const IN_ROW_SPACING_IN: Record<string, number> = {
  tomato: 24, tomatoes: 24,
  pepper: 18, peppers: 18,
  cucumber: 12, cucumbers: 12,
  cabbage: 18,
  squash: 24, "summer squash": 24, zucchini: 24,
  melon: 36, watermelon: 48, cantaloupe: 36,
  bean: 4, beans: 4, "common beans": 4,
  pea: 3, peas: 3,
  spinach: 4,
  basil: 12, herb: 12, herbs: 12,
  beet: 4, beets: 4,
  radish: 2, radishes: 2,
  carrot: 3, carrots: 3,
  onion: 4, onions: 4,
  garlic: 4,
  potato: 12, potatoes: 12,
  lettuce: 8,
  kale: 18,
  broccoli: 18,
  cauliflower: 18,
  corn: 8,
  strawberry: 12, strawberries: 12,
  blueberry: 36, blueberries: 36,
  raspberry: 24, raspberries: 24,
  "wild berries": 24,
};

const DEFAULT_YIELD = 1;
const DEFAULT_SPACING = 12;
export const DEFAULT_ROW_LENGTH_FT = 30;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function lookup<T>(table: Record<string, T>, name: string, fallback: T): T {
  const k = norm(name);
  if (!k) return fallback;
  if (table[k] !== undefined) return table[k];
  for (const [key, val] of Object.entries(table)) {
    if (k.includes(key)) return val;
  }
  return fallback;
}

export function yieldFor(name: string): number {
  return lookup(YIELD_PER_PLANT_LBS, name, DEFAULT_YIELD);
}

export function spacingFor(name: string): number {
  return lookup(IN_ROW_SPACING_IN, name, DEFAULT_SPACING);
}

const GARDEN_KEYWORDS = Object.keys(YIELD_PER_PLANT_LBS);
export function isGardenPlant(name: string): boolean {
  const k = norm(name);
  if (!k) return false;
  return GARDEN_KEYWORDS.some((g) => k.includes(g));
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(digits).replace(/\.0+$/, "");
}

function mdTable(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${r.map((c) => String(c ?? "")).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].join("\n");
}

// ---------------------------------------------------------------------------
// Inputs (matches the shape returned by getFoodReportsData)
// ---------------------------------------------------------------------------

export type ReportInputs = {
  foods: Array<{
    id: string;
    name: string;
    category: string | null;
    oz_per_serving: number | string | null;
    price_per_pound: number | string | null;
    season?: string | null;
  }>;
  people: Array<{ id: string; name: string }>;
  entries: Array<{ food_id: string; person_id: string; day_of_week: number; quantity: number | string }>;
  storagePlan: Array<{
    name: string; category: string | null; food_type: string | null;
    pounds_per_year: number | string | null;
    target_months: number | string | null;
    price_per_pound: number | string | null;
    notes: string | null;
  }>;
  plantings: Array<{ id: string; crop: string; variety: string | null; status: string | null; planted_on: string | null; expected_harvest: string | null }>;
  harvests: Array<{ id: string; planting_id: string | null; harvested_on: string; quantity: number | string; unit: string; quality: string | null; notes: string | null }>;
  garden: Array<{ row_label: string; position: number; plant_name: string | null }>;
  rowLengthFt?: number;
  generatedAt: string; // ISO
};

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toPounds(qty: number, unit: string | null | undefined): number {
  const u = (unit ?? "").toLowerCase().trim();
  if (!u) return qty;
  if (["lb", "lbs", "pound", "pounds"].includes(u)) return qty;
  if (["oz", "ounce", "ounces"].includes(u)) return qty / 16;
  if (["kg", "kilogram", "kilograms"].includes(u)) return qty * 2.20462;
  if (["g", "gram", "grams"].includes(u)) return qty * 0.00220462;
  return qty;
}

// ---------------------------------------------------------------------------
// 1. Yearly Food Plan
// ---------------------------------------------------------------------------

function buildYearlyFoodPlan(i: ReportInputs): FoodReport {
  const peopleById = new Map(i.people.map((p) => [p.id, p.name]));
  const weeklyByFood = new Map<string, number>(); // weekly ounces
  const breakdownByFood = new Map<string, Map<string, number>>(); // food -> person -> weekly oz
  for (const e of i.entries) {
    const qty = toNum(e.quantity);
    weeklyByFood.set(e.food_id, (weeklyByFood.get(e.food_id) ?? 0) + qty);
    const inner = breakdownByFood.get(e.food_id) ?? new Map();
    const pname = peopleById.get(e.person_id) ?? "—";
    inner.set(pname, (inner.get(pname) ?? 0) + qty);
    breakdownByFood.set(e.food_id, inner);
  }

  type Row = { name: string; category: string; weeklyOz: number; annualLbs: number; pricePerLb: number; annualCost: number };
  const rows: Row[] = [];
  for (const f of i.foods) {
    const weeklyOz = weeklyByFood.get(f.id) ?? 0;
    if (weeklyOz === 0) continue;
    const annualLbs = (weeklyOz * 52) / 16;
    const price = toNum(f.price_per_pound);
    rows.push({
      name: f.name,
      category: f.category ?? "Uncategorized",
      weeklyOz,
      annualLbs,
      pricePerLb: price,
      annualCost: annualLbs * price,
    });
  }
  rows.sort((a, b) => b.annualLbs - a.annualLbs);

  const totalLbs = rows.reduce((s, r) => s + r.annualLbs, 0);
  const totalCost = rows.reduce((s, r) => s + r.annualCost, 0);
  const totalWeeklyOz = rows.reduce((s, r) => s + r.weeklyOz, 0);

  const byCat = new Map<string, { lbs: number; cost: number }>();
  for (const r of rows) {
    const c = byCat.get(r.category) ?? { lbs: 0, cost: 0 };
    c.lbs += r.annualLbs;
    c.cost += r.annualCost;
    byCat.set(r.category, c);
  }

  const md = [
    `# Yearly Food Plan`,
    ``,
    `*Generated ${i.generatedAt.slice(0, 10)} — ${i.people.length} ${i.people.length === 1 ? "person" : "people"}, ${rows.length} foods*`,
    ``,
    `## Summary`,
    ``,
    `- **Annual need:** ${fmt(totalLbs)} lbs`,
    `- **Estimated annual cost:** $${fmt(totalCost, 2)}`,
    `- **Weekly ounces (all people):** ${fmt(totalWeeklyOz)}`,
    ``,
    `## By Category`,
    ``,
    mdTable(
      ["Category", "Annual lbs", "Annual cost"],
      Array.from(byCat.entries())
        .sort((a, b) => b[1].lbs - a[1].lbs)
        .map(([c, v]) => [c, fmt(v.lbs), `$${fmt(v.cost, 2)}`]),
    ),
    ``,
    `## Foods`,
    ``,
    mdTable(
      ["Food", "Category", "Weekly oz", "Annual lbs", "$/lb", "Annual cost"],
      rows.map((r) => [r.name, r.category, fmt(r.weeklyOz), fmt(r.annualLbs), `$${fmt(r.pricePerLb, 2)}`, `$${fmt(r.annualCost, 2)}`]),
    ),
    ``,
  ].join("\n");

  return {
    slug: "yearly-food-plan",
    title: "Yearly Food Plan",
    description: "Annual pounds and cost per food, derived from the weekly meal plan.",
    markdown: md,
    csvColumns: [
      { key: "food", label: "Food" },
      { key: "category", label: "Category" },
      { key: "weekly_oz", label: "Weekly oz" },
      { key: "annual_lbs", label: "Annual lbs" },
      { key: "price_per_lb", label: "Price per lb" },
      { key: "annual_cost", label: "Annual cost" },
    ],
    csvRows: rows.map((r) => ({
      food: r.name, category: r.category,
      weekly_oz: r.weeklyOz.toFixed(2),
      annual_lbs: r.annualLbs.toFixed(2),
      price_per_lb: r.pricePerLb.toFixed(2),
      annual_cost: r.annualCost.toFixed(2),
    })),
    obsidianPath: "27 Food Production/Reports/Yearly Food Plan.md",
  };
}

// ---------------------------------------------------------------------------
// 2. Long-Term Storage Plan
// ---------------------------------------------------------------------------

function buildStoragePlan(i: ReportInputs): FoodReport {
  const rows = i.storagePlan.map((r) => {
    const lbsYear = toNum(r.pounds_per_year);
    const months = toNum(r.target_months) || 12;
    const targetLbs = (lbsYear * months) / 12;
    const price = toNum(r.price_per_pound);
    return {
      name: r.name,
      category: r.category ?? "Uncategorized",
      foodType: r.food_type ?? "",
      lbsPerYear: lbsYear,
      targetMonths: months,
      targetLbs,
      pricePerLb: price,
      targetCost: targetLbs * price,
      notes: r.notes ?? "",
    };
  }).sort((a, b) => b.targetLbs - a.targetLbs);

  const totalLbs = rows.reduce((s, r) => s + r.targetLbs, 0);
  const totalCost = rows.reduce((s, r) => s + r.targetCost, 0);

  const md = [
    `# Long-Term Storage Plan`,
    ``,
    `*Generated ${i.generatedAt.slice(0, 10)} — ${rows.length} items*`,
    ``,
    `## Summary`,
    ``,
    `- **Total target pounds:** ${fmt(totalLbs)}`,
    `- **Estimated value:** $${fmt(totalCost, 2)}`,
    ``,
    `## Items`,
    ``,
    mdTable(
      ["Item", "Category", "Type", "Lbs/yr", "Months", "Target lbs", "$/lb", "Target $"],
      rows.map((r) => [r.name, r.category, r.foodType, fmt(r.lbsPerYear), fmt(r.targetMonths), fmt(r.targetLbs), `$${fmt(r.pricePerLb, 2)}`, `$${fmt(r.targetCost, 2)}`]),
    ),
    ``,
  ].join("\n");

  return {
    slug: "long-term-storage-plan",
    title: "Long-Term Storage Plan",
    description: "Target pantry quantities by category, scaled to your chosen number of months.",
    markdown: md,
    csvColumns: [
      { key: "name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "food_type", label: "Food type" },
      { key: "lbs_per_year", label: "Lbs per year" },
      { key: "target_months", label: "Target months" },
      { key: "target_lbs", label: "Target lbs" },
      { key: "price_per_lb", label: "Price per lb" },
      { key: "target_cost", label: "Target cost" },
      { key: "notes", label: "Notes" },
    ],
    csvRows: rows.map((r) => ({
      name: r.name, category: r.category, food_type: r.foodType,
      lbs_per_year: r.lbsPerYear.toFixed(2),
      target_months: r.targetMonths,
      target_lbs: r.targetLbs.toFixed(2),
      price_per_lb: r.pricePerLb.toFixed(2),
      target_cost: r.targetCost.toFixed(2),
      notes: r.notes,
    })),
    obsidianPath: "50 Food Storage/Reports/Long-Term Storage Plan.md",
  };
}

// ---------------------------------------------------------------------------
// 3. Harvest Report
// ---------------------------------------------------------------------------

function buildHarvestReport(i: ReportInputs): FoodReport {
  const plantingById = new Map(i.plantings.map((p) => [p.id, p]));
  type Row = { date: string; crop: string; variety: string; qty: number; unit: string; pounds: number; quality: string; notes: string };
  const rows: Row[] = [];
  for (const h of i.harvests) {
    const planting = h.planting_id ? plantingById.get(h.planting_id) : null;
    const qty = toNum(h.quantity);
    rows.push({
      date: (h.harvested_on ?? "").slice(0, 10),
      crop: planting?.crop ?? "—",
      variety: planting?.variety ?? "",
      qty,
      unit: h.unit,
      pounds: toPounds(qty, h.unit),
      quality: h.quality ?? "",
      notes: h.notes ?? "",
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));

  // Totals by crop
  const byCrop = new Map<string, { pounds: number; count: number }>();
  for (const r of rows) {
    const c = byCrop.get(r.crop) ?? { pounds: 0, count: 0 };
    c.pounds += r.pounds;
    c.count += 1;
    byCrop.set(r.crop, c);
  }
  const cropRows = Array.from(byCrop.entries()).sort((a, b) => b[1].pounds - a[1].pounds);
  const totalLbs = rows.reduce((s, r) => s + r.pounds, 0);

  // Totals by year+month
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    const ym = r.date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + r.pounds);
  }
  const monthRows = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const md = [
    `# Harvest Report`,
    ``,
    `*Generated ${i.generatedAt.slice(0, 10)} — ${rows.length} harvest entries totaling ${fmt(totalLbs)} lbs*`,
    ``,
    `## By Crop`,
    ``,
    cropRows.length
      ? mdTable(["Crop", "Entries", "Pounds"], cropRows.map(([c, v]) => [c, v.count, fmt(v.pounds)]))
      : "_No harvests recorded._",
    ``,
    `## By Month`,
    ``,
    monthRows.length
      ? mdTable(["Month", "Pounds"], monthRows.map(([m, p]) => [m, fmt(p)]))
      : "_No harvests recorded._",
    ``,
    `## All Harvests`,
    ``,
    rows.length
      ? mdTable(
          ["Date", "Crop", "Variety", "Qty", "Unit", "Lbs", "Quality", "Notes"],
          rows.map((r) => [r.date, r.crop, r.variety, fmt(r.qty, 2), r.unit, fmt(r.pounds, 2), r.quality, r.notes.replace(/\|/g, "\\|").replace(/\n/g, " ")]),
        )
      : "_No harvests recorded._",
    ``,
  ].join("\n");

  return {
    slug: "harvest-report",
    title: "Harvest Report",
    description: "Every recorded harvest with per-crop and per-month totals.",
    markdown: md,
    csvColumns: [
      { key: "date", label: "Date" },
      { key: "crop", label: "Crop" },
      { key: "variety", label: "Variety" },
      { key: "quantity", label: "Quantity" },
      { key: "unit", label: "Unit" },
      { key: "pounds", label: "Pounds" },
      { key: "quality", label: "Quality" },
      { key: "notes", label: "Notes" },
    ],
    csvRows: rows.map((r) => ({
      date: r.date, crop: r.crop, variety: r.variety,
      quantity: r.qty, unit: r.unit, pounds: r.pounds.toFixed(2),
      quality: r.quality, notes: r.notes,
    })),
    obsidianPath: "27 Food Production/Reports/Harvest Report.md",
  };
}

// ---------------------------------------------------------------------------
// 4. Garden Layout (current as-planted grid)
// ---------------------------------------------------------------------------

function buildGardenLayout(i: ReportInputs): FoodReport {
  // Group by row
  const rowMap = new Map<string, Map<number, string>>();
  let maxPos = 0;
  for (const p of i.garden) {
    if (!rowMap.has(p.row_label)) rowMap.set(p.row_label, new Map());
    if (p.plant_name && p.plant_name.trim()) {
      rowMap.get(p.row_label)!.set(p.position, p.plant_name.trim());
    }
    if (p.position > maxPos) maxPos = p.position;
  }
  const rows = Array.from(rowMap.keys()).sort();

  // Count by plant
  const counts = new Map<string, number>();
  for (const m of rowMap.values()) {
    for (const v of m.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const totalPlants = Array.from(counts.values()).reduce((s, n) => s + n, 0);

  // Markdown grid (one block per row)
  const gridLines: string[] = [];
  for (const r of rows) {
    const cells: string[] = [];
    const m = rowMap.get(r)!;
    for (let pos = 1; pos <= maxPos; pos++) {
      cells.push(m.get(pos) ?? "·");
    }
    gridLines.push(`**${r}**: ${cells.join(" | ")}`);
  }

  const csvRows: Record<string, string | number>[] = [];
  for (const r of rows) {
    const m = rowMap.get(r)!;
    for (let pos = 1; pos <= maxPos; pos++) {
      csvRows.push({ row: r, position: pos, plant: m.get(pos) ?? "" });
    }
  }

  const md = [
    `# Garden Layout — Current Plantings`,
    ``,
    `*Generated ${i.generatedAt.slice(0, 10)} — ${rows.length} rows, ${totalPlants} plants*`,
    ``,
    `## Plant Counts`,
    ``,
    counts.size
      ? mdTable(
          ["Plant", "Count", "Est. yield (lbs)"],
          Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, c]) => [name, c, fmt(c * yieldFor(name))]),
        )
      : "_No plants recorded._",
    ``,
    `## Layout`,
    ``,
    gridLines.length ? gridLines.join("\n\n") : "_No rows defined._",
    ``,
  ].join("\n");

  return {
    slug: "garden-layout",
    title: "Garden Layout",
    description: "Snapshot of every garden plot with row × position grid and plant counts.",
    markdown: md,
    csvColumns: [
      { key: "row", label: "Row" },
      { key: "position", label: "Position" },
      { key: "plant", label: "Plant" },
    ],
    csvRows,
    obsidianPath: "27 Food Production/Reports/Garden Layout.md",
  };
}

// ---------------------------------------------------------------------------
// 5. Optimized Garden Layout — sized to meet the Yearly Food Plan,
//    assuming 30 ft rows (or whatever rowLengthFt the caller passed).
// ---------------------------------------------------------------------------

function buildOptimizedGardenLayout(i: ReportInputs): FoodReport {
  const rowFt = i.rowLengthFt ?? DEFAULT_ROW_LENGTH_FT;
  const rowIn = rowFt * 12;

  // Annual lbs per food from plan entries
  const weeklyByFood = new Map<string, number>();
  for (const e of i.entries) {
    weeklyByFood.set(e.food_id, (weeklyByFood.get(e.food_id) ?? 0) + toNum(e.quantity));
  }

  type Need = {
    name: string;
    annualLbs: number;
    yieldPerPlant: number;
    spacingIn: number;
    plantsNeeded: number;
    plantsPerRow: number;
    rowsNeeded: number;
    linearFt: number;
  };
  const needs: Need[] = [];
  for (const f of i.foods) {
    if (!isGardenPlant(f.name)) continue;
    const weeklyOz = weeklyByFood.get(f.id) ?? 0;
    if (weeklyOz === 0) continue;
    const annualLbs = (weeklyOz * 52) / 16;
    const ypp = yieldFor(f.name);
    const spacing = spacingFor(f.name);
    const plantsNeeded = Math.max(1, Math.ceil(annualLbs / ypp));
    const plantsPerRow = Math.max(1, Math.floor(rowIn / spacing));
    const rowsNeeded = Math.ceil(plantsNeeded / plantsPerRow);
    needs.push({
      name: f.name,
      annualLbs,
      yieldPerPlant: ypp,
      spacingIn: spacing,
      plantsNeeded,
      plantsPerRow,
      rowsNeeded,
      linearFt: (plantsNeeded * spacing) / 12,
    });
  }
  needs.sort((a, b) => b.rowsNeeded - a.rowsNeeded || b.annualLbs - a.annualLbs);

  // Pack rows: each row up to rowIn inches. Group same plant in contiguous
  // chunks. If a need spills past one row, allocate additional full rows.
  type RowAlloc = { plant: string; plants: number; spacingIn: number };
  const layout: RowAlloc[][] = []; // rows of allocations
  for (const n of needs) {
    let remaining = n.plantsNeeded;
    // First try to fit a partial block in the currently-open last row
    while (remaining > 0) {
      // try to slot into last row
      const last = layout[layout.length - 1];
      const usedIn = last ? last.reduce((s, a) => s + a.plants * a.spacingIn, 0) : Infinity;
      const free = last ? rowIn - usedIn : 0;
      const fitsHere = Math.max(0, Math.floor(free / n.spacingIn));
      if (last && fitsHere > 0 && remaining > 0) {
        const place = Math.min(fitsHere, remaining);
        last.push({ plant: n.name, plants: place, spacingIn: n.spacingIn });
        remaining -= place;
        if (remaining === 0) break;
      }
      // open a new row
      const perRow = Math.max(1, Math.floor(rowIn / n.spacingIn));
      const place = Math.min(perRow, remaining);
      layout.push([{ plant: n.name, plants: place, spacingIn: n.spacingIn }]);
      remaining -= place;
    }
  }

  const totalRows = layout.length;
  const totalLinearFt = needs.reduce((s, n) => s + n.linearFt, 0);
  const totalPlants = needs.reduce((s, n) => s + n.plantsNeeded, 0);

  const layoutLines = layout.map((row, idx) => {
    const label = `Row${pad(idx + 1)}`;
    const blocks = row
      .map((a) => `${a.plant} ×${a.plants} (${fmt((a.plants * a.spacingIn) / 12, 1)} ft)`)
      .join("  •  ");
    const usedIn = row.reduce((s, a) => s + a.plants * a.spacingIn, 0);
    const usedFt = usedIn / 12;
    return `**${label}** [${fmt(usedFt, 1)} / ${rowFt} ft]: ${blocks}`;
  });

  const md = [
    `# Optimized Garden Layout`,
    ``,
    `*Generated ${i.generatedAt.slice(0, 10)} — sized to meet the Yearly Food Plan.*`,
    ``,
    `## Assumptions`,
    ``,
    `- Row length: **${rowFt} ft** (${rowIn} in)`,
    `- In-row spacing per plant: from reference table below (default ${DEFAULT_SPACING} in)`,
    `- Yield per plant: from reference table below (default ${DEFAULT_YIELD} lb)`,
    `- Annual demand: weekly oz × 52 ÷ 16`,
    ``,
    `## Summary`,
    ``,
    `- **Plants required:** ${totalPlants}`,
    `- **Linear row-feet required:** ${fmt(totalLinearFt)} ft`,
    `- **Rows required (${rowFt} ft each):** ${totalRows}`,
    ``,
    `## Plant Requirements`,
    ``,
    needs.length
      ? mdTable(
          ["Plant", "Annual lbs", "Yield/plant", "Spacing (in)", "Plants needed", "Plants/row", "Rows needed", "Linear ft"],
          needs.map((n) => [n.name, fmt(n.annualLbs), fmt(n.yieldPerPlant, 2), n.spacingIn, n.plantsNeeded, n.plantsPerRow, n.rowsNeeded, fmt(n.linearFt)]),
        )
      : "_No garden-classified foods in the food plan._",
    ``,
    `## Proposed Layout`,
    ``,
    layoutLines.length ? layoutLines.join("\n\n") : "_Nothing to plant._",
    ``,
  ].join("\n");

  // CSV rows: one row per plant block in the layout
  const csvRows: Record<string, string | number>[] = [];
  layout.forEach((row, idx) => {
    row.forEach((a) => {
      csvRows.push({
        row: `Row${pad(idx + 1)}`,
        plant: a.plant,
        plants: a.plants,
        spacing_in: a.spacingIn,
        feet_used: ((a.plants * a.spacingIn) / 12).toFixed(2),
      });
    });
  });

  return {
    slug: "optimized-garden-layout",
    title: "Optimized Garden Layout",
    description: `Layout sized to the Yearly Food Plan, assuming ${rowFt}-ft rows.`,
    markdown: md,
    csvColumns: [
      { key: "row", label: "Row" },
      { key: "plant", label: "Plant" },
      { key: "plants", label: "Plants" },
      { key: "spacing_in", label: "Spacing (in)" },
      { key: "feet_used", label: "Feet used" },
    ],
    csvRows,
    obsidianPath: "27 Food Production/Reports/Optimized Garden Layout.md",
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildAllReports(inputs: ReportInputs): FoodReport[] {
  return [
    buildYearlyFoodPlan(inputs),
    buildStoragePlan(inputs),
    buildHarvestReport(inputs),
    buildGardenLayout(inputs),
    buildOptimizedGardenLayout(inputs),
  ];
}

export function reportCsv(report: FoodReport): string {
  return rowsToCsv(report.csvRows, report.csvColumns);
}

export function reportMarkdownFile(report: FoodReport): string {
  const meta = [
    `---`,
    `bostead:`,
    `  kind: food_report`,
    `  slug: ${report.slug}`,
    `title: ${JSON.stringify(report.title)}`,
    `---`,
    ``,
  ].join("\n");
  return meta + report.markdown;
}
