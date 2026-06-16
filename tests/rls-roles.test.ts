/**
 * RLS role enforcement test — viewer is read-only, editor can write own rows.
 * Skipped automatically when Supabase service role credentials aren't present
 * (e.g. plain CI without secrets). Locally and in trusted CI, the env vars
 * SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY enable it.
 */
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SRK);

describe.skipIf(!enabled)("RLS: viewer is read-only, editor can write own rows", () => {
  const admin = createClient(URL!, SRK!, { auth: { persistSession: false } });

  async function asUser(email: string, password: string): Promise<SupabaseClient> {
    const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`signin ${email}: ${error.message}`);
    return c;
  }

  async function createUser(email: string, role: "viewer" | "editor") {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: "TestPass!123", email_confirm: true,
    });
    if (error || !data.user) throw new Error(error?.message);
    const id = data.user.id;
    await admin.from("profiles").upsert({ id, email, status: "approved" });
    await admin.from("user_roles").insert({ user_id: id, role });
    return id;
  }

  async function cleanup(id: string) {
    await admin.from("tasks").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }

  it("enforces viewer/editor write permissions on public.tasks", async () => {
    const stamp = Date.now();
    const viewerEmail = `rls-viewer-${stamp}@test.local`;
    const editorEmail = `rls-editor-${stamp}@test.local`;
    const viewerId = await createUser(viewerEmail, "viewer");
    const editorId = await createUser(editorEmail, "editor");

    await admin.from("tasks").insert([
      { user_id: viewerId, title: "viewer-seed", slug: `v-seed-${stamp}`, status: "open" },
      { user_id: editorId, title: "editor-seed", slug: `e-seed-${stamp}`, status: "open" },
    ]);

    try {
      const viewer = await asUser(viewerEmail, "TestPass!123");
      const editor = await asUser(editorEmail, "TestPass!123");

      // viewer can read own
      const r = await viewer.from("tasks").select("id").eq("user_id", viewerId);
      expect(r.error).toBeNull();

      // viewer cannot insert
      const vIns = await viewer.from("tasks").insert({
        user_id: viewerId, title: "v-new", slug: `v-new-${stamp}`, status: "open",
      });
      expect(vIns.error).not.toBeNull();

      // viewer "update" silently filtered to zero rows
      const before = await admin.from("tasks").select("title").eq("user_id", viewerId).single();
      await viewer.from("tasks").update({ title: "hacked" }).eq("user_id", viewerId);
      const after = await admin.from("tasks").select("title").eq("user_id", viewerId).single();
      expect(after.data?.title).toBe(before.data?.title);

      // viewer delete leaves the row in place
      await viewer.from("tasks").delete().eq("user_id", viewerId);
      const stillThere = await admin.from("tasks").select("id").eq("user_id", viewerId);
      expect(stillThere.data?.length ?? 0).toBeGreaterThan(0);

      // editor can insert / update / delete own
      const eIns = await editor.from("tasks").insert({
        user_id: editorId, title: "e-new", slug: `e-new-${stamp}`, status: "open",
      });
      expect(eIns.error).toBeNull();
      const eUpd = await editor.from("tasks").update({ title: "edited" }).eq("user_id", editorId);
      expect(eUpd.error).toBeNull();

      // editor cannot modify someone else's row
      const otherBefore = await admin.from("tasks").select("title").eq("user_id", viewerId).single();
      await editor.from("tasks").update({ title: "stolen" }).eq("user_id", viewerId);
      const otherAfter = await admin.from("tasks").select("title").eq("user_id", viewerId).single();
      expect(otherAfter.data?.title).toBe(otherBefore.data?.title);

      const eDel = await editor.from("tasks").delete().eq("user_id", editorId);
      expect(eDel.error).toBeNull();
    } finally {
      await cleanup(viewerId);
      await cleanup(editorId);
    }
  }, 60_000);
});
