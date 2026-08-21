import { describe, expect, it } from "vitest";
import {
  detectTruncation,
  estimateTokens,
  formatTokens,
  truncationOrNull,
} from "@/lib/ai-truncation";

describe("estimateTokens", () => {
  it("uses ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });
});

describe("detectTruncation", () => {
  it("flags finishReason=length as an output cap", () => {
    const s = detectTruncation({
      finishReason: "length",
      usage: { inputTokens: 3000, outputTokens: 512, totalTokens: 3512 },
      contextLimit: 8192,
      model: "llama3.2:3b",
    });
    expect(s.truncated).toBe(true);
    expect(s.reason).toBe("output-cap");
    expect(s.estimated).toBe(false);
    expect(s.inputTokens).toBe(3000);
    expect(s.usedFraction).toBeCloseTo(3512 / 8192);
  });

  it("flags a silent context overflow from estimated tokens", () => {
    // 40 KB of procedures -> ~10k tokens, into a 4k window.
    const s = detectTruncation({
      finishReason: "stop",
      promptChars: 40_000,
      outputText: "short answer",
      contextLimit: 4096,
      model: "llama3.2:3b",
    });
    expect(s.reason).toBe("context-overflow");
    expect(s.truncated).toBe(true);
    expect(s.estimated).toBe(true);
    expect(s.inputTokens).toBe(10_000);
  });

  it("warns without claiming truncation at 90% context use", () => {
    const s = detectTruncation({
      finishReason: "stop",
      usage: { inputTokens: 7000, outputTokens: 500 },
      contextLimit: 8192,
    });
    expect(s.reason).toBe("context-pressure");
    expect(s.truncated).toBe(false);
    expect(s.totalTokens).toBe(7500);
  });

  it("stays quiet for a normal reply", () => {
    expect(
      truncationOrNull({
        finishReason: "stop",
        usage: { inputTokens: 800, outputTokens: 200 },
        contextLimit: 32768,
      }),
    ).toBeNull();
  });

  it("stays quiet when no limit is known and nothing was capped", () => {
    expect(
      truncationOrNull({ finishReason: "stop", promptChars: 900_000, outputText: "hi" }),
    ).toBeNull();
  });

  it("accepts AI SDK v4 usage spellings", () => {
    const s = detectTruncation({
      finishReason: "stop",
      usage: { promptTokens: 4000, completionTokens: 200 },
      contextLimit: 4096,
    });
    expect(s.estimated).toBe(false);
    expect(s.reason).toBe("context-overflow");
  });
});

describe("formatTokens", () => {
  it("formats compactly", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(3512)).toBe("3.5k");
    expect(formatTokens(131072)).toBe("131k");
    expect(formatTokens(null)).toBe("unknown");
  });
});
