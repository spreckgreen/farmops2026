/**
 * Playwright global teardown.
 *
 * Removes the e2e user (cascades to their tasks, daily_notes, activity_log
 * via foreign-key ON DELETE CASCADE) and the local auth artifacts.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

export default async function globalTeardown() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const seedPath = path.resolve("e2e/.auth/seed.json");
  let seed: { userId: string } | null = null;
  try {
    seed = JSON.parse(await readFile(seedPath, "utf8"));
  } catch {
    seed = null;
  }

  if (seed?.userId) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    try {
      await admin.auth.admin.deleteUser(seed.userId);
    } catch {
      // best-effort cleanup
    }
  }

  await rm(path.resolve("e2e/.auth"), { recursive: true, force: true });
}
