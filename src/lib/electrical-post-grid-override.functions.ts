// Authenticated read/write of manual post grid-cell overrides.
//
// Writes touch only public.electrical_post_grid_overrides: no frozen geometry,
// no electrical record, and no coordinate is changed by this path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateOverrideDraft } from "@/lib/electrical-post-grid-override";
import type { PostGridOverride } from "@/lib/electrical-post-grid-override";

export const listPostGridOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PostGridOverride[]> => {
    const { data, error } = await context.supabase
      .from("electrical_post_grid_overrides")
      .select("post_ref, override_grid_cell, derived_grid_cell, geometry_version, reconciliation_note, updated_at")
      .order("post_ref", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      postRef: r.post_ref,
      overrideGridCell: r.override_grid_cell,
      derivedGridCell: r.derived_grid_cell,
      geometryVersion: r.geometry_version,
      reconciliationNote: r.reconciliation_note,
      updatedAt: r.updated_at,
    }));
  });

export const savePostGridOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { postRef: string; gridCell: string; note: string }) => input)
  .handler(async ({ data, context }) => {
    const checked = validateOverrideDraft(data);
    if (!checked.ok) throw new Error(checked.error);
    const { error } = await context.supabase.from("electrical_post_grid_overrides").upsert(
      {
        user_id: context.userId,
        post_ref: checked.postRef,
        override_grid_cell: checked.gridCell,
        derived_grid_cell: checked.derivedGridCell,
        geometry_version: checked.geometryVersion,
        reconciliation_note: checked.note,
      },
      { onConflict: "user_id,post_ref" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const, postRef: checked.postRef };
  });

export const clearPostGridOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { postRef: string }) => input)
  .handler(async ({ data, context }) => {
    const postRef = data.postRef.trim().toUpperCase();
    const { error } = await context.supabase
      .from("electrical_post_grid_overrides")
      .delete()
      .eq("user_id", context.userId)
      .eq("post_ref", postRef);
    if (error) throw new Error(error.message);
    return { ok: true as const, postRef };
  });
