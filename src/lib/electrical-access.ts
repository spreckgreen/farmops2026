// Who may see which Electrical screens.
//
// Two independent ideas meet here:
//
//  * The **add-on** decides the depth of access. `electrical` is the full
//    module (read + write + reconciliation tooling); `electrical_readonly` is
//    the electrician grant — the whole field record, read-only, with the
//    reconciliation tools withheld.
//  * The **electrician role** decides the breadth of the app. A user holding it
//    only ever sees the Electrical tab; the rest of the farm app is not theirs.
//
// This module is pure so both the navigation and the page gate agree, and so
// the rules can be unit-tested. The server-side gate in `addons.server` is what
// actually protects the data.

export type ElectricalSection =
  | "overview"
  | "entities"
  | "services"
  | "diagrams"
  | "topology"
  | "workbook"
  | "labels"
  | "qa"
  | "standards"
  | "panel"
  | "assistant"
  | "changes"
  | "mapping"
  | "sor"
  | "validation"
  | "adjudication"
  | "import"
  | "export";

/**
 * Reconciliation areas: they compare the canonical engineering workbook against
 * FarmOps and drive corrections. They stay with the full add-on — an electrician
 * reads the as-installed record, they do not adjudicate the system of record.
 */
export const RECONCILIATION_SECTIONS: ElectricalSection[] = [
  "qa",
  "mapping",
  "sor",
  "validation",
  "adjudication",
  "import",
  "export",
];

/** Sections an electrician (read-only add-on) may open. */
export const ELECTRICIAN_VIEWABLE_SECTIONS: ElectricalSection[] = [
  "overview",
  "entities",
  "services",
  "diagrams",
  "topology",
  "workbook",
  "labels",
  "standards",
  "panel",
  // AI assistance is read-only and scenario-scoped: an electrician gets the
  // scenarios their own access already covers.
  "assistant",
  // Their own audited change history: an electrician can always see what they
  // recorded, even though the farm-wide review list is admin-only.
  "changes",
];

export function isReconciliationSection(section: ElectricalSection): boolean {
  return RECONCILIATION_SECTIONS.includes(section);
}

export interface ElectricalAccessInput {
  /** Full `electrical` entitlement is active. */
  full: boolean;
  /** Read-only `electrical_readonly` entitlement is active. */
  readOnly: boolean;
  /** Field-write `electrical_fieldwrite` entitlement is active. */
  fieldWrite?: boolean;
  /** Scan-scoped `electrical_scan` entitlement is active. */
  scan?: boolean;
}

export interface ElectricalAccess {
  /** Any electrical access at all. */
  canView: boolean;
  /** No writes are authorised for this user. */
  readOnly: boolean;
  /** May write the as-installed field record (audited when not the full add-on). */
  canWrite: boolean;
  /** Writes are recorded for administrator review. */
  auditedWrites: boolean;
  /** Reconciliation tabs are available. */
  canReconcile: boolean;
  /** Only a scanned panel label, no farm-wide access. */
  scanOnly: boolean;
  /** Which sections to render / link to. */
  sections: ElectricalSection[];
}

export function electricalAccess(input: ElectricalAccessInput): ElectricalAccess {
  const full = input.full === true;
  const fieldWrite = !full && input.fieldWrite === true;
  const readOnly = !full && !fieldWrite && input.readOnly === true;
  const scanOnly = !full && !fieldWrite && !readOnly && input.scan === true;
  const sections: ElectricalSection[] = full
    ? [...ELECTRICIAN_VIEWABLE_SECTIONS, ...RECONCILIATION_SECTIONS]
    : fieldWrite || readOnly
      ? [...ELECTRICIAN_VIEWABLE_SECTIONS]
      : scanOnly
        ? ["panel"]
        : [];
  return {
    canView: full || fieldWrite || readOnly || scanOnly,
    readOnly: !full && !fieldWrite,
    canWrite: full || fieldWrite,
    auditedWrites: fieldWrite,
    canReconcile: full,
    scanOnly,
    sections,
  };
}

export function canOpenSection(
  access: ElectricalAccess,
  section: ElectricalSection,
): boolean {
  return access.sections.includes(section);
}


export const RECONCILIATION_DENIED =
  "Reconciliation tools compare the canonical engineering workbook against FarmOps and are limited to the full Electrical add-on. Your access covers the as-installed field record, read-only.";

/**
 * Which section a URL belongs to, so the gate can judge a page without every
 * route having to declare itself.
 */
export function sectionFromPathname(pathname: string): ElectricalSection {
  const rest = pathname.replace(/^\/electrical\/?/, "").replace(/\/+$/, "");
  if (!rest) return "overview";
  const head = rest.split("/")[0];
  switch (head) {
    case "services":
    case "diagrams":
    case "topology":
    case "workbook":
    case "labels":
    case "qa":
    case "assistant":
    case "standards":
    case "mapping":
    case "sor":
    case "validation":
    case "adjudication":
    case "import":
    case "export":
      return head;
    case "panel":
      return "panel";
    case "changes":
      return "changes";
    default:
      // /electrical/$kind and /electrical/item/$kind/$id
      return "entities";
  }
}

/**
 * True when this account is scoped to the Electrical tab only. Holding the
 * `electrician` role is a scope, not a rank: it never widens with extra base
 * roles such as `viewer` or `editor` — only an administrator (`admin` role or
 * `isAdmin`) browses the whole farm app.
 */
export function isElectricianScoped(roles: readonly string[] | undefined, isAdmin?: boolean): boolean {
  if (isAdmin === true) return false;
  const list = roles ?? [];
  if (list.includes("admin")) return false;
  return list.includes("electrician");
}

/** Paths an Electrical-scoped account may open outside `/electrical`. */
const ELECTRICIAN_ALLOWED_PREFIXES = ["/electrical", "/auth", "/profile"];

export function electricianPathAllowed(pathname: string): boolean {
  return ELECTRICIAN_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
