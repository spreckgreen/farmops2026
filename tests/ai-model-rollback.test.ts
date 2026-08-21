import { describe, expect, it } from "vitest";
import {
  canRollback,
  deletableTag,
  describeRollback,
  parseRollbackPoint,
  serializeRollbackPoint,
  type ModelRollbackPoint,
} from "@/lib/ai-model-rollback";

const derivedPoint: ModelRollbackPoint = {
  previousModel: "llama3.2:3b",
  appliedModel: "llama3.2-3b-ctx32k",
  kind: "derived_context",
  createdTag: "llama3.2-3b-ctx32k",
  changedAt: "2026-08-21T20:00:00.000Z",
};

describe("rollback point round-trip", () => {
  it("serializes and parses losslessly", () => {
    expect(parseRollbackPoint(serializeRollbackPoint(derivedPoint))).toEqual(derivedPoint);
  });

  it("tolerates junk, empty, and legacy plain-string values", () => {
    expect(parseRollbackPoint(null)).toBeNull();
    expect(parseRollbackPoint("")).toBeNull();
    expect(parseRollbackPoint("llama3.2:3b")).toBeNull();
    expect(parseRollbackPoint("{not json")).toBeNull();
    expect(parseRollbackPoint('{"previousModel":"a"}')).toBeNull();
  });

  it("normalizes an unknown kind and missing fields", () => {
    const p = parseRollbackPoint('{"appliedModel":"qwen2.5:7b","kind":"weird"}');
    expect(p).toMatchObject({ appliedModel: "qwen2.5:7b", kind: "manual", previousModel: null, createdTag: null });
  });
});

describe("canRollback", () => {
  it("is offered when the previous model differs from the active one", () => {
    expect(canRollback(derivedPoint, "llama3.2-3b-ctx32k")).toBe(true);
  });

  it("is not offered without a previous model or when already restored", () => {
    expect(canRollback(null, "llama3.2:3b")).toBe(false);
    expect(canRollback({ ...derivedPoint, previousModel: null }, "x")).toBe(false);
    expect(canRollback(derivedPoint, "llama3.2:3b")).toBe(false);
  });
});

describe("deletableTag", () => {
  it("offers the derived tag created by the num_ctx fix", () => {
    expect(deletableTag(derivedPoint)).toBe("llama3.2-3b-ctx32k");
  });

  it("offers a freshly pulled model but never a manual switch", () => {
    expect(
      deletableTag({
        previousModel: "llama3.2:3b",
        appliedModel: "qwen2.5:7b",
        kind: "switch_model",
        createdTag: "qwen2.5:7b",
        changedAt: derivedPoint.changedAt,
      }),
    ).toBe("qwen2.5:7b");
    expect(deletableTag({ ...derivedPoint, kind: "manual", createdTag: null })).toBeNull();
  });

  it("never deletes the model being restored", () => {
    expect(deletableTag({ ...derivedPoint, createdTag: "llama3.2:3b" })).toBeNull();
  });
});

describe("describeRollback", () => {
  it("reads as an undo label", () => {
    expect(describeRollback(derivedPoint)).toBe(
      "Undo num_ctx fix: llama3.2-3b-ctx32k → llama3.2:3b",
    );
  });
});
