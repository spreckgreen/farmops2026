# CI Security Pipeline

`security.yml` runs on every PR and on pushes to `main`. It performs the
same automated checks Lovable runs internally:

| Job                  | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `rls-and-db-lint`    | `supabase db lint` (RLS missing, exposed columns, weak policies) + executes every `tests/*.rls.test.ts` against the linked Supabase project. |
| `dependency-audit`   | Fails on **high** or **critical** dependency CVEs.                            |

## Required GitHub repository secrets

Add these under **Settings → Secrets and variables → Actions**:

- `SUPABASE_ACCESS_TOKEN` — personal access token from https://supabase.com/dashboard/account/tokens
- `SUPABASE_PROJECT_REF` — your project ref
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — used only by RLS tests to seed/cleanup fixtures

## Note on connector security scans (Wiz / Aikido)

Wiz and Aikido are **workspace-scoped connectors** that scan automatically
whenever a build is published — they are not invocable from GitHub Actions.
Results appear in your project's **Security** tab. This workflow runs the
locally reproducible portion (RLS + DB lint + dependency audit); connector
scans continue to run server-side on each deploy.
