// What each plan actually gives you, expressed as the real pages it opens.
//
// The public handout at /demo/pricing sells the idea; these pages are the
// signed-in truth: they read the account's own subscription and say, per module,
// whether the page is open right now. Nothing here decides access — every module
// page keeps its own gate and every server function re-checks entitlement.
import {
  PRICED_EDITIONS,
  PRICED_MODULES,
  type PricedEdition,
  type PricedModule,
} from "@/lib/farmops-pricing";
import { moduleAllowance, tier } from "@/lib/subscription-tiers";

/** Pages a module opens, so a plan page can show real destinations. */
export interface ModulePage {
  to: string;
  label: string;
}

export const MODULE_PAGES: Record<string, ModulePage[]> = {
  electrical: [
    { to: "/electrical", label: "Module home" },
    { to: "/electrical/grid-map", label: "Grid map" },
    { to: "/electrical/audit-sheet", label: "Field audit sheet" },
    { to: "/electrical/documents", label: "Printable documents" },
  ],
  maintenance: [
    { to: "/maintenance", label: "Equipment register" },
    { to: "/service-scheduling", label: "Service schedules" },
    { to: "/maintenance/forecast", label: "Failure forecast" },
  ],
  inventory: [
    { to: "/inventory", label: "Items, kits and consumables" },
    { to: "/reports", label: "Usage reporting" },
  ],
  food: [
    { to: "/food", label: "Module home" },
    { to: "/food/plan", label: "Food plan" },
    { to: "/food/storage", label: "Storage" },
  ],
  cameras: [
    { to: "/security", label: "Security" },
    { to: "/security/cameras", label: "Cameras" },
  ],
};

/** Always-included pages: free forever on every plan, including the free one. */
export const ALWAYS_INCLUDED: ModulePage[] = [
  { to: "/procedures", label: "Procedures knowledge base" },
  { to: "/procedures/ingest", label: "Ingest a manual" },
  { to: "/dashboard", label: "Dashboard" },
];

export function modulePages(moduleKey: string): ModulePage[] {
  return MODULE_PAGES[moduleKey] ?? [];
}

export function planTiers(): PricedEdition[] {
  return PRICED_EDITIONS;
}

export function planTier(key: string): PricedEdition | undefined {
  return tier(key);
}

/** Plain-language sentence for how many paid modules a plan switches on. */
export function allowanceSentence(t: PricedEdition): string {
  const allowance = moduleAllowance(t);
  if (allowance === "all") {
    return t.perModuleOneTime > 0
      ? "Any module you licence"
      : "Every paid module";
  }
  if (allowance === 0) return "Knowledge Base and Procedures only";
  return `${allowance} paid module${allowance === 1 ? "" : "s"} of your choice`;
}

export function priceSentence(t: PricedEdition): string {
  if (t.deployment === "selfhost") {
    return `$${t.oneTime} once, then $${t.maintenancePerYear} a year`;
  }
  if (t.monthly === 0 && t.annual === 0) return "Free forever";
  return `$${t.monthly}/month or $${t.annual}/year`;
}

export interface ModuleAccess extends PricedModule {
  /** Open for this account right now. */
  open: boolean;
  /** Covered by the plan being looked at, whether or not it is this account's. */
  coveredByTier: boolean;
  pages: ModulePage[];
}

/**
 * Combine the catalog, a tier and the account's live unlocks. `unlocked` comes
 * from the server; a module absent from it is shown locked, never hidden.
 */
export function moduleAccess(
  t: PricedEdition | undefined,
  unlocked: string[],
): ModuleAccess[] {
  const allowance = t ? moduleAllowance(t) : 0;
  return PRICED_MODULES.map((m) => ({
    ...m,
    open: unlocked.includes(m.key),
    coveredByTier: allowance === "all" || allowance > 0,
    pages: modulePages(m.key),
  }));
}

/** Total real pages a plan can open, used for a one-number summary. */
export function openPageCount(access: ModuleAccess[]): number {
  return (
    ALWAYS_INCLUDED.length +
    access.filter((m) => m.open).reduce((sum, m) => sum + m.pages.length, 0)
  );
}
