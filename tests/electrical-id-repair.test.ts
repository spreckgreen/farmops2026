import { describe, expect, it } from "vitest";
import { planIdRepairs, repairPlanIsEmpty } from "@/lib/electrical-id-repair";

const JB105 = "aaaaaaaa-0000-4000-8000-000000000105";
const JB106 = "aaaaaaaa-0000-4000-8000-000000000106";
const PNL = "bbbbbbbb-0000-4000-8000-00000000000f";

function input(over: Partial<Parameters<typeof planIdRepairs>[0]> = {}) {
  return {
    panels: [{ id: PNL, panel_id: "PNL-FS-NW" }],
    jboxes: [
      { id: JB105, jbox_id: "JB-105-01" },
      { id: JB106, jbox_id: "JB-106-01" },
    ],
    raceways: [
      {
        id: "r1",
        conduit_id: "CON-105",
        source_panel_uuid: PNL,
        source_endpoint_ref: "PNL-FS-NW",
        dest_jbox_uuid: JB105,
        dest_endpoint_ref: "JB-105",
      },
      {
        id: "r2",
        conduit_id: "CON-106",
        dest_jbox_uuid: JB106,
        dest_endpoint_ref: "JB-106",
      },
    ],
    branches: [
      { id: "b1", branch_id: "BR-105-02-02", source_jbox_uuid: JB105 },
      { id: "b2", branch_id: "BR-106-01-01", source_jbox_uuid: JB106 },
    ],
    ...over,
  };
}

describe("corrected junction-box ID propagation", () => {
  it("refreshes stale legacy endpoint text from the relational parent", () => {
    const plan = planIdRepairs(input());
    expect(plan.refs.map((r) => [r.stable_id, r.was, r.now])).toEqual([
      ["CON-105", "JB-105", "JB-105-01"],
      ["CON-106", "JB-106", "JB-106-01"],
    ]);
  });

  it("leaves agreeing references untouched", () => {
    const plan = planIdRepairs(input());
    expect(plan.refs.some((r) => r.was === "PNL-FS-NW")).toBe(false);
  });

  it("never proposes a change for blank (incomplete) references", () => {
    const plan = planIdRepairs(
      input({
        raceways: [{ id: "r3", conduit_id: "CON-107", dest_jbox_uuid: JB105, dest_endpoint_ref: null }],
        branches: [],
      }),
    );
    expect(plan.refs).toEqual([]);
    expect(repairPlanIsEmpty(plan)).toBe(true);
  });

  it("rewrites a branch ID whose encoded junction-box sequence was mis-entered", () => {
    const plan = planIdRepairs(input());
    expect(plan.branchIds).toEqual([
      { id: "b1", was: "BR-105-02-02", now: "BR-105-01-02", parent: "JB-105-01" },
    ]);
  });

  it("keeps an already-agreeing branch ID", () => {
    const plan = planIdRepairs(input());
    expect(plan.branchIds.some((r) => r.was === "BR-106-01-01")).toBe(false);
  });

  it("takes the next free sequence instead of colliding", () => {
    const plan = planIdRepairs(
      input({
        branches: [
          { id: "b1", branch_id: "BR-105-02-02", source_jbox_uuid: JB105 },
          { id: "b3", branch_id: "BR-105-01-02", source_jbox_uuid: JB105 },
        ],
      }),
    );
    expect(plan.branchIds[0]!.now).toBe("BR-105-01-03");
  });

  it("blocks — never guesses — when the encoded raceway path disagrees", () => {
    const plan = planIdRepairs(
      input({
        branches: [{ id: "b4", branch_id: "BR-201-02-01", source_jbox_uuid: JB105 }],
      }),
    );
    expect(plan.branchIds).toEqual([]);
    expect(plan.blocked[0]!.stable_id).toBe("BR-201-02-01");
  });

  it("does not revert corrected junction-box IDs", () => {
    const plan = planIdRepairs(input());
    expect(plan.refs.every((r) => r.now === "JB-105-01" || r.now === "JB-106-01")).toBe(true);
    expect(plan.branchIds.every((r) => r.parent.endsWith("-01"))).toBe(true);
  });
});
