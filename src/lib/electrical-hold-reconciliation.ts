// Stale-hold reconciliation.
//
// A circuit-group membership hold exists for one reason only: no stable
// circuit-group identity existed yet, so relational load membership could not
// be applied. Once a permanent circuit group with the SAME panel, the SAME
// breaker position and the SAME observed label exists in
// electrical_circuit_groups, that reason is gone — the hold is satisfied by the
// permanent record and must stop being reported as an active hold.
//
// Matching is deterministic (panel + breaker + label). Nothing is inferred: a
// held item without a breaker number, without a panel reference, or with no
// exact label match stays held.

export interface HeldCircuitGroupItem {
  item_key: string;
  entity_kind: string;
  panel_ref: string | null;
  breaker_number: number | null;
  observed_label: string | null;
}

export interface PermanentCircuitGroup {
  circuit_group_id: string;
  panel_id: string | null;
  breaker_number: number | null;
  description: string | null;
}

function norm(v: string | null): string {
  return (v ?? "").trim().toUpperCase();
}

/**
 * Returns the permanent circuit group that already satisfies this held item, or
 * null when the hold is still genuinely unresolved.
 */
export function satisfyingCircuitGroup(
  item: HeldCircuitGroupItem,
  groups: readonly PermanentCircuitGroup[],
): PermanentCircuitGroup | null {
  if (item.entity_kind !== "circuit_group") return null;
  if (!item.panel_ref || item.breaker_number == null || !item.observed_label) return null;
  const matches = groups.filter(
    (g) =>
      norm(g.panel_id) === norm(item.panel_ref) &&
      g.breaker_number === item.breaker_number &&
      norm(g.description) === norm(item.observed_label),
  );
  // An ambiguous match is not a resolution.
  return matches.length === 1 ? (matches[0] as PermanentCircuitGroup) : null;
}
