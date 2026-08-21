import { describe, expect, it } from "vitest";
import {
  evaluateModel,
  inferParamsB,
  overallLevel,
} from "../src/lib/ai-model-suitability";

describe("inferParamsB", () => {
  it("reads plain size tags", () => {
    expect(inferParamsB("llama3.2:3b")).toBe(3);
    expect(inferParamsB("qwen2.5:14b-instruct-q4_K_M")).toBe(14);
    expect(inferParamsB("qwen2.5:1.5b")).toBe(1.5);
  });
  it("handles MoE and named tags", () => {
    expect(inferParamsB("mixtral:8x7b")).toBe(56);
    expect(inferParamsB("phi3:mini")).toBe(3.8);
  });
  it("returns null when unknown", () => {
    expect(inferParamsB("gemma:latest")).toBeNull();
  });
});

describe("evaluateModel", () => {
  it("flags a 3B model with a 2k window as unsuitable everywhere", () => {
    const v = evaluateModel({ id: "llama3.2:3b", contextLength: 2048 });
    expect(overallLevel(v)).toBe("unsuitable");
    expect(v[0].fix).toContain("num_ctx");
  });

  it("passes reports but not manuals for a 3B model with 8k context", () => {
    const v = evaluateModel({ id: "llama3.2:3b", contextLength: 8192 });
    const reports = v.find((x) => x.task.key === "reports")!;
    const manuals = v.find((x) => x.task.key === "manuals")!;
    expect(reports.level).toBe("marginal");
    expect(manuals.level).toBe("unsuitable");
  });

  it("accepts a 14B model with 32k context", () => {
    const v = evaluateModel({ id: "qwen2.5:14b", contextLength: 32768 });
    expect(overallLevel(v)).toBe("good");
  });

  it("marks unverified when metadata is missing", () => {
    expect(overallLevel(evaluateModel({ id: "gemma:latest" }))).toBe("unknown");
  });
});
