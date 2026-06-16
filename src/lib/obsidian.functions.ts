import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { slugify } from "./slug";
import {
  DAILY_FOLDER,
  WEEKLY_FOLDER,
  MONTHLY_FOLDER,
  QUARTERLY_FOLDER,
  YEARLY_FOLDER,
  TASKS_FOLDER,
  MAINTENANCE_FOLDER,
  CONSUMABLES_FOLDER,
  inventoryFolderFor,
  classifyPath,
  monthlyFileName,
  quarterlyFileName,
  yearlyFileName,
  isYearlyRollup,
} from "./obsidian-layout";

// ============================================================================
// Obsidian markdown sync — shared types
// ============================================================================
//
// Markdown layout in the Obsidian vault:
//   Daily/YYYY-MM-DD.md      one file per daily note
//   Tasks/<slug>.md          one file per task (includes scheduled "report" tasks)
//   Projects/<slug>.md       one file per project
//   Summaries/<id>.md        one file per summary
//   Inventory/<slug>.md      one file per inventory item
//   Maintenance/<id>.md      one file per maintenance record
//   Consumables/<slug>.md    one file per consumable
//
// Every file uses YAML frontmatter with a `bostead` block describing the
// source record (kind + id + slug). The body is human-editable markdown.

export type ObsidianFile = { path: string; content: string };

import { renderSummaryMarkdown } from "./obsidian-markdown";



const FRONT_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function escapeYaml(value: string): string {
  if (value === "") return '""';
  if (/[":#\n\-\[\]{}&*!|>'%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function toYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${escapeYaml(String(item))}`);
      }
    } else if (typeof v === "object") {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 === undefined || v2 === null) continue;
        lines.push(`  ${k2}: ${escapeYaml(String(v2))}`);
      }
    } else {
      lines.push(`${k}: ${escapeYaml(String(v))}`);
    }
  }
  return lines.join("\n");
}

function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = text.match(FRONT_RE);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, unknown> = {};
  const lines = m[1].split("\n");
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;
  let currentArr: string[] | null = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (raw.startsWith("  - ")) {
      if (currentArr) currentArr.push(unquote(raw.slice(4).trim()));
      continue;
    }
    if (raw.startsWith("  ") && currentObj) {
      const [k, ...rest] = raw.trim().split(":");
      currentObj[k.trim()] = unquote(rest.join(":").trim());
      continue;
    }
    const idx = raw.indexOf(":");
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    const val = raw.slice(idx + 1).trim();
    currentKey = key;
    if (val === "") {
      // nested object or array follows
      currentObj = {};
      currentArr = [];
      meta[key] = currentObj;
      // we don't know yet if obj or array — overwrite later
    } else if (val === "[]") {
      meta[key] = [];
      currentObj = null;
      currentArr = null;
    } else {
      meta[key] = unquote(val);
      currentObj = null;
      currentArr = null;
    }
    // re-bind array reference so subsequent "  - " entries go there
    if (currentArr && currentObj && currentKey) {
      // attach both — we'll resolve later via heuristics
    }
  }
  // Post-process: if any meta value is an empty object but the next lines were
  // array items, promote it. Simplest: rerun a small array detector.
  const meta2: Record<string, unknown> = {};
  let activeArr: string[] | null = null;
  let activeObj: Record<string, unknown> | null = null;
  let activeKey: string | null = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (raw.startsWith("  - ") && activeKey) {
      if (!activeArr) {
        activeArr = [];
        meta2[activeKey] = activeArr;
        activeObj = null;
      }
      activeArr.push(unquote(raw.slice(4).trim()));
      continue;
    }
    if (raw.startsWith("  ") && activeKey) {
      if (!activeObj) {
        activeObj = {};
        meta2[activeKey] = activeObj;
        activeArr = null;
      }
      const [k, ...rest] = raw.trim().split(":");
      activeObj[k.trim()] = unquote(rest.join(":").trim());
      continue;
    }
    const idx = raw.indexOf(":");
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    const val = raw.slice(idx + 1).trim();
    activeKey = key;
    activeArr = null;
    activeObj = null;
    if (val === "") {
      meta2[key] = {};
    } else if (val === "[]") {
      meta2[key] = [];
    } else {
      meta2[key] = unquote(val);
    }
  }
  return { meta: meta2, body: m[2] };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function buildFile(meta: Record<string, unknown>, body: string): string {
  return `---\n${toYaml(meta)}\n---\n\n${body}\n`;
}

function safeSlug(s: string, fallback: string): string {
  const v = slugify(s || "");
  return v || fallback;
}

// ============================================================================
// Export
// ============================================================================

export const obsidianExport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ files: ObsidianFile[] }> => {
    const { supabase } = context;
    const files: ObsidianFile[] = [];

    const [notesQ, tasksQ, projectsQ, summariesQ, inventoryQ, maintenanceQ, consumablesQ] = await Promise.all([
      supabase.from("daily_notes").select("*").order("date", { ascending: true }),
      supabase.from("tasks").select("*").order("created_at", { ascending: true }),
      supabase.from("projects").select("*").order("name", { ascending: true }),
      supabase.from("summaries").select("*").order("created_at", { ascending: true }),
      supabase.from("inventory_items").select("*").order("name", { ascending: true }),
      supabase.from("maintenance_records").select("*").order("performed_at", { ascending: true }),
      supabase.from("consumables").select("*").order("name", { ascending: true }),
    ]);

    for (const n of notesQ.data ?? []) {
      const meta = {
        bostead: { kind: "daily_note", id: n.id, date: n.date },
        date: n.date,
        updated: n.updated_at,
      };
      files.push({ path: `${DAILY_FOLDER}/${n.date}.md`, content: buildFile(meta, n.markdown_content || "") });
    }

    for (const t of tasksQ.data ?? []) {
      const meta = {
        bostead: { kind: "task", id: t.id, slug: t.slug },
        title: t.title,
        status: t.status,
        percent: t.percent_complete,
        start_at: t.start_at ?? "",
        closed_at: t.closed_at ?? "",
        tags: (t.project_tags ?? []) as string[],
      };
      const body = `# ${t.title}\n\n*Status:* ${t.status} — ${t.percent_complete}%\n`;
      files.push({ path: `${TASKS_FOLDER}/${t.slug}.md`, content: buildFile(meta, body) });
    }

    for (const p of projectsQ.data ?? []) {
      const meta = {
        bostead: { kind: "project", id: p.id, slug: p.slug },
        name: p.name,
        start_date: p.start_date ?? "",
      };
      const body = `# ${p.name}\n\n${p.description ?? ""}\n`;
      // Projects (lightweight metadata) live alongside the monthly rollups by default.
      files.push({ path: `${MONTHLY_FOLDER}/_projects/${p.slug}.md`, content: buildFile(meta, body) });
    }

    for (const s of summariesQ.data ?? []) {
      const meta = {
        bostead: { kind: "summary", id: s.id },
        mode: s.mode,
        status: s.status,
        period_start: s.period_start,
        period_end: s.period_end,
        scope_project: s.scope_project ?? "",
      };
      const payload = s.edited_summary ?? s.generated_summary;
      const body =
        renderSummaryMarkdown(payload, s.mode, s.period_start, s.period_end, s.scope_project) +
        "\n\n<!-- structured payload below — used for round-trip import; safe to ignore -->\n" +
        "```json\n" + JSON.stringify(payload, null, 2) + "\n```\n";
      const tag = s.scope_project ?? null;
      let folder: string;
      let fileName: string;
      if (s.mode === "weekly_report") {
        folder = WEEKLY_FOLDER;
        fileName = `${s.period_start} ${tag ?? "weekly"}`.trim();
      } else if (s.mode === "quarter_review") {
        folder = QUARTERLY_FOLDER;
        fileName = quarterlyFileName(s.period_start, tag);
      } else if (s.mode === "monthly_rollup") {
        folder = MONTHLY_FOLDER;
        fileName = monthlyFileName(s.period_start, tag);
      } else if (s.mode === "yearly_rollup") {
        folder = YEARLY_FOLDER;
        fileName = yearlyFileName(s.period_start, tag);
      } else if (s.mode === "daily_recap") {
        folder = DAILY_FOLDER;
        fileName = `${s.period_start.slice(0, 10)} recap`;
      } else if (s.mode === "project_rollup") {
        if (isYearlyRollup(s.period_start, s.period_end)) {
          folder = YEARLY_FOLDER;
          fileName = yearlyFileName(s.period_start, tag);
        } else {
          folder = MONTHLY_FOLDER;
          fileName = monthlyFileName(s.period_start, tag);
        }
      } else {
        folder = `${MONTHLY_FOLDER}/_task_updates`;
        fileName = s.id;
      }
      const safe = fileName.replace(/[\\/:*?"<>|]/g, "-").trim();
      files.push({ path: `${folder}/${safe}.md`, content: buildFile(meta, body) });
    }

    for (const i of inventoryQ.data ?? []) {
      const slug = safeSlug(i.name || i.sku || "", i.id);
      const itemType = (i as { item_type?: string | null }).item_type ?? null;
      const folder = inventoryFolderFor(itemType);
      const meta = {
        bostead: { kind: "inventory_item", id: i.id, slug },
        name: i.name ?? "",
        item_type: itemType ?? "",
        sku: i.sku ?? "",
        category: i.category ?? "",
        location: i.location ?? "",
        status: i.status,
        quantity: i.quantity ?? "",
        unit: i.unit ?? "",
        min_quantity: i.min_quantity ?? "",
        reorder_level: i.reorder_level ?? "",
        unit_cost: i.unit_cost ?? "",
        vendor: i.vendor ?? "",
        barcode: i.barcode ?? "",
        current_hours: i.current_hours,
        current_miles: i.current_miles,
        usage_tracking: i.usage_tracking,
        tags: (i.tags ?? []) as string[],
      };
      const body = `# ${i.name ?? "Inventory item"}\n\n${i.description ?? ""}\n\n${i.notes ?? ""}\n`;
      files.push({ path: `${folder}/${slug}.md`, content: buildFile(meta, body) });
    }

    for (const m of maintenanceQ.data ?? []) {
      const meta = {
        bostead: { kind: "maintenance_record", id: m.id, asset_id: m.asset_id ?? "" },
        title: m.title ?? "",
        asset_name: m.asset_name ?? "",
        asset_id: m.asset_id ?? "",
        service_type: m.service_type ?? "",
        status: m.status ?? "",
        performed_at: m.performed_at ?? "",
        due_at: m.due_at ?? "",
        scheduled_date: m.scheduled_date ?? "",
        completed_date: m.completed_date ?? "",
        recurrence: m.recurrence ?? "",
        cost: m.cost ?? "",
        vendor: m.vendor ?? "",
        consumables_used: m.consumables_used ?? [],
      };
      const body = `# ${m.title ?? m.asset_name ?? "Maintenance"}\n\n${m.description ?? ""}\n\n${m.notes ?? ""}\n`;
      files.push({ path: `${MAINTENANCE_FOLDER}/${m.id}.md`, content: buildFile(meta, body) });
    }

    for (const c of consumablesQ.data ?? []) {
      const slug = safeSlug(c.name || "", c.id);
      const meta = {
        bostead: { kind: "consumable", id: c.id, slug },
        name: c.name,
        unit: c.unit ?? "",
        category: c.category ?? "",
        quantity_in_stock: c.quantity_in_stock,
        min_quantity: c.min_quantity,
        cost_per_unit: c.cost_per_unit ?? "",
      };
      const body = `# ${c.name}\n`;
      files.push({ path: `${CONSUMABLES_FOLDER}/${slug}.md`, content: buildFile(meta, body) });
    }

    return { files };
  });

// ============================================================================
// Import
// ============================================================================

const FileSchema = z.object({ path: z.string(), content: z.string() });

export const obsidianImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ files: z.array(FileSchema) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let dailyNotes = 0;
    let tasks = 0;
    let projects = 0;
    let summaries = 0;
    let inventory = 0;
    let maintenance = 0;
    let consumables = 0;

    const num = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s ? s : null;
    };

    for (const file of data.files) {
      if (!file.path.toLowerCase().endsWith(".md")) continue;
      const { meta, body } = parseFrontmatter(file.content);
      const bostead = (meta.bostead as Record<string, string> | undefined) ?? {};
      const kindFromBostead = bostead.kind;
      const baseName = file.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
      const classified = classifyPath(file.path);
      const kind = (kindFromBostead as string | undefined) || classified?.kind || null;
      if (!kind) continue;

      try {
        if (kind === "daily_note") {
          const date = (meta.date as string) || baseName;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const { error } = await supabase
            .from("daily_notes")
            .upsert(
              { user_id: userId, date, markdown_content: body.trim() },
              { onConflict: "user_id,date" },
            );
          if (!error) dailyNotes++;
        } else if (kind === "task") {
          const slug = safeSlug((bostead.slug as string) || baseName, baseName);
          const title = (meta.title as string) || baseName;
          const status = ["open", "blocked", "done"].includes(meta.status as string)
            ? (meta.status as "open" | "blocked" | "done")
            : "open";
          const percent = Math.max(0, Math.min(100, Number(meta.percent ?? 0))) || 0;
          const start_at = meta.start_at ? String(meta.start_at) : null;
          const closed_at = meta.closed_at ? String(meta.closed_at) : null;
          const project_tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
          const { error } = await supabase.from("tasks").upsert(
            {
              user_id: userId,
              slug,
              title,
              status,
              percent_complete: percent,
              start_at: start_at || null,
              closed_at: closed_at || null,
              project_tags,
            },
            { onConflict: "user_id,slug" },
          );
          if (!error) tasks++;
        } else if (kind === "project") {
          const slug = safeSlug((bostead.slug as string) || baseName, baseName);
          const name = (meta.name as string) || baseName;
          const start_date = meta.start_date ? String(meta.start_date) : null;
          const description = body.replace(/^#\s.*\n/, "").trim() || null;
          const { error } = await supabase.from("projects").upsert(
            {
              user_id: userId,
              slug,
              name,
              start_date: start_date || null,
              description,
            },
            { onConflict: "user_id,slug" },
          );
          if (!error) projects++;
        } else if (kind === "summary") {
          const id = (bostead.id as string) || baseName;
          if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
          const mode = meta.mode as string;
          const period_start = meta.period_start as string;
          const period_end = meta.period_end as string;
          if (!mode || !period_start || !period_end) continue;
          const jsonMatch = body.match(/```json\n([\s\S]*?)\n```/);
          let payload: unknown = null;
          if (jsonMatch) {
            try {
              payload = JSON.parse(jsonMatch[1]);
            } catch {
              payload = { text: body };
            }
          } else {
            payload = { text: body.trim() };
          }
          const status = ["draft", "reviewed", "published"].includes(meta.status as string)
            ? (meta.status as "draft" | "reviewed" | "published")
            : "draft";
          const { error } = await supabase.from("summaries").upsert(
            {
              id,
              user_id: userId,
              mode: mode as
                | "project_rollup"
                | "task_update"
                | "weekly_report"
                | "quarter_review"
                | "daily_recap"
                | "monthly_rollup"
                | "yearly_rollup",
              period_start,
              period_end,
              status,
              scope_project: (meta.scope_project as string) || null,
              edited_summary: payload as never,
              generated_summary: payload as never,
            },
            { onConflict: "id" },
          );
          if (!error) summaries++;
        } else if (kind === "inventory_item") {
          const id = (bostead.id as string) || "";
          const name = str(meta.name) || baseName;
          const description = body.replace(/^#\s.*\n/, "").trim();
          const row: Record<string, unknown> = {
            user_id: userId,
            name,
            sku: str(meta.sku),
            category: str(meta.category),
            location: str(meta.location),
            status: ["available", "in_use", "maintenance", "retired"].includes(meta.status as string)
              ? (meta.status as string)
              : "available",
            quantity: num(meta.quantity),
            unit: str(meta.unit),
            min_quantity: num(meta.min_quantity),
            reorder_level: num(meta.reorder_level),
            unit_cost: num(meta.unit_cost),
            vendor: str(meta.vendor),
            barcode: str(meta.barcode) ?? "",
            current_hours: num(meta.current_hours) ?? 0,
            current_miles: num(meta.current_miles) ?? 0,
            usage_tracking: str(meta.usage_tracking) ?? "none",
            tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
            item_type: str(meta.item_type),
            description,
          };
          if (/^[0-9a-f-]{36}$/i.test(id)) row.id = id;
          const { error } = await supabase.from("inventory_items").upsert(row as never, { onConflict: "id" });
          if (!error) inventory++;
        } else if (kind === "maintenance_record") {
          const id = (bostead.id as string) || baseName;
          if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
          const description = body.replace(/^#\s.*\n/, "").trim();
          const consumablesUsed = Array.isArray(meta.consumables_used)
            ? meta.consumables_used
            : [];
          const { error } = await supabase.from("maintenance_records").upsert(
            {
              id,
              user_id: userId,
              title: str(meta.title),
              asset_name: str(meta.asset_name),
              asset_id: str(meta.asset_id),
              service_type: str(meta.service_type),
              status: str(meta.status),
              performed_at: str(meta.performed_at),
              due_at: str(meta.due_at),
              scheduled_date: str(meta.scheduled_date),
              completed_date: str(meta.completed_date),
              recurrence: str(meta.recurrence) ?? "none",
              cost: num(meta.cost),
              vendor: str(meta.vendor),
              consumables_used: consumablesUsed as never,
              description,
            },
            { onConflict: "id" },
          );
          if (!error) maintenance++;
        } else if (kind === "consumable") {
          const id = (bostead.id as string) || "";
          const name = str(meta.name) || baseName;
          const row: Record<string, unknown> = {
            user_id: userId,
            name,
            unit: str(meta.unit) ?? "pcs",
            category: str(meta.category) ?? "",
            quantity_in_stock: num(meta.quantity_in_stock) ?? 0,
            min_quantity: num(meta.min_quantity) ?? 0,
            cost_per_unit: num(meta.cost_per_unit) ?? 0,
          };
          if (/^[0-9a-f-]{36}$/i.test(id)) row.id = id;
          const { error } = await supabase.from("consumables").upsert(row as never, { onConflict: "id" });
          if (!error) consumables++;
        }
      } catch {
        // skip malformed file
      }
    }

    return { dailyNotes, tasks, projects, summaries, inventory, maintenance, consumables };
  });
