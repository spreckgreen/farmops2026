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
