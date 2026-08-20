import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { unresolvedRefs, type NoteRefScan, type TaskLookup } from "./note-refs";
import { extractTaskRefs } from "./note-refs";

/**
 * One-click audit: scans every daily note owned by the caller for
 * `#task/<slug>` and `[[Title]]` references that no longer resolve to a task.
 */
export const scanNoteTaskRefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [notesRes, tasksRes] = await Promise.all([
      supabase
        .from("daily_notes")
        .select("id, date, markdown_content")
        .eq("user_id", userId)
        .order("date", { ascending: false }),
      supabase.from("tasks").select("slug, title").eq("user_id", userId),
    ]);
    if (notesRes.error) throw new Error(notesRes.error.message);
    if (tasksRes.error) throw new Error(tasksRes.error.message);

    const tasks = (tasksRes.data ?? []) as TaskLookup[];
    const notes = (notesRes.data ?? []) as Array<{
      id: string;
      date: string;
      markdown_content: string;
    }>;

    let refCount = 0;
    let unresolvedCount = 0;
    const scans: NoteRefScan[] = [];

    for (const note of notes) {
      const md = note.markdown_content ?? "";
      const total = extractTaskRefs(md).length;
      refCount += total;
      const unresolved = unresolvedRefs(md, tasks);
      unresolvedCount += unresolved.length;
      if (unresolved.length > 0) {
        scans.push({ date: note.date, noteId: note.id, unresolved, refCount: total });
      }
    }

    return {
      scannedNotes: notes.length,
      taskCount: tasks.length,
      refCount,
      unresolvedCount,
      scannedAt: new Date().toISOString(),
      notes: scans,
    };
  });
