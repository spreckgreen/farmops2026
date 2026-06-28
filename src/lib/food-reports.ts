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
  | "optimized-garden-layout"
  | "weather-pattern-season";


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

// Word-boundary match so e.g. "pea" does not match "peanut", and
// "bean" does not match "beanie". Multi-word keys like "summer squash"
// are matched as a phrase.
function matchesKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function lookup<T>(table: Record<string, T>, name: string, fallback: T): T {
  const k = norm(name);
  if (!k) return fallback;
  if (table[k] !== undefined) return table[k];
  for (const [key, val] of Object.entries(table)) {
    if (matchesKeyword(k, key)) return val;
  }
  return fallback;
}

export function yieldFor(name: string): number {
  return lookup(YIELD_PER_PLANT_LBS, name, DEFAULT_YIELD);
}

export function spacingFor(name: string): number {
  return lookup(IN_ROW_SPACING_IN, name, DEFAULT_SPACING);
}

// Foods that should never be treated as garden plants even if a substring
// would match (e.g. "peanut butter" — peanut is a legume but here it's the
// orchard/pantry product, not a garden crop).
const NON_GARDEN_OVERRIDES = ["peanut butter", "peanut", "nut butter"];

const GARDEN_KEYWORDS = Object.keys(YIELD_PER_PLANT_LBS);
export function isGardenPlant(name: string): boolean {
  const k = norm(name);
  if (!k) return false;
  if (NON_GARDEN_OVERRIDES.some((o) => k.includes(o))) return false;
  return GARDEN_KEYWORDS.some((g) => matchesKeyword(k, g));
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
  weather?: Array<{
    forecast_date: string;
    high_temp_f: number | null;
    low_temp_f: number | null;
    conditions: string | null;
    precip_probability: number | null;
    precip_type: string | null;
  }>;
  rowLengthFt?: number;
  seasonYear?: number; // when set, the weather report renders only this season
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
// 6. Weather Pattern for Season
//    Growing season = (LAST_SPRING_FROST - 1 month) through
//                     (FIRST_FALL_FROST + 1 month), labeled by the year of
//                     the fall frost.
// ---------------------------------------------------------------------------

// Configurable frost dates (MM-DD). Tweak here if the farmhouse zone shifts.
export const LAST_SPRING_FROST_MMDD = "04-15";
export const FIRST_FALL_FROST_MMDD = "10-15";

// Configurable temperature thresholds for what counts as a "growing day".
// A day is counted when its observed low > MIN_LOW_F and high < MAX_HIGH_F.
// Days inside the season window with no observation are *estimated* —
// assumed to be growing days (since they sit between expected frost dates).
export const GROWING_DAY_MIN_LOW_F = 40;   // frost-risk cutoff
export const GROWING_DAY_MAX_HIGH_F = 95;  // heat-stress cutoff

function isGrowingDay(high: number | null, low: number | null): boolean {
  if (high == null || low == null) return false;
  return low > GROWING_DAY_MIN_LOW_F && high < GROWING_DAY_MAX_HIGH_F;
}


function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

type SeasonWindow = {
  year: number;
  start: Date;       // 1 month before last spring frost
  lastFrost: Date;   // last spring frost
  firstFrost: Date;  // first fall frost
  end: Date;         // 1 month after first fall frost
};

function seasonForYear(year: number): SeasonWindow {
  const [lsm, lsd] = LAST_SPRING_FROST_MMDD.split("-").map(Number);
  const [ffm, ffd] = FIRST_FALL_FROST_MMDD.split("-").map(Number);
  const lastFrost = new Date(Date.UTC(year, lsm - 1, lsd));
  const firstFrost = new Date(Date.UTC(year, ffm - 1, ffd));
  return {
    year,
    start: addMonths(lastFrost, -1),
    lastFrost,
    firstFrost,
    end: addMonths(firstFrost, 1),
  };
}

function buildWeatherPatternForSeason(i: ReportInputs): FoodReport {
  const weather = (i.weather ?? []).slice().sort((a, b) => a.forecast_date.localeCompare(b.forecast_date));
  const today = new Date(i.generatedAt.slice(0, 10) + "T00:00:00Z");

  // Determine the set of years to render: any year that has weather data
  // within its season window, plus the current year.
  const years = new Set<number>([today.getUTCFullYear()]);
  for (const w of weather) {
    const y = Number(w.forecast_date.slice(0, 4));
    if (Number.isFinite(y)) {
      years.add(y);
      // Weather in Jan-Feb may belong to previous fall's growing season tail
      // — handled naturally because each season window is keyed by the
      // fall-frost year, which equals the start year here.
    }
  }

  type SeasonStats = {
    season: SeasonWindow;
    inWindow: typeof weather;
    daysCaptured: number;
    totalSeasonDays: number;
    observedGrowingDays: number;     // observations meeting thresholds
    observedNonGrowingDays: number;  // observations failing thresholds
    estimatedGrowingDays: number;    // unobserved days inside the window (assumed)
    totalGrowingDays: number;        // observed + estimated
    confidencePct: number;           // observed / total season days * 100
    avgHigh: number | null;
    avgLow: number | null;
    minLow: number | null;
    maxHigh: number | null;
    precipDays: number;
    isCurrent: boolean;
    dayOfSeason: number | null; // null if outside the window
    elapsedDays: number;        // days from season start through today (or full season if past)
  };

  const stats: SeasonStats[] = Array.from(years)
    .sort((a, b) => b - a) // newest first
    .map((year) => {
      const season = seasonForYear(year);
      const inWindow = weather.filter(
        (w) => w.forecast_date >= ymd(season.start) && w.forecast_date <= ymd(season.end),
      );
      const totalSeasonDays = daysBetween(season.start, season.end) + 1;
      const highs = inWindow.map((w) => Number(w.high_temp_f)).filter((n) => Number.isFinite(n));
      const lows = inWindow.map((w) => Number(w.low_temp_f)).filter((n) => Number.isFinite(n));
      const precipDays = inWindow.filter(
        (w) => Number(w.precip_probability ?? 0) >= 50 || (w.precip_type && w.precip_type !== "none"),
      ).length;
      const isCurrent = today >= season.start && today <= season.end;
      const dayOfSeason = isCurrent ? daysBetween(season.start, today) + 1 : null;
      const elapsedDays = isCurrent
        ? Math.min(totalSeasonDays, daysBetween(season.start, today) + 1)
        : today > season.end
          ? totalSeasonDays
          : 0;

      let observedGrowingDays = 0;
      let observedNonGrowingDays = 0;
      for (const w of inWindow) {
        if (isGrowingDay(
          w.high_temp_f != null ? Number(w.high_temp_f) : null,
          w.low_temp_f != null ? Number(w.low_temp_f) : null,
        )) observedGrowingDays += 1;
        else observedNonGrowingDays += 1;
      }
      // Estimated = elapsed days minus what we actually observed.
      // Assumption: unobserved days within the frost-bracketed window are
      // treated as growing days.
      const estimatedGrowingDays = Math.max(0, elapsedDays - inWindow.length);
      const totalGrowingDays = observedGrowingDays + estimatedGrowingDays;
      const confidencePct = elapsedDays > 0
        ? Math.round((inWindow.length / elapsedDays) * 100)
        : 0;

      return {
        season,
        inWindow,
        daysCaptured: inWindow.length,
        totalSeasonDays,
        observedGrowingDays,
        observedNonGrowingDays,
        estimatedGrowingDays,
        totalGrowingDays,
        confidencePct,
        avgHigh: highs.length ? highs.reduce((s, n) => s + n, 0) / highs.length : null,
        avgLow: lows.length ? lows.reduce((s, n) => s + n, 0) / lows.length : null,
        minLow: lows.length ? Math.min(...lows) : null,
        maxHigh: highs.length ? Math.max(...highs) : null,
        precipDays,
        isCurrent,
        dayOfSeason,
        elapsedDays,
      };
    });

  const current = stats.find((s) => s.isCurrent);

  const lines: string[] = [
    `# Weather Pattern for Season`,
    ``,
    `*Generated ${i.generatedAt.slice(0, 10)} — station BosteadFarmHouse (119722)*`,
    ``,
    `## Season Definition`,
    ``,
    `- **Start:** 1 month before last spring frost (${LAST_SPRING_FROST_MMDD})`,
    `- **End:** 1 month after first fall frost (${FIRST_FALL_FROST_MMDD})`,
    `- Seasons are labeled by year of the fall frost.`,
    ``,
    `## Growing-Day Rule`,
    ``,
    `- A day is counted as a **growing day** when observed **low > ${GROWING_DAY_MIN_LOW_F}°F** and **high < ${GROWING_DAY_MAX_HIGH_F}°F**.`,
    `- Days inside the window with **no captured observation** are **estimated** as growing days (assumed frost-free between expected frost dates).`,
    `- Confidence = captured observations ÷ elapsed season days.`,
    ``,
  ];

  if (current) {
    const pct = current.totalSeasonDays
      ? Math.round((current.daysCaptured / current.totalSeasonDays) * 100)
      : 0;
    lines.push(
      `## Current Season — ${current.season.year}`,
      ``,
      `- **Window:** ${ymd(current.season.start)} → ${ymd(current.season.end)} (${current.totalSeasonDays} days)`,
      `- **Day of season:** ${current.dayOfSeason} of ${current.totalSeasonDays}`,
      `- **Weather days captured:** ${current.daysCaptured} (${pct}% of season)`,
      `- **Growing days so far:** ${current.totalGrowingDays} (${current.observedGrowingDays} observed + ${current.estimatedGrowingDays} estimated)`,
      `- **Non-growing observations:** ${current.observedNonGrowingDays} (failed low/high thresholds)`,
      `- **Estimated days remaining:** ${Math.max(0, current.totalSeasonDays - (current.dayOfSeason ?? 0))}`,
      `- **Confidence:** ${current.confidencePct}% of elapsed days have captured weather data.`,
      current.avgHigh != null
        ? `- **Avg high so far:** ${fmt(current.avgHigh, 1)}°F · **Avg low:** ${fmt(current.avgLow ?? 0, 1)}°F`
        : `- _No weather samples captured yet — totals are 100% estimated._`,
      current.maxHigh != null
        ? `- **Max high:** ${fmt(current.maxHigh, 0)}°F · **Min low:** ${fmt(current.minLow ?? 0, 0)}°F · **Wet days:** ${current.precipDays}`
        : ``,
      ``,
    );
  }

  const past = stats.filter((s) => !s.isCurrent && s.season.end < today);
  if (past.length) {
    lines.push(
      `## Previous Seasons`,
      ``,
      mdTable(
        ["Season", "Window", "Total days", "Captured", "Growing (obs)", "Growing (est)", "Total growing", "Confidence", "Avg high", "Avg low", "Wet days"],
        past.map((s) => [
          s.season.year,
          `${ymd(s.season.start)} → ${ymd(s.season.end)}`,
          s.totalSeasonDays,
          s.daysCaptured,
          s.observedGrowingDays,
          s.estimatedGrowingDays,
          s.totalGrowingDays,
          `${s.confidencePct}%`,
          s.avgHigh != null ? fmt(s.avgHigh, 1) : "—",
          s.avgLow != null ? fmt(s.avgLow, 1) : "—",
          s.precipDays,
        ]),
      ),
      ``,
      `_Estimated growing days assume any uncaptured day within the frost-bracketed window was a growing day. Lower confidence = more reliance on that assumption._`,
      ``,
    );
  } else if (!current) {
    lines.push(`_No weather data recorded yet for any growing season._`, ``);
  }

  // Future seasons — summary-only estimation (no daily log, no observations yet).
  const future = stats.filter((s) => !s.isCurrent && s.season.start > today);
  if (future.length) {
    lines.push(
      `## Future Seasons (Estimated)`,
      ``,
      mdTable(
        ["Season", "Window", "Total days", "Estimated growing days"],
        future.map((s) => [
          s.season.year,
          `${ymd(s.season.start)} → ${ymd(s.season.end)}`,
          s.totalSeasonDays,
          s.totalSeasonDays,
        ]),
      ),
      ``,
      `_Future seasons have no captured weather yet. Estimated growing days assume the full frost-bracketed window is frost-free. No daily log is shown until observations exist._`,
      ``,
    );
  }

  // Detailed daily log for each season with data (skip future seasons).
  for (const s of stats) {
    if (s.daysCaptured === 0) continue;
    if (s.season.start > today) continue;
    lines.push(
      `## ${s.season.year} Daily Log`,
      ``,
      mdTable(
        ["Date", "High °F", "Low °F", "Growing?", "Conditions", "Precip %"],
        s.inWindow.map((w) => {
          const grow = isGrowingDay(
            w.high_temp_f != null ? Number(w.high_temp_f) : null,
            w.low_temp_f != null ? Number(w.low_temp_f) : null,
          );
          return [
            w.forecast_date,
            w.high_temp_f != null ? fmt(Number(w.high_temp_f), 0) : "—",
            w.low_temp_f != null ? fmt(Number(w.low_temp_f), 0) : "—",
            grow ? "✓" : "✗",
            (w.conditions ?? "").replace(/\|/g, "\\|"),
            w.precip_probability != null ? fmt(Number(w.precip_probability), 0) : "—",
          ];
        }),
      ),
      ``,
    );
  }



  const csvRows: Record<string, string | number>[] = [];
  for (const s of stats) {
    for (const w of s.inWindow) {
      const grow = isGrowingDay(
        w.high_temp_f != null ? Number(w.high_temp_f) : null,
        w.low_temp_f != null ? Number(w.low_temp_f) : null,
      );
      csvRows.push({
        season_year: s.season.year,
        date: w.forecast_date,
        high_f: w.high_temp_f ?? "",
        low_f: w.low_temp_f ?? "",
        growing_day: grow ? "yes" : "no",
        conditions: w.conditions ?? "",
        precip_probability: w.precip_probability ?? "",
        precip_type: w.precip_type ?? "",
      });
    }
  }

  return {
    slug: "weather-pattern-season",
    title: "Weather Pattern for Season",
    description:
      "Per-year growing season weather (1 month before last spring frost through 1 month after first fall frost).",
    markdown: lines.join("\n"),
    csvColumns: [
      { key: "season_year", label: "Season year" },
      { key: "date", label: "Date" },
      { key: "high_f", label: "High °F" },
      { key: "low_f", label: "Low °F" },
      { key: "growing_day", label: "Growing day" },
      { key: "conditions", label: "Conditions" },
      { key: "precip_probability", label: "Precip %" },
      { key: "precip_type", label: "Precip type" },
    ],

    csvRows,
    obsidianPath: "27 Food Production/Reports/Weather Pattern for Season.md",
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
    buildWeatherPatternForSeason(inputs),
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
