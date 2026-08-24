import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { INVENTORY_TYPES, type InventoryTypeDef } from "@/lib/obsidian-layout";

export type CatalogStatus = "loading" | "ready" | "fallback" | "empty";

export type InventoryTypeCatalog = {
  types: InventoryTypeDef[];
  status: CatalogStatus;
  /** Set when the database read failed and the built-in list is being used. */
  error: string | null;
  reload: () => void;
};

// Module-level cache so opening several comboboxes doesn't refetch the catalog
// (e.g. one dialog plus a dozen inline row editors on the inventory page).
let cache: InventoryTypeDef[] | null = null;

/**
 * Loads the inventory type catalog from `inventory_item_types` (active rows,
 * ordered by sort_order) and falls back to the built-in INVENTORY_TYPES list
 * when the table is unreachable, so the picker is never blank.
 */
export function useInventoryTypeCatalog(): InventoryTypeCatalog {
  const [types, setTypes] = useState<InventoryTypeDef[]>(cache ?? []);
  const [status, setStatus] = useState<CatalogStatus>(cache ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (cache && nonce === 0) return;
    let cancelled = false;
    setStatus("loading");
    setError(null);

    (async () => {
      const { data, error: dbError } = await supabase
        .from("inventory_item_types")
        .select("value,label,folder,sort_order,active")
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (cancelled) return;

      if (dbError) {
        cache = INVENTORY_TYPES;
        setTypes(INVENTORY_TYPES);
        setStatus("fallback");
        setError(dbError.message);
        return;
      }

      const rows: InventoryTypeDef[] = (data ?? []).map((r) => ({
        value: r.value,
        label: r.label,
        folder: r.folder,
      }));

      if (rows.length === 0) {
        // Table exists but has no seeded rows — use the built-in catalog rather
        // than showing an empty picker.
        cache = INVENTORY_TYPES;
        setTypes(INVENTORY_TYPES);
        setStatus(INVENTORY_TYPES.length ? "fallback" : "empty");
        return;
      }

      cache = rows;
      setTypes(rows);
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { types, status, error, reload: () => setNonce((n) => n + 1) };
}
