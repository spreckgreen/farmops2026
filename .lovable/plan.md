# Point FarmOps at OpenAI (ChatGPT API)

Your `createAiProvider` in `src/lib/ai-gateway.server.ts` already routes to any OpenAI-compatible endpoint when `CUSTOM_AI_BASE_URL` + `CUSTOM_AI_API_KEY` are set. OpenAI's own API *is* that endpoint, so this is pure configuration — no code edits, no rebuild.

Note: your paid ChatGPT Plus/Pro subscription (chat.openai.com) is **separate** from the OpenAI API and does not grant API access. You'll create an API key at https://platform.openai.com/api-keys and it's billed separately (pay-as-you-go, typically pennies per FarmOps query on `gpt-4o-mini`).

## Steps

1. **Get an OpenAI API key**
   - https://platform.openai.com/api-keys → Create new secret key (starts with `sk-proj-...`)
   - Add a small credit balance at https://platform.openai.com/settings/organization/billing (min $5)

2. **Set the three vars on the VPS** in `~/bostead-a29954a1/.env.local`:
   ```
   CUSTOM_AI_BASE_URL=https://api.openai.com/v1
   CUSTOM_AI_API_KEY=sk-proj-...your-key...
   CUSTOM_AI_MODEL=gpt-4o-mini
   ```
   Model choices (all OpenAI-hosted, no local RAM needed):
   - `gpt-4o-mini` — recommended default, ~$0.15/1M input tokens, fast, plenty smart for FarmOps advisory
   - `gpt-4o` — higher quality, ~10× cost, for complex diagnosis
   - `gpt-5-mini` / `gpt-5-nano` — newer, similar tiering

3. **Restart the app container** so it picks up the new env:
   ```bash
   cd ~/bostead-a29954a1 && docker compose up -d app
   ```

4. **Verify via existing UI** at `/settings/self-host`:
   - "Run AI test" card should report `provider: custom`, `baseUrl: https://api.openai.com/v1`, and a real reply.
   - Farm Consultant, Maintenance Forecaster, Symptom→Procedure, and Preservation Coach all flow through the same provider — they'll start working immediately.

5. **Optional: also set the model via the vault** at `/settings/self-host` model picker so it can be changed without touching `.env.local`. The picker writes `CUSTOM_AI_MODEL` to `vault_secrets` and `getServerEnv` prefers vault over env.

## What this changes

Nothing in the codebase. All existing AI features (`consultant.functions.ts`, `maintenance-forecast.functions.ts`, `maintenance-symptom.functions.ts`, `preservation-coach.functions.ts`) already call `createAiProvider()` and are agnostic to which OpenAI-compatible backend answers.

## Rollback

Delete the three `CUSTOM_AI_*` lines from `.env.local` and restart `app`. It falls back to `LOVABLE_API_KEY` (Lovable AI Gateway) if set, else bundled Ollama.

## Cost sanity check

Typical FarmOps consultant query: ~2–4K input tokens (farm snapshot) + ~300 output tokens ≈ **$0.001 per query** on `gpt-4o-mini`. 1000 queries/month ≈ $1. Well under your Plus subscription cost, and unlike Plus it actually works from FarmOps.

Approve and I'll (a) skip straight to a short "you're set — here's the exact 3 commands" reply if you just want to run it yourself, or (b) if you want the OpenAI key stored via the Lovable secrets tool instead of `.env.local`, say so and I'll request it through the secure form.