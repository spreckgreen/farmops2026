// FARMOPS-ELEC-DESIGN-TO-FIELD-V1 — pure-logic coverage.
import { describe, expect, it } from "vitest";

import {
  DESIGN_STEP_COLUMNS,
  FIELD_STEP_COLUMNS,
  checkCoordinates,
  designPatch,
  fieldEvidencePatch,
  historyCsv,
  historyEvents,
  previewDesignStep,
  previewFieldStep,
  provenanceLine,
  stepSummary,
  validateDesignSubmission,
  validateFieldEvidence,
  type DesignToFieldRow,
} from "@/lib/electrical-design-to-field";

const row = (over: Partial<DesignToFieldRow> = {}): DesignToFieldRow =>
  ({
    id: "uuid-1",
    load_id: "FS-056",
    description: "Overhead LED",
    install_status: "planned",
    design_x_ft: null,
    design_y_ft: null,
    design_grid: null,
    design_location_source: null,
    grid_migration_provenance: null,
    location_x_ft: null,
    location_y_ft: null,
    field_grid_reference: null,
    grid_reference: null,
    grid_reference_precision: null,
    location_evidence: null,
    field_verification_status: null,
    verified_at: null,
    legacy_grid: "C4",
    grid: "C4",
    corner_reference: null,
    mounting_wall_face: null,
    coverage_direction: null,
    pole_scheme: null,
    pole_location_kind: null,
    pole_ref_start: null,
    pole_ref_end: null,
    updated_at: "2026-09-05T00:00:00Z",
    ...over,
  }) as DesignToFieldRow;

const design = { stableId: "FS-056", xFt: 6, yFt: 10, approvalReference: "Owner approval 05Sep26" };
const field = {
  stableId: "FS-056",
  xFt: 7.5,
  yFt: 10,
  evidence: "Field audit 05Sep26 — measured",
  observedAt: "2026-09-05T12:00:00Z",
};

describe("input validation", () => {
  it("keeps coordinates inside the frozen 60 x 40 envelope", () => {
    expect(checkCoordinates(6, 10)).toMatchObject({ ok: true, xFt: 6, yFt: 10 });
    expect(checkCoordinates(61, 10).ok).toBe(false);
    expect(checkCoordinates(6, 41).ok).toBe(false);
    expect(checkCoordinates("", 10).ok).toBe(false);
    expect(checkCoordinates(6.44, 10).xFt).toBe(6.4);
  });

  it("requires an approval reference for a design position", () => {
    expect(validateDesignSubmission({ ...design, approvalReference: "" }).ok).toBe(false);
    expect(validateDesignSubmission(design).ok).toBe(true);
  });

  it("requires an observation note for field evidence", () => {
    expect(validateFieldEvidence({ ...field, evidence: "" }).ok).toBe(false);
    const ok = validateFieldEvidence({ ...field, observedAt: null });
    expect(ok.ok).toBe(true);
  });
});

describe("step 1 — approved design position", () => {
  it("writes only design columns and never claims verification", () => {
    const patch = designPatch(design);
    expect(Object.keys(patch).sort()).toEqual([...DESIGN_STEP_COLUMNS].sort());
    expect(patch["design_location_source"]).toBe("APPROVED_DESIGN_XY");
    expect(patch["install_status"]).toBeUndefined();
    expect(patch["field_verification_status"]).toBeUndefined();
    expect(patch["verified_at"]).toBeUndefined();
    expect(patch["description"]).toBeUndefined();
  });

  it("moves the derived location from the original grid to the approved design", () => {
    const p = previewDesignStep(row(), design);
    expect(p.effectiveBefore).toMatch(/original grid/);
    expect(p.effectiveAfter).toMatch(/approved design/);
    expect(p.effectiveAfter).toMatch(/not field verified/);
    expect(p.changes.map((c) => c.column)).toContain("design_x_ft");
    expect(stepSummary(p)).toMatch(/not field verified/);
  });

  it("warns when accepted field evidence already outranks the design", () => {
    const verified = row({
      field_grid_reference: "A8",
      location_evidence: "Field audit",
      verified_at: "2026-09-04T00:00:00Z",
      field_verification_status: "UPDATED_FROM_FIELD_OBSERVATION",
    });
    const p = previewDesignStep(verified, design);
    expect(p.warnings.join(" ")).toMatch(/already outranks/);
    expect(p.effectiveAfter).toMatch(/observed/);
  });
});

describe("step 2 — accepted field evidence", () => {
  const withDesign = row({
    design_x_ft: 6,
    design_y_ft: 10,
    design_grid: "B1",
    design_location_source: "APPROVED_DESIGN_XY",
    grid_migration_provenance: "Approved design position: Owner approval 05Sep26",
  });

  it("writes only field columns and touches no design column", () => {
    const patch = fieldEvidencePatch(field);
    expect(Object.keys(patch).sort()).toEqual([...FIELD_STEP_COLUMNS].sort());
    for (const column of DESIGN_STEP_COLUMNS) expect(patch[column]).toBeUndefined();
    expect(patch["field_verification_status"]).toBe("UPDATED_FROM_FIELD_OBSERVATION");
  });

  it("supersedes the approved design while keeping it on record", () => {
    const p = previewFieldStep(withDesign, field);
    expect(p.supersedes).toBe("APPROVED_DESIGN_XY");
    expect(p.effectiveBefore).toMatch(/approved design/);
    expect(p.effectiveAfter).toMatch(/observed/);
    expect(p.changes.some((c) => c.column.startsWith("design_"))).toBe(false);
    expect(p.preserved.join(" ")).toMatch(/approved design coordinates/);
    // The design values themselves are untouched in the record.
    expect(withDesign.design_x_ft).toBe(6);
  });

  it("reports how far the as-found position is from the design", () => {
    const p = previewFieldStep(withDesign, field);
    expect(p.warnings.join(" ")).toMatch(/1\.5 ft from the approved design/);
    const same = previewFieldStep(withDesign, { ...field, xFt: 6, yFt: 10 });
    expect(same.warnings).toEqual([]);
  });

  it("leaves the record's stable ID and relationships out of every patch", () => {
    const patch = { ...designPatch(design), ...fieldEvidencePatch(field) };
    for (const forbidden of [
      "load_id",
      "circuit_group_uuid",
      "circuit_group_ref",
      "suggested_panel",
      "notes",
      "description",
      "amps",
      "install_status",
    ]) {
      expect(patch[forbidden as keyof typeof patch]).toBeUndefined();
    }
  });

  it("keeps the derived grid label a read-out of the exact feet", () => {
    const patch = fieldEvidencePatch(field);
    expect(patch["grid_reference_precision"]).toBe("EXACT");
    expect(patch["location_x_ft"]).toBe(7.5);
    expect(provenanceLine(row({ ...withDesign }))).toMatch(/approved design/);
  });
});

describe("history", () => {
  const raw = [
    {
      id: "h2",
      entity_ref: "FS-056",
      created_at: "2026-09-05T12:00:00Z",
      actor_email: "owner@example.com",
      summary: "Field evidence accepted for FS-056 at 7.5 ft E / 10 ft S (B1); supersedes APPROVED_DESIGN_XY",
      changes: [{ column: "location_x_ft", before: null, after: 7.5 }],
    },
    {
      id: "h1",
      entity_ref: "FS-056",
      created_at: "2026-09-05T08:00:00Z",
      actor_email: "owner@example.com",
      summary: "Approved design position 6 ft E / 10 ft S (B1) recorded for FS-056; not field verified.",
      changes: [{ column: "design_x_ft", before: null, after: 6 }],
    },
  ];

  it("orders newest first and classifies each step", () => {
    const events = historyEvents(raw);
    expect(events.map((e) => e.step)).toEqual([
      "FIELD_EVIDENCE_ACCEPTED",
      "APPROVED_DESIGN_SUBMITTED",
    ]);
    expect(events[0]!.changes[0]).toMatchObject({ column: "location_x_ft", after: 7.5 });
  });

  it("exports every before/after row as CSV", () => {
    const csv = historyCsv(historyEvents(raw));
    expect(csv.split("\n")[0]).toBe(
      "recorded_at,stable_id,step,actor,column,before,after",
    );
    expect(csv).toMatch(/design_x_ft/);
    expect(csv).toMatch(/location_x_ft/);
  });
});
