// FA-FS-2026-09-03-PM-R1 — the revised PNL-FS-NW breaker audit manifest.
import { describe, expect, it } from "vitest";

import {
  assignProposedCircuitGroupIds,
  buildManifestGraph,
  classifyItem,
  isPendingRef,
  parseManifest,
  pendingRefItemKey,
} from "@/lib/electrical-audit-batch";
import { checkCircuitGroupId } from "@/lib/electrical-breaker-reference";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDIT_R1_BATCH_ID,
  auditedBreakerReferenceMatches,
  breakerItemKey,
  buildFsNwAuditManifestR1,
  fsNwAuditManifestR1Text,
  groupItemKey,
  loadLinkItemKey,
} from "@/lib/electrical-fs-nw-audit-r1";

describe("FA-FS-2026-09-03-PM-R1", () => {
  it("records the seven audited breakers exactly as observed", () => {
    expect(FS_NW_AUDITED_BREAKERS.map((b) => b.breaker_reference)).toEqual([
      "PNL-FS-NW-B40",
      "PNL-FS-NW-B39",
      "PNL-FS-NW-B37",
      "PNL-FS-NW-B35",
      "PNL-FS-NW-B33",
      "PNL-FS-NW-B31",
      "PNL-FS-NW-B29",
    ]);
    expect(FS_NW_AUDITED_BREAKERS.every(auditedBreakerReferenceMatches)).toBe(true);
    expect(FS_NW_AUDITED_BREAKERS.map((b) => `${b.side} ${b.position}`)).toEqual([
      "Left 1",
      "Right 1",
      "Right 2",
      "Right 3",
      "Right 4",
      "Right 5",
      "Right 6",
    ]);
  });

  it("is a valid manifest with a group and a position for every breaker", () => {
    const parsed = parseManifest(fsNwAuditManifestR1Text());
    expect(parsed.errors).toEqual([]);
    expect(parsed.ok).toBe(true);
    const m = parsed.manifest!;
    expect(m.batch_id).toBe(FS_NW_AUDIT_R1_BATCH_ID);
    expect(m.items.length).toBe(14);
    for (const b of FS_NW_AUDITED_BREAKERS) {
      const group = m.items.find((i) => i.item_key === groupItemKey(b))!;
      const bp = m.items.find((i) => i.item_key === breakerItemKey(b))!;
      expect(group.entity_kind).toBe("circuit_group");
      expect(bp.entity_kind).toBe("breaker_position");
      expect(bp.fields["ocp_amps"]).toBe(20);
      expect(bp.fields["poles"]).toBe(1);
      expect(bp.fields["breaker_number"]).toBe(b.breaker_number);
      expect(group.fields["description"]).toBe(b.circuit_group_label);
      expect(bp.refs.circuit_group_ref).toBe(group.target_stable_id);
    }
  });

  it("never puts a breaker reference inside a proposed circuit-group identity", () => {
    const m = buildFsNwAuditManifestR1();
    const { items, proposed } = assignProposedCircuitGroupIds(m.items, []);
    const ids = FS_NW_AUDITED_BREAKERS.map((b) => proposed[groupItemKey(b)]!);
    expect(ids).toEqual([
      "CG-FS-001",
      "CG-FS-002",
      "CG-FS-003",
      "CG-FS-004",
      "CG-FS-005",
      "CG-FS-006",
      "CG-FS-007",
    ]);
    for (const id of ids) expect(checkCircuitGroupId(id).ok).toBe(true);
    // Each breaker item now references the allocated permanent identity.
    const bp = items.find((i) => i.item_key === breakerItemKey(FS_NW_AUDITED_BREAKERS[0]!))!;
    expect(bp.refs.circuit_group_ref).toBe("CG-FS-001");
  });

  it("links each position to the group created in the same transaction", () => {
    const m = buildFsNwAuditManifestR1();
    const { items } = assignProposedCircuitGroupIds(m.items, []);
    const graph = buildManifestGraph(items);
    const b = FS_NW_AUDITED_BREAKERS[2]!;
    const bp = items.find((i) => i.item_key === breakerItemKey(b))!;
    const classified = classifyItem(bp, {
      target: null,
      resolved: new Map([["panel|PNL-FS-NW", "panel-uuid"]]),
      pendingCreates: graph.pendingCreates,
    });
    expect(classified.operation).toBe("CREATE");
    expect(classified.disposition).toBe("ready");
    const link = classified.patch["circuit_group_uuid"];
    expect(isPendingRef(link)).toBe(true);
    expect(pendingRefItemKey(String(link))).toBe(groupItemKey(b));
    expect(classified.patch["panel_uuid"]).toBe("panel-uuid");
  });

  it("emits load linkage only for exactly identified loads and says so in scope", () => {
    const withoutLoads = buildFsNwAuditManifestR1();
    expect(withoutLoads.items.some((i) => i.entity_kind === "load")).toBe(false);
    expect(withoutLoads.scope).toContain("Load linkage withheld");

    const b = FS_NW_AUDITED_BREAKERS[0]!;
    const withLoads = buildFsNwAuditManifestR1({
      loads: { [b.breaker_reference]: ["FS-054", "FS-055"] },
    });
    const keys = withLoads.items.filter((i) => i.entity_kind === "load").map((i) => i.item_key);
    expect(keys).toEqual([loadLinkItemKey(b, "FS-054"), loadLinkItemKey(b, "FS-055")]);
    const link = withLoads.items.find((i) => i.item_key === keys[0])!;
    expect(link.target_stable_id).toBe("FS-054");
    expect(link.refs.circuit_group_ref).toBe(withLoads.items[0]!.target_stable_id);
  });

  it("is deterministic", () => {
    expect(fsNwAuditManifestR1Text()).toBe(fsNwAuditManifestR1Text());
  });
});
