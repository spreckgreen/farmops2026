import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { unresolvedRefs, type TaskLookup } from "./note-refs";
import {
  buildActivityTokenIndex,
  planRepairs,
  type RepairEdit,
  type ActivityTokenIndex,
} from "./note-ref-repair";

export type NoteRepair = {
  noteId: string;
  date: string;
  edits: RepairEdit[];
  skipped: number;
  applied: boolean;
};

/**
 * Auto-repair workflow: rewrites broken `#task/<slug>` / `[[Title]]` references
 * to their canonical form, preferring the task the activity log actually
 * attached the entry to, then an exact title match.
 *
 * `dryRun: true` returns the exact edits without touching any note.
 */
export const repairNoteTaskRefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dryRun?: boolean; allowFuzzy?: boolean } | undefined) => ({
    dryRun: input?.dryRun ?? true,
    allowFuzzy: input?.allowFuzzy ?? false,
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [notesRes, tasksRes, logRes] = await Promise.all([
      supabase
        .from("daily_notes")
        .select("id, date, markdown_content")
        .eq("user_id", userId)
        .order("date", { ascending: false }),
      supabase.from("tasks").select("id, slug, title").eq("user_id", userId),
      supabase
        .from("activity_log")
        .select("raw_content, task_id")
        .eq("user_id", userId)
        .not("task_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);
    if (notesRes.error) throw new Error(notesRes.error.message);
    if (tasksRes.error) throw new Error(tasksRes.error.message);
    if (logRes.error) throw new Error(logRes.error.message);

    const taskRows = (tasksRes.data ?? []) as Array<{
      id: string;
      slug: string;
      title: string;
    }>;
    const tasks: TaskLookup[] = taskRows.map((t) => ({ slug: t.slug, title: t.title }));
    const tasksById = new Map(taskRows.map((t) => [t.id, { slug: t.slug, title: t.title }]));
    const activityIndex: ActivityTokenIndex = buildActivityTokenIndex(
      (logRes.data ?? []) as Array<{ raw_content: string | null; task_id: string | null }>,
      tasksById,
    );

    const notes = (notesRes.data ?? []) as Array<{
      id: string;
      date: string;
      markdown_content: string | null;
    }>;

    const repairs: NoteRepair[] = [];
    let editCount = 0;
    let skippedCount = 0;

    for (const note of notes) {
      const md = note.markdown_content ?? "";
      const refs = unresolvedRefs(md, tasks);
      if (refs.length === 0) continue;
      const plan = planRepairs(md, refs, tasks, activityIndex, {
        allowFuzzy: data.allowFuzzy,
      });
      if (plan.edits.length === 0) {
        skippedCount += plan.skipped.length;
        repairs.push({
          noteId: note.id,
          date: note.date,
          edits: [],
          skipped: plan.skipped.length,
          applied: false,
        });
        continue;
      }

      let applied = false;
      if (!data.dryRun) {
        const { error } = await supabase
          .from("daily_notes")
          .update({ markdown_content: plan.markdown })
          .eq("id", note.id)
          .eq("user_id", userId);
        if (error) throw new Error(`${note.date}: ${error.message}`);
        applied = true;
      }

      editCount += plan.edits.length;
      skippedCount += plan.skipped.length;
      repairs.push({
        noteId: note.id,
        date: note.date,
        edits: plan.edits,
        skipped: plan.skipped.length,
        applied,
      });
    }

    return {
      dryRun: data.dryRun,
      allowFuzzy: data.allowFuzzy,
      scannedNotes: notes.length,
      editCount,
      skippedCount,
      activityTokens: activityIndex.size,
      ranAt: new Date().toISOString(),
      notes: repairs,
    };
  });
