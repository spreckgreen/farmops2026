# USDA FoodData Central nutrition

FarmOps can search USDA FoodData Central online and maintain a local reference
cache for offline use. A USDA record is never attached to a FarmOps food until a
signed-in user reviews and approves the match on **Food → Nutrition**.

## Online API search

1. Request a data.gov API key from the USDA FoodData Central API guide.
2. Save it as a Shared FarmOps vault secret with env key `USDA_FDC_API_KEY`, or
   set the same variable in `.env.local`.
3. If using `.env.local`, recreate the app container. A vault change is visible
   after the server-environment cache refreshes (normally within 60 seconds).

The key is server-only. Never prefix it with `VITE_`, put it in frontend code,
or commit it to Git.

## Local/offline reference data

Download an official JSON dataset from:

https://fdc.nal.usda.gov/download-datasets/

Start with Foundation Foods. Add FNDDS for prepared foods and SR Legacy as a
fallback. Branded Foods is optional and much larger.

After applying the database migration, import an extracted JSON file:

```bash
set -a
source .env.local
set +a
bun scripts/import-usda-fooddata.ts \
  /path/to/FoodData_Central_foundation_food_json.json \
  2026-04
```

The importer upserts by USDA `fdc_id`, records the release, and does not modify
any user food or approved match. Re-running it for a newer release refreshes the
reference cache while leaving user approval explicit.

## Data-source order

1. Foundation Foods for minimally processed farm foods.
2. FNDDS (`Survey (FNDDS)`) for cooked and prepared foods.
3. SR Legacy when no current record is suitable.
4. Branded Foods only for a specific commercial product.

## Update procedure

USDA releases should be imported as a reviewed maintenance operation. Record the
release argument exactly as published, back up Postgres first, run the importer,
and spot-check existing approved FDC IDs. The import refreshes reference records;
it never chooses a different FDC ID for a FarmOps food.


## Planner linking and assessment

**Suggest matches for unlinked planner foods** searches the local cache and,
when configured, the FoodData Central API for every currently unlinked food.
It returns up to three ranked candidates per food. Suggestions remain previews:
a signed-in user must approve the FDC ID before the planner treats it as a
nutrition source.

A planner food may have multiple approved profiles, such as raw, canned, or
dehydrated. Use **Edit food → Planner nutrition form** to select which approved
form supplies the daily assessment. The selected person's Monday-through-Sunday
chart expresses energy, protein, fat, carbohydrate, fiber, and sodium as a
percentage of that person's targets.

Planner quantities are servings. `oz_per_serving` converts servings to grams
before applying USDA values per 100 g. Older foods without a serving size use a
one-ounce-per-unit compatibility fallback and should be completed for accurate
assessment.

New people start with the FDA adult Daily Values: 2,000 kcal, 50 g protein,
78 g fat, 275 g carbohydrate, 28 g fiber, and 2,300 mg sodium. These values are
general label references, not individualized medical recommendations. Each
person's targets can be edited in the planner.

- FDA Daily Values:
  https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels
- FoodData Central API:
  https://fdc.nal.usda.gov/api-guide/

## Preservation conversions

The planner shows weekly planning equivalents for fresh quantity, freeze-dried
dry ounces, dehydrated dry ounces, and canned quarts. These estimates use the
same crop-specific yield assumptions as Preservation Coach; actual batch yield
must replace the estimate when known.

Nutrition is not transformed with a universal retention percentage. Canning,
dehydration, and freeze-drying affect foods differently. Match each applicable
form to its own USDA FDC record and select that approved form for the planner.
