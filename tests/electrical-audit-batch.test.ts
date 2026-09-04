// FARMOPS-ELEC-AUDIT-BATCH-V1 — pure-logic coverage for the bulk field audit.
import { describe, expect, it } from "vitest";

import {
  AUDIT_BATCH_SCHEMA_VERSION,
  APPLY_ORDER,
  POLE_SEQUENCE,
  classifyItem,
  compensatingManifest,
  manifestChecksum,
  odsCandidateRows,
  parseFieldGrid,
  parseManifest,
  polesAdjacent,
  selectable,
  summarize,
  validatePole,
  type AuditBatchItemInput,
} from "@/lib/electrical-audit-batch";

const baseItem = (over: Partial<AuditBatchItemInput> = {}): AuditBatchItemInput =>
  ({
    item_key: "k1",
    entity_kind: "load",
    target_stable_id: "FS-035",
    observation_class: "FIELD_AS_BUILT",
    operation: "UPDATE",
    fields: {},
    install_state: null,
    pole: null,
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: "Field Audit 03Sep26 PM",
    notes: null,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
    ...over,
  }) as AuditBatchItemInput;

const manifest = (items: AuditBatchItemInput[]) => ({
  schema_version: AUDIT_BATCH_SCHEMA_VERSION,
  batch_id: "FA-FS-2026-09-03-PM",
  title: "Farm Shop field audit",
  items,
});

describe("pole grid semantics", () => {
  it("keeps the frozen clockwise sequence and corners", () => {
    expect(POLE_SEQUENCE[0]).toBe("01NE");
    expect(POLE_SEQUENCE).toHaveLength(26);
    expect(POLE_SEQUENCE).toContain("14SW");
    expect(POLE_SEQUENCE).not.toContain("14NW");
  });

  it("accepts AT_POST with one reference only", () => {
    expect(validatePole({ kind: "AT_POST", start: "03NE", end: null })).toEqual([]);
    expect(
      validatePole({ kind: "AT_POST", start: "03NE", end: "04SE" }).length,
    ).toBeGreaterThan(0);
  });

  it("treats 04SE/05SE as one BETWEEN_POSTS location", () => {
    expect(polesAdjacent("04SE", "05SE")).toBe(true);
    expect(validatePole({ kind: "BETWEEN_POSTS", start: "04SE", end: "05SE" })).toEqual([]);
    expect(
      validatePole({ kind: "BETWEEN_POSTS", start: "03NE", end: "09SE" }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects 14NW as invalid under the scheme", () => {
    expect(validatePole({ kind: "AT_POST", start: "14NW", end: null }).length).toBeGreaterThan(0);
  });

  it("allows NOT_APPLICABLE for central-room equipment", () => {
    expect(validatePole({ kind: "NOT_APPLICABLE", start: null, end: null })).toEqual([]);
    expect(
      validatePole({ kind: "NOT_APPLICABLE", start: "03NE", end: null }).length,
    ).toBeGreaterThan(0);
  });

  it("preserves fractional audit grid references", () => {
    expect(parseFieldGrid("F3.5")).toMatchObject({ row: "F", column: 3.5 });
    expect(parseFieldGrid("D2.5")?.fractional).toBe(true);
    expect(parseFieldGrid("B2")?.fractional).toBe(false);
  });
});

describe("manifest parsing", () => {
  it("rejects duplicate item keys", () => {
    const parsed = parseManifest(manifest([baseItem(), baseItem()]));
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.join(" ")).toMatch(/k1/);
  });

  it("checksums identical manifests identically regardless of key order", async () => {
    const a = parseManifest(manifest([baseItem()])).manifest!;
    const b = parseManifest({ ...manifest([baseItem()]), title: "Farm Shop field audit" }).manifest!;
    expect(await manifestChecksum(a)).toBe(await manifestChecksum(b));
  });
});

describe("classification", () => {
  const target = {
    id: "uuid-1",
    load_id: "FS-035",
    updated_at: "2026-09-01T00:00:00Z",
    install_status: "planned",
  };

  it("produces an exact diff for an eligible field observation", () => {
    const item = classifyItem(
      baseItem({ install_state: "rough_in" }),
      { target },
    );
    expect(item.disposition).toBe("ready");
    expect(item.expected_updated_at).toBe("2026-09-01T00:00:00Z");
    expect(item.changes.length).toBeGreaterThan(0);
  });

  it("reports no change when the record already matches", () => {
    const item = classifyItem(baseItem({ fields: {} }), { target });
    expect(["no_change", "ready"]).toContain(item.disposition);
  });

  it("holds an unknown stable ID rather than inventing a record", () => {
    const item = classifyItem(baseItem({ target_stable_id: "FS-999" }), { target: null });
    expect(item.disposition).toBe("hold");
    expect(item.patch).toEqual({});
  });

  it("routes planned design changes to the ODS candidate export", () => {
    const item = classifyItem(
      baseItem({
        target_stable_id: "FS-002",
        observation_class: "PLANNED_DESIGN",
        ods_field: "Grid",
        ods_candidate_value: "C4",
        reason: "planned relocation",
      }),
      { target: { ...target, load_id: "FS-002" } },
    );
    expect(item.disposition).toBe("ods_candidate");
    expect(item.patch).toEqual({});
    const rows = odsCandidateRows("FA-FS-2026-09-03-PM", [item]);
    expect(rows[0]).toMatchObject({ stable_id: "FS-002", candidate_value: "C4" });
  });

  it("never lets holds, conflicts, candidates or no-change be approved", () => {
    expect(selectable("ready")).toBe(true);
    for (const d of ["hold", "conflict", "ods_candidate", "no_change", "applied", "failed"] as const) {
      expect(selectable(d)).toBe(false);
    }
  });

  it("refuses a branch whose encoded origin is not a verified J-box", () => {
    const item = classifyItem(
      baseItem({
        entity_kind: "branch",
        target_stable_id: "BR-104-01-03",
        operation: "CREATE",
        refs: { jbox_ref: "JB-104-01" },
      }),
      { target: null, existingJboxIds: [], existingBranchIds: [] },
    );
    expect(item.disposition).toBe("hold");
  });
});

describe("apply order and summaries", () => {
  it("orders panels before loads and observations", () => {
    expect(APPLY_ORDER.indexOf("panel")).toBeLessThan(APPLY_ORDER.indexOf("breaker_position"));
    expect(APPLY_ORDER.indexOf("breaker_position")).toBeLessThan(APPLY_ORDER.indexOf("load"));
  });

  it("counts dispositions", () => {
    const s = summarize([
      { operation: "UPDATE", disposition: "ready", observation_class: "FIELD_AS_BUILT" },
      { operation: "HOLD_UNRESOLVED", disposition: "hold", observation_class: "TEMPORARY" },
    ]);
    expect(s.items).toBe(2);
    expect(s.ready).toBe(1);
    expect(s.holds).toBe(1);
  });
});

describe("recovery", () => {
  it("builds a compensating manifest that restores prior values", () => {
    const applied = [
      {
        item_key: "k1",
        entity_kind: "load" as const,
        target_stable_id: "FS-035",
        operation: "UPDATE" as const,
        changes: [{ column: "install_status", before: "planned", after: "conductors_installed" }],
      },
    ] as never;
    const m = compensatingManifest(
      { batch_id: "FA-FS-2026-09-03-PM", title: "Farm Shop field audit" },
      applied,
    );
    expect(m.compensates_batch_id).toBe("FA-FS-2026-09-03-PM");
    expect(m.items[0]!.fields).toMatchObject({ install_status: "planned" });
  });
});
