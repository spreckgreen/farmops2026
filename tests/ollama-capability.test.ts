import { describe, expect, it } from "vitest";
import {
  OLLAMA_DEFAULT_NUM_CTX,
  parseOllamaShow,
  parseParameterSizeLabel,
  readModelfileNumber,
  readTrainedContext,
} from "@/lib/ollama-capability";
import { evaluateTask, recommendedContext, TASK_REQUIREMENTS } from "@/lib/ai-model-suitability";

const reports = TASK_REQUIREMENTS.find((t) => t.key === "reports")!;

describe("readModelfileNumber", () => {
  it("reads num_ctx from an Ollama parameters block", () => {
    expect(readModelfileNumber('stop "<|eot_id|>"\nnum_ctx      16384', "num_ctx")).toBe(16384);
  });
  it("reads a PARAMETER-prefixed Modelfile line", () => {
    expect(readModelfileNumber("FROM llama3.2:3b\nPARAMETER num_ctx 32768", "num_ctx")).toBe(32768);
  });
  it("returns null when absent", () => {
    expect(readModelfileNumber("temperature 0.7", "num_ctx")).toBeNull();
  });
});

describe("parseParameterSizeLabel", () => {
  it("parses billions and millions", () => {
    expect(parseParameterSizeLabel("3.2B")).toBe(3.2);
    expect(parseParameterSizeLabel("780M")).toBe(0.78);
  });
  it("parses MoE labels", () => {
    expect(parseParameterSizeLabel("8x7B")).toBe(56);
  });
});

describe("readTrainedContext", () => {
  it("prefers the declared architecture key", () => {
    expect(
      readTrainedContext({
        "general.architecture": "llama",
        "llama.context_length": 131072,
        "clip.context_length": 77,
      }),
    ).toBe(131072);
  });
});

describe("parseOllamaShow", () => {
  it("uses the exact parameter count and clamps context to the runtime default", () => {
    const cap = parseOllamaShow({
      parameters: 'stop "<|eot_id|>"\ntemperature 0.6',
      details: { parameter_size: "3.2B", quantization_level: "Q4_K_M" },
      capabilities: ["completion", "tools"],
      model_info: {
        "general.architecture": "llama",
        "general.parameter_count": 3212749888,
        "llama.context_length": 131072,
      },
    });
    expect(cap.paramsB).toBe(3.21);
    expect(cap.paramsSource).toBe("count");
    expect(cap.trainedContextLength).toBe(131072);
    expect(cap.numCtx).toBeNull();
    expect(cap.contextLength).toBe(OLLAMA_DEFAULT_NUM_CTX);
    expect(cap.contextSource).toBe("runtime-default");
    expect(cap.quantization).toBe("Q4_K_M");
    expect(cap.capabilities).toContain("tools");
  });

  it("honours a baked-in num_ctx and num_predict", () => {
    const cap = parseOllamaShow({
      parameters: "num_ctx 32768\nnum_predict 4096",
      model_info: { "general.architecture": "qwen2", "qwen2.context_length": 32768 },
      details: { parameter_size: "7.6B" },
    });
    expect(cap.contextLength).toBe(32768);
    expect(cap.contextSource).toBe("num_ctx");
    expect(cap.numPredict).toBe(4096);
    expect(cap.paramsB).toBe(7.6);
    expect(cap.paramsSource).toBe("label");
  });

  it("respects an operator-raised runtime default", () => {
    const cap = parseOllamaShow(
      { model_info: { "llama.context_length": 131072 } },
      16384,
    );
    expect(cap.contextLength).toBe(16384);
  });

  it("returns nulls for an empty response", () => {
    const cap = parseOllamaShow({});
    expect(cap.contextLength).toBeNull();
    expect(cap.paramsB).toBeNull();
    expect(cap.contextSource).toBeNull();
  });
});

describe("suitability with real capability numbers", () => {
  it("explains a runtime-clamped window instead of blaming the weights", () => {
    const v = evaluateTask(
      {
        id: "llama3.2:3b",
        contextLength: 4096,
        trainedContextLength: 131072,
        contextSource: "runtime-default",
        paramsB: 3.21,
      },
      reports,
    );
    expect(v.level).toBe("unsuitable");
    expect(v.reasons.join(" ")).toMatch(/runtime default/);
    expect(v.reasons.join(" ")).toMatch(/128k/);
  });

  it("caps the recommended context at the trained window", () => {
    expect(
      recommendedContext({ id: "phi:latest", contextLength: 2048, trainedContextLength: 8192 }),
    ).toBe(8192);
    expect(
      recommendedContext({ id: "llama3.2:3b", contextLength: 4096, trainedContextLength: 131072 }),
    ).toBe(32768);
  });
});
