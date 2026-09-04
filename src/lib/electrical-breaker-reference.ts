// Derived, read-only breaker reference.
//
// The authoritative identity of a breaker position stays the panel UUID plus the
// physical position row in `electrical_breaker_positions`. `breaker_reference` is
// a display-only projection: PNL-<panel>-B<breaker number>, e.g. PNL-FS-NW-B39.
// It is never stored as an identity, never concatenated into a circuit group's
// stable ID, and a circuit group is never renamed when its breaker changes.

export const BREAKER_REFERENCE_SHAPE = "PNL-<panel>-B<breaker number>";
export const BREAKER_REFERENCE_EXAMPLE = "PNL-FS-NW-B39";
export const CIRCUIT_GROUP_ID_SHAPE = "CG-<site>-<sequence>";
export const CIRCUIT_GROUP_ID_EXAMPLE = "CG-FS-014";
export const CIRCUIT_GROUP_ID_RE = /^CG-[A-Z]{2,4}-\d{3}$/;

/**
 * Build the derived reference for a breaker position. Returns null when either
 * part is missing — a partial reference is never invented.
 */
export function breakerReference(
  panelId: string | null | undefined,
  breakerNumber: number | string | null | undefined,
): string | null {
  const panel = String(panelId ?? "").trim().toUpperCase();
  if (!panel) return null;
  const raw = String(breakerNumber ?? "").trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) return null;
  return `${panel}-B${num}`;
}

/** Display form of the relationship: breaker_reference → circuit_group_id [description]. */
export function breakerRelationshipLabel(input: {
  panel_id?: string | null;
  breaker_number?: number | string | null;
  circuit_group_id?: string | null;
  description?: string | null;
}): string | null {
  const ref = breakerReference(input.panel_id, input.breaker_number);
  const group = String(input.circuit_group_id ?? "").trim();
  if (!ref || !group) return null;
  const description = String(input.description ?? "").trim();
  return description ? `${ref} → ${group} [${description}]` : `${ref} → ${group}`;
}

/** Validate a permanent circuit group stable ID (independent of any breaker). */
export function checkCircuitGroupId(value: string): { ok: boolean; error?: string } {
  const id = String(value ?? "").trim().toUpperCase();
  if (CIRCUIT_GROUP_ID_RE.test(id)) return { ok: true };
  if (/-B\d+/.test(id)) {
    return {
      ok: false,
      error:
        `A circuit group ID must never contain a breaker reference. Use ${CIRCUIT_GROUP_ID_SHAPE} ` +
        `(e.g. ${CIRCUIT_GROUP_ID_EXAMPLE}); the breaker is a separate relationship.`,
    };
  }
  return {
    ok: false,
    error: `Required format ${CIRCUIT_GROUP_ID_SHAPE} — e.g. ${CIRCUIT_GROUP_ID_EXAMPLE}.`,
  };
}
