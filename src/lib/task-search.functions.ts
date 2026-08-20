import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Quick search over tasks by canonical slug or title.
 * Accepts raw user input such as `#task/replace-hydraulic-filter`,
 * `replace-hydraulic`, or `[[Replace hydraulic filter]]`.
 */
export const searchTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(25).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const raw = data.query
      .trim()
      .replace(/^#task\//i, "")
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .trim();
    if (!raw) return { exact: null, matches: [] as Array<{ id: string; slug: string; title: string; status: string }> };

    const safe = raw.replace(/[%,()]/g, " ").trim();
    const like = `%${safe}%`;

    const { data: rows, error } = await supabase
      .from("tasks")
      .select("id, slug, title, status")
      .or(`slug.ilike.${like},title.ilike.${like}`)
      .order("closed_at", { ascending: false, nullsFirst: true })
      .limit(data.limit ?? 8);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{ id: string; slug: string; title: string; status: string }>;
    const lower = raw.toLowerCase();
    const exact =
      list.find((t) => t.slug.toLowerCase() === lower) ??
      list.find((t) => t.title.toLowerCase() === lower) ??
      null;
    return { exact, matches: list };
  });
