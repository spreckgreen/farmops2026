/**
 * Playwright global setup.
 *
 * Creates a fresh test user via the Supabase Admin API, signs that user in
 * once via the UI to capture an authenticated `storageState`, and seeds a
 * known backlog task that the spec will move to Today.
 *
 * The created user id and seed task slug are written to e2e/.auth/seed.json
 * so the teardown can clean them up and the spec can read the slug.
 */
import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function globalSetup(config: FullConfig) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Playwright e2e requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- 1. Create the test user ------------------------------------------
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const email = `e2e-backlog-${runId}@example.com`;
  const password = `Pw_${runId}_${runId}`;

  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) throw userErr ?? new Error("createUser failed");
  const userId = created.user.id;

  // Grant editor role so write policies allow tasks/daily_notes inserts.
  await admin.from("user_roles").insert({ user_id: userId, role: "editor" });

  // ---- 2. Seed a backlog task ------------------------------------------
  const taskTitle = `E2E Backlog Task ${runId}`;
  const slug = `e2e-backlog-task-${runId}`;
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .insert({
      user_id: userId,
      title: taskTitle,
      slug,
      status: "open",
      // Backlog = open tasks not yet pulled into today (no start_at / not on
      // today's activity_log). Leave start_at null so it lands in Backlog.
    })
    .select("id, slug, title")
    .single();
  if (taskErr || !task) throw taskErr ?? new Error("seed task failed");

  // ---- 3. Sign in via UI to capture storageState ------------------------
  const baseURL =
    process.env.BASE_URL ??
    "https://id-preview--3262d5a9-40fd-4cf4-a353-9549a732cb96.lovable.app";

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page
    .getByRole("button", { name: /^(sign in|log in)$/i })
    .first()
    .click();

  // Wait for the post-login redirect (any authenticated route is fine).
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 30_000,
  });

  const authDir = path.resolve("e2e/.auth");
  await mkdir(authDir, { recursive: true });
  await context.storageState({ path: path.join(authDir, "user.json") });
  await browser.close();

  // ---- 4. Persist seed metadata for spec + teardown --------------------
  await writeFile(
    path.join(authDir, "seed.json"),
    JSON.stringify(
      { userId, email, taskId: task.id, taskSlug: task.slug, taskTitle: task.title },
      null,
      2,
    ),
    "utf8",
  );

  // Silence unused param warning while leaving the signature ready for
  // future per-project config tweaks.
  void config;
}
