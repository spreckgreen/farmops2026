/**
 * Parts / consumables are stock items, not serviceable assets.
 * Maintenance asset pickers must never offer them (e.g. "Oil filter" is a part,
 * "Kubota Zero Turn Mower Z421KWT" is an asset).
 */
export const PART_ITEM_TYPES = [
  "part",
  "parts",
  "consumable",
  "consumables",
  "supply",
  "supplies",
];

export function isPartItemType(itemType: string | null | undefined) {
  return PART_ITEM_TYPES.includes((itemType ?? "").trim().toLowerCase());
}

export function isServiceableAsset(item: { item_type?: string | null }) {
  return !isPartItemType(item.item_type);
}

/**
 * Item types that can have manuals / SOP procedure documents.
 * Manuals only make sense for equipment and ham radio gear — not parts,
 * consumables, feed, plants, or food storage rows.
 */
export const MANUAL_ITEM_TYPES = [
  "30_equipment",
  "23_2_ham_radio",
  // legacy / free-text values seen on older rows
  "equipment",
  "asset",
  "ham_radio",
  "radio",
];

export function isManualEligibleType(itemType: string | null | undefined) {
  const t = (itemType ?? "").trim().toLowerCase();
  return MANUAL_ITEM_TYPES.includes(t);
}

export function isManualEligibleAsset(item: { item_type?: string | null }) {
  return isManualEligibleType(item.item_type);
}
