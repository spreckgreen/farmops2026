import { describe, expect, it } from "vitest";
import {
  STAGE_COMPLETION_PERCENT,
  displayCompletionPercent,
  stageCompletionPercent,
} from "@/lib/electrical-lifecycle";
import { INSTALL_STATUSES } from "@/lib/electrical-install-progress.functions";

describe("Complete % mirrors the recorded stage", () => {
  it("maps every install stage to exactly one percentage", () => {
    for (const s of INSTALL_STATUSES) {
      expect(STAGE_COMPLETION_PERCENT[s], s).toBeTypeOf("number");
    }
  });

  it("keeps the ladder monotonic from planned to complete", () => {
    const seq = INSTALL_STATUSES.map((s) => STAGE_COMPLETION_PERCENT[s]);
    for (let i = 1; i < seq.length; i += 1) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    expect(stageCompletionPercent("planned")).toBe(0);
    expect(stageCompletionPercent("material_ready")).toBe(10);
    expect(stageCompletionPercent("conductors_installed")).toBe(55);
    expect(stageCompletionPercent("complete")).toBe(100);
    expect(stageCompletionPercent("as_built_verified")).toBe(100);
  });

  it("prefers the stage over a stale stored number and flags it", () => {
    const r = displayCompletionPercent("raceway_installed", 95);
    expect(r.percent).toBe(40);
    expect(r.source).toBe("stage");
    expect(r.stale).toBe(true);
  });

  it("does not flag a stored number that already agrees", () => {
    expect(displayCompletionPercent("tested", 90)).toMatchObject({ percent: 90, stale: false });
  });

  it("falls back to the stored number only when the stage is off-ladder", () => {
    expect(displayCompletionPercent("out_of_service", 30)).toMatchObject({
      percent: 30,
      source: "stored",
    });
    expect(displayCompletionPercent(null, null)).toMatchObject({ percent: null, source: "none" });
  });
});
