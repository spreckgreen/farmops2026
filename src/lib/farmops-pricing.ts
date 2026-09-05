// Numeric pricing model behind the public calculator at /demo/pricing.
//
// DESIGN DATA. Every number here restates a price anchor already written in
// src/lib/product-architecture.ts (EDITIONS). These are proposed anchors for
// discussion, not live prices, and nothing here charges anything.
import { EDITIONS, type EditionKey } from "@/lib/product-architecture";

export type Deployment = "cloud" | "selfhost";
export type Billing = "monthly" | "annual";

/** Paid modules the calculator can switch on. Knowledge Base is always free. */
export interface PricedModule {
  key: string;
  name: string;
  /** Live route for the module inside the application. */
  route: string;
  status: "shipping" | "in-app today";
}

export const PRICED_MODULES: PricedModule[] = [
  { key: "electrical", name: "Electrical Infrastructure", route: "/electrical", status: "shipping" },
  { key: "maintenance", name: "Maintenance", route: "/maintenance", status: "in-app today" },
  { key: "inventory", name: "Inventory", route: "/inventory", status: "in-app today" },
  { key: "food", name: "Food & Growing", route: "/food", status: "in-app today" },
  { key: "cameras", name: "Cameras", route: "/cameras", status: "in-app today" },
];

export interface PricedEdition {
  key: EditionKey;
  name: string;
  deployment: Deployment;
  /** Recurring subscription price, cloud editions only. */
  monthly: number;
  annual: number;
  /** One-time licence, self-host editions only. */
  oneTime: number;
  /** Yearly maintenance after the first 12 months, self-host editions only. */
  maintenancePerYear: number;
  /** Additional monthly charge per managed customer site (contractor cloud). */
  perSiteMonthly: number;
  seats: number | "unlimited";
  sites: number | "unlimited";
  /** How many paid modules the edition unlocks. */
  paidModules: number | "all";
  /** Per-module self-host licence fee, applied when paidModules is "purchased". */
  perModuleOneTime: number;
  contractor: boolean;
}

const PER_MODULE_SELFHOST = 249;

export const PRICED_EDITIONS: PricedEdition[] = [
  {
    key: "free_kb",
    name: "Free — Knowledge Base",
    deployment: "cloud",
    monthly: 0,
    annual: 0,
    oneTime: 0,
    maintenancePerYear: 0,
    perSiteMonthly: 0,
    seats: 2,
    sites: 1,
    paidModules: 0,
    perModuleOneTime: 0,
    contractor: false,
  },
  {
    key: "cloud_homestead",
    name: "Cloud — Homestead",
    deployment: "cloud",
    monthly: 19,
    annual: 190,
    oneTime: 0,
    maintenancePerYear: 0,
    perSiteMonthly: 0,
    seats: 5,
    sites: 1,
    paidModules: 1,
    perModuleOneTime: 0,
    contractor: false,
  },
  {
    key: "cloud_pro",
    name: "Cloud — Pro",
    deployment: "cloud",
    monthly: 49,
    annual: 490,
    oneTime: 0,
    maintenancePerYear: 0,
    perSiteMonthly: 0,
    seats: 15,
    sites: 3,
    paidModules: "all",
    perModuleOneTime: 0,
    contractor: false,
  },
  {
    key: "cloud_contractor",
    name: "Cloud — Contractor",
    deployment: "cloud",
    monthly: 99,
    annual: 990,
    oneTime: 0,
    maintenancePerYear: 0,
    perSiteMonthly: 9,
    seats: 25,
    sites: "unlimited",
    paidModules: "all",
    perModuleOneTime: 0,
    contractor: true,
  },
  {
    key: "selfhost_standard",
    name: "Self-host — Standard",
    deployment: "selfhost",
    monthly: 0,
    annual: 0,
    oneTime: 899,
    maintenancePerYear: 199,
    perSiteMonthly: 0,
    seats: "unlimited",
    sites: 1,
    paidModules: 0,
    perModuleOneTime: PER_MODULE_SELFHOST,
    contractor: false,
  },
  {
    key: "selfhost_contractor",
    name: "Self-host — Contractor",
    deployment: "selfhost",
    monthly: 0,
    annual: 0,
    oneTime: 1899,
    maintenancePerYear: 349,
    perSiteMonthly: 0,
    seats: "unlimited",
    sites: "unlimited",
    paidModules: "all",
    perModuleOneTime: 0,
    contractor: true,
  },
];

/** Free-text anchor from the architecture document, shown next to each result. */
export function editionAnchorText(key: EditionKey): string {
  return EDITIONS.find((e) => e.key === key)?.price ?? "";
}

export interface CalculatorInput {
  deployment: Deployment;
  billing: Billing;
  /** Selected paid module keys. Knowledge Base is always included and free. */
  modules: string[];
  seats: number;
  /** Properties or customer sites the install must cover. */
  sites: number;
  contractor: boolean;
}

export interface LineItem {
  label: string;
  detail: string;
  amount: number;
}

export interface Quote {
  edition: PricedEdition;
  fits: boolean;
  /** Why this edition cannot cover the requested shape. */
  shortfalls: string[];
  lines: LineItem[];
  /** First 12 months of ownership, including any one-time licence. */
  firstYear: number;
  /** Each following year, once the first term ends. */
  ongoingPerYear: number;
  monthlyEquivalent: number;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function seatCap(e: PricedEdition) {
  return e.seats === "unlimited" ? Number.POSITIVE_INFINITY : e.seats;
}
function siteCap(e: PricedEdition) {
  return e.sites === "unlimited" ? Number.POSITIVE_INFINITY : e.sites;
}

/** Prices one edition against the requested shape. Pure arithmetic, no I/O. */
export function quoteEdition(e: PricedEdition, input: CalculatorInput): Quote {
  const moduleCount = input.modules.length;
  const shortfalls: string[] = [];

  if (e.deployment !== input.deployment) {
    shortfalls.push(
      input.deployment === "cloud" ? "Hosted by FarmOps is not this edition." : "Runs on FarmOps hosting, not your own hardware.",
    );
  }
  if (input.seats > seatCap(e)) shortfalls.push(`Covers ${e.seats} people; you asked for ${input.seats}.`);
  if (input.sites > siteCap(e)) shortfalls.push(`Covers ${e.sites} site${e.sites === 1 ? "" : "s"}; you asked for ${input.sites}.`);
  if (input.contractor && !e.contractor) shortfalls.push("No rights to manage separate customer sites.");
  if (e.paidModules !== "all" && moduleCount > e.paidModules && e.perModuleOneTime === 0) {
    shortfalls.push(
      e.paidModules === 0
        ? "Knowledge Base only — no paid modules."
        : `Unlocks ${e.paidModules} paid module; you picked ${moduleCount}.`,
    );
  }

  const lines: LineItem[] = [];
  let firstYear = 0;
  let ongoingPerYear = 0;

  if (e.deployment === "cloud") {
    const base = input.billing === "annual" ? e.annual : e.monthly * 12;
    if (base > 0) {
      lines.push({
        label: e.name,
        detail:
          input.billing === "annual"
            ? `${money(e.annual)} per year (two months saved against monthly)`
            : `${money(e.monthly)} per month × 12`,
        amount: base,
      });
    } else {
      lines.push({ label: e.name, detail: "Free forever, never expires", amount: 0 });
    }
    firstYear += base;
    ongoingPerYear += base;

    if (e.perSiteMonthly > 0 && input.sites > 1) {
      const managed = input.sites - 1;
      const siteYear = managed * e.perSiteMonthly * 12;
      lines.push({
        label: "Managed customer sites",
        detail: `${managed} site${managed === 1 ? "" : "s"} × ${money(e.perSiteMonthly)} per month`,
        amount: siteYear,
      });
      firstYear += siteYear;
      ongoingPerYear += siteYear;
    }
  } else {
    lines.push({
      label: `${e.name} licence`,
      detail: `${money(e.oneTime)} once, includes 12 months of upgrades and support`,
      amount: e.oneTime,
    });
    firstYear += e.oneTime;

    if (e.perModuleOneTime > 0 && moduleCount > 0) {
      const modules = moduleCount * e.perModuleOneTime;
      lines.push({
        label: "Module licences",
        detail: `${moduleCount} module${moduleCount === 1 ? "" : "s"} × ${money(e.perModuleOneTime)} once`,
        amount: modules,
      });
      firstYear += modules;
    }
    lines.push({
      label: "Upgrades and support after year one",
      detail: `${money(e.maintenancePerYear)} per year — optional; lapsing never stops the install`,
      amount: 0,
    });
    ongoingPerYear += e.maintenancePerYear;
  }

  return {
    edition: e,
    fits: shortfalls.length === 0,
    shortfalls,
    lines,
    firstYear,
    ongoingPerYear,
    monthlyEquivalent: Math.round((firstYear / 12) * 100) / 100,
  };
}

/** Every edition priced, cheapest fitting first. */
export function quoteAll(input: CalculatorInput): Quote[] {
  const quotes = PRICED_EDITIONS.map((e) => quoteEdition(e, input));
  return quotes.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    return a.firstYear - b.firstYear;
  });
}

/** The cheapest edition that actually covers the requested shape, if any. */
export function recommend(input: CalculatorInput): Quote | undefined {
  return quoteAll(input).find((q) => q.fits);
}

export const PRICING_DISCLAIMER =
  "Design price anchors from the FarmOps product architecture, shown for discussion. Nothing on this page is a live price, a quote or a charge.";
