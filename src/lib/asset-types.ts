/**
 * Parts / consumables are stock items, not serviceable assets.
 * Maintenance asset pickers must never offer them (e.g. "Oil filter" is a part,
 * "Kubota Zero Turn Mower Z421KWT" is an asset).
 */
export const PART_ITEM_TYPES = [
  // catalog codes
  "31_parts",
  "41_feed",
  "50_food_storage",
  "52_plants",
  // legacy / free-text values seen on older rows
  "part",
  "parts",
  "consumable",
  "consumables",
  "supply",
  "supplies",
  "oil",
  "fluid",
  "filter",
];

export function isPartItemType(itemType: string | null | undefined) {
  return PART_ITEM_TYPES.includes((itemType ?? "").trim().toLowerCase());
}

/**
 * Serviceable assets are the things maintenance can actually be booked against:
 * equipment and ham radio gear. Parts, consumables, feed, plants and food
 * storage rows are stock, not assets, so they never appear in asset pickers.
 */
export function isServiceableAsset(item: { item_type?: string | null }) {
  // Kits are groupings, not serviceable machines — service the radio, not the kit.
  return isManualEligibleType(item.item_type) && !isKitItemType(item.item_type);
}

/**
 * Kits are groupings of other inventory (e.g. "Ham Radio Field Deployment Kit"
 * = radio + antenna + batteries + spare connectors). They live in inventory but
 * behave differently from single assets: they get checked out and back in.
 */
export const KIT_ITEM_TYPES = ["32_kits", "kit", "kits", "field_kit", "assembly"];

export function isKitItemType(itemType: string | null | undefined) {
  return KIT_ITEM_TYPES.includes((itemType ?? "").trim().toLowerCase());
}

export function isKitItem(item: { item_type?: string | null }) {
  return isKitItemType(item.item_type);
}

/** A single asset: manual-eligible but not a kit. */
export function isSingleAsset(item: { item_type?: string | null }) {
  return isManualEligibleType(item.item_type) && !isKitItemType(item.item_type);
}

/**
 * Item types that can have manuals / SOP procedure documents.
 * Manuals only make sense for equipment and ham radio gear — not parts,
 * consumables, feed, plants, or food storage rows.
 */
export const MANUAL_ITEM_TYPES = [
  "30_equipment",
  "32_kits",
  "23_2_ham_radio",
  // legacy / free-text values seen on older rows
  "equipment",
  "asset",
  "ham_radio",
  "radio",
  "kit",
  "kits",
  "field_kit",
  "assembly",
];

export function isManualEligibleType(itemType: string | null | undefined) {
  const t = (itemType ?? "").trim().toLowerCase();
  return MANUAL_ITEM_TYPES.includes(t);
}

export function isManualEligibleAsset(item: { item_type?: string | null }) {
  return isManualEligibleType(item.item_type);
}
