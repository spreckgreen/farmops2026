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
