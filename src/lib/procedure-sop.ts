// Pure helpers for inventory-item SOP drafting. Kept out of
// procedure-sop.functions.ts so that file stays a thin server-function wrapper.

/** Section skeleton every generated SOP must follow, in order. */
export const SOP_SECTIONS = [
  "Purpose",
  "Scope",
  "Safety",
  "Required tools and parts",
  "Pre-use checks",
  "Operating steps",
  "Shutdown and storage",
  "Routine maintenance",
  "Troubleshooting",
  "Records",
];

/** Plain text from stored TinyWiki HTML, for feeding existing procedures to the model. */
export function stripHtml(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip markdown/code fences the model sometimes wraps its output in. */
export function unfence(text: string): string {
  const t = String(text ?? "").trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

export const SOP_SYSTEM_PROMPT =
  "You write Standard Operating Procedures for a small farm's equipment and supplies. " +
  "Output TiddlyWiki markup ONLY — no HTML, no markdown fences, no preamble. " +
  "Markup rules: `!! Section` for section headings, `# step` for numbered steps, " +
  "`* point` for bullets, `''bold''` for emphasis. " +
  `Use exactly these sections, in order, each as a '!!' heading: ${SOP_SECTIONS.join(", ")}. ` +
  "Ground every specific (intervals, parts, capacities) in the provided item record, " +
  "maintenance history, or existing procedures. When a detail is unknown, write a " +
  "bracketed placeholder like [confirm from manufacturer manual] instead of inventing it. " +
  "Keep it practical and checkable: short imperative steps a helper could follow. " +
  "Safety must call out real hazards for this kind of item (fuel, PTO, blades, chemicals, " +
  "pressure, electricity) when they apply. Aim for 400-900 words.";

export interface SopItemRecord {
  name: string | null;
  sku: string | null;
  category: string | null;
  item_type: string | null;
  vendor: string | null;
  location: string | null;
  unit: string | null;
  quantity: number | null;
  usage_tracking: string | null;
  current_hours: number | null;
  current_miles: number | null;
  description: string | null;
  notes: string | null;
  tags: string[] | null;
  status: string | null;
}

export interface SopHistoryRow {
  title: string | null;
  service_type: string | null;
  description: string | null;
  performed_at: string | null;
  status: string | null;
}

export function sopItemLabel(it: SopItemRecord): string {
  return it.name || it.sku || "Inventory item";
}

export function buildSopPrompt(args: {
  item: SopItemRecord;
  history: SopHistoryRow[];
  linkedProcedures: Array<{ name: string; text: string }>;
  focus?: string;
}): string {
  const { item: it, history, linkedProcedures, focus } = args;
  const label = sopItemLabel(it);

  const itemBlock = [
    `NAME: ${label}`,
    `SKU: ${it.sku ?? "(none)"}`,
    `CATEGORY: ${it.category ?? "(none)"}`,
    `TYPE: ${it.item_type ?? "(none)"}`,
    `VENDOR: ${it.vendor ?? "(none)"}`,
    `LOCATION: ${it.location ?? "(none)"}`,
    `ON HAND: ${it.quantity ?? 0} ${it.unit ?? ""}`.trimEnd(),
    `STATUS: ${it.status ?? "(none)"}`,
    `USAGE TRACKING: ${it.usage_tracking ?? "none"} (hours: ${it.current_hours ?? 0}, miles: ${it.current_miles ?? 0})`,
    `TAGS: ${(it.tags ?? []).join(", ") || "(none)"}`,
    `DESCRIPTION: ${it.description ?? "(none)"}`,
    `NOTES: ${it.notes ?? "(none)"}`,
  ].join("\n");

  const historyBlock =
    history.length === 0
      ? "(no maintenance history)"
      : history
          .map(
            (r) =>
              `- ${r.performed_at?.slice(0, 10) ?? "undated"} | ${r.service_type ?? "service"} | ` +
              `${r.title ?? "(untitled)"} | ${r.status ?? ""} | ${String(r.description ?? "").slice(0, 200)}`,
          )
          .join("\n");

  const existingBlock =
    linkedProcedures.length === 0
      ? "(none)"
      : linkedProcedures.map((p) => `### ${p.name}\n${p.text}`).join("\n\n");

  return (
    `ITEM RECORD:\n${itemBlock}\n\n` +
    `MAINTENANCE HISTORY:\n${historyBlock}\n\n` +
    `EXISTING LINKED PROCEDURES (match their conventions, do not duplicate them):\n${existingBlock}\n\n` +
    (focus ? `USER FOCUS / EXTRA CONTEXT:\n${focus}\n\n` : "") +
    `Write the SOP for: ${label}`
  );
}
