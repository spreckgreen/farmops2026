/**
 * Helpers for adding more content to a procedure that is already saved.
 *
 * The procedures pane stores each page as a TinyWiki HTML document, so both
 * "append" flows (imported manuals, generated SOPs) need to merge two wiki
 * markup bodies rather than blindly overwriting the stored page.
 */

export type ProcedureSaveMode = "create" | "replace" | "append";

/**
 * Merge `addition` onto the end of `existingBody`, separated by a dated
 * section heading so the page reads as a changelog of additions.
 *
 * Example:
 *   appendProcedureBody("! Mower\n\nOld steps\n", "New steps", "Workshop manual", new Date("2026-08-24"))
 *   // "! Mower\n\nOld steps\n\n----\n!! Added 2026-08-24 — Workshop manual\n\nNew steps\n"
 *
 * If the addition is already present verbatim, the body is returned unchanged
 * so re-running an import does not duplicate content.
 */
export function appendProcedureBody(
  existingBody: string,
  addition: string,
  label?: string,
  now: Date = new Date(),
): string {
  const base = (existingBody ?? "").trimEnd();
  const extra = (addition ?? "").trim();
  if (!extra) return base ? `${base}\n` : "";
  if (!base) return `${extra}\n`;
  if (base.includes(extra)) return `${base}\n`;

  const day = now.toISOString().slice(0, 10);
  const heading = label ? `!! Added ${day} — ${label}` : `!! Added ${day}`;
  return `${base}\n\n----\n${heading}\n\n${extra}\n`;
}

/** Human-readable outcome word for toasts and result cards. */
export function describeSaveMode(mode: ProcedureSaveMode): string {
  if (mode === "append") return "appended to";
  if (mode === "replace") return "replaced";
  return "created";
}
