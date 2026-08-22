import { describe, expect, it } from "vitest";
import {
  buildTagDeletionPlan,
  shouldAutoRollback,
  describeAutoRollback,
  type ModelRollbackPoint,
} from "@/lib/ai-model-rollback";

const point: ModelRollbackPoint = {
  previousModel: "llama3.2:3b",
  appliedModel: "llama3.2-3b-ctx32k",
  kind: "derived_context",
  createdTag: "llama3.2-3b-ctx32k",
  changedAt: new Date().toISOString(),
};

describe("tag deletion plan", () => {
  it("removes the created tag and keeps the restored model", () => {
    const plan = buildTagDeletionPlan(point, "llama3.2-3b-ctx32k");
    expect(plan.remove).toEqual(["llama3.2-3b-ctx32k"]);
    expect(plan.keep.map((k) => k.tag)).toEqual(["llama3.2:3b"]);
  });
  it("never deletes the model being restored", () => {
    const plan = buildTagDeletionPlan({ ...point, createdTag: "llama3.2:3b" }, "llama3.2:3b");
    expect(plan.remove).toEqual([]);
  });
  it("is empty without a rollback point", () => {
    expect(buildTagDeletionPlan(null).remove).toEqual([]);
  });
});

describe("auto rollback", () => {
  it("triggers when a gating workflow fails", () => {
    const results = [
      { workflow: "weekly_report", workflowLabel: "Weekly report", ok: true, passed: false },
      { workflow: "manual", workflowLabel: "Manual", ok: true, passed: true },
    ];
    expect(shouldAutoRollback(results)).toBe(true);
    expect(describeAutoRollback(results, "llama3.2:3b")).toContain("Weekly report");
  });
  it("stays put when both pass", () => {
    expect(
      shouldAutoRollback([
        { workflow: "weekly_report", ok: true, passed: true },
        { workflow: "manual", ok: true, passed: true },
      ]),
    ).toBe(false);
  });
  it("ignores smoke-only runs", () => {
    expect(shouldAutoRollback([{ workflow: "smoke", ok: false }])).toBe(false);
  });
});
