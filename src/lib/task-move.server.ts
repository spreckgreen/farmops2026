/**
 * Move one task's day-scoped footprint from one farm calendar day to another.
 *
 * "Footprint" = the `- #task/<slug> ...` lines in the source daily note, the
 * activity_log rows attached to that note for the task, and the task's own
 * `start_at` / `closed_at` stamps.
 *
 * Example: moveTaskBetweenDays(sb, userId, taskId, "2026-08-22", "2026-08-19")
 *   -> note lines appended to the 2026-08-19 note (created if missing),
 *      activity_log.created_at restamped from 2026-08-22T15:10Z to 2026-08-19T15:10Z
 *      (wall-clock preserved in America/New_York), same for closed_at.
 */
import { extractTaskRefLines, appendLines } from "@/lib/daily-note-append";
import { shiftStampToDay } from "@/lib/app-timezone";

type Sb = {
  from: (table: string) => any;
};

export async function moveTaskBetweenDays(
  supabase: Sb,
  userId: string,
  taskId: string,
  fromDate: string,
  toDate: string,
) {
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id, slug, status, start_at, closed_at")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr) throw new Error(taskErr.message);
  if (!task) throw new Error("Task not found");

  if (fromDate === toDate) {
    return {
      ok: true as const,
      taskId: task.id,
      fromDate,
      toDate,
      movedLines: 0,
      movedEntries: 0,
    };
  }

  const { data: fromNote, error: fromErr } = await supabase
    .from("daily_notes")
    .select("id, markdown_content")
    .eq("user_id", userId)
    .eq("date", fromDate)
    .maybeSingle();
  if (fromErr) throw new Error(fromErr.message);

  let movedLines: string[] = [];
  if (fromNote) {
    const { remaining, extracted } = extractTaskRefLines(
      fromNote.markdown_content ?? "",
      task.slug,
    );
    movedLines = extracted;
    if (remaining !== (fromNote.markdown_content ?? "")) {
      const { error } = await supabase
        .from("daily_notes")
        .update({ markdown_content: remaining })
        .eq("id", fromNote.id);
      if (error) throw new Error(error.message);
    }
  }

  // Target note: reuse or create the destination day's note.
  let toNoteId: string | null = null;
  let toMarkdown = "";
  const { data: toNote, error: toErr } = await supabase
    .from("daily_notes")
    .select("id, markdown_content")
    .eq("user_id", userId)
    .eq("date", toDate)
    .maybeSingle();
  if (toErr) throw new Error(toErr.message);
  if (toNote) {
    toNoteId = toNote.id;
    toMarkdown = toNote.markdown_content ?? "";
  }

  const nextMarkdown = appendLines(toMarkdown, movedLines);
  if (toNoteId) {
    if (nextMarkdown !== toMarkdown) {
      const { error } = await supabase
        .from("daily_notes")
        .update({ markdown_content: nextMarkdown })
        .eq("id", toNoteId);
      if (error) throw new Error(error.message);
    }
  } else {
    const { data: created, error } = await supabase
      .from("daily_notes")
      .insert({ user_id: userId, date: toDate, markdown_content: nextMarkdown })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    toNoteId = created.id;
  }

  // Re-home the activity-log rows written for this task on `fromDate`.
  let movedEntries = 0;
  if (fromNote && toNoteId) {
    const { data: entries, error: entErr } = await supabase
      .from("activity_log")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("daily_note_id", fromNote.id)
      .eq("task_id", task.id);
    if (entErr) throw new Error(entErr.message);
    for (const entry of entries ?? []) {
      const { error } = await supabase
        .from("activity_log")
        .update({
          daily_note_id: toNoteId,
          created_at: shiftStampToDay(toDate, entry.created_at),
        })
        .eq("id", entry.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      movedEntries += 1;
    }
  }

  // Day stamps on the task itself follow the note.
  const patch: { start_at?: string; closed_at?: string } = {};
  if (task.start_at) patch.start_at = shiftStampToDay(toDate, task.start_at);
  if (task.closed_at) patch.closed_at = shiftStampToDay(toDate, task.closed_at);
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", task.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  return {
    ok: true as const,
    taskId: task.id,
    fromDate,
    toDate,
    movedLines: movedLines.length,
    movedEntries,
  };
}
