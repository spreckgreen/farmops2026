// Turns the /demo/farmops_o_s handout into a clickable roadmap: each slide
// carries links to the real pages in the application that implement what the
// slide describes, plus the public pricing calculator.
//
// Module pages are behind sign-in, so links are marked accordingly. The demo
// itself stays anonymous and reads no records.

export interface SlideLink {
  /** Route path inside this application. */
  to: string;
  label: string;
  /** Requires an account with the matching module grant. */
  gated?: boolean;
}

export interface SlideLinkSet {
  heading: string;
  links: SlideLink[];
}

/** Keyed by 1-based slide number in FARMOPS_OS_DEMO_SLIDES. */
export const FARMOPS_OS_SLIDE_LINKS: Record<number, SlideLinkSet> = {
  1: {
    heading: "Jump in",
    links: [
      { to: "/demo/pricing", label: "Pricing calculator" },
      { to: "/demo/electrical", label: "Electrical module deck" },
      { to: "/procedures", label: "Free Procedures module", gated: true },
    ],
  },
  2: {
    heading: "The platform, running",
    links: [
      { to: "/dashboard", label: "Dashboard", gated: true },
      { to: "/admin", label: "Administration", gated: true },
      { to: "/docs/product-architecture", label: "Product architecture", gated: true },
    ],
  },
  3: {
    heading: "People and permission",
    links: [
      { to: "/admin/users", label: "Users and roles", gated: true },
      { to: "/admin/panel-access", label: "Module access grants", gated: true },
      { to: "/vault", label: "Secrets vault", gated: true },
    ],
  },
  4: {
    heading: "Trust and continuity",
    links: [
      { to: "/electrical/changes", label: "Change history", gated: true },
      { to: "/admin/export", label: "Backups and exports", gated: true },
      { to: "/admin/restore", label: "Restore tooling", gated: true },
      { to: "/settings/troubleshooting", label: "Health and diagnostics", gated: true },
    ],
  },
  5: {
    heading: "The free module",
    links: [
      { to: "/procedures", label: "Procedures knowledge base", gated: true },
      { to: "/procedures/ingest", label: "Ingest a manual", gated: true },
    ],
  },
  6: {
    heading: "Packaging work",
    links: [
      { to: "/admin/addons", label: "Module toggles today", gated: true },
      { to: "/docs/product-architecture", label: "Licensing model", gated: true },
      { to: "/demo/pricing", label: "Pricing calculator" },
    ],
  },
  7: {
    heading: "Open a module",
    links: [
      { to: "/procedures", label: "Procedures (free)", gated: true },
      { to: "/electrical", label: "Electrical", gated: true },
      { to: "/maintenance", label: "Maintenance", gated: true },
      { to: "/inventory", label: "Inventory", gated: true },
      { to: "/food", label: "Food & Growing", gated: true },
      { to: "/cameras", label: "Cameras", gated: true },
    ],
  },
  8: {
    heading: "Electrical, live",
    links: [
      { to: "/electrical", label: "Module home", gated: true },
      { to: "/electrical/grid-map", label: "Grid map", gated: true },
      { to: "/electrical/audit-sheet", label: "Field audit sheet", gated: true },
      { to: "/electrical/documents", label: "Printable documents", gated: true },
      { to: "/electrical/api-docs", label: "API reference", gated: true },
    ],
  },
  9: {
    heading: "Maintenance, live",
    links: [
      { to: "/maintenance", label: "Equipment register", gated: true },
      { to: "/service-scheduling", label: "Service schedules", gated: true },
      { to: "/maintenance/diagnose", label: "Symptom diagnosis", gated: true },
      { to: "/maintenance/forecast", label: "Failure forecast", gated: true },
    ],
  },
  10: {
    heading: "Inventory, live",
    links: [
      { to: "/inventory", label: "Items, kits and consumables", gated: true },
      { to: "/reports", label: "Usage reporting", gated: true },
    ],
  },
  11: {
    heading: "Food & Growing, live",
    links: [
      { to: "/food", label: "Module home", gated: true },
      { to: "/food/plan", label: "Food plan", gated: true },
      { to: "/food/storage", label: "Storage", gated: true },
      { to: "/food/irrigation", label: "Irrigation", gated: true },
    ],
  },
  12: {
    heading: "Growing from free",
    links: [
      { to: "/procedures", label: "Start with Procedures", gated: true },
      { to: "/admin/addons", label: "Turn a module on", gated: true },
      { to: "/demo/pricing", label: "Price the next step" },
    ],
  },
  13: {
    heading: "Price it yourself",
    links: [
      { to: "/demo/pricing", label: "Open the pricing calculator" },
      { to: "/docs/product-architecture", label: "Full edition table", gated: true },
    ],
  },
  14: {
    heading: "Hosted or your own hardware",
    links: [
      { to: "/settings/self-host", label: "Self-host settings", gated: true },
      { to: "/admin/ai-engines", label: "AI engine choice", gated: true },
      { to: "/demo/pricing", label: "Compare cost both ways" },
    ],
  },
  15: {
    heading: "Next step",
    links: [
      { to: "/procedures", label: "Open the free module", gated: true },
      { to: "/demo/pricing", label: "Pricing calculator" },
      { to: "/demo/electrical", label: "Electrical module deck" },
      { to: "/demo", label: "All presentations" },
    ],
  },
};
