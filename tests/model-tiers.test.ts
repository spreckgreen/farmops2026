import { describe, expect, it } from "vitest";
import { rankModelTiers, recommendedModel } from "@/lib/model-tiers";

describe("rankModelTiers", () => {
  it("picks three distinct tiers from an OpenAI-style list", () => {
    const tiers = rankModelTiers([
      "gpt-4.1-mini",
      "gpt-5.6-sol",
      "gpt-4.1",
      "text-embedding-3-small",
      "whisper-1",
    ]);
    expect(tiers.excluded).toContain("text-embedding-3-small");
    expect(tiers.excluded).toContain("whisper-1");
    expect(tiers.best?.id).toBe("gpt-5.6-sol");
    expect(tiers.good?.id).toBe("gpt-4.1-mini");
    expect(tiers.better?.id).toBe("gpt-4.1");
    expect(recommendedModel(tiers)).toBe("gpt-4.1");
  });

  it("ranks Ollama tags by parameter count", () => {
    const tiers = rankModelTiers(["llama3.2:1b", "llama3.1:8b", "gpt-oss:120b"]);
    expect(tiers.best?.id).toBe("gpt-oss:120b");
    expect(tiers.good?.id).toBe("llama3.2:1b");
    expect(tiers.better?.id).toBe("llama3.1:8b");
  });

  it("returns empty tiers when nothing usable is listed", () => {
    const tiers = rankModelTiers(["nomic-embed-text", "bge-m3"]);
    expect(tiers.better).toBeNull();
    expect(recommendedModel(tiers)).toBeNull();
  });
});
