/**
 * RLS role test: creates two ephemeral users (viewer + editor), tries
 * blocked/allowed operations against public.tasks as each, prints a
 * PASS/FAIL report, then deletes both users.
 *
 * Run:  bun scripts/test-rls.ts
 * Env:  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !ANON || !SRK) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(URL, SRK, { auth: { persistSession: false } });

type Row = { actor: string; op: string; expected: "allowed" | "blocked"; actual: "allowed" | "blocked"; detail?: string };
const results: Row[] = [];

async function asUser(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return c;
}

async function tryOp(
  actor: string,
  op: string,
  expected: "allowed" | "blocked",
  fn: () => Promise<{ error: { message: string } | null }>,
) {
  try {
    const { error } = await fn();
    const actual = error ? "blocked" : "allowed";
    results.push({ actor, op, expected, actual, detail: error?.message });
  } catch (e) {
    results.push({ actor, op, expected, actual: "blocked", detail: String(e) });
  }
}

async function createUser(email: string, role: "viewer" | "editor"): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "TestPass!123", email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const id = data.user.id;
  await admin.from("profiles").upsert({ id, email, status: "approved" });
  await admin.from("user_roles").insert({ user_id: id, role });
  return id;
}

async function cleanup(id: string) {
  await admin.from("tasks").delete().eq("user_id", id);
  await admin.auth.admin.deleteUser(id);
}

async function main() {
  const stamp = Date.now();
  const viewerEmail = `rls-viewer-${stamp}@test.local`;
  const editorEmail = `rls-editor-${stamp}@test.local`;

  const viewerId = await createUser(viewerEmail, "viewer");
  const editorId = await createUser(editorEmail, "editor");

  // Seed one task per user (admin bypass RLS)
  await admin.from("tasks").insert([
    { user_id: viewerId, title: "viewer-seed", slug: `v-seed-${stamp}`, status: "open" },
    { user_id: editorId, title: "editor-seed", slug: `e-seed-${stamp}`, status: "open" },
  ]);

  try {
    const viewer = await asUser(viewerEmail, "TestPass!123");
    const editor = await asUser(editorEmail, "TestPass!123");

    // Viewer: read own = allowed; writes = blocked
    await tryOp("viewer", "SELECT own", "allowed", async () =>
      viewer.from("tasks").select("id").eq("user_id", viewerId).then((r) => ({ error: r.error })));
    await tryOp("viewer", "INSERT", "blocked", async () =>
      viewer.from("tasks").insert({ user_id: viewerId, title: "v-new", slug: `v-new-${stamp}`, status: "open" }));
    await tryOp("viewer", "UPDATE own", "blocked", async () => {
      const before = await admin.from("tasks").select("title").eq("user_id", viewerId).single();
      const res = await viewer.from("tasks").update({ title: "hacked" }).eq("user_id", viewerId);
      const after = await admin.from("tasks").select("title").eq("user_id", viewerId).single();
      return { error: res.error ?? (before.data?.title !== after.data?.title ? null : { message: "RLS filter: 0 rows updated" }) };
    });
    await tryOp("viewer", "DELETE own", "blocked", async () => {
      const res = await viewer.from("tasks").delete().eq("user_id", viewerId);
      const after = await admin.from("tasks").select("id").eq("user_id", viewerId);
      return { error: res.error ?? ((after.data?.length ?? 0) === 0 ? null : { message: "RLS filter: 0 rows deleted" }) };
    });

    // Editor: own writes allowed; other-user writes blocked
    await tryOp("editor", "INSERT", "allowed", async () =>
      editor.from("tasks").insert({ user_id: editorId, title: "e-new", slug: `e-new-${stamp}`, status: "open" }));
    await tryOp("editor", "UPDATE own", "allowed", async () =>
      editor.from("tasks").update({ title: "edited" }).eq("user_id", editorId));
    await tryOp("editor", "UPDATE other", "blocked", async () => {
      // RLS filters silently on UPDATE; verify by checking row count change
      const before = await admin.from("tasks").select("title").eq("user_id", viewerId).limit(1).single();
      const res = await editor.from("tasks").update({ title: "stolen" }).eq("user_id", viewerId);
      const after = await admin.from("tasks").select("title").eq("user_id", viewerId).limit(1).single();
      const changed = before.data?.title !== after.data?.title;
      return { error: res.error ?? (changed ? null : { message: "no rows affected (RLS filter)" }) };
    });
    await tryOp("editor", "DELETE own", "allowed", async () =>
      editor.from("tasks").delete().eq("user_id", editorId));
  } finally {
    await cleanup(viewerId);
    await cleanup(editorId);
  }

  // Report
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(`\n${pad("actor", 8)} ${pad("op", 14)} ${pad("expected", 10)} ${pad("actual", 10)} result`);
  console.log("-".repeat(60));
  let pass = 0, fail = 0;
  for (const r of results) {
    const ok = r.expected === r.actual;
    ok ? pass++ : fail++;
    console.log(`${pad(r.actor, 8)} ${pad(r.op, 14)} ${pad(r.expected, 10)} ${pad(r.actual, 10)} ${ok ? "PASS" : "FAIL"}`);
    if (!ok && r.detail) console.log(`   -> ${r.detail}`);
  }
  console.log(`\n${pass} passed, ${fail} failed, ${results.length} total`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
