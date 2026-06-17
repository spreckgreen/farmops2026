import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end test config.
 *
 * Targets a running app (preview deployment by default). Override with:
 *   BASE_URL=http://localhost:3000 bunx playwright test
 *
 * Required env (loaded from your shell, never committed):
 *   BASE_URL                       — defaults to the Lovable preview URL
 *   SUPABASE_URL                   — for seeding test users + data
 *   SUPABASE_PUBLISHABLE_KEY       — anon client (UI sign-in)
 *   SUPABASE_SERVICE_ROLE_KEY      — admin client (create user, seed tasks)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL:
      process.env.BASE_URL ??
      "https://id-preview--3262d5a9-40fd-4cf4-a353-9549a732cb96.lovable.app",
    storageState: "e2e/.auth/user.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
