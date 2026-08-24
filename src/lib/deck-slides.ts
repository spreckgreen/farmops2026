// Slide content for the FarmOps instructional deck at /deck.
// Every "shot" slide points at a real screenshot captured from this app
// (src/assets/deck/*.png), so the deck can never drift into mockups.
import tasks from "@/assets/deck/tasks.png";
import tasksScheduled from "@/assets/deck/tasks-scheduled.png";
import tasksBacklog from "@/assets/deck/tasks-backlog.png";
import projects from "@/assets/deck/projects.png";
import reports from "@/assets/deck/reports.png";
import inventory from "@/assets/deck/inventory.png";
import serviceScheduling from "@/assets/deck/service-scheduling.png";
import maintenance from "@/assets/deck/maintenance.png";
import maintenanceForecast from "@/assets/deck/maintenance-forecast.png";
import maintenanceGenerate from "@/assets/deck/maintenance-generate-schedule.png";
import maintenanceImport from "@/assets/deck/maintenance-import-manual.png";
import procedures from "@/assets/deck/procedures.png";
import proceduresIngest from "@/assets/deck/procedures-ingest.png";
import food from "@/assets/deck/food.png";
import foodGarden from "@/assets/deck/food-garden.png";
import foodOrchard from "@/assets/deck/food-orchard.png";
import foodLivestock from "@/assets/deck/food-livestock.png";
import foodStorage from "@/assets/deck/food-storage.png";
import foodIrrigation from "@/assets/deck/food-irrigation.png";
import vault from "@/assets/deck/vault.png";
import sync from "@/assets/deck/sync.png";
import aiEngines from "@/assets/deck/admin-ai-engines.png";

export type Slide =
  | {
      kind: "title";
      title: string;
      subtitle: string;
      kicker: string;
      footer: string;
    }
  | {
      kind: "section";
      number: string;
      title: string;
      subtitle: string;
      covers: string[];
    }
  | { kind: "text"; kicker: string; title: string; bullets: string[]; note?: string }
  | {
      kind: "shot";
      kicker: string;
      title: string;
      route: string;
      image: string;
      steps: string[];
      tip?: string;
    };

export const SLIDES: Slide[] = [
  {
    kind: "title",
    kicker: "Homestead operations handbook",
    title: "FarmOps",
    subtitle:
      "Run the whole homestead from one place — daily work, equipment, food, and the paperwork that keeps it all repeatable.",
    footer: "A guided tour in 30 pages, using real screens from your own install",
  },
  {
    kind: "text",
    kicker: "Why this exists",
    title: "The homestead problem",
    bullets: [
      "Your knowledge lives in three notebooks, a phone gallery, and your head.",
      "The mower gets serviced when it sounds wrong, not at 100 hours.",
      "You buy a filter you already have because nothing tracks the shelf.",
      "Nobody else can do the chore if you're not there to explain it.",
    ],
    note: "FarmOps fixes all four by writing things down once and reusing them.",
  },
  {
    kind: "text",
    kicker: "How to use this deck",
    title: "Read it like a walkthrough",
    bullets: [
      "Five sections: daily work, what you own, keeping it running, food, and the back office.",
      "Each page shows the real screen plus the three or four steps to use it.",
      "Arrow keys or Space move between pages; press G for the grid of all 30.",
      "Press P (or use Print) to save the whole deck as a PDF handout.",
    ],
    note: "Start at section 1 and set up in order — later sections lean on earlier data.",
  },

  {
    kind: "section",
    number: "01",
    title: "Plan the day",
    subtitle: "Tasks, schedules, projects, and a daily log that writes your history for you.",
    covers: ["Open tasks", "Scheduled work", "Backlog", "Projects", "Reports"],
  },
  {
    kind: "shot",
    kicker: "Section 1 · Daily work",
    title: "Your task board",
    route: "/tasks",
    image: tasks,
    steps: [
      "Add a task with a plain title — \"replace mower blades\" is enough to start.",
      "Tag it with a project so it rolls up into the right area later.",
      "Move status as work happens: open → blocked → done.",
      "Percent complete lets long jobs show progress without extra tasks.",
    ],
    tip: "Anything that will take more than a minute belongs here, not in your head.",
  },
  {
    kind: "shot",
    kicker: "Section 1 · Daily work",
    title: "Scheduled and recurring work",
    route: "/tasks/scheduled",
    image: tasksScheduled,
    steps: [
      "Give a task a start date and it appears on the scheduled view for that day.",
      "Set a recurrence for chores that repeat — weekly coop bedding, monthly generator run.",
      "When a recurring task closes, the next occurrence is stamped automatically.",
      "Bulk restamp moves a whole day of missed work forward instead of retyping it.",
    ],
    tip: "All dates use the farm timezone, so \"today\" means today on the property.",
  },
  {
    kind: "shot",
    kicker: "Section 1 · Daily work",
    title: "The backlog is allowed to be big",
    route: "/tasks/backlog",
    image: tasksBacklog,
    steps: [
      "Park every someday idea here instead of losing it — fencing, a second hive, a new gate.",
      "Backlog items carry no date, so they never clutter the day view.",
      "When a season opens up, move an item to a date to pull it into the plan.",
      "Review the backlog once a month; delete freely, that's the point.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 1 · Daily work",
    title: "Projects group the work",
    route: "/projects",
    image: projects,
    steps: [
      "Create a project for anything with a beginning and an end — \"build the wood shed\".",
      "Break it into design elements and weight them by effort.",
      "Completion is calculated from the weighted elements, not a guess.",
      "Tasks tagged to the project feed the same rollup.",
    ],
    tip: "Ongoing routines stay as recurring tasks; projects are for things that finish.",
  },
  {
    kind: "shot",
    kicker: "Section 1 · Daily work",
    title: "Daily notes and reports",
    route: "/reports",
    image: reports,
    steps: [
      "Write a short daily note — weather, what got done, what broke.",
      "Rate energy and productivity so you can see patterns across a season.",
      "Weekly, monthly, and yearly rollups summarize the notes for you.",
      "Reports become the record you check next spring instead of guessing.",
    ],
  },

  {
    kind: "section",
    number: "02",
    title: "Know what you own",
    subtitle: "Every asset, part, and kit — with quantities you can actually trust.",
    covers: ["Inventory", "Types & tags", "Parts (BOM)", "Kits", "Service scheduling"],
  },
  {
    kind: "shot",
    kicker: "Section 2 · Inventory",
    title: "One list for equipment and parts",
    route: "/inventory",
    image: inventory,
    steps: [
      "Add each item with a name, inventory type, location, and quantity.",
      "Set a minimum quantity so the Low Stock counter warns you before a job stalls.",
      "Types separate serviceable equipment from consumables like oil and filters.",
      "Import a CSV to load a shed in one pass; reconciliation shows the diff first.",
    ],
    tip: "Location matters more than you think — \"Greenfield Garage Shed\" saves a search later.",
  },
  {
    kind: "text",
    kicker: "Section 2 · Inventory",
    title: "Parts lists, assemblies, and kits",
    bullets: [
      "Open an item's Parts (BOM) panel to list the components it's built from.",
      "Give a group its own item of type 32 Kits — a ham radio field kit, a canning kit.",
      "Check a kit out for a deployment and component stock decrements automatically.",
      "Check it back in and the parts you actually returned go back on the shelf.",
      "The pack-out checklist prints, and each line takes an issue reason plus a note.",
    ],
    note: "Shortages, defects, and substitutions get recorded before you leave, not after.",
  },
  {
    kind: "shot",
    kicker: "Section 2 · Inventory",
    title: "Service scheduling by asset",
    route: "/service-scheduling",
    image: serviceScheduling,
    steps: [
      "Pick the assets that actually get serviced — parts and consumables are filtered out.",
      "Attach intervals in hours, miles, or calendar months.",
      "Log a reading whenever you note the hour meter; projections use the real rate.",
      "Schedules feed the maintenance list, so nothing depends on memory.",
    ],
  },

  {
    kind: "section",
    number: "03",
    title: "Keep it running",
    subtitle: "Maintenance records, forecasts, service manuals, and written procedures.",
    covers: ["Maintenance log", "Forecast", "Generated schedules", "Manual import", "Procedures"],
  },
  {
    kind: "shot",
    kicker: "Section 3 · Maintenance",
    title: "Log every service",
    route: "/maintenance",
    image: maintenance,
    steps: [
      "Record what was done, on which asset, on what date, and what it cost.",
      "Pick the asset from the dropdown so the record stays linked, not typed.",
      "List consumables used and stock comes down with the entry.",
      "Edit a record later when the invoice or the hour reading arrives.",
    ],
    tip: "A five-word note today is worth more than a perfect note you never write.",
  },
  {
    kind: "shot",
    kicker: "Section 3 · Maintenance",
    title: "See what's coming due",
    route: "/maintenance/forecast",
    image: maintenanceForecast,
    steps: [
      "The forecast projects due dates from measured usage, or an assumed rate if you have none.",
      "Assets missing usage snapshots are called out with an Add reading button.",
      "Order parts against the forecast instead of the day something fails.",
      "Add a reading after heavy use and the projection tightens immediately.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 3 · Maintenance",
    title: "Generate a maintenance schedule",
    route: "/maintenance/generate-schedule",
    image: maintenanceGenerate,
    steps: [
      "Select one or more assets — batch generation handles a whole shed at once.",
      "The routing panel shows which AI engine will run before you start.",
      "Review the proposed intervals and tasks, then confirm what to keep.",
      "A Maintenance plan document is written into Procedures and linked to the asset.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 3 · Maintenance",
    title: "Import a service manual",
    route: "/maintenance/import-manual",
    image: maintenanceImport,
    steps: [
      "Choose the manual type: service schedule, operator manual, or workshop manual.",
      "Paste the manual text and the parsed preview shows intervals, tasks, and part matches.",
      "Confirm fuzzy part matches — strictness is a slider, alternates are ranked.",
      "The impact summary lists what will be created or changed before you commit.",
    ],
    tip: "Manuals attach to equipment and radios only; consumables don't need one.",
  },
  {
    kind: "shot",
    kicker: "Section 3 · Procedures",
    title: "Write procedures once",
    route: "/procedures",
    image: procedures,
    steps: [
      "Every how-to lives here: SOPs, maintenance plans, manuals, checklists.",
      "Filter by type — pick Maintenance Plan to find plans by asset and interval.",
      "Append to an existing page when you learn something new; edits are dated.",
      "Link a procedure to an inventory item so it's found from the asset.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 3 · Procedures",
    title: "Bring in what you already wrote",
    route: "/procedures/ingest",
    image: proceduresIngest,
    steps: [
      "Paste or upload existing notes and they become properly titled procedure pages.",
      "Incremental sync only rewrites the pages that changed.",
      "Kit procedures are suggested automatically and attach with one click.",
      "Anything written here is what a helper reads when you're not home.",
    ],
  },

  {
    kind: "section",
    number: "04",
    title: "Grow and store food",
    subtitle: "Garden, orchard, livestock, irrigation, and a year of storage planned on purpose.",
    covers: ["Food hub", "Garden", "Orchard", "Livestock", "Storage", "Irrigation"],
  },
  {

  {
    kind: "shot",
    kicker: "Section 4 · Food",
    title: "Garden beds and plots",
    route: "/food/garden",
    image: foodGarden,
    steps: [
      "Lay out rows and positions so every plot has a real address.",
      "Assign what's planted where, with notes for variety and spacing.",
      "Plantings carry expected harvest dates that show up as work.",
      "Record harvests against the planting to learn what actually yields here.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 4 · Food",
    title: "Orchard and perennials",
    route: "/food/orchard",
    image: foodOrchard,
    steps: [
      "Log each tree or cane by species, variety, location, and planting date.",
      "Status tracks establishment, bearing, or removal.",
      "Pruning and spraying become recurring tasks tied to the season.",
      "Notes here pay off in year five, when you can't remember which row is which.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 4 · Food",
    title: "Livestock",
    route: "/food/livestock",
    image: foodLivestock,
    steps: [
      "Track animals by species, breed, tag, count, and purpose.",
      "Expected yield turns a flock into pounds you can plan meals around.",
      "Location and status keep culls, sales, and losses honest.",
      "Feed and health chores belong in recurring tasks.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 4 · Food",
    title: "Storage and a year of food",
    route: "/food/storage",
    image: foodStorage,
    steps: [
      "Enter what's on the shelf with quantity, unit, and best-by date.",
      "The storage plan sets pounds per person per year and target months of supply.",
      "Gaps between plan and shelf show exactly what to buy or grow next.",
      "Price per pound turns the gap into a budget number.",
    ],
    tip: "Plan first, then shop — it's the difference between stocked and cluttered.",
  },
  {
    kind: "shot",
    kicker: "Section 4 · Food",
    title: "Irrigation you can verify",
    route: "/food/irrigation",
    image: foodIrrigation,
    steps: [
      "Connected controllers sync zones, nozzles, and area automatically.",
      "Map a zone to a garden plot or an orchard tree so watering ties to plants.",
      "Run history records duration and gallons, not just intent.",
      "Weather forecasts land in the daily note so you can skip a cycle knowingly.",
    ],
  },

  {
    kind: "section",
    number: "05",
    title: "The back office",
    subtitle: "Secrets, sync, AI engines, and backups — the parts that protect everything else.",
    covers: ["Vault", "Sync", "AI engines", "Backup and recovery"],
  },
  {
    kind: "shot",
    kicker: "Section 5 · Back office",
    title: "The vault",
    route: "/vault",
    image: vault,
    steps: [
      "Store gate codes, well pump serials, and account details as encrypted entries.",
      "Personal entries stay yours; shared entries are visible to the household.",
      "Values are encrypted before storage — the database never holds plaintext.",
      "Keep a copy of the master key somewhere physical, off the server.",
    ],
    tip: "A vault you can't recover is a vault you don't have. Back the key up first.",
  },
  {
    kind: "shot",
    kicker: "Section 5 · Back office",
    title: "Sync and your own notes",
    route: "/sync",
    image: sync,
    steps: [
      "Push procedures out to a notes vault so they're readable offline in the barn.",
      "Incremental sync updates only changed pages instead of rewriting everything.",
      "Round-trip edits without losing your existing folder structure.",
      "Run it after any procedure session — it takes seconds.",
    ],
  },
  {
    kind: "shot",
    kicker: "Section 5 · Back office",
    title: "Choose your AI engine",
    route: "/admin/ai-engines",
    image: aiEngines,
    steps: [
      "Four slots: a local model on your own hardware, or a hosted provider.",
      "Test connection lists the provider's models and ranks them Good / Better / Best.",
      "Incompatible models are flagged and blocked instead of failing mid-job.",
      "Per-feature routing decides which engine writes manuals versus summaries.",
    ],
    tip: "Self-hosted keeps everything on the property; hosted is faster for long manuals.",
  },
  {
    kind: "text",
    kicker: "Getting started",
    title: "Your first week on FarmOps",
    bullets: [
      "Day 1 — Add your five most important assets and their locations.",
      "Day 2 — Write today's daily note. Keep it to three lines.",
      "Day 3 — Enter minimum quantities for the parts you hate running out of.",
      "Day 4 — Generate a maintenance plan for your mower and read it.",
      "Day 5 — Enter what's on the pantry shelf and set a storage target.",
      "Day 6 — Back up the vault master key somewhere off the machine.",
      "Day 7 — Review the week's report and delete half the backlog.",
    ],
    note: "The system pays you back the first time it tells you something you'd forgotten.",
  },
];

export const SLIDE_COUNT = SLIDES.length;

export function slideTitle(slide: Slide): string {
  return slide.kind === "title" ? slide.title : slide.title;
}
