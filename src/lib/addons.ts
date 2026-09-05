// Pure add-on / entitlement helpers shared by client and server.
//
// An add-on is an optional module (the Electrical Infrastructure module is the
// first) that can be switched on or off per user. Entitlement rows are the
// shape a billing webhook would eventually write to, but for now they are
// granted by an admin.

export const ADDON_KEYS = [
  "electrical",
  "electrical_scan",
  "electrical_readonly",
  "electrical_fieldwrite",
  // Paid modules a subscription tier can unlock (see @/lib/subscription-tiers).
  "maintenance",
  "inventory",
  "food",
] as const;

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
  /** How many times an administrator has taken this access away. */
  revoked_count?: number | null;
  /** Set once the revocation limit is passed: no self re-provisioning until then. */
  blocked_until?: string | null;
}

/**
 * Losing access is recoverable: a disabled or declined user may ask again (or
 * re-scan a label) and be re-provisioned. Being revoked MORE than this many
 * times is treated as abuse and locks the account out of self-service access
 * for a year.
 */
export const MAX_REVOCATIONS_BEFORE_BLOCK = 2;
export const REVOCATION_BLOCK_DAYS = 365;

/**
 * Shared test account. It is exercised constantly (revoke → disable → re-enable)
 * so it is exempt from the revocation counter and can never be locked out.
 */
export const TEST_ACCOUNT_EMAILS = ["bosteadfarms@gmail.com"];

export function isTestAccountEmail(email: string | null | undefined): boolean {
  const value = String(email ?? "").trim().toLowerCase();
  return value.length > 0 && TEST_ACCOUNT_EMAILS.includes(value);
}

/** True while a revocation lockout is still running. */
export function isRevocationBlocked(
  row: Pick<EntitlementRow, "blocked_until"> | null | undefined,
  now: Date = new Date(),
): boolean {
  const until = row?.blocked_until ?? null;
  if (!until) return false;
  const at = new Date(until);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() > now.getTime();
}

/**
 * The revocation bookkeeping for one "access taken away" event. Test accounts
 * never accrue revocations, so they stay unlimited.
 */
export function nextRevocationState(
  row: Pick<EntitlementRow, "revoked_count" | "blocked_until"> | null | undefined,
  opts: { email?: string | null; now?: Date } = {},
): { revoked_count: number; blocked_until: string | null } {
  const now = opts.now ?? new Date();
  const current = Math.max(0, Number(row?.revoked_count ?? 0) || 0);
  if (isTestAccountEmail(opts.email)) {
    return { revoked_count: current, blocked_until: null };
  }
  const count = current + 1;
  if (count <= MAX_REVOCATIONS_BEFORE_BLOCK) {
    return { revoked_count: count, blocked_until: row?.blocked_until ?? null };
  }
  const until = new Date(now.getTime() + REVOCATION_BLOCK_DAYS * 24 * 60 * 60 * 1000);
  return { revoked_count: count, blocked_until: until.toISOString() };
}

export function revocationBlockMessage(until: string | null | undefined): string {
  const label = until ? new Date(until).toLocaleDateString() : "a later date";
  return `Access to this add-on was revoked more than ${MAX_REVOCATIONS_BEFORE_BLOCK} times, so self-service access is blocked until ${label}. Contact an administrator.`;
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

/**
 * Scan-scoped Electrical access. A viewer who reaches the app by scanning a
 * printed panel QR label is self-provisioned with this add-on so the label is
 * never a dead end. It unlocks ONLY the panel sheet for a panel they scanned
 * plus that panel's own local topology — never the farm-wide module. Anything
 * wider still needs an administrator-approved system-data window.
 */
export const SCAN_ADDON: AddonKey = "electrical_scan";
export const FULL_ELECTRICAL_ADDON: AddonKey = "electrical";
/**
 * Read-only Electrical access, handed to electricians. It opens the whole
 * electrician-viewable module for reading but authorises no writes and no
 * reconciliation tooling (ODS import/export, parallel validation, adjudication,
 * SOR status, field mapping) — those stay with the full add-on.
 */
export const READONLY_ELECTRICAL_ADDON: AddonKey = "electrical_readonly";
/**
 * Field-write Electrical access. Same breadth as the read-only electrician
 * grant, but the electrician may also record what they installed: panels,
 * raceways, junction boxes, branch runs, circuits, loads, services, panel
 * layout and labels. Reconciliation tooling is still withheld, and every
 * change made under this grant is written to `electrical_change_audit` so an
 * administrator can review it afterwards.
 */
export const FIELDWRITE_ELECTRICAL_ADDON: AddonKey = "electrical_fieldwrite";
/** Keys that may read farm-wide electrical data, widest first. */
export const ELECTRICAL_READ_ADDONS: AddonKey[] = [
  FULL_ELECTRICAL_ADDON,
  FIELDWRITE_ELECTRICAL_ADDON,
  READONLY_ELECTRICAL_ADDON,
];
/** Keys that may write the as-installed field record, widest first. */
export const ELECTRICAL_FIELD_WRITE_ADDONS: AddonKey[] = [
  FULL_ELECTRICAL_ADDON,
  FIELDWRITE_ELECTRICAL_ADDON,
];
/** Keys that may read a scanned panel sheet, widest first. */
export const PANEL_SHEET_ADDONS: AddonKey[] = [
  FULL_ELECTRICAL_ADDON,
  FIELDWRITE_ELECTRICAL_ADDON,
  READONLY_ELECTRICAL_ADDON,
  SCAN_ADDON,
];

