// Print-template system for FarmOps tasks.
//
// Pure rendering: each template turns a task set plus options into a complete,
// self-contained HTML document ready for a print window. Templates are modelled
// on the Homestead Year planner page types (THE GRID, THE WORK, THE WORK · YOUR
// OWN, THE LEDGER, THE RECORD) plus a plain FarmOps list.
//
// No data is invented here: printed rows only carry values the caller supplies.
// Blank rows are explicitly blank so they can be filled in by hand.

export interface PrintTask {
  title: string;
  slug: string;
  status: string;
  recurrence?: string | null;
  /** ISO date (YYYY-MM-DD) the task is scheduled/stamped for, when known. */
  date?: string | null;
  note?: string | null;
}

export type TemplateId =
  | "work"
  | "work-your-own"
  | "grid"
  | "ledger"
  | "record"
  | "farmops-list";

export interface TemplateOptions {
  /** Heading shown at the top of the sheet. */
  title: string;
  /** Small italic line under the heading. */
  subtitle?: string;
  /** Footer motto line, planner style. */
  motto?: string;
  /** Extra blank rows appended for handwriting. */
  blankRows: number;
  /** Month used by the grid template, as YYYY-MM. */
  month?: string;
}

export interface TaskPrintTemplate {
  id: TemplateId;
  name: string;
  description: string;
  orientation: "portrait" | "landscape";
  /** Whether the template consumes the task list at all. */
  usesTasks: boolean;
  defaultBlankRows: number;
}

export const TASK_PRINT_TEMPLATES: TaskPrintTemplate[] = [
  {
    id: "work",
    name: "The Work",
    description:
      "Printed task list with a tick box, a date-done column and a line for what happened.",
    orientation: "portrait",
    usesTasks: true,
    defaultBlankRows: 6,
  },
  {
    id: "work-your-own",
    name: "The Work · Your Own",
    description: "Nothing printed. Ruled rows only, for jobs written by hand in the field.",
    orientation: "portrait",
    usesTasks: false,
    defaultBlankRows: 24,
  },
  {
    id: "grid",
    name: "The Grid",
    description: "Month calendar with a box per day; dated tasks are printed in their day box.",
    orientation: "landscape",
    usesTasks: true,
    defaultBlankRows: 0,
  },
  {
    id: "ledger",
    name: "The Ledger",
    description:
      "Columned sheet for what went into store: item, quantity, method, value, running total.",
    orientation: "portrait",
    usesTasks: false,
    defaultBlankRows: 22,
  },
  {
    id: "record",
    name: "The Record",
    description: "Blank ruled page for weather, prices, what broke — anything a grid cannot hold.",
    orientation: "portrait",
    usesTasks: false,
    defaultBlankRows: 30,
  },
  {
    id: "farmops-list",
    name: "FarmOps List",
    description: "Plain compact FarmOps table: title, slug, status, recurrence. No decoration.",
    orientation: "portrait",
    usesTasks: true,
    defaultBlankRows: 0,
  },
];

export function getTemplate(id: string): TaskPrintTemplate | null {
  return TASK_PRINT_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLANNER_CSS = `
  body { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  .sheet-head { border-bottom: 2px solid #1a1a1a; padding-bottom: 6px; margin-bottom: 14px; }
  .eyebrow { font-size: 9px; letter-spacing: .22em; text-transform: uppercase; color: #6b6257; }
  h1 { font-size: 26px; letter-spacing: .04em; margin: 4px 0 2px; text-transform: uppercase; }
  .sub { font-style: italic; font-size: 11px; color: #5c554b; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 8.5px; letter-spacing: .16em; text-transform: uppercase; color: #6b6257;
       border-bottom: 1px solid #1a1a1a; padding: 0 6px 4px; text-align: left; font-weight: 600; }
  td { border-bottom: 1px solid #cdc6b8; padding: 7px 6px; font-size: 11px; vertical-align: bottom; }
  .tick { width: 26px; }
  .tick span { display: inline-block; width: 12px; height: 12px; border: 1px solid #1a1a1a; }
  .printed { font-style: italic; }
  .blank td { height: 24px; }
  .rule { height: 26px; border-bottom: 1px solid #cdc6b8; }
  .foot { position: fixed; bottom: 10px; left: 0; right: 0; display: flex;
          justify-content: space-between; font-size: 8.5px; letter-spacing: .18em;
          text-transform: uppercase; color: #6b6257; }
  .grid-cal { table-layout: fixed; }
  .grid-cal th { text-align: center; }
  .grid-cal td { height: 92px; vertical-align: top; border: 1px solid #b8b0a0; padding: 3px 4px; font-size: 9px; }
  .grid-cal .daynum { font-size: 10px; color: #6b6257; }
  .grid-cal .ev { display: block; margin-top: 2px; line-height: 1.25; }
  .grid-cal td.out { background: #f6f3ec; }
  .plain { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .plain th, .plain td { border: 1px solid #999; font-size: 10.5px; padding: 4px 6px; }
`;

function docShell(
  opts: TemplateOptions,
  orientation: "portrait" | "landscape",
  bodyHtml: string,
  bodyClass = "",
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>${esc(opts.title)}</title>
<style>
  @page { size: letter ${orientation}; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 22px; color: #1a1a1a; line-height: 1.35; }
  ${PLANNER_CSS}
  @media print { body { padding: 0; } }
</style>
</head>
<body class="${bodyClass}">
${bodyHtml}
</body></html>`;
}

function head(opts: TemplateOptions, eyebrow: string, heading: string): string {
  return `<div class="sheet-head">
  <div class="eyebrow">${esc(eyebrow)}</div>
  <h1>${esc(heading)}</h1>
  ${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ""}
</div>`;
}

function foot(opts: TemplateOptions): string {
  if (!opts.motto) return "";
  return `<div class="foot"><span>${esc(opts.title)}</span><span>${esc(opts.motto)}</span></div>`;
}

function blankRows(count: number, cells: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    out += `<tr class="blank">${'<td>&nbsp;</td>'.repeat(cells)}</tr>`;
  }
  return out;
}

function renderWork(tasks: PrintTask[], opts: TemplateOptions): string {
  const rows = tasks
    .map(
      (t) => `<tr>
      <td class="tick"><span></span></td>
      <td class="printed">${esc(t.title)}${
        t.recurrence && t.recurrence !== "none" ? ` <em>(${esc(t.recurrence)})</em>` : ""
      }</td>
      <td>${esc(t.date ?? "")}</td>
      <td>${esc(t.note ?? "")}</td>
    </tr>`,
    )
    .join("");
  return docShell(
    opts,
    "portrait",
    `${head(opts, "FarmOps · Bostead Farms", "The Work")}
<table>
  <thead><tr><th></th><th>Job</th><th>Date done</th><th>What happened</th></tr></thead>
  <tbody>${rows}${blankRows(opts.blankRows, 4)}</tbody>
</table>
${foot(opts)}`,
  );
}

function renderWorkYourOwn(_tasks: PrintTask[], opts: TemplateOptions): string {
  return docShell(
    opts,
    "portrait",
    `${head(opts, "FarmOps · Bostead Farms", "The Work · Your Own")}
<p class="sub">Nothing printed here. Your jobs, in your order. Tick it, date it, say what happened.</p>
<table>
  <thead><tr><th></th><th>Job</th><th>Date done</th><th>What happened</th></tr></thead>
  <tbody>${blankRows(Math.max(opts.blankRows, 1), 4)}</tbody>
</table>
${foot(opts)}`,
  );
}

function renderLedger(_tasks: PrintTask[], opts: TemplateOptions): string {
  return docShell(
    opts,
    "portrait",
    `${head(opts, "FarmOps · Bostead Farms", "The Ledger")}
<p class="sub">Everything that went into store. Write what it would have cost to buy.</p>
<table>
  <thead><tr><th>Date</th><th>Item</th><th>Quantity</th><th>Method</th><th>Store value</th><th>Running total</th></tr></thead>
  <tbody>${blankRows(Math.max(opts.blankRows, 1), 6)}</tbody>
</table>
${foot(opts)}`,
  );
}

function renderRecord(_tasks: PrintTask[], opts: TemplateOptions): string {
  const lines = Array.from({ length: Math.max(opts.blankRows, 1) })
    .map(() => `<div class="rule"></div>`)
    .join("");
  return docShell(
    opts,
    "portrait",
    `${head(opts, "FarmOps · Bostead Farms", "The Record")}
<p class="sub">Weather, prices, what broke, what the neighbour said.</p>
${lines}
${foot(opts)}`,
  );
}

/** Parses YYYY-MM into a year/month pair, defaulting to nothing when absent. */
export function parseMonth(month: string | undefined): { year: number; month: number } | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map((n) => Number(n));
  if (!y || !m || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function renderGrid(tasks: PrintTask[], opts: TemplateOptions): string {
  const parsed = parseMonth(opts.month);
  if (!parsed) {
    return docShell(
      opts,
      "landscape",
      `${head(opts, "FarmOps · Bostead Farms", "The Grid")}
<p class="sub">Choose a month to print the calendar.</p>`,
    );
  }
  const { year, month } = parsed;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDow = first.getUTCDay(); // 0 = Sunday
  const byDay = new Map<number, PrintTask[]>();
  for (const t of tasks) {
    if (!t.date) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.date);
    if (!m) continue;
    if (Number(m[1]) !== year || Number(m[2]) !== month) continue;
    const d = Number(m[3]);
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }

  const cells: string[] = [];
  for (let i = 0; i < startDow; i++) cells.push(`<td class="out">&nbsp;</td>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const events = (byDay.get(d) ?? [])
      .map((t) => `<span class="ev">· ${esc(t.title)}</span>`)
      .join("");
    cells.push(`<td><div class="daynum">${d}</div>${events}</td>`);
  }
  while (cells.length % 7 !== 0) cells.push(`<td class="out">&nbsp;</td>`);
  let rows = "";
  for (let i = 0; i < cells.length; i += 7) {
    rows += `<tr>${cells.slice(i, i + 7).join("")}</tr>`;
  }

  return docShell(
    opts,
    "landscape",
    `${head(opts, "FarmOps · Bostead Farms", `${MONTH_NAMES[month - 1]} ${year} · The Grid`)}
<table class="grid-cal">
  <thead><tr>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((d) => `<th>${d}</th>`)
    .join("")}</tr></thead>
  <tbody>${rows}</tbody>
</table>
${foot(opts)}`,
  );
}

function renderFarmopsList(tasks: PrintTask[], opts: TemplateOptions): string {
  const rows = tasks
    .map(
      (t) => `<tr>
    <td>${esc(t.title)}</td>
    <td>${esc(t.slug)}</td>
    <td>${esc(t.status)}</td>
    <td>${esc(t.recurrence && t.recurrence !== "none" ? t.recurrence : "")}</td>
    <td>${esc(t.date ?? "")}</td>
  </tr>`,
    )
    .join("");
  return docShell(
    opts,
    "portrait",
    `<h1 style="font-size:18px;text-transform:none;letter-spacing:0">${esc(opts.title)}</h1>
${opts.subtitle ? `<p style="font-size:11px;color:#555">${esc(opts.subtitle)}</p>` : ""}
<table>
  <thead><tr><th>Title</th><th>Slug</th><th>Status</th><th>Recurrence</th><th>Date</th></tr></thead>
  <tbody>${rows}${blankRows(opts.blankRows, 5)}</tbody>
</table>`,
    "plain",
  );
}

const RENDERERS: Record<TemplateId, (tasks: PrintTask[], opts: TemplateOptions) => string> = {
  work: renderWork,
  "work-your-own": renderWorkYourOwn,
  grid: renderGrid,
  ledger: renderLedger,
  record: renderRecord,
  "farmops-list": renderFarmopsList,
};

/** Renders a complete printable HTML document for the chosen template. */
export function renderTaskPrint(
  templateId: string,
  tasks: PrintTask[],
  opts: TemplateOptions,
): string {
  const tpl = getTemplate(templateId);
  if (!tpl) throw new Error(`Unknown task print template: ${templateId}`);
  return RENDERERS[tpl.id](tpl.usesTasks ? tasks : [], opts);
}
