import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !anonKey || !serviceKey) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type TestUser = { id: string; email: string; password: string; client: SupabaseClient };

async function createUser(): Promise<TestUser> {
  const email = `rls-test-${crypto.randomUUID()}@example.com`;
  const password = `Pw_${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return { id: data.user.id, email, password, client };
}

let userA: TestUser;
let userB: TestUser;
let noteId: string;

beforeAll(async () => {
  userA = await createUser();
  userB = await createUser();

  const { data: note, error: noteErr } = await admin
    .from("daily_notes")
    .insert({ user_id: userA.id, date: "2026-06-09", markdown_content: "test" })
    .select("id")
    .single();
  if (noteErr) throw noteErr;
  noteId = note.id;

  const { error: logErr } = await admin.from("activity_log").insert([
    { user_id: userA.id, daily_note_id: noteId, entry_type: "note", raw_content: "row 1" },
    { user_id: userA.id, daily_note_id: noteId, entry_type: "note", raw_content: "row 2" },
  ]);
  if (logErr) throw logErr;
}, 30_000);

afterAll(async () => {
  await admin.from("activity_log").delete().eq("daily_note_id", noteId);
  await admin.from("daily_notes").delete().eq("id", noteId);
  if (userA) await admin.auth.admin.deleteUser(userA.id);
  if (userB) await admin.auth.admin.deleteUser(userB.id);
});

describe("activity_log RLS: delete by daily_note_id", () => {
  it("other user cannot delete rows owned by user A", async () => {
    const { error } = await userB.client
      .from("activity_log")
      .delete()
      .eq("daily_note_id", noteId);
    // RLS silently filters — delete succeeds with no rows affected
    expect(error).toBeNull();

    const { count, error: countErr } = await admin
      .from("activity_log")
      .select("*", { count: "exact", head: true })
      .eq("daily_note_id", noteId);
    expect(countErr).toBeNull();
    expect(count).toBe(2);
  });

  it("owning user cannot delete their own rows by daily_note_id", async () => {
    const { error } = await userA.client
      .from("activity_log")
      .delete()
      .eq("daily_note_id", noteId);
    // RLS silently filters — delete succeeds with no rows affected (append-only log)
    expect(error).toBeNull();

    const { count, error: countErr } = await admin
      .from("activity_log")
      .select("*", { count: "exact", head: true })
      .eq("daily_note_id", noteId);
    expect(countErr).toBeNull();
    expect(count).toBe(2);
  });
});
