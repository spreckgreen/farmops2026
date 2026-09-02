import { describe, expect, it } from "vitest";
import { priceRun } from "@/lib/ai-metering.server";

describe("AI metering", () => {
  it("does not bill self-hosted runs", () => {
    const r = priceRun({
      area: "electrical.panel_qa",
      backend: "local",
      modelId: "llama3.1:8b",
      inputTokens: 5000,
      outputTokens: 1000,
    });
    expect(r.metered).toBe(false);
    expect(r.costUsd).toBe(0);
    expect(r.estimated).toBe(false);
  });

  it("prices a cloud run from published token rates", () => {
    const r = priceRun({
      area: "electrical.panel_qa",
      backend: "hosted",
      modelId: "google/gemini-3.6-flash",
      inputTokens: 3500,
      outputTokens: 900,
    });
    expect(r.metered).toBe(true);
    // 3500/1e6*0.30 + 900/1e6*2.50
    expect(r.costUsd).toBeCloseTo(0.00105 + 0.00225, 6);
  });

  it("estimates tokens from the feature profile when the model reported none", () => {
    const r = priceRun({
      area: "summary.weekly",
      backend: "hosted",
      modelId: "google/gemini-3-flash-preview",
    });
    expect(r.estimated).toBe(true);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("charges nothing for an unpriced custom cloud model", () => {
    const r = priceRun({
      area: "consultant",
      backend: "hosted",
      modelId: "my-private/finetune-v3",
      inputTokens: 1000,
      outputTokens: 100,
    });
    expect(r.metered).toBe(true);
    expect(r.costUsd).toBe(0);
  });
});
