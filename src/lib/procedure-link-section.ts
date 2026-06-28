// Helpers that keep a managed "Linked Items" section in sync inside the
// procedure's wiki body whenever links are added or removed.
// Runs on the server, so it cannot use DOMParser — uses regex instead.

import type { LinkTargetKind } from "@/lib/procedure-links.functions";

export const MANAGED_HEADING = "!! Linked Items";
const MANAGED_NOTE = "//Auto-generated from links — edits below this heading will be overwritten.//";

export interface ManagedLink {
  /** Stable identifier (target id) used to build a deterministic anchor slug. */
  id: string;
  kind: LinkTargetKind;
  label: string;
  notes: string | null;
}

/** Wiki-heading slug must mirror the renderer in src/lib/tinywiki.ts. */
export function slugifyHeading(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Anchor slug for a specific linked item — stable across renames. */
export function linkAnchorSlug(kind: LinkTargetKind, id: string): string {
  // Heading text used below is "<Kind>: <label> [<short-id>]" so this must
  // match what slugifyHeading would produce for that exact heading.
  return `${kind}-${id}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
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

  // Mini table of contents — uses [[label|#slug]] which the renderer turns
  // into in-page anchor links (not new-tab links).
  lines.push("''On this page:''");
  if (inv.length) lines.push(`* [[Inventory|#inventory]]`);
  for (const l of inv) {
    const heading = headingFor(l);
    lines.push(`** [[${l.label}|#${slugifyHeading(heading)}]]`);
  }
  if (maint.length) lines.push(`* [[Maintenance|#maintenance]]`);
  for (const l of maint) {
    const heading = headingFor(l);
    lines.push(`** [[${l.label}|#${slugifyHeading(heading)}]]`);
  }
  lines.push("");

  if (inv.length) {
    lines.push("!!! Inventory");
    lines.push("");
    for (const l of inv) {
      lines.push(`!!! ${headingFor(l)}`);
      if (l.notes) lines.push(l.notes);
      lines.push("");
    }
  }
  if (maint.length) {
    lines.push("!!! Maintenance");
    lines.push("");
    for (const l of maint) {
      lines.push(`!!! ${headingFor(l)}`);
      if (l.notes) lines.push(l.notes);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Heading text for a linked item — embeds the stable anchor token so the
 *  renderer-generated slug matches `linkAnchorSlug`. */
function headingFor(l: ManagedLink): string {
  return `${l.kind} ${l.id} ${l.label}`;
}

/** Compose a fresh body = previous body (minus old section) + new section. */
export function composeBodyWithLinks(prevBody: string, links: ManagedLink[]): string {
  const base = stripManagedSection(prevBody || "");
  const section = buildManagedSection(links);
  if (!section) return base.replace(/\s+$/g, "") + "\n";
  return base.replace(/\s+$/g, "") + "\n" + section;
}
