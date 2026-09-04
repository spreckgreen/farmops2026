import { describe, expect, it } from "vitest";
import { breakerDisplay } from "@/lib/electrical-breaker-reference";
import { labelFieldValue, type LabelRecord } from "@/lib/electrical-labels";
import { panelCoverageCsv } from "@/lib/electrical-panel-coverage";

describe("breakerDisplay sync path", () => {
  it("derives the shared reference", () => {
    expect(breakerDisplay({ panel_id: "PNL-FS-NW", breaker_number: 39 })).toEqual({
      reference: "PNL-FS-NW-B39",
      label: "PNL-FS-NW-B39",
      derived: true,
    });
  });
  it("falls back to recorded position when the panel is unknown", () => {
    const out = breakerDisplay({ side: "right", position: 6 });
    expect(out).toEqual({ reference: null, label: "right6", derived: false });
  });
  it("uses the sentinel when nothing is recorded", () => {
    expect(breakerDisplay({ notInRecord: "NOT IN RECORD" }).label).toBe("NOT IN RECORD");
  });
});

describe("labels use the same reference", () => {
  const record = {
    kind: "circuit_group",
    id: "u1",
    stableId: "CG-FS-014",
    values: { suggested_panel: "PNL-FS-NW", breaker_number: "39" },
  } as unknown as LabelRecord;
  it("prints the derived reference", () => {
    expect(labelFieldValue(record, "breaker_number")).toBe("PNL-FS-NW-B39");
  });
});

describe("coverage export", () => {
  it("carries a breaker_reference column", () => {
    const csv = panelCoverageCsv({
      panels: [
        {
          panel_id: "PNL-FS-NW",
          positions: [
            {
              panel_id: "PNL-FS-NW",
              breaker_number: 39,
              side: "right",
              position: 20,
              state: "recorded",
              state_label: "Recorded",
              has_transcription_evidence: true,
              has_record: true,
              logical_owner: null,
              detail: "",
            },
          ],
        },
      ],
    } as never);
    expect(csv.split("\n")[0]).toContain("breaker_reference");
    expect(csv).toContain("PNL-FS-NW-B39");
  });
});
