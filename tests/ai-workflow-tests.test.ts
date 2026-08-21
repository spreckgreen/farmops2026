import { describe, expect, it } from "vitest";
import {
  AI_WORKFLOW_TESTS,
  getWorkflow,
  gradeWorkflow,
  workflowPromptChars,
} from "@/lib/ai-workflow-tests";

const goodReport = `## Summary
Busy week: pump repair, fencing, and mowing.

## Completed
- Grease loader pins on tractor #4
- Replaced the pressure switch on the well pump
- Mowed the north field (6 acres)
- Fence repair at the creek crossing
- Oil change on the skid steer

## Blocked
- Steel doors: waiting on the Miller Supply quote
- Rachio zone 3 needs a new solenoid

## Next week
- Chimney inspection`;

const goodManual = `## Tools
- Adjustable wrench
- Screwdriver set
- Voltage tester
- Pipe dope
- Bucket

## Safety
- Warning: switch off the 20 A breaker before touching wiring.
- Warning: relieve tank pressure before removing the switch.

## Steps
1. Turn off the 20 A breaker feeding the pump and verify with a voltage tester.
2. Close the isolation valve downstream of the pressure tank.
3. Open the nearest faucet to drain and relieve pressure.
4. Drain the tank until the gauge reads zero.
5. Photograph the wiring, then disconnect the leads from the old switch.
6. Unthread the old pressure switch from the tank tee.
7. Apply pipe dope and thread on the new 30/50 switch hand tight plus one turn.
8. Reconnect the leads to the matching terminals.
9. Close the faucet and reopen the isolation valve.
10. Restore the breaker and let the pump repressurise.

## Verification
The pump should cut in near 30 psi and cut out near 50 psi, with no weeping at the tee. ${"Confirm steady pressure over three draw cycles. ".repeat(6)}`;

describe("workflow definitions", () => {
  it("exposes one test per workflow with a real prompt", () => {
    expect(AI_WORKFLOW_TESTS.map((w) => w.key)).toEqual(["smoke", "weekly_report", "manual"]);
    expect(workflowPromptChars(getWorkflow("weekly_report"))).toBeGreaterThan(800);
    expect(getWorkflow("manual").requirementKey).toBe("manuals");
    expect(getWorkflow("weekly_report").requirementKey).toBe("reports");
    expect(() => getWorkflow("nope")).toThrow(/Unknown AI workflow/);
  });
});

describe("weekly_report grading", () => {
  it("passes a structured rollup", () => {
    const { passed, checks } = gradeWorkflow("weekly_report", goodReport);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(passed).toBe(true);
  });

  it("fails the truncated 'nothing happened' reply", () => {
    const { passed, checks } = gradeWorkflow(
      "weekly_report",
      "There are no tasks logged for this week.",
    );
    expect(passed).toBe(false);
    const emptyClaim = checks.find((c) => c.label.startsWith("Did not claim"));
    expect(emptyClaim?.ok).toBe(false);
  });

  it("fails when sections are missing", () => {
    const { checks } = gradeWorkflow("weekly_report", "- did some stuff\n- and more stuff");
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain("found 0 of 4");
  });
});

describe("manual grading", () => {
  it("passes a full procedure", () => {
    const { passed } = gradeWorkflow("manual", goodManual);
    expect(passed).toBe(true);
  });

  it("fails a short outline with too few steps", () => {
    const { passed, checks } = gradeWorkflow(
      "manual",
      "## Steps\n1. Turn off power.\n2. Replace switch.",
    );
    expect(passed).toBe(false);
    expect(checks.find((c) => c.label.includes("8 numbered"))?.ok).toBe(false);
  });
});

describe("smoke grading", () => {
  it("only requires a non-empty reply", () => {
    expect(gradeWorkflow("smoke", "AI test OK").passed).toBe(true);
    expect(gradeWorkflow("smoke", "").passed).toBe(false);
  });
});
