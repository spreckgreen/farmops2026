# Route AI to a custom endpoint

Allow AI summaries (`src/lib/summary.functions.ts`) and food planning (`src/lib/food.functions.ts`) to call any OpenAI-compatible API endpoint instead of Lovable AI Gateway, controlled by server-side secrets. Falls back to Lovable AI when the overrides are not set, so existing behavior is unchanged.

## Configuration (server-only secrets)

Add three optional secrets via `add_secret`:

- `CUSTOM_AI_BASE_URL` — e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, or a self-hosted `http://host/v1`. When set, this endpoint is used instead of `https://ai.gateway.lovable.dev/v1`.
- `CUSTOM_AI_API_KEY` — sent as `Authorization: Bearer <key>` (standard OpenAI-compatible auth).
- `CUSTOM_AI_MODEL` *(optional)* — overrides the model id passed to the provider (some endpoints don't recognize `google/gemini-3-flash-preview`). If unset, the existing model ids are used unchanged.

Nothing is exposed to the browser; all reads happen inside the server function handlers.

## Code changes

**`src/lib/ai-gateway.server.ts`** — extend the helper:

```ts
export function createAiProvider() {
  const customBase = process.env.CUSTOM_AI_BASE_URL;
  const customKey = process.env.CUSTOM_AI_API_KEY;
  if (customBase && customKey) {
    return {
      provider: createOpenAICompatible({
        name: "custom-ai",
        baseURL: customBase,
        headers: { Authorization: `Bearer ${customKey}` },
      }),
      modelOverride: process.env.CUSTOM_AI_MODEL,
    };
  }
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("Missing AI credentials (set CUSTOM_AI_BASE_URL + CUSTOM_AI_API_KEY, or LOVABLE_API_KEY)");
  return {
    provider: createOpenAICompatible({
      name: "lovable-ai-gateway",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": apiKey },
    }),
    modelOverride: undefined,
  };
}
```

Keep `createLovableAiGatewayProvider` exported for backwards compatibility.

**`src/lib/summary.functions.ts`** (line ~302-310) — replace the manual key read + `createLovableAiGatewayProvider` block with:

```ts
const { createAiProvider } = await import("./ai-gateway.server");
const { provider, modelOverride } = createAiProvider();
// ...
model: provider(modelOverride ?? "google/gemini-3-flash-preview"),
```

**`src/lib/food.functions.ts`** (line ~1164-1204) — same swap, default model stays `google/gemini-2.5-flash`.

## Docs

Update `README.md` to document the three optional env vars and note that when unset the app continues to use Lovable AI Gateway.

## Out of scope

- No UI settings screen — this is a deploy-time configuration, matching how `LOVABLE_API_KEY` is handled today.
- No per-user routing; it's a global override.
- Rachio webhook URL and other Lovable-hosted pieces are unrelated and untouched.
