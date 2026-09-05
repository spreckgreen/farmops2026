// Slide content for the public per-module feature demos:
//   /demo/maintenance, /demo/inventory, /demo/food, /demo/procedures,
//   /demo/security
//
// Text-only layouts (no screenshots, no farm records) so every deck can be
// shown anonymously. Every capability described here is implemented in the
// application; nothing on these slides is aspirational except where a slide
// says so in its own words. No prices appear here — pricing lives in
// /demo/pricing and /plans.
import { type PromoSlide } from "@/lib/promo-slides";
import { type DeckSlideLinks } from "@/components/deck/deck-viewer";

const closingActions = [
  "Open the module inside FarmOps and work from your own records",
  "Download this deck as a PDF or PowerPoint handout",
  "Compare what each plan opens on the Plans page",
];

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */

export const MAINTENANCE_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps Maintenance · Feature demo",
    title: "Service work planned from the real manual",
    subtitle:
      "Maintenance turns manufacturer service schedules into dated work, forecasts what is coming due from actual usage, and helps you name a fault before you take anything apart.",
    footer: "Feature demo · 12 pages · no farm records shown",
  },
  {
    kind: "statement",
    kicker: "The problem",
    title: "Service intervals live in a book nobody opens",
    lead:
      "Every machine on a property carries its own schedule, its own part numbers and its own hour meter. Kept on paper, none of it produces a work list.",
    bullets: [
      "Intervals sit in a PDF manual, so the next service date is never actually calculated.",
      "Part numbers are known by the manual but not by your parts shelf.",
      "Hours and miles are read on the machine and then forgotten.",
      "When something fails, the useful history — what was done, when, by whom — cannot be found.",
    ],
  },
  {
    kind: "cards",
    kicker: "The register",
    title: "One list of service work with the numbers on top",
    cards: [
      {
        label: "Records",
        heading: "Every job, open or done",
        body: "Asset, service type, due date, recurrence, cost and vendor, with counts for total, open and overdue at the top of the page.",
      },
      {
        label: "Import",
        heading: "Bring your spreadsheet",
        body: "CSV or JSON import that recognises differently named columns, shows the parsed rows before anything is written, and can replace your existing records when you ask it to.",
      },
      {
        label: "Export",
        heading: "Take it back out",
        body: "Full CSV export of every field, so the register is never a place your data gets trapped.",
      },
      {
        label: "Scheduling",
        heading: "Service scheduling page",
        body: "A dedicated scheduling screen for laying work out over the weeks ahead.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Manuals",
    title: "Import the manufacturer's schedule, keep the parts",
    lead:
      "Choose the machine, choose the kind of manual — service schedule, operator, workshop — and bring the content in. Service schedules become intervals; operator and workshop manuals become a procedure page linked to the machine.",
    bullets: [
      "Parts named by the manual are matched against your inventory and scored exact, strong, weak or none.",
      "Each part can be accepted, rejected, matched again by hand, or created as a new item.",
      "Before applying, you see which intervals are new and which overlap what you already have.",
      "Unresolved part matches block the import rather than quietly creating duplicates.",
    ],
    note: "Nothing is written until you press the button that applies it.",
  },
  {
    kind: "statement",
    kicker: "Forecast",
    title: "What is coming due, from real usage",
    lead:
      "The forecast page buckets work into overdue, 30, 60 and 90 days for each machine, using its usage rate and the intervals actually recorded.",
    bullets: [
      "Usage rate comes from hour and mile readings you log — a machine needs at least two readings before it can be forecast.",
      "Machines that cannot be forecast yet are listed as a gap, with a direct path to log a reading.",
      "An optional written briefing summarises the window in plain sentences, and can be regenerated.",
      "The forecast never invents a usage rate to fill a hole in the readings.",
    ],
  },
  {
    kind: "statement",
    kicker: "Diagnose",
    title: "Describe the symptom, get a shortlist",
    lead:
      "Type what the machine is doing. The diagnose page returns the matching procedure, the assets it suspects, and which parts you already have on the shelf against which are missing.",
    bullets: [
      "Parts are only ever drawn from your own inventory — nothing invented, nothing guessed.",
      "A confidence badge, the engine used and how long it took are shown with every answer.",
      "One action turns the suggestion into a maintenance record.",
      "Answers are a starting point for a person, not an instruction to a machine.",
    ],
  },
  {
    kind: "cards",
    kicker: "Draft a schedule",
    title: "Build a plan for several machines at once",
    cards: [
      {
        label: "Select",
        heading: "Pick the machines",
        body: "Choose several assets, add usage context, and optionally paste or upload a reference document to work from.",
      },
      {
        label: "Draft",
        heading: "One merged plan",
        body: "Each machine is drafted in turn and the results merge into a single plan you review as one change set.",
      },
      {
        label: "Guard",
        heading: "Existing schedules respected",
        body: "If a machine already has schedules you are warned, and can draft in supplemental mode instead of duplicating.",
      },
      {
        label: "Approve",
        heading: "Review then apply",
        body: "The plan is a proposal on screen. Nothing reaches the register until you approve it.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Data discipline",
    title: "Only serviceable things ask to be serviced",
    lead:
      "The module is deliberately narrow about what it will act on, so the register stays believable.",
    bullets: [
      "Only asset types that can actually be serviced appear in the schedule and manual pickers.",
      "Import column names are normalised, and columns it does not recognise are carried through rather than dropped.",
      "Overdue is a calculation from recorded dates, not a status somebody remembered to set.",
      "Every AI-assisted screen is separately switched on per account.",
    ],
  },
  {
    kind: "statement",
    kicker: "Works with the rest",
    title: "Maintenance is not an island",
    lead:
      "The same records serve the other modules, because they sit on one platform rather than five products.",
    bullets: [
      "Parts point at Inventory items, so a service job knows whether it can be done today.",
      "Operator and workshop manuals land in the free Procedures knowledge base.",
      "Kits deployed from Inventory can carry their matching manuals with them.",
      "Electrical equipment carries its own audited records, and can be serviced like anything else.",
    ],
  },
  {
    kind: "cta",
    kicker: "Maintenance",
    title: "Stop rediscovering the service schedule",
    lead:
      "Import the manual once, log the readings as you go, and let the register tell you what is due.",
    actions: closingActions,
    footer: "FarmOps Maintenance · part of the FarmOps O/S module line-up",
  },
];

export const MAINTENANCE_SLIDE_LINKS: Record<number, DeckSlideLinks> = {
  3: {
    heading: "See it in the app",
    links: [
      { to: "/maintenance", label: "Maintenance register", gated: true },
      { to: "/service-scheduling", label: "Service scheduling", gated: true },
    ],
  },
  4: {
    heading: "See it in the app",
    links: [{ to: "/maintenance/import-manual", label: "Import a manual", gated: true }],
  },
  5: {
    heading: "See it in the app",
    links: [{ to: "/maintenance/forecast", label: "Forecast", gated: true }],
  },
  6: {
    heading: "See it in the app",
    links: [{ to: "/maintenance/diagnose", label: "Diagnose", gated: true }],
  },
  7: {
    heading: "See it in the app",
    links: [{ to: "/maintenance/generate-schedule", label: "Draft a schedule", gated: true }],
  },
  10: {
    heading: "Next",
    links: [
      { to: "/demo", label: "All presentations" },
      { to: "/demo/farmops_o_s", label: "FarmOps O/S deck" },
      { to: "/plans", label: "Plans", gated: true },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export const INVENTORY_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps Inventory · Feature demo",
    title: "What you own, where it is, and what it is part of",
    subtitle:
      "Inventory holds assets and parts with locations, quantities and barcodes — then adds parts lists, kits that check out and back in, and a spreadsheet import you can review and undo.",
    footer: "Feature demo · 11 pages · no farm records shown",
  },
  {
    kind: "statement",
    kicker: "The problem",
    title: "A count is only useful if it survives contact with the day",
    lead:
      "Most property inventories are a spreadsheet that was true once. The damage is done by everything that happens after it is saved.",
    bullets: [
      "Parts get pulled for a job and the count is never adjusted.",
      "The same item exists three times under three spellings.",
      "A re-import overwrites good rows with worse ones and there is no way back.",
      "Nobody can tell whether a repair can start today or is waiting on a part.",
    ],
  },
  {
    kind: "cards",
    kicker: "The register",
    title: "Assets and parts in one searchable list",
    cards: [
      {
        label: "Records",
        heading: "The fields that matter",
        body: "Name, description, type, status, location, quantity, minimum quantity, barcode and tags.",
      },
      {
        label: "Find it",
        heading: "Search and filters",
        body: "Search across name, description, type, location, barcode and tags, filter by status or type, and switch on a low-stock view.",
      },
      {
        label: "Scan it",
        heading: "Barcode scanning",
        body: "Scan a barcode straight into the search box to pull up an item at the shelf.",
      },
      {
        label: "Export it",
        heading: "Round-trip CSV",
        body: "Export keeps the row identity, so an edited file can come back in and update the same records.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Import",
    title: "Check the file, review the plan, then apply",
    lead:
      "A spreadsheet import runs in three deliberate steps, and every step can be abandoned without changing anything.",
    bullets: [
      "A validation report first: rows read, valid rows, errors, warnings, unknown and missing columns, downloadable as an issue list.",
      "Then a reconcile plan grouped into create, update, unchanged and missing, matched by row identity, then barcode, then name.",
      "Every row can be accepted, rejected or edited by hand before it is applied.",
      "Deleting rows that are missing from the file is a separate opt-in, never a default.",
    ],
  },
  {
    kind: "statement",
    kicker: "Undo",
    title: "Every applied import can be rolled back",
    lead:
      "Each import stores a snapshot of what it changed, so a bad file is a bad afternoon rather than a lost register.",
    bullets: [
      "Rolling back removes the rows the import created.",
      "Rows it updated are restored to the values they held before.",
      "Rows it deleted are put back.",
      "Import history stays visible, so you can see what happened and when.",
    ],
  },
  {
    kind: "statement",
    kicker: "Parts lists",
    title: "What an item is made of, and what that costs",
    lead:
      "Any item can carry a parts list: quantity per parent, what is on hand, unit cost and the material cost that rolls up from it.",
    bullets: [
      "Buildable units are calculated from the components you actually hold.",
      "Shortfalls are named, so ordering is a list rather than a guess.",
      "Linking a component that would create a loop is refused outright.",
      "The same parts list is what Maintenance checks when it asks whether a job can start.",
    ],
  },
  {
    kind: "statement",
    kicker: "Kits",
    title: "Kits that check out and come back honestly",
    lead:
      "A kit is an item with a parts list that can be deployed. Checking one out pulls the component quantities for the number of units taken.",
    bullets: [
      "Outstanding quantity is tracked per line, so a partly returned kit is visible.",
      "Returns are clamped to what is actually outstanding — checking the same kit in twice cannot inflate stock.",
      "A kit is marked fully returned only when every line is back.",
      "Kits can suggest their own manuals, matched by asset metadata, title or wording overlap and ranked by score.",
    ],
  },
  {
    kind: "cards",
    kicker: "Data discipline",
    title: "Rules that stop the register drifting",
    cards: [
      {
        label: "Validated",
        heading: "Values are checked",
        body: "Statuses must be real statuses, numbers must be numbers, identities must be well formed, and blank rows are skipped.",
      },
      {
        label: "Reported",
        heading: "Problems are named",
        body: "Unknown and missing columns are listed rather than silently ignored, with a downloadable issue report.",
      },
      {
        label: "Bounded",
        heading: "No invented stock",
        body: "Deletions, replacements and kit returns are all bounded by explicit opt-ins or by outstanding quantities.",
      },
      {
        label: "Reversible",
        heading: "Nothing one-way",
        body: "Imports keep snapshots, exports keep identity, and the whole register can leave as CSV.",
      },
    ],
  },
  {
    kind: "cta",
    kicker: "Inventory",
    title: "A count you can act on",
    lead:
      "Bring in the spreadsheet you already have, review what it would change, and start deploying kits against real quantities.",
    actions: closingActions,
    footer: "FarmOps Inventory · part of the FarmOps O/S module line-up",
  },
];

export const INVENTORY_SLIDE_LINKS: Record<number, DeckSlideLinks> = {
  3: { heading: "See it in the app", links: [{ to: "/inventory", label: "Inventory", gated: true }] },
  4: { heading: "See it in the app", links: [{ to: "/inventory", label: "Import and reconcile", gated: true }] },
  7: {
    heading: "See it in the app",
    links: [
      { to: "/inventory", label: "Kits", gated: true },
      { to: "/procedures", label: "Linked manuals" },
    ],
  },
  9: {
    heading: "Next",
    links: [
      { to: "/demo", label: "All presentations" },
      { to: "/demo/maintenance", label: "Maintenance deck" },
      { to: "/plans", label: "Plans", gated: true },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Food & Growing
 * ------------------------------------------------------------------ */

export const FOOD_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps Food & Growing · Feature demo",
    title: "From what you plan to eat, back to what you plant",
    subtitle:
      "Food & Growing starts with a plan for the people you feed, then follows it out through garden, orchard, livestock, processing, preservation, storage and price history.",
    footer: "Feature demo · 11 pages · no farm records shown",
  },
  {
    kind: "statement",
    kicker: "The problem",
    title: "Growing decisions get made without the plan in the room",
    lead:
      "The garden is planted in spring, the freezer is filled in autumn, and the two are rarely the same conversation.",
    bullets: [
      "How much of each food a household actually needs is never written down.",
      "Plantings, harvests and preserved jars live in different notebooks.",
      "Nobody knows what the year's food was worth against what it would have cost.",
      "Season timing is remembered rather than recorded, so it drifts every year.",
    ],
  },
  {
    kind: "cards",
    kicker: "The plan",
    title: "People, foods, and quantities in one grid",
    cards: [
      {
        label: "Plan",
        heading: "People against foods",
        body: "A matrix of the people you feed and the foods you intend to produce, with a planning entry in each cell.",
      },
      {
        label: "Start fast",
        heading: "Seed from a template",
        body: "Begin from a template rather than an empty page, then edit every row to your own household.",
      },
      {
        label: "Storage",
        heading: "Plan rows become storage rows",
        body: "Food storage targets can be seeded straight from the plan, so the pantry is measured against intent.",
      },
      {
        label: "Overview",
        heading: "Yield progress",
        body: "A farm-wide overview with yield progress against the plan for the season.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Growing",
    title: "Every growing area keeps its own register",
    lead:
      "Each area is its own page with its own records, so a garden bed and a livestock pen are not forced into the same shape.",
    bullets: [
      "Garden plots, including bulk entry and seeding from a template.",
      "Crop plantings with harvests recorded against them.",
      "Orchard trees with bulk entry for a whole planting.",
      "Livestock register with its own dashboard, plus irrigation and processing pages.",
    ],
  },
  {
    kind: "statement",
    kicker: "Seasons",
    title: "Season timing recorded once and applied",
    lead:
      "Planting seasons are a register you keep, not folklore. When they change, the change propagates.",
    bullets: [
      "A plant seasons register you can edit and reset.",
      "Applying seasons pushes the timing through into the food plan.",
      "Food categories can be auto-classified and updated in bulk — as a visible action, not a silent one.",
      "Reports pull the season, plan and yield picture together.",
    ],
  },
  {
    kind: "statement",
    kicker: "Preserve",
    title: "Preservation guidance beside your own records",
    lead:
      "The preservation coach is the module's one AI screen, switched on per account and always advisory.",
    bullets: [
      "Guidance is generated on request, next to the crops and storage you actually recorded.",
      "It informs a person making a food-safety decision — it is not a substitute for tested canning guidance.",
      "The rest of the module is plain, deterministic record keeping with no model in the loop.",
      "Nothing is written to your registers without you doing it.",
    ],
    note: "Preservation and food safety remain your responsibility and your local guidance's.",
  },
  {
    kind: "cards",
    kicker: "Storage and value",
    title: "What you put away, and what it was worth",
    cards: [
      {
        label: "Storage",
        heading: "Pantry and freezer",
        body: "A food storage register measured against the plan rows it was seeded from.",
      },
      {
        label: "Prices",
        heading: "Price history",
        body: "Record prices over time, including a bulk refresh for regional produce and livestock products.",
      },
      {
        label: "Processing",
        heading: "Batches",
        body: "Processing batches tracked from the field or the pen through to what came out of them.",
      },
      {
        label: "Reports",
        heading: "The year on a page",
        body: "Structured reports drawn from the same records rather than a separate summary you maintain.",
      },
    ],
  },
  {
    kind: "cta",
    kicker: "Food & Growing",
    title: "Plan the food, then follow it all the way",
    lead:
      "Start from the plan for the people you feed and let the growing, processing and storage records answer back.",
    actions: closingActions,
    footer: "FarmOps Food & Growing · part of the FarmOps O/S module line-up",
  },
];

export const FOOD_SLIDE_LINKS: Record<number, DeckSlideLinks> = {
  3: {
    heading: "See it in the app",
    links: [
      { to: "/food/plan", label: "Food plan", gated: true },
      { to: "/food", label: "Overview", gated: true },
    ],
  },
  4: {
    heading: "See it in the app",
    links: [
      { to: "/food/garden", label: "Garden", gated: true },
      { to: "/food/orchard", label: "Orchard", gated: true },
      { to: "/food/livestock", label: "Livestock", gated: true },
    ],
  },
  5: { heading: "See it in the app", links: [{ to: "/food/seasons", label: "Seasons", gated: true }] },
  6: { heading: "See it in the app", links: [{ to: "/food/preserve", label: "Preserve", gated: true }] },
  7: {
    heading: "See it in the app",
    links: [
      { to: "/food/storage", label: "Storage", gated: true },
      { to: "/food/prices", label: "Prices", gated: true },
      { to: "/food/reports", label: "Reports", gated: true },
    ],
  },
  8: {
    heading: "Next",
    links: [
      { to: "/demo", label: "All presentations" },
      { to: "/demo/farmops_o_s", label: "FarmOps O/S deck" },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Procedures / Knowledge Base — free forever
 * ------------------------------------------------------------------ */

export const PROCEDURES_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps Procedures · Feature demo · free forever",
    title: "The knowledge base that never asks for a subscription",
    subtitle:
      "Procedures holds your manuals, standard operating procedures and how-we-do-it notes as self-contained pages you can export. It is free in every edition of FarmOps.",
    footer: "Feature demo · 10 pages · free module, no subscription",
  },
  {
    kind: "statement",
    kicker: "Why free",
    title: "Knowledge should not be the thing you lose",
    lead:
      "A knowledge base is where the answers about your property live. Locking it behind a bill is the fastest way to make it untrustworthy.",
    bullets: [
      "Procedures is free forever, in the hosted and self-hosted editions alike.",
      "Each page is a self-contained file you can export and read without FarmOps.",
      "Import and export both work, so the door is open in each direction.",
      "Paid modules link to procedures; procedures never depend on a paid module.",
    ],
  },
  {
    kind: "cards",
    kicker: "Authoring",
    title: "Write it, or bring it",
    cards: [
      {
        label: "Write",
        heading: "Editable pages",
        body: "A small wiki of procedure documents you can edit in place, each one exportable on its own.",
      },
      {
        label: "Assist",
        heading: "Drafting help",
        body: "An assisted prompt for drafting a procedure, and a generator that produces an SOP from an inventory item.",
      },
      {
        label: "Import",
        heading: "Documents you already have",
        body: "Bring in chat exports, Markdown or text, CSV or JSON, PDFs and Word documents.",
      },
      {
        label: "Verify",
        heading: "Check the engine first",
        body: "A test card confirms which AI engine is answering before a long job runs, so you know what handled your text.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Import and summarise",
    title: "A long export becomes a shelf of articles",
    lead:
      "Dropped files are read in your browser and split into items. Only the extracted text is sent for summarising, and only for the items you keep.",
    bullets: [
      "Choose one article per item, or group related items into topics with an extra clustering pass.",
      "Select and deselect items before the summarising run, which is capped per run.",
      "The result is a report: what was saved, renamed or failed, with source attribution and text sizes.",
      "Files and items that were skipped are listed with the reason instead of vanishing.",
    ],
  },
  {
    kind: "statement",
    kicker: "Connected",
    title: "Procedures are attached to the things they describe",
    lead:
      "A procedure is more useful when the equipment, the part and the kit all point at it.",
    bullets: [
      "Procedures link to inventory items, and links can be made at section level rather than whole page.",
      "Page metadata names the asset and type, which is how kits find their matching manuals.",
      "Maintenance imports operator and workshop manuals straight into a procedure page and links it to the machine.",
      "Appending to an existing manual is supported, so a second document extends the first.",
    ],
  },
  {
    kind: "cards",
    kicker: "Discipline",
    title: "Assisted, never automatic",
    cards: [
      {
        label: "Gated",
        heading: "AI is opt-in",
        body: "Every assisted screen is switched on per account, and each run is visible with its engine and timing.",
      },
      {
        label: "Local first",
        heading: "Parsing in your browser",
        body: "Uploaded documents are parsed on your machine; only extracted text leaves it.",
      },
      {
        label: "Reviewed",
        heading: "Saving is a decision",
        body: "Selection happens before the run and the report happens after — no page appears without your action.",
      },
      {
        label: "Portable",
        heading: "Yours to take",
        body: "Pages export individually as self-contained files, whatever you decide about FarmOps later.",
      },
    ],
  },
  {
    kind: "cta",
    kicker: "Procedures · free forever",
    title: "Start with the knowledge base",
    lead:
      "It costs nothing, it works on its own, and it is the fastest way to see whether FarmOps fits how your property runs.",
    actions: [
      "Open Procedures and import a document you already have",
      "Download this deck as a PDF or PowerPoint handout",
      "See what the paid modules add on the Plans page",
    ],
    footer: "FarmOps Procedures · free in every edition",
  },
];

export const PROCEDURES_SLIDE_LINKS: Record<number, DeckSlideLinks> = {
  3: { heading: "See it in the app", links: [{ to: "/procedures", label: "Procedures" }] },
  4: { heading: "See it in the app", links: [{ to: "/procedures/ingest", label: "Import & summarise" }] },
  5: {
    heading: "See it in the app",
    links: [
      { to: "/procedures", label: "Procedures" },
      { to: "/inventory", label: "Linked items", gated: true },
    ],
  },
  7: {
    heading: "Next",
    links: [
      { to: "/demo", label: "All presentations" },
      { to: "/plans", label: "Plans", gated: true },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Security & cameras
 * ------------------------------------------------------------------ */

export const SECURITY_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps Security · Feature demo",
    title: "Cameras recorded honestly, coverage drawn only from evidence",
    subtitle:
      "Security keeps a register of the cameras on the property, their live view where the stream can be played, and a coverage map that is drawn only where a position and an aim were actually recorded.",
    footer: "Feature demo · 11 pages · no farm records shown",
  },
  {
    kind: "statement",
    kicker: "The problem",
    title: "Most camera maps are a drawing, not a record",
    lead:
      "Coverage diagrams tend to show where somebody hoped a camera was pointing. That is the one thing a security record must not do.",
    bullets: [
      "A camera's position is assumed from a wall name rather than measured.",
      "Aim is drawn from the brochure instead of from the mount.",
      "Offline cameras still look green because nothing ever checked them.",
      "The camera exists on the network but nowhere in the property's electrical records.",
    ],
  },
  {
    kind: "cards",
    kicker: "The register",
    title: "One list of cameras with stable identity",
    cards: [
      {
        label: "Identity",
        heading: "Stable camera numbers",
        body: "Each camera gets a permanent number that is never reused, so history stays attached to the right device.",
      },
      {
        label: "Feeds",
        heading: "Playable kinds only",
        body: "No feed, HLS, MP4, MJPEG or embed. Addresses that browsers cannot play are refused with an explanation.",
      },
      {
        label: "Status",
        heading: "Online, offline, unknown",
        body: "Unknown is a real answer. A camera with no address is never reported as offline.",
      },
      {
        label: "Brands",
        heading: "Brand notes",
        body: "A brands tab records what each manufacturer actually allows, including where no public live-video access exists.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Status",
    title: "Freshness is part of the answer",
    lead:
      "A status without a time is a rumour. Every check records when it happened and how it turned out.",
    bullets: [
      "Checks are labelled fresh, ageing or never checked, with fresh meaning checked in the last ten minutes.",
      "Stale cameras are flagged for a re-check, and a check-all sweep can run across the register.",
      "Cameras with no address are skipped rather than counted as failures.",
      "The map and the coverage summary read the same status the list does.",
    ],
  },
  {
    kind: "statement",
    kicker: "Coverage",
    title: "A cone is drawn only when position and aim are both known",
    lead:
      "Coverage wedges are geometry in feet from recorded values. Miss either value and the camera is listed as a gap instead of guessed onto the plan.",
    bullets: [
      "The coverage summary counts placed, aimed and online cameras.",
      "Any camera missing from the map is named, with the reason: no feed, no position, or no aim.",
      "Published field of view and range for known models prefill a value — they never overwrite one you recorded.",
      "No position is ever inferred from a description.",
    ],
  },
  {
    kind: "statement",
    kicker: "Before a grid exists",
    title: "Compass sides for a building that has not been measured yet",
    lead:
      "New sites rarely start with a measured grid. Cameras can be placed by compass side and slot until one exists.",
    bullets: [
      "Record the side of the building and the slot along it.",
      "Two cameras on the same side split the arc between them by their field of view.",
      "Compass placement is never silently converted into exact coordinates.",
      "When a building grid is defined later, real positions supersede the compass view.",
    ],
  },
  {
    kind: "statement",
    kicker: "Local bridges",
    title: "Cameras with no public video access can still be viewed",
    lead:
      "Where a brand offers no public live-video access, a local bridge on your own network can republish the stream in a form a browser plays.",
    bullets: [
      "The bridge wizard builds the stream and snapshot addresses from a base address and the exact stream name.",
      "Duplicate stream names are flagged before they are saved.",
      "A secure page loading an insecure local stream is called out as a mixed-content problem, with what to do about it.",
      "FarmOps does not use unofficial cloud clients or store brand account credentials for video.",
    ],
  },
  {
    kind: "statement",
    kicker: "Linked to electrical",
    title: "A camera is also a load on a circuit",
    lead:
      "A camera can be given its own electrical record — described from the model, the mount and the recorded side — without inventing anything about the wiring.",
    bullets: [
      "Creation is preview first, and writes only when you confirm it.",
      "Panel, circuit, breaker, voltage, current and exact position are withheld because they were not observed.",
      "Every write is recorded in the electrical change history.",
      "A camera cannot get an electrical record without a recorded side, and cannot be linked twice.",
    ],
  },
  {
    kind: "cta",
    kicker: "Security",
    title: "A camera register you can defend",
    lead:
      "Add the cameras, record what you actually measured, and let the gaps stay visible until you close them.",
    actions: closingActions,
    footer: "FarmOps Security · part of the FarmOps O/S module line-up",
  },
];

export const SECURITY_SLIDE_LINKS: Record<number, DeckSlideLinks> = {
  3: { heading: "See it in the app", links: [{ to: "/security", label: "Security", gated: true }] },
  4: { heading: "See it in the app", links: [{ to: "/security", label: "Camera status", gated: true }] },
  6: {
    heading: "See it in the app",
    links: [
      { to: "/building-grids", label: "Building grids", gated: true },
      { to: "/site-plan", label: "Site plan", gated: true },
    ],
  },
  8: {
    heading: "See it in the app",
    links: [
      { to: "/electrical", label: "Electrical", gated: true },
      { to: "/demo/electrical", label: "Electrical deck" },
    ],
  },
  9: {
    heading: "Next",
    links: [
      { to: "/demo", label: "All presentations" },
      { to: "/plans", label: "Plans", gated: true },
    ],
  },
};
