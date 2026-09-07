// Suggested inventory item name built from the manufacturer and the model.
//
// The suggestion is only ever a default: the item's name stays a free-text
// field, so a name someone typed themselves is never overwritten.

/** "Kenwood TS-480 SAT" from manufacturer "Kenwood" and model "TS-480 SAT". */
export function suggestedItemName(manufacturer: string | null | undefined, model: string | null | undefined): string {
  return [manufacturer, model]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Whether a saved name still looks like the manufacturer + model suggestion,
 * i.e. nobody has renamed the item by hand. Blank names count as unedited.
 */
export function nameMatchesSuggestion(
  name: string | null | undefined,
  manufacturer: string | null | undefined,
  model: string | null | undefined,
): boolean {
  const current = (name ?? "").trim();
  if (!current) return true;
  return current.toLowerCase() === suggestedItemName(manufacturer, model).toLowerCase();
}
