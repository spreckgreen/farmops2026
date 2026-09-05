import { describe, it, expect } from "vitest";
import {
  classifyCircuitSharing,
  sharingFromGroupMembers,
  stageAsBuiltLoadObservation,
} from "@/lib/electrical-audit-as-built";
import {
  R3_OUTLET_AUDITED_LOADS,
  SHARED_TOKEN,
  buildOutletMetadataR3,
  type OutletLoadRow,
} from "@/lib/electrical-outlet-metadata-r3";
import {
  R3A_OUTLET_CLASSIFICATION_BATCH_ID,
  R3A_OUTLET_LOADS,
  R3A_PERMITTED_FIELDS,
  buildOutletClassificationR3A,
} from "@/lib/electrical-outlet-classification-r3a";
import { buildFsNwAuditManifestR3 } from "@/lib/electrical-fs-nw-audit-r3";
import { FS_NW_AUDITED_BREAKERS, FS_NW_AUDITED_LOADS } from "@/lib/electrical-fs-nw-audit-r1";

describe("dedicated/shared derivation", () => {
  it("never calls a circuit dedicated just because one load row is linked", () => {
    const c = classifyCircuitSharing("FS-039", { groupLoadIds: ["FS-039"] });
    expect(c.value).toBeNull();
    expect(sharingFromGroupMembers("FS-039", ["FS-039"])).toBeNull();
  });

  it("is shared when more than one load occupies the group", () => {
    expect(classifyCircuitSharing("FS-036", { groupLoadIds: ["FS-036", "FS-037"] }).value).toBe("S");
  });

  it("keeps general-use receptacles shared even when alone on the group", () => {
    expect(
      classifyCircuitSharing("FS-076", { groupLoadIds: ["FS-076"], generalUseReceptacle: true })
        .value,
    ).toBe("S");
  });

  it("leaves circuits with unresolved additional loads unresolved, not dedicated", () => {
    expect(
      classifyCircuitSharing("FS-090", {
        groupLoadIds: ["FS-090"],
        additionalLoadsUnresolved: true,
        dedicatedCircuitEvidence: true,
      }).value,
    ).toBeNull();
  });

  it("is dedicated only with explicit supplies-only-this evidence", () => {
    expect(
      classifyCircuitSharing("FS-101", { groupLoadIds: ["FS-101"], dedicatedCircuitEvidence: true })
        .value,
    ).toBe("D");
  });
});

const asBuilt = (extra: Record<string, unknown> = {}) =>
  stageAsBuiltLoadObservation({
    load_id: "FS-039",
    circuit_group_ref: "group-uuid-1",
    group_load_ids: ["FS-039"],
    physically_installed: true,
    evidence: "traced",
    ...extra,
  } as never);

describe("as-built staging scope", () => {
  it("does not touch classification when the field is outside the batch scope", () => {
    const staged = asBuilt();
    expect(staged.item.fields).not.toHaveProperty("dedicated");
    expect(staged.item.fields).not.toHaveProperty("dedicated_shared");
    expect(staged.sharing).toBeNull();
    expect(staged.gaps.join(" ")).toMatch(/outside this batch's evidence-supported scope/);
  });

  it("stages no dedicated=true even in scope without evidence", () => {
    const staged = asBuilt({ sharing_classification_in_scope: true });
    expect(staged.item.fields).not.toHaveProperty("dedicated");
    expect(staged.sharing).toBeNull();
  });

  it("stages shared in scope for a general-use receptacle", () => {
    const staged = asBuilt({
      sharing_classification_in_scope: true,
      general_use_receptacle: true,
    });
    expect(staged.item.fields["dedicated_shared"]).toBe("S");
    expect(staged.item.fields["dedicated"]).toBe(false);
  });
});

describe("R3-METADATA general reconciliation", () => {
  const built = buildFsNwAuditManifestR3({
    groups: FS_NW_AUDITED_BREAKERS.map((b, i) => ({
      breaker_reference: b.breaker_reference,
      circuit_group_id: `group-${i}`,
    })) as never,
    knownLoadIds: Object.values(FS_NW_AUDITED_LOADS).flat(),
    buildingFromPanel: "Farm Shop",
  });

  it("classifies nothing as dedicated", () => {
    expect(built.dedicatedCircuitLoads).toEqual([]);
  });

  it("never stages the classification columns", () => {
    for (const item of built.manifest.items) {
      expect(item.fields).not.toHaveProperty("dedicated");
      expect(item.fields).not.toHaveProperty("dedicated_shared");
    }
  });
});

describe(R3A_OUTLET_CLASSIFICATION_BATCH_ID, () => {
  const built = buildOutletClassificationR3A({
    loads: R3A_OUTLET_LOADS.map((id) => ({
      load_id: id,
      dedicated: true,
      dedicated_shared: "D",
      amps: 20,
      connected_va: 2400,
      circuit_group_uuid: "group-1",
    })),
  });

  it("stages exactly two items, one per audited outlet", () => {
    expect(built.manifest.items.length).toBe(2);
    expect(built.manifest.items.map((i) => i.target_stable_id)).toEqual(["FS-039", "FS-076"]);
  });

  it("changes only dedicated and dedicated_shared", () => {
    for (const item of built.manifest.items) {
      expect(Object.keys(item.fields).sort()).toEqual([...R3A_PERMITTED_FIELDS].sort());
      expect(item.fields["dedicated"]).toBe(false);
      expect(item.fields["dedicated_shared"]).toBe(SHARED_TOKEN);
      expect(item.refs).toEqual({});
    }
  });

  it("shows the exact before values in the preview", () => {
    expect(built.rows.map((r) => r.before)).toEqual([
      { dedicated: true, dedicated_shared: "D" },
      { dedicated: true, dedicated_shared: "D" },
    ]);
  });

  it("is deterministic", () => {
    const again = buildOutletClassificationR3A({
      loads: R3A_OUTLET_LOADS.map((id) => ({
        load_id: id,
        dedicated: true,
        dedicated_shared: "D",
        amps: 20,
        connected_va: 2400,
        circuit_group_uuid: "group-1",
      })),
    });
    expect(JSON.stringify(again.manifest)).toBe(JSON.stringify(built.manifest));
  });

  it("stages nothing when the outlets are already shared", () => {
    const none = buildOutletClassificationR3A({
      loads: R3A_OUTLET_LOADS.map((id) => ({ load_id: id, dedicated: false, dedicated_shared: "S" })),
    });
    expect(none.alreadyCorrect).toEqual(["FS-039", "FS-076"]);
    expect(none.manifest.items.every((i) => i.operation === "HOLD_UNRESOLVED")).toBe(true);
  });

  it("holds a missing load instead of writing it", () => {
    const missing = buildOutletClassificationR3A({ loads: [] });
    expect(missing.loadsNotFound).toEqual(["FS-039", "FS-076"]);
    expect(missing.manifest.items.every((i) => i.operation === "HOLD_UNRESOLVED")).toBe(true);
  });
});

/**
 * Regression: apply R3-OUTLET-METADATA, then the general R3-METADATA
 * reconciliation. All 18 audited outlets must stay dedicated=false, class S,
 * with amperage and connected VA unrecorded.
 */
describe("R3-OUTLET-METADATA then R3-METADATA", () => {
  it("leaves all 18 audited outlets shared with current unrecorded", () => {
    // Legacy state: 20 A branch rating recorded as the outlet's own current.
    const rows: Record<string, OutletLoadRow> = {};
    for (const id of R3_OUTLET_AUDITED_LOADS) {
      rows[id] = {
        load_id: id,
        dedicated: true,
        dedicated_shared: "D",
        amps: 20,
        connected_va: 2400,
        amps_semantic: "INSTALLED_OCP_RATING",
        amps_semantic_provenance: null,
        circuit_group_uuid: "group-1",
      };
    }

    // Step 1 — apply the outlet metadata correction to the simulated records.
    const outlets = buildOutletMetadataR3({
      audited: Object.values(rows),
      candidates: [],
    });
    for (const item of outlets.manifest.items) {
      if (item.operation !== "UPDATE") continue;
      const row = rows[String(item.target_stable_id)]!;
      Object.assign(row, item.fields);
    }

    // Step 2 — apply the general metadata reconciliation over the same records.
    const recon = buildFsNwAuditManifestR3({
      groups: FS_NW_AUDITED_BREAKERS.map((b, i) => ({
        breaker_reference: b.breaker_reference,
        circuit_group_id: `group-${i}`,
      })) as never,
      knownLoadIds: [...R3_OUTLET_AUDITED_LOADS, ...Object.values(FS_NW_AUDITED_LOADS).flat()],
      buildingFromPanel: "Farm Shop",
    });
    for (const item of recon.manifest.items) {
      const row = rows[String(item.target_stable_id)];
      if (!row || item.operation === "HOLD_UNRESOLVED") continue;
      Object.assign(row, item.fields);
    }

    for (const id of R3_OUTLET_AUDITED_LOADS) {
      const row = rows[id]!;
      expect(row.dedicated, `${id} dedicated`).toBe(false);
      expect(row.dedicated_shared, `${id} class`).toBe(SHARED_TOKEN);
      expect(row.amps ?? null, `${id} amps`).toBeNull();
      expect(row.connected_va ?? null, `${id} VA`).toBeNull();
    }
  });
});
