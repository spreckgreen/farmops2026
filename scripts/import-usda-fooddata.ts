#!/usr/bin/env bun
/**
 * Import an official FoodData Central JSON download into FarmOps's local cache.
 *
 * Usage:
 *   bun scripts/import-usda-fooddata.ts /path/to/FoodData_Central_foundation_food_json.json 2026-04
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The import is idempotent
 * by fdc_id and never creates or changes a user's approved nutrient profile.
 */
import { createClient } from "@supabase/supabase-js";
import { extractFoodsFromDownload, normalizeUsdaFood } from "../src/lib/usda-fooddata";

const [filePath, sourceRelease] = process.argv.slice(2);
if (!filePath || !sourceRelease) {
  console.error(
    "Usage: bun scripts/import-usda-fooddata.ts <USDA JSON file> <release, e.g. 2026-04>",
  );
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}

const source = Bun.file(filePath);
if (!(await source.exists())) {
  console.error(`File not found: ${filePath}`);
  process.exit(2);
}

console.log(`[usda-import] Reading ${filePath}`);
const records = extractFoodsFromDownload(await source.json());
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const importedAt = new Date().toISOString();
const chunkSize = 250;
let imported = 0;

for (let offset = 0; offset < records.length; offset += chunkSize) {
  const rows = records.slice(offset, offset + chunkSize).map((record) => {
    const food = normalizeUsdaFood(record);
    return {
      fdc_id: food.fdcId,
      description: food.description,
      data_type: food.dataType,
      food_category: food.foodCategory,
      publication_date: food.publicationDate,
      brand_owner: food.brandOwner,
      ingredients: food.ingredients,
      nutrients: food.nutrients,
      portions: food.portions,
      raw_payload: food.raw,
      source_release: sourceRelease,
      fetched_at: importedAt,
      updated_at: importedAt,
    };
  });
  const { error } = await db.from("usda_fdc_foods").upsert(rows, { onConflict: "fdc_id" });
  if (error) throw new Error(`Import failed at row ${offset}: ${error.message}`);
  imported += rows.length;
  console.log(`[usda-import] ${imported}/${records.length}`);
}

console.log(`[usda-import] Complete: ${imported} USDA foods from release ${sourceRelease}`);
