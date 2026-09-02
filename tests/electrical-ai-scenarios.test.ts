import { describe, expect, it } from "vitest";
import { electricalAccess } from "@/lib/electrical-access";
import {
  ELECTRICAL_AI_SCENARIOS,
  electricalAiScenariosFor,
} from "@/lib/electrical-ai-scenarios";

const ids = (scope: Parameters<typeof electricalAiScenariosFor>[0]) =>
  electricalAiScenariosFor(scope).map((s) => s.id);

describe("electrical AI scenario scoping", () => {
  it("gives an administrator every scenario", () => {
    const access = electricalAccess({ full: false, readOnly: false });
    expect(ids({ access, isAdmin: true })).toEqual(
      ELECTRICAL_AI_SCENARIOS.map((s) => s.id),
    );
  });

  it("limits a read-only electrician to read scenarios", () => {
    const access = electricalAccess({ full: false, readOnly: true });
    expect(ids({ access, isAdmin: false })).toEqual(["panel_qa", "topology_explain"]);
  });

  it("adds the field-note draft for a field-write electrician", () => {
    const access = electricalAccess({ full: false, readOnly: false, fieldWrite: true });
    expect(ids({ access, isAdmin: false })).toEqual([
      "panel_qa",
      "topology_explain",
      "field_note",
    ]);
  });

  it("gives the full add-on reconciliation triage but not the admin review", () => {
    const access = electricalAccess({ full: true, readOnly: false });
    const list = ids({ access, isAdmin: false });
    expect(list).toContain("qa_triage");
    expect(list).not.toContain("audit_summary");
  });

  it("withholds the assistant from scanned-label access", () => {
    const access = electricalAccess({ full: false, readOnly: false, scan: true });
    expect(ids({ access, isAdmin: false })).toEqual([]);
  });
});
