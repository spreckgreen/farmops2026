import { describe, it, expect } from "vitest";
import { appendTaskRefLine } from "@/lib/daily-note-append";

/**
 * Regression tests for the Backlog → Today move.
 *
 * The original bug: `addTaskToToday` skipped the markdown append whenever
 * `#task/<slug>` already appeared in today's note. Because `getDailyNote`
 * seeds today's note from the prior day's markdown, the slug was almost
 * always present, and the user's "Add to today" click looked like a no-op
 * in the daily-note view (even though the activity_log row was inserted).
 *
 * `appendTaskRefLine` now appends unconditionally, deduping only on an
 * exact line match (which protects against double-clicks within the same
 * day, while still letting today's note get its own fresh entry when the
 * slug was carried over from yesterday).
 */

const REF = "- #task/follow-up-cement Follow-up Cement #project/bosteadfarmshop";

describe("appendTaskRefLine — Backlog → Today regression", () => {
  it("appends the ref line to an empty note (no leading blank line)", () => {
    expect(appendTaskRefLine("", REF)).toBe(`${REF}\n`);
  });

  it("treats whitespace-only markdown as empty", () => {
    expect(appendTaskRefLine("   \n\n  ", REF)).toBe(`${REF}\n`);
  });

  it("appends after existing content with a single newline separator", () => {
    const md = "- existing entry\n- another entry";
    expect(appendTaskRefLine(md, REF)).toBe(`- existing entry\n- another entry\n${REF}\n`);
  });

  it("normalizes accumulated trailing whitespace/newlines before appending", () => {
    const md = "- existing entry\n\n\n   \n";
    expect(appendTaskRefLine(md, REF)).toBe(`- existing entry\n${REF}\n`);
  });

  it("STILL appends when the slug is already present via the prior-day seed", () => {
    // Yesterday's note referenced the same task. Today's note was seeded
    // from yesterday so `#task/follow-up-cement` is already in the
    // markdown — but NOT as an exact match for today's refLine.
    const seededFromYesterday = [
      "- 9:00 standup",
      "- #task/follow-up-cement waiting on supplier callback",
      "- lunch with K",
    ].join("\n");

    const result = appendTaskRefLine(seededFromYesterday, REF);

    expect(result).toContain(REF);
    expect(result.endsWith(`${REF}\n`)).toBe(true);
    // The carried-over line from yesterday must still be there.
    expect(result).toContain("waiting on supplier callback");
    // And there should be exactly one occurrence of today's exact refLine.
    const occurrences = result.split("\n").filter((l) => l.trim() === REF.trim()).length;
    expect(occurrences).toBe(1);
  });

  it("does NOT append a second time when today's exact ref line already exists", () => {
    // Idempotency guard: a double-click of "Add to today" within the same
    // day must not duplicate the bullet.
    const alreadyAddedToday = `- morning notes\n${REF}\n- afternoon notes`;
    expect(appendTaskRefLine(alreadyAddedToday, REF)).toBe(alreadyAddedToday);
  });

  it("treats lines that share the slug but differ in text as DIFFERENT entries", () => {
    // A task with the same slug logged with a different free-text suffix
    // (e.g. progress note) must NOT block today's canonical ref line.
    const md = `- #task/follow-up-cement called supplier, no answer`;
    const result = appendTaskRefLine(md, REF);
    expect(result).toBe(`${md}\n${REF}\n`);
  });

  it("tolerates differing surrounding whitespace when deduping today's line", () => {
    // The exact ref line is present with extra surrounding whitespace —
    // still considered a duplicate (we compare trim()'d lines).
    const md = `- morning\n   ${REF}   \n- afternoon`;
    expect(appendTaskRefLine(md, REF)).toBe(md);
  });

  it("handles a null/undefined-shaped markdown input safely", () => {
    // `daily_notes.markdown_content` is nullable in the DB; the handler
    // passes `note.markdown_content ?? ""`, but guard the helper too.
    expect(appendTaskRefLine(undefined as unknown as string, REF)).toBe(`${REF}\n`);
    expect(appendTaskRefLine(null as unknown as string, REF)).toBe(`${REF}\n`);
  });
});
