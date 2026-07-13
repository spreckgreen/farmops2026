import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";

// Unit + integration tests for createAiProvider().
//
// Verifies:
//   * When CUSTOM_AI_BASE_URL + CUSTOM_AI_API_KEY are set, chat completions
//     are routed to the custom endpoint with a Bearer token, and
//     CUSTOM_AI_MODEL (when set) overrides the caller's model id — this is
//     the path summary.functions.ts and food.functions.ts use.
//   * When they are unset (only LOVABLE_API_KEY present), requests fall
//     back to https://ai.gateway.lovable.dev/v1 with the Lovable-API-Key
//     header.
//   * When no credentials are configured at all, the factory throws.

const CUSTOM_BASE = "https://ai.example.test/v1";
const LOVABLE_BASE = "https://ai.gateway.lovable.dev/v1";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mockChatFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const body = {
      id: "test",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls, fetchMock };
}

async function loadFactory() {
  // Re-import so the module re-reads process.env — matches how the real
  // server functions dynamic-import ai-gateway.server inside their handler.
  vi.resetModules();
  return (await import("@/lib/ai-gateway.server")).createAiProvider;
}

async function callChat(model: string) {
  const createAiProvider = await loadFactory();
  const { provider, modelOverride } = createAiProvider();
  return generateText({
    model: provider(modelOverride ?? model),
    prompt: "hello",
  });
}

beforeEach(() => {
  delete process.env.CUSTOM_AI_BASE_URL;
  delete process.env.CUSTOM_AI_API_KEY;
  delete process.env.CUSTOM_AI_MODEL;
  delete process.env.LOVABLE_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("createAiProvider – custom endpoint", () => {
  it("routes to CUSTOM_AI_BASE_URL with Bearer token when set", async () => {
    process.env.CUSTOM_AI_BASE_URL = CUSTOM_BASE;
    process.env.CUSTOM_AI_API_KEY = "sk-custom-123";
    process.env.LOVABLE_API_KEY = "should-be-ignored";
    const { calls } = mockChatFetch();

    await callChat("google/gemini-3-flash-preview");

    expect(calls.length).toBe(1);
    expect(calls[0].url.startsWith(CUSTOM_BASE)).toBe(true);
    expect(calls[0].url).not.toContain("ai.gateway.lovable.dev");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-custom-123");
    expect(headers.get("lovable-api-key")).toBeNull();
  });

  it("applies CUSTOM_AI_MODEL override in the outgoing request body", async () => {
    process.env.CUSTOM_AI_BASE_URL = CUSTOM_BASE;
    process.env.CUSTOM_AI_API_KEY = "sk-custom-123";
    process.env.CUSTOM_AI_MODEL = "my-local/llama-4";
    const { calls } = mockChatFetch();

    await callChat("google/gemini-3-flash-preview");

    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body.model).toBe("my-local/llama-4");
  });
});

describe("createAiProvider – Lovable fallback", () => {
  it("falls back to the Lovable AI Gateway when CUSTOM_AI_BASE_URL is unset", async () => {
    process.env.LOVABLE_API_KEY = "lov-key-abc";
    const { calls } = mockChatFetch();

    await callChat("google/gemini-3-flash-preview");

    expect(calls.length).toBe(1);
    expect(calls[0].url.startsWith(LOVABLE_BASE)).toBe(true);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("lovable-api-key")).toBe("lov-key-abc");
    expect(headers.get("authorization")).toBeNull();
  });

  it("falls back to Lovable when CUSTOM_AI_BASE_URL is set but CUSTOM_AI_API_KEY is missing", async () => {
    process.env.CUSTOM_AI_BASE_URL = CUSTOM_BASE;
    process.env.LOVABLE_API_KEY = "lov-key-abc";
    const { calls } = mockChatFetch();

    await callChat("google/gemini-3-flash-preview");

    expect(calls[0].url.startsWith(LOVABLE_BASE)).toBe(true);
  });

  it("passes the caller's model id through when no override is set", async () => {
    process.env.LOVABLE_API_KEY = "lov-key-abc";
    const { calls } = mockChatFetch();

    await callChat("google/gemini-3-flash-preview");

    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body.model).toBe("google/gemini-3-flash-preview");
  });

  it("falls back to the bundled Ollama endpoint when no credentials are configured", async () => {
    const { calls } = mockChatFetch();
    await callChat("google/gemini-3-flash-preview");
    expect(calls[0].url.startsWith("http://ollama:11434/v1")).toBe(true);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer ollama");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body.model).toBe("llama3.2:3b");
  });

});
