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
  assignProposedCircuitGroupIds,
  buildManifestGraph,
  nextCircuitGroupId,
  orderForApply,
  pendingRef,
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
    expect(validatePole({ pole_location_kind: "AT_POST", pole_ref_start: "03NE", pole_ref_end: null })).toEqual([]);
    expect(
      validatePole({ pole_location_kind: "AT_POST", pole_ref_start: "03NE", pole_ref_end: "04SE" }).length,
    ).toBeGreaterThan(0);
  });

  it("treats 04SE/05SE as one BETWEEN_POSTS location", () => {
    expect(polesAdjacent("04SE", "05SE")).toBe(true);
    expect(validatePole({ pole_location_kind: "BETWEEN_POSTS", pole_ref_start: "04SE", pole_ref_end: "05SE" })).toEqual([]);
    expect(
      validatePole({ pole_location_kind: "BETWEEN_POSTS", pole_ref_start: "03NE", pole_ref_end: "09SE" }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects 14NW as invalid under the scheme", () => {
    expect(validatePole({ pole_location_kind: "AT_POST", pole_ref_start: "14NW", pole_ref_end: null }).length).toBeGreaterThan(0);
  });

  it("allows NOT_APPLICABLE for central-room equipment", () => {
    expect(validatePole({ pole_location_kind: "NOT_APPLICABLE", pole_ref_start: null, pole_ref_end: null })).toEqual([]);
    expect(
      validatePole({ pole_location_kind: "NOT_APPLICABLE", pole_ref_start: "03NE", pole_ref_end: null }).length,
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
      baseItem({ install_state: "installed" }),
      { target },
    );
    expect(item.disposition).toBe("ready");
    expect(item.expected_updated_at).toBe("2026-09-01T00:00:00Z");
    expect(item.changes.length).toBeGreaterThan(0);
  });

  it("holds when the observation proposes nothing writable", () => {
    const item = classifyItem(baseItem({ fields: {} }), { target });
    expect(item.disposition).toBe("hold");
    expect(item.patch).toEqual({});
  });

  it("never writes evidence into notes when the manifest asks for no notes change", () => {
    const withNotes = { ...target, notes: "Owner note: keep." };
    const item = classifyItem(baseItem({ install_state: "installed" }), { target: withNotes });
    expect(item.patch["notes"]).toBeUndefined();
    expect(item.messages.some((m) => m.text.includes("journal only"))).toBe(true);
  });

  it("appends a requested note with de-duplication instead of replacing", () => {
    const withNotes = { ...target, notes: "Owner note: keep." };
    const appended = classifyItem(baseItem({ notes: "Audit: 20A confirmed." }), {
      target: withNotes,
    });
    expect(appended.patch["notes"]).toBe("Owner note: keep. Audit: 20A confirmed.");

    const duplicate = classifyItem(baseItem({ notes: "Owner note: keep." }), {
      target: withNotes,
    });
    expect(duplicate.patch["notes"]).toBeUndefined();
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

describe("manifest-local dependency resolution (9.1)", () => {
  const groupItem = baseItem({
    item_key: "cg1",
    entity_kind: "circuit_group",
    target_stable_id: "AUTO",
    operation: "CREATE",
    refs: { panel_ref: "PNL-FS-NW" },
    fields: { breaker_number: 39, circuit_rating_amps: 20 },
  });
  const breakerItem = baseItem({
    item_key: "bp1",
    entity_kind: "breaker_position",
    target_stable_id: null,
    operation: "CREATE",
    refs: { panel_ref: "PNL-FS-NW", circuit_group_ref: "CG-FS-008" },
    fields: { side: "right", position: 1, breaker_number: 39, poles: 1, ocp_amps: 20 },
  });

  it("proposes the next unused CG-FS-## identity, never reusing one", () => {
    expect(nextCircuitGroupId(["CG-FS-01", "CG-FS-07", "CG-HS-09"])).toBe("CG-FS-008");
    const { items, proposed } = assignProposedCircuitGroupIds([groupItem], ["CG-FS-07"]);
    expect(items[0]!.target_stable_id).toBe("CG-FS-008");
    expect(proposed["cg1"]).toBe("CG-FS-008");
  });

  it("flags a duplicated proposed stable ID as an ambiguous conflict", () => {
    const graph = buildManifestGraph([
      { ...breakerItem, item_key: "a", entity_kind: "circuit_group", target_stable_id: "CG-FS-008" },
      { ...breakerItem, item_key: "b", entity_kind: "circuit_group", target_stable_id: "CG-FS-008" },
    ] as never);
    expect(graph.conflicts.length).toBe(1);
    expect(graph.pendingCreates.size).toBe(0);
  });

  it("links a breaker position to the circuit group created in the same manifest", () => {
    const { items } = assignProposedCircuitGroupIds([groupItem, breakerItem], ["CG-FS-07"]);
    const graph = buildManifestGraph(items);
    const bp = classifyItem(items[1]!, {
      target: null,
      resolved: new Map([["panel|PNL-FS-NW", "panel-uuid"]]),
      pendingCreates: graph.pendingCreates,
    });
    expect(bp.disposition).toBe("ready");
    expect(bp.patch["circuit_group_uuid"]).toBe(pendingRef("cg1"));
    expect(graph.dependsOn.get("bp1")).toEqual(["cg1"]);
  });

  it("orders a manifest-local parent before its dependent", () => {
    const ordered = orderForApply(
      [
        { item_key: "bp1", entity_kind: "breaker_position" as const },
        { item_key: "cg1", entity_kind: "circuit_group" as const },
      ],
      new Map([["bp1", ["cg1"]]]),
    );
    expect(ordered.map((i) => i.item_key)).toEqual(["cg1", "bp1"]);
  });

  it("still refuses a reference that matches neither a record nor a manifest create", () => {
    const bp = classifyItem(breakerItem, {
      target: null,
      resolved: new Map([["panel|PNL-FS-NW", "panel-uuid"]]),
      pendingCreates: new Map(),
    });
    expect(bp.disposition).toBe("hold");
  });
});
