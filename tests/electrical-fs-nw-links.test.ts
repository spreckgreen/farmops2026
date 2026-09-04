import { describe, expect, it } from "vitest";

import { parseManifest } from "@/lib/electrical-audit-batch";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDITED_LOADS,
  FS_NW_LINKS_BATCH_ID,
  buildFsNwLoadLinkManifest,
  fsNwLoadLinkManifestText,
  type ResolvedAuditedGroup,
} from "@/lib/electrical-fs-nw-audit-r1";

const allLoads = Object.values(FS_NW_AUDITED_LOADS).flat();

const approvedGroups: ResolvedAuditedGroup[] = FS_NW_AUDITED_BREAKERS.map((b, i) => ({
  breaker_reference: b.breaker_reference,
  circuit_group_id: `CG-FS-${String(20 + i).padStart(3, "0")}`,
}));

describe("FA-FS-2026-09-03-PM-R1-LINKS", () => {
  it("links all 20 audited loads to the approved CG-FS-### identities", () => {
    const r = buildFsNwLoadLinkManifest({ groups: approvedGroups, knownLoadIds: allLoads });
    expect(r.linkCount).toBe(20);
    expect(r.groupsNotApproved).toEqual([]);
    expect(r.loadsNotFound).toEqual([]);
    const links = r.manifest.items.filter((i) => i.operation === "LINK");
    expect(links).toHaveLength(20);
    for (const item of links) {
      expect(item.refs?.circuit_group_ref).toMatch(/^CG-FS-\d{3}$/);
      expect(item.target_stable_id).toMatch(/^FS-\d{3}$/);
      // Location is never written on a link item.
      expect(item.field_grid_reference).toBeNull();
    }
    // The unidentified second load on B29 is still carried as a hold.
    expect(r.manifest.items.filter((i) => i.operation === "HOLD_UNRESOLVED")).toHaveLength(1);
    expect(r.manifest.batch_id).toBe(FS_NW_LINKS_BATCH_ID);
  });

  it("uses the approved group of the audited breaker for each load", () => {
    const r = buildFsNwLoadLinkManifest({ groups: approvedGroups, knownLoadIds: allLoads });
    const b37 = approvedGroups.find((g) => g.breaker_reference === "PNL-FS-NW-B37")!;
    const item = r.manifest.items.find((i) => i.target_stable_id === "FS-044")!;
    expect(item.refs?.circuit_group_ref).toBe(b37.circuit_group_id);
  });

  it("holds instead of guessing when a group is not approved yet", () => {
    const r = buildFsNwLoadLinkManifest({
      groups: approvedGroups.filter((g) => g.breaker_reference !== "PNL-FS-NW-B31"),
      knownLoadIds: allLoads,
    });
    expect(r.groupsNotApproved).toEqual(["PNL-FS-NW-B31"]);
    expect(r.linkCount).toBe(17);
    const hold = r.manifest.items.find((i) => i.item_key === "fs-nw-b31-group-not-approved")!;
    expect(hold.operation).toBe("HOLD_UNRESOLVED");
    expect(r.manifest.items.some((i) => i.target_stable_id === "FS-036")).toBe(false);
  });

  it("holds a load that has no FarmOps record", () => {
    const r = buildFsNwLoadLinkManifest({
      groups: approvedGroups,
      knownLoadIds: allLoads.filter((id) => id !== "FS-076"),
    });
    expect(r.loadsNotFound).toEqual(["FS-076"]);
    expect(r.linkCount).toBe(19);
    expect(r.manifest.items.some((i) => i.target_stable_id === "FS-076")).toBe(false);
  });

  it("skips loads already linked to their audited group", () => {
    const r = buildFsNwLoadLinkManifest({
      groups: approvedGroups,
      knownLoadIds: allLoads,
      alreadyLinked: ["FS-054", "FS-055"],
    });
    expect(r.skippedAlreadyLinked).toEqual(["FS-054", "FS-055"]);
    expect(r.linkCount).toBe(18);
  });

  it("emits a valid, deterministic manifest", () => {
    const input = { groups: approvedGroups, knownLoadIds: allLoads };
    const text = fsNwLoadLinkManifestText(input);
    expect(text).toBe(fsNwLoadLinkManifestText(input));
    const parsed = parseManifest(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ok).toBe(true);
  });

  it("changes only the relationship: no label, note or location on a link item", () => {
    const r = buildFsNwLoadLinkManifest({ groups: approvedGroups, knownLoadIds: allLoads });
    const links = r.manifest.items.filter((i) => i.operation === "LINK");
    expect(links.length).toBe(20);
    for (const i of links) {
      expect(i.notes ?? null).toBeNull();
      expect(i.observed_label ?? null).toBeNull();
      expect(i.fields).toEqual({});
      expect(i.field_grid_reference ?? null).toBeNull();
      expect(i.pole ?? null).toBeNull();
      expect(i.install_state ?? null).toBeNull();
      // The relationship column is the only thing carried.
      expect(Object.keys(i.refs ?? {}).sort()).toEqual(["circuit_group_ref", "load_ref"]);
      // How and when it was observed still lives in the evidence line.
      expect(i.evidence).toContain("field audit 03 Sep 2026 PM");
    }
  });
});
