// Preservation Coach: given a harvest batch, recommend method + yields + procedure.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Deterministic yield table (per 7-quart canner load, sensible defaults)
// -----------------------------------------------------------------------------
type YieldRow = {
  /** lbs of raw produce → 7 quart jars (canner load) */
  lbsPer7Qt: number;
  /** lbs per 1-quart freezer bag */
  lbsPerFreezerQt: number;
  /** shrink ratio for dehydration (raw:dry) */
  dehydrateRatio: number;
  /** approx grams/unit for count-based inputs (e.g. per apple) */
  gramsPerCount?: number;
};

const YIELDS: Record<string, YieldRow> = {
  tomato:     { lbsPer7Qt: 21, lbsPerFreezerQt: 1.5, dehydrateRatio: 12, gramsPerCount: 150 },
  green_bean: { lbsPer7Qt: 14, lbsPerFreezerQt: 1.5, dehydrateRatio: 10 },
  bean:       { lbsPer7Qt: 14, lbsPerFreezerQt: 1.5, dehydrateRatio: 10 },
  corn:       { lbsPer7Qt: 20, lbsPerFreezerQt: 2.0, dehydrateRatio: 6, gramsPerCount: 250 },
  apple:      { lbsPer7Qt: 19, lbsPerFreezerQt: 1.5, dehydrateRatio: 8, gramsPerCount: 180 },
  pear:       { lbsPer7Qt: 17, lbsPerFreezerQt: 1.5, dehydrateRatio: 8, gramsPerCount: 180 },
  peach:      { lbsPer7Qt: 17, lbsPerFreezerQt: 1.5, dehydrateRatio: 8, gramsPerCount: 150 },
  berry:      { lbsPer7Qt: 12, lbsPerFreezerQt: 1.5, dehydrateRatio: 6 },
  strawberry: { lbsPer7Qt: 12, lbsPerFreezerQt: 1.5, dehydrateRatio: 8 },
  blueberry:  { lbsPer7Qt: 12, lbsPerFreezerQt: 1.5, dehydrateRatio: 6 },
  squash:     { lbsPer7Qt: 16, lbsPerFreezerQt: 1.5, dehydrateRatio: 10, gramsPerCount: 900 },
  zucchini:   { lbsPer7Qt: 16, lbsPerFreezerQt: 1.5, dehydrateRatio: 12, gramsPerCount: 300 },
  cucumber:   { lbsPer7Qt: 14, lbsPerFreezerQt: 1.5, dehydrateRatio: 15, gramsPerCount: 300 },
  pepper:     { lbsPer7Qt: 14, lbsPerFreezerQt: 1.5, dehydrateRatio: 10, gramsPerCount: 150 },
  carrot:     { lbsPer7Qt: 17, lbsPerFreezerQt: 1.5, dehydrateRatio: 10, gramsPerCount: 70 },
  potato:     { lbsPer7Qt: 20, lbsPerFreezerQt: 2.0, dehydrateRatio: 6, gramsPerCount: 200 },
  onion:      { lbsPer7Qt: 14, lbsPerFreezerQt: 1.5, dehydrateRatio: 10, gramsPerCount: 150 },
  cabbage:    { lbsPer7Qt: 25, lbsPerFreezerQt: 1.5, dehydrateRatio: 12, gramsPerCount: 900 },
  herb:       { lbsPer7Qt: 8,  lbsPerFreezerQt: 0.5, dehydrateRatio: 8 },
  default:    { lbsPer7Qt: 18, lbsPerFreezerQt: 1.5, dehydrateRatio: 10 },
};

// Low-acid crops MUST NOT be water-bath canned (USDA / NCHFP safety).
const LOW_ACID = new Set([
  "green_bean", "bean", "corn", "squash", "zucchini", "carrot",
  "potato", "onion", "pepper", "cabbage",
]);

// Best default method by crop family.
const DEFAULT_METHOD: Record<string, Method> = {
  tomato: "can_water_bath",
  apple: "can_water_bath",
  pear: "can_water_bath",
  peach: "can_water_bath",
  berry: "freeze",
  strawberry: "freeze",
  blueberry: "freeze",
  green_bean: "can_pressure",
  bean: "can_pressure",
  corn: "freeze",
  squash: "freeze",
  zucchini: "freeze",
  cucumber: "ferment",
  pepper: "freeze",
  carrot: "cold_store",
  potato: "cold_store",
  onion: "cold_store",
  cabbage: "ferment",
  herb: "dehydrate",
};

const SHELF_MONTHS: Record<Method, number> = {
  can_water_bath: 18,
  can_pressure: 18,
  freeze: 10,
  dehydrate: 12,
  ferment: 6,
  cold_store: 4,
};

const METHOD_LABEL: Record<Method, string> = {
  can_water_bath: "Water-bath canning",
  can_pressure: "Pressure canning",
  freeze: "Freeze",
  dehydrate: "Dehydrate",
  ferment: "Ferment",
  cold_store: "Cold storage",
};

export type Method =
  | "can_water_bath"
  | "can_pressure"
  | "freeze"
  | "dehydrate"
  | "ferment"
  | "cold_store";

export interface Yields {
  inputLbs: number;
  quartJars: number;
  pintJars: number;
  freezerQtBags: number;
  dehydratedOz: number;
}

export interface PreservationRecommendation {
  crop: string;
  cropKey: string;
  variety: string | null;
  primaryMethod: Method;
  primaryMethodLabel: string;
  rationale: string;
  isLowAcid: boolean;
  safetyNotes: string[];
  alternates: { method: Method; label: string; rationale: string }[];
  yields: Yields;
  procedure: { id: string; name: string; slug: string } | null;
  candidatesConsidered: string[];
  storageSuggestion: {
    name: string;
    category: string;
    food_type: string;
    unit: string;
    quantity: number;
    best_by_months: number;
  };
  targetShelfMonths: number;
  model: string;
  latencyMs: number;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function normalizeCrop(s: string): string {
  const t = s.trim().toLowerCase();
  if (!t) return "default";
  // singularize a few common plurals
  const singular = t.replace(/ies$/, "y").replace(/es$/, "").replace(/s$/, "");
  const collapsed = singular.replace(/\s+/g, "_");
  if (YIELDS[collapsed]) return collapsed;
  // family match
  for (const key of Object.keys(YIELDS)) {
    if (key !== "default" && collapsed.includes(key)) return key;
  }
  if (collapsed.includes("tomato")) return "tomato";
  if (collapsed.includes("bean")) return "bean";
  if (collapsed.includes("berry")) return "berry";
  if (collapsed.includes("herb") || collapsed.includes("basil") || collapsed.includes("mint") ||
      collapsed.includes("thyme") || collapsed.includes("oregano")) return "herb";
  return "default";
}

function toLbs(quantity: number, unit: string, cropKey: string): number {
  const u = unit.trim().toLowerCase();
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return quantity;
  if (u === "oz" || u === "ounce" || u === "ounces") return quantity / 16;
  if (u === "kg" || u === "kilogram" || u === "kilograms") return quantity * 2.2046;
  if (u === "g" || u === "gram" || u === "grams") return (quantity / 1000) * 2.2046;
  if (u === "bushel" || u === "bushels" || u === "bu") return quantity * 50; // rough avg
  if (u === "peck" || u === "pecks") return quantity * 12.5;
  if (u === "quart" || u === "quarts" || u === "qt") return quantity * 2; // ~2 lb produce per qt
  if (u === "pint" || u === "pints" || u === "pt") return quantity * 1;
  if (u === "gallon" || u === "gallons" || u === "gal") return quantity * 8;
  // count-based
  if (u === "count" || u === "each" || u === "ea" || u === "" || u === "unit" || u === "units") {
    const g = YIELDS[cropKey]?.gramsPerCount ?? YIELDS.default.gramsPerCount ?? 150;
    return (quantity * g / 1000) * 2.2046;
  }
  return quantity; // assume lbs if unknown
}

function computeYields(inputLbs: number, cropKey: string): Yields {
  const y = YIELDS[cropKey] ?? YIELDS.default;
  const quartJars = Math.floor((inputLbs / y.lbsPer7Qt) * 7);
  const pintJars = quartJars * 2;
  const freezerQtBags = Math.floor(inputLbs / y.lbsPerFreezerQt);
  const dehydratedOz = Math.round((inputLbs * 16) / y.dehydrateRatio);
  return {
    inputLbs: Math.round(inputLbs * 10) / 10,
    quartJars,
    pintJars,
    freezerQtBags,
    dehydratedOz,
  };
}

function stripToText(html: string): string {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankProcedures(
  query: string,
  procs: { id: string; name: string; slug: string; text: string }[],
): { id: string; name: string; slug: string; text: string; score: number }[] {
  const q = query.toLowerCase();
  const terms = Array.from(new Set(q.match(/[a-z0-9]{3,}/g) ?? []));
  return procs
    .map((p) => {
      const hay = `${p.name} ${p.text}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
        const m = hay.match(re);
        if (m) score += m.length;
      }
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score);
}

// -----------------------------------------------------------------------------
// Server functions
// -----------------------------------------------------------------------------

const RecommendInput = z.object({
  crop: z.string().trim().min(1).max(100),
  variety: z.string().trim().max(100).nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(50),
  targetShelfMonths: z.number().int().min(1).max(60).nullable().optional(),
  harvestId: z.string().uuid().nullable().optional(),
});

export const recommendPreservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RecommendInput.parse(d))
  .handler(async ({ data, context }): Promise<PreservationRecommendation> => {
    const { supabase, userId } = context;
    const started = Date.now();

    const cropKey = normalizeCrop(data.crop);
    const inputLbs = toLbs(data.quantity, data.unit, cropKey);
    const yields = computeYields(inputLbs, cropKey);
    const isLowAcid = LOW_ACID.has(cropKey);
    const targetShelfMonths = data.targetShelfMonths ?? 12;

    // Load procedures for candidate matching
    const { data: procRows, error: procErr } = await supabase
      .from("procedures")
      .select("id, name, content")
      .eq("user_id", userId);
    if (procErr) throw new Error(procErr.message);

    const procs = (procRows ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      text: stripToText(String(r.content ?? "")).slice(0, 800),
    }));

    const query = `${data.crop} ${data.variety ?? ""} preserve can freeze dehydrate ferment`;
    const ranked = rankProcedures(query, procs).slice(0, 12);
    const candidatePool = ranked.filter((p) => p.score > 0).length > 0
      ? ranked.filter((p) => p.score > 0)
      : ranked;

    // Deterministic default
    let primaryMethod: Method = DEFAULT_METHOD[cropKey] ?? "freeze";
    let rationale = `${METHOD_LABEL[primaryMethod]} is the standard preservation for ${data.crop}.`;
    const safetyNotes: string[] = [];
    if (isLowAcid) {
      safetyNotes.push(
        "Low-acid crop — never water-bath can. Use a pressure canner or freeze.",
      );
      if (primaryMethod === "can_water_bath") primaryMethod = "can_pressure";
    }

    // Try AI enrichment (procedure match + refined rationale). Guarded — fall back on failure.
    let procedure: { id: string; name: string; slug: string } | null = null;
    let alternates: { method: Method; label: string; rationale: string }[] = [];
    let modelId = "deterministic";

    try {
      const { createAiProvider } = await import("./ai-gateway.server");
      const { provider, modelOverride } = await createAiProvider();
      modelId = modelOverride ?? "google/gemini-3.6-flash";
      const { generateText, Output, NoObjectGeneratedError } = await import("ai");

      const schema = z.object({
        primary_method: z.enum([
          "can_water_bath", "can_pressure", "freeze", "dehydrate", "ferment", "cold_store",
        ]),
        rationale: z.string(),
        procedure_id: z.string().nullable(),
        alternates: z.array(
          z.object({
            method: z.enum([
              "can_water_bath", "can_pressure", "freeze", "dehydrate", "ferment", "cold_store",
            ]),
            rationale: z.string(),
          }),
        ),
        extra_safety_notes: z.array(z.string()),
      });

      const proceduresBlock = candidatePool
        .slice(0, 12)
        .map((p) => `### ${p.name} (id:${p.id})\n${p.text.slice(0, 300)}`)
        .join("\n\n");

      try {
        const { output } = await generateText({
          model: provider(modelId),
          output: Output.object({ schema }),
          system:
            "You are a home food-preservation coach. Return structured JSON. Rules: " +
            "(1) primary_method must be safe for the crop — NEVER water-bath can low-acid crops " +
            "(beans, corn, squash, carrots, potatoes, onions, peppers, cabbage). " +
            "(2) procedure_id MUST be one of the provided procedure ids, or null if none clearly matches. " +
            "(3) rationale is one short sentence. (4) alternates has at most 2 entries. " +
            "(5) extra_safety_notes has at most 3 short entries.",
          prompt:
            `CROP: ${data.crop}${data.variety ? ` (${data.variety})` : ""}\n` +
            `QUANTITY: ${data.quantity} ${data.unit} (≈ ${yields.inputLbs} lbs)\n` +
            `LOW_ACID: ${isLowAcid ? "yes" : "no"}\n` +
            `TARGET_SHELF_MONTHS: ${targetShelfMonths}\n` +
            `DEFAULT_METHOD: ${primaryMethod}\n\n` +
            `PROCEDURES:\n${proceduresBlock || "(none)"}`,
        });

        const validIds = new Set(candidatePool.map((p) => p.id));
        // Safety guard: never let the model pick water-bath for low-acid.
        if (!(isLowAcid && output.primary_method === "can_water_bath")) {
          primaryMethod = output.primary_method;
        }
        rationale = output.rationale.slice(0, 300);
        if (output.procedure_id && validIds.has(output.procedure_id)) {
          const p = candidatePool.find((x) => x.id === output.procedure_id)!;
          procedure = { id: p.id, name: p.name, slug: p.slug };
        }
        alternates = (output.alternates ?? [])
          .filter((a) => !(isLowAcid && a.method === "can_water_bath"))
          .filter((a) => a.method !== primaryMethod)
          .slice(0, 2)
          .map((a) => ({
            method: a.method,
            label: METHOD_LABEL[a.method],
            rationale: a.rationale.slice(0, 200),
          }));
        for (const n of (output.extra_safety_notes ?? []).slice(0, 3)) {
          if (n && n.length < 300) safetyNotes.push(n);
        }
      } catch (err) {
        if (!NoObjectGeneratedError.isInstance(err)) {
          // non-schema error: swallow, keep deterministic result
          // eslint-disable-next-line no-console
          console.warn("[preservation-coach] AI call failed:", err);
        }
      }
    } catch {
      // provider unavailable — deterministic result stands
    }

    // Fallback: pick top-ranked procedure if AI didn't set one
    if (!procedure && candidatePool.length > 0 && candidatePool[0].score > 0) {
      const p = candidatePool[0];
      procedure = { id: p.id, name: p.name, slug: p.slug };
    }

    // Build storage suggestion
    const jarCount = yields.quartJars || yields.pintJars || 0;
    let storageQty = 0;
    let storageUnit = "lb";
    if (primaryMethod === "can_water_bath" || primaryMethod === "can_pressure" || primaryMethod === "ferment") {
      storageQty = yields.quartJars || 0;
      storageUnit = "quart jars";
    } else if (primaryMethod === "freeze") {
      storageQty = yields.freezerQtBags || 0;
      storageUnit = "quart bags";
    } else if (primaryMethod === "dehydrate") {
      storageQty = yields.dehydratedOz || 0;
      storageUnit = "oz";
    } else {
      storageQty = Math.round(yields.inputLbs);
      storageUnit = "lb";
    }
    if (storageQty === 0) storageQty = jarCount || Math.max(1, Math.round(yields.inputLbs));

    const bestByMonths = Math.min(
      SHELF_MONTHS[primaryMethod],
      Math.max(targetShelfMonths, 1),
    );

    return {
      crop: data.crop,
      cropKey,
      variety: data.variety ?? null,
      primaryMethod,
      primaryMethodLabel: METHOD_LABEL[primaryMethod],
      rationale,
      isLowAcid,
      safetyNotes,
      alternates,
      yields,
      procedure,
      candidatesConsidered: candidatePool.slice(0, 12).map((p) => p.name),
      storageSuggestion: {
        name: `${data.crop}${data.variety ? ` (${data.variety})` : ""} — ${METHOD_LABEL[primaryMethod]}`,
        category: "preserved",
        food_type: cropKey,
        unit: storageUnit,
        quantity: storageQty,
        best_by_months: bestByMonths,
      },
      targetShelfMonths,
      model: modelId,
      latencyMs: Date.now() - started,
    };
  });

// -----------------------------------------------------------------------------
// Log a preserved batch into food_storage_items
// -----------------------------------------------------------------------------
const LogInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100),
  food_type: z.string().trim().max(100),
  unit: z.string().trim().max(50),
  quantity: z.number().nonnegative(),
  best_by_months: z.number().int().min(1).max(60),
  method: z.string().trim().max(50),
  crop: z.string().trim().max(100),
  variety: z.string().trim().max(100).nullable().optional(),
  harvest_id: z.string().uuid().nullable().optional(),
});

export const logPreservationBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LogInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const today = new Date();
    const bestBy = new Date(today);
    bestBy.setMonth(bestBy.getMonth() + data.best_by_months);

    const noteLines = [
      `preservation:${data.method}`,
      `crop:${data.crop}`,
    ];
    if (data.variety) noteLines.push(`variety:${data.variety}`);
    if (data.harvest_id) noteLines.push(`harvest_id:${data.harvest_id}`);

    const row = {
      user_id: userId,
      name: data.name,
      category: data.category,
      food_type: data.food_type,
      quantity: data.quantity,
      unit: data.unit,
      acquired_on: today.toISOString().slice(0, 10),
      best_by: bestBy.toISOString().slice(0, 10),
      status: "available",
      notes: noteLines.join("\n"),
    };

    const { data: inserted, error } = await supabase
      .from("food_storage_items")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

// -----------------------------------------------------------------------------
// List recent preservation batches
// -----------------------------------------------------------------------------
export const listRecentPreservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("food_storage_items")
      .select("id, name, category, food_type, quantity, unit, acquired_on, best_by, notes")
      .eq("user_id", context.userId)
      .like("notes", "preservation:%")
      .order("acquired_on", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -----------------------------------------------------------------------------
// Fetch a harvest for prefill (crop, quantity, unit, variety)
// -----------------------------------------------------------------------------
export const getHarvestForPreservation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: h, error } = await context.supabase
      .from("crop_harvests")
      .select("id, quantity, unit, harvested_on, planting_id, crop_plantings(crop, variety)")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!h) return null;
    const planting = Array.isArray(h.crop_plantings) ? h.crop_plantings[0] : h.crop_plantings;
    return {
      id: String(h.id),
      quantity: Number(h.quantity),
      unit: String(h.unit),
      harvested_on: h.harvested_on as string,
      crop: (planting as { crop?: string } | null)?.crop ?? "",
      variety: (planting as { variety?: string | null } | null)?.variety ?? null,
    };
  });
