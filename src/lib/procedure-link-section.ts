// Helpers that keep a managed "Linked Items" section in sync inside the
// procedure's wiki body whenever links are added or removed.
// Runs on the server, so it cannot use DOMParser — uses regex instead.

import type { LinkTargetKind } from "@/lib/procedure-links.functions";

export const MANAGED_HEADING = "!! Linked Items";
const MANAGED_NOTE = "//Auto-generated from links — edits below this heading will be overwritten.//";

export interface ManagedLink {
  kind: LinkTargetKind;
  label: string;
  notes: string | null;
}

/** Unescape the entities introduced by buildTinyWikiHtml's escPre. */
function unescapePre(s: string): string {
  return s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

/**
 * Extract the wiki body for the content tiddler from a TinyWiki HTML doc.
 * Server-safe (no DOMParser). Returns "" when not parseable.
 */
export function extractBodyFromHtml(html: string, name: string): string {
  // Look for the main content tiddler div by title.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<div[^>]*title="${esc}"[^>]*>\\s*<pre>([\\s\\S]*?)<\\/pre>\\s*<\\/div>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return "";
  return unescapePre(m[1]);
}

/** Remove the managed section (heading + everything after) from a body. */
export function stripManagedSection(body: string): string {
  const idx = body.indexOf(MANAGED_HEADING);
  if (idx === -1) return body;
  return body.slice(0, idx).replace(/\s+$/g, "") + "\n";
}

/** Build the managed wiki section from the current set of links. */
export function buildManagedSection(links: ManagedLink[]): string {
  if (links.length === 0) return "";
  const inv = links.filter((l) => l.kind === "inventory");
  const maint = links.filter((l) => l.kind === "maintenance");

  const lines: string[] = ["", MANAGED_HEADING, MANAGED_NOTE, ""];

  if (inv.length) {
    lines.push("!!! Inventory");
    for (const l of inv) {
      const note = l.notes ? ` — ${l.notes}` : "";
      lines.push(`* ${l.label}${note}`);
    }
    lines.push("");
  }
  if (maint.length) {
    lines.push("!!! Maintenance");
    for (const l of maint) {
      const note = l.notes ? ` — ${l.notes}` : "";
      lines.push(`* ${l.label}${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Compose a fresh body = previous body (minus old section) + new section. */
export function composeBodyWithLinks(prevBody: string, links: ManagedLink[]): string {
  const base = stripManagedSection(prevBody || "");
  const section = buildManagedSection(links);
  if (!section) return base.replace(/\s+$/g, "") + "\n";
  return base.replace(/\s+$/g, "") + "\n" + section;
}
