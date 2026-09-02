import { beforeEach, describe, expect, it } from "vitest";
import {
  ELECTRICAL_AI_CACHE_TTL_MS,
  cacheAgeLabel,
  cacheKey,
  dropCachedAnswer,
  readCachedAnswer,
  runCostLabel,
  writeCachedAnswer,
} from "@/lib/electrical-ai-cache";

const answer = {
  scenario: "panel_qa",
  area: "electrical.panel_qa",
  areaLabel: "Panel Q&A",
  engineLabel: "Self-hosted (local)",
  model: "gemma:latest",
  backend: "local",
  answer: "The three mini splits land on PNL-H1.",
  contextCounts: { loads: 138 },
  latencyMs: 154_500,
  finishedAt: Date.now(),
  cost: null,
  escalation: null,
} as never;

describe("electrical AI 24h answer cache", () => {
  beforeEach(() => window.localStorage.clear());

  it("normalizes the key so casing and spacing hit the same entry", () => {
    expect(cacheKey("panel_qa", "  What panel   is the Mini Splits on ")).toBe(
      "panel_qa|what panel is the mini splits on",
    );
  });

  it("replays a stored answer for the same question", () => {
    writeCachedAnswer("panel_qa", "What panel is the mini splits on", answer);
    const hit = readCachedAnswer("panel_qa", "what panel is the MINI SPLITS on");
    expect(hit?.answer.answer).toContain("PNL-H1");
    expect(readCachedAnswer("panel_qa", "unrelated question")).toBeNull();
  });

  it("expires entries older than 24 hours", () => {
    writeCachedAnswer("panel_qa", "q", answer);
    const raw = JSON.parse(
      window.localStorage.getItem("farmops.electrical-ai-cache.v1")!,
    );
    raw[0].cachedAt = Date.now() - ELECTRICAL_AI_CACHE_TTL_MS - 1000;
    window.localStorage.setItem(
      "farmops.electrical-ai-cache.v1",
      JSON.stringify(raw),
    );
    expect(readCachedAnswer("panel_qa", "q")).toBeNull();
  });

  it("a refresh drops the old entry", () => {
    writeCachedAnswer("panel_qa", "q", answer);
    dropCachedAnswer("panel_qa", "q");
    expect(readCachedAnswer("panel_qa", "q")).toBeNull();
  });

  it("labels local runs as free and cloud runs at their price", () => {
    expect(runCostLabel(null, "local")).toBe("$0.00 (self-hosted)");
    expect(
      runCostLabel(
        { metered: true, usd: 0.0032, estimated: true, inputTokens: 5000, outputTokens: 400 },
        "hosted",
      ),
    ).toBe("$0.0032 (estimated)");
  });

  it("describes cache age in human terms", () => {
    const now = Date.now();
    expect(cacheAgeLabel(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(cacheAgeLabel(now - 3 * 3_600_000, now)).toBe("3 hours ago");
  });
});
