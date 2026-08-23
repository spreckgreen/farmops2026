import { describe, expect, it } from "vitest";
import { AI_ENGINE_IDS, parseEnginesConfig } from "@/lib/ai-engines";

describe("three-engine configuration", () => {
  it("exposes only local, Ollama Cloud and other cloud", () => {
    expect(AI_ENGINE_IDS).toEqual(["local", "ollama_cloud", "other_cloud"]);
  });

  it("migrates an existing Lovable cloud default without blocking other keys", () => {
    const parsed = parseEnginesConfig(
      JSON.stringify({
        cloudDefault: "lovable",
        engines: {
          local: { baseUrl: null, apiKey: null, model: null },
          ollama_cloud: {
            baseUrl: "https://ollama.com/v1",
            apiKey: "ollama-cloud-key",
            model: "gpt-oss:120b",
          },
          lovable: { baseUrl: null, apiKey: "obsolete", model: null },
          other_cloud: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "openai-key",
            model: "gpt-4.1",
          },
        },
      }),
    );

    expect(parsed?.cloudDefault).toBe("other_cloud");
    expect(parsed?.engines.other_cloud.apiKey).toBe("openai-key");
    expect(Object.keys(parsed?.engines ?? {})).not.toContain("lovable");
  });
});