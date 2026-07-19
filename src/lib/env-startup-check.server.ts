// ============================================================================
// env-startup-check.server.ts — fail-fast placeholder detector
//
// Imported at the top of `src/server.ts` so a container that still has
// `.env` values like `CHANGE_ME_ANON_KEY_JWT` or `https://supabase.example.com`
// (copied straight from `docs/env.self-hosted-supabase.example.tmpl` without being
// filled in by `scripts/fill-env-from-supabase.sh`) crashes on boot with a
// clear error, instead of silently serving a broken app that can't reach
// Supabase.
//
// Example failing values it catches:
//   SUPABASE_URL=https://supabase.example.com
//   SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.CHANGE_ME_ANON_KEY_JWT
// ============================================================================

const SUPABASE_VARS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
] as const;

// Substrings that indicate a placeholder value from
// docs/env.self-hosted-supabase.example.tmpl was never replaced.
const PLACEHOLDER_MARKERS = [
  "CHANGE_ME",
  "supabase.example.com",
  "your-project.supabase.co",
  "your-project-ref",
];

export function assertNoPlaceholderSupabaseEnv(): void {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {};

  const offenders: Array<{ name: string; marker: string }> = [];
  for (const name of SUPABASE_VARS) {
    const value = env[name];
    if (!value) continue;
    for (const marker of PLACEHOLDER_MARKERS) {
      if (value.includes(marker)) {
        offenders.push({ name, marker });
        break;
      }
    }
  }

  if (offenders.length === 0) return;

  const lines = offenders.map(
    (o) => `  - ${o.name} still contains placeholder marker "${o.marker}"`,
  );
  const msg = [
    "",
    "=== [startup] FATAL: Supabase env vars still contain placeholders ===",
    ...lines,
    "",
    "These values come from docs/env.self-hosted-supabase.example.tmpl and must be",
    "replaced with the real keys from your self-hosted Supabase stack.",
    "",
    "Fix:",
    "  sudo scripts/fill-env-from-supabase.sh   # auto-populate from /home/<user>/supabase-project",
    "  # then restart:",
    "  ./scripts/refresh.sh --no-pull --force",
    "===================================================================",
    "",
  ].join("\n");

  // eslint-disable-next-line no-console
  console.error(msg);
  throw new Error(
    `Refusing to start: placeholder Supabase env vars detected (${offenders
      .map((o) => o.name)
      .join(", ")}). See docs/env.self-hosted-supabase.example.tmpl.`,
  );
}

// Run at module load — importing this file is enough to enforce the check.
assertNoPlaceholderSupabaseEnv();
