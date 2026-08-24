// Pure helpers for turning existing maintenance_records rows into a
// "Maintenance plan" procedure body — used to backfill plan pages for
// schedules that were generated before plan documents existed.

export interface PlanRecord {
  title: string | null;
  service_type: string | null;
  recurrence: string | null;
  description: string | null;
  notes: string | null;
  due_at: string | null;
  scheduled_date: string | null;
  asset_name: string | null;
}

function esc(cell: string): string {
  return String(cell ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

/** "every 300 hours" -> "every 300 hours"; "none"/null -> "as needed". */
export function intervalLabel(recurrence: string | null): string {
  const r = (recurrence ?? "").trim();
  if (!r || r.toLowerCase() === "none") return "as needed";
  return r;
}

function firstDue(r: PlanRecord): string {
  const d = r.due_at ?? r.scheduled_date ?? null;
  return d ? String(d).slice(0, 10) : "—";
}

/** Extract the "Parts:" bullet block out of the record description, if any. */
export function partsFromDescription(description: string | null): string[] {
  const text = String(description ?? "");
  const m = text.match(/Parts:\s*\n([\s\S]*?)(\n\s*\n|$)/i);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function buildBackfilledPlanBody(
  pageName: string,
  assetName: string,
  records: PlanRecord[],
  opts: { date?: string } = {},
): string {
  const day = opts.date ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`! ${pageName}`, "");
  lines.push(`''Type:'' Maintenance plan`);
  lines.push(`''Asset:'' ${assetName}`);
  lines.push(`''Generated:'' ${day} (from saved maintenance records)`, "");
  lines.push("!! Service intervals", "");
  lines.push("|!Service|!Interval|!Type|!First due|!Parts|");
  for (const r of records) {
    lines.push(
      `|${esc(r.title ?? r.service_type ?? "Service")}|${esc(intervalLabel(r.recurrence))}|${
        esc(r.service_type ?? "—")
      }|${esc(firstDue(r))}|${esc(partsFromDescription(r.description).join(", ") || "—")}|`,
    );
  }
  lines.push("");
  lines.push("!! Task detail", "");
  for (const r of records) {
    lines.push(`!!! ${r.title ?? r.service_type ?? "Service"}`, "");
    lines.push(`Interval: ${intervalLabel(r.recurrence)}`, "");
    if (r.description) lines.push(r.description.trim(), "");
    if (r.notes) lines.push(`//${r.notes.trim()}//`, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
