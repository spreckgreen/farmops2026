// Pure add-on / entitlement helpers shared by client and server.
//
// An add-on is an optional module (the Electrical Infrastructure module is the
// first) that can be switched on or off per user. Entitlement rows are the
// shape a billing webhook would eventually write to, but for now they are
// granted by an admin.

export const ADDON_KEYS = ["electrical"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

export const ENTITLEMENT_STATUSES = ["active", "trialing", "expired", "disabled"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export interface EntitlementRow {
  id?: string;
  user_id?: string;
  addon_key: string;
  status: string;
  expires_at: string | null;
  notes?: string | null;
}

/**
 * An entitlement grants access only while it is active/trialing and unexpired.
 * Fails closed for unknown statuses so a bad value never unlocks a module.
 */
export function isEntitlementActive(
  row: Pick<EntitlementRow, "status" | "expires_at"> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row) return false;
  const status = String(row.status ?? "").toLowerCase();
  if (status !== "active" && status !== "trialing") return false;
  if (!row.expires_at) return true;
  const expires = new Date(row.expires_at);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
}

export function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Trial";
    case "expired":
      return "Expired";
    case "disabled":
      return "Disabled";
    default:
      return status;
  }
}

export const ADDON_NOT_ENABLED = "This add-on is not enabled for your account.";
