import { describe, expect, it } from "vitest";

import {
  classifyItem,
  parseFieldGrid,
  parseManifest,
} from "@/lib/electrical-audit-batch";
import {
  FS_048_CIRCUIT_GROUP_ID,
  FS_AUDIT_R1_20260906_BATCH_ID,
  FS_AUDIT_R1_20260906_LOAD_GRIDS,
  FS_AUDIT_R1_20260906_NOT_FOUND,
  buildFsAuditR120260906Manifest,
} from "@/lib/electrical-fs-audit-r1-20260906";

const manifest = buildFsAuditR120260906Manifest();
const item = (key: string) => manifest.items.find((i) => i.item_key.endsWith(key));

describe("field grid references", () => {
  it("accepts single and fractional cells", () => {
    expect(parseFieldGrid("F6.5")).toMatchObject({ raw: "F6.5", fractional: true, span: false });
    expect(parseFieldGrid("A1")).toMatchObject({ raw: "A1", span: false });
  });

  it("preserves a position observed between two adjacent cells", () => {
    expect(parseFieldGrid("B9/C9")).toMatchObject({ raw: "B9/C9", span: true, endRow: "C" });
    expect(parseFieldGrid("D3.5/E3.5")).toMatchObject({ raw: "D3.5/E3.5", span: true });
    expect(parseFieldGrid("A3/A4")).toMatchObject({ raw: "A3/A4", span: true });
  });

  it("rejects non-adjacent or malformed spans", () => {
    expect(parseFieldGrid("A1/C1")).toBeNull();
    expect(parseFieldGrid("A1/B3")).toBeNull();
    expect(parseFieldGrid("A1/B1/C1")).toBeNull();
  });
});

describe(FS_AUDIT_R1_20260906_BATCH_ID, () => {
  it("parses against the audit-batch schema", () => {
    const parsed = parseManifest(manifest);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ok).toBe(true);
  });

  it("stages every verified load grid exactly as observed", () => {
    for (const load of FS_AUDIT_R1_20260906_LOAD_GRIDS) {
      const staged = item(`${load.load_id.toLowerCase()}-location`);
      expect(staged, load.load_id).toBeTruthy();
      expect(staged?.field_grid_reference).toBe(load.grid);
      expect(staged?.observation_class).toBe("FIELD_AS_BUILT");
    }
  });

  it("holds the branches not found at JB-104-02 without deleting them", () => {
    for (const missing of FS_AUDIT_R1_20260906_NOT_FOUND) {
      const held = item(`${missing.toLowerCase()}-not-found`);
      expect(held?.observation_class).toBe("HOLD_UNRESOLVED");
      expect(held?.reason).toContain("DISPOSITION_REQUIRED");
      expect(held?.fields).toEqual({});
    }
    // No item ever proposes a delete.
    expect(manifest.items.some((i) => i.operation === "CREATE" && !i.target_stable_id)).toBe(false);
  });

  it("records FS-035 by post only and never infers a grid cell", () => {
    const pole = item("fs-035-pole");
    expect(pole?.pole?.pole_location_kind).toBe("BETWEEN_POSTS");
    expect(pole?.field_grid_reference ?? null).toBeNull();
    expect(item("fs-035-grid-unverified")?.observation_class).toBe("HOLD_UNRESOLVED");
  });

  it("keeps FS-048 a load on CG-FS-005 and holds its outgoing branch", () => {
    const cg = item("fs-048-circuit-group");
    expect(cg?.entity_kind).toBe("load");
    expect(cg?.refs.circuit_group_ref).toBe(FS_048_CIRCUIT_GROUP_ID);
    const held = item("fs-048-outgoing-branch");
    expect(held?.observation_class).toBe("HOLD_UNRESOLVED");
    expect(held?.target_stable_id ?? null).toBeNull();
  });

  it("applies the FS-054 correction but holds the conflicting relationship", () => {
    const loc = item("fs-054-location");
    expect(loc?.field_grid_reference).toBe("A5/A6");
    expect(loc?.pole?.pole_ref_start).toBe("23N");
    expect(loc?.notes).toContain("A3");
    const conflict = item("fs-054-br-104-02-conflict");
    expect(conflict?.observation_class).toBe("HOLD_UNRESOLVED");
  });

  it("does not record a mounting height for JB-105-01", () => {
    const jb = item("jb-105-01");
    expect(jb?.pole?.pole_ref_start).toBe("03NE");
    expect(JSON.stringify(jb?.fields)).not.toContain("height");
  });
});

describe("observed conduit creation", () => {
  const target = { id: "u1", conduit_id: "CON-201", updated_at: "2026-09-01T00:00:00Z" };

  it("proposes a CREATE for a directly observed raceway with no FarmOps record", () => {
    const con = item("con-201-flex")!;
    expect(con.entity_kind).toBe("raceway");
    expect(con.observation_class).toBe("FIELD_AS_BUILT");
    const classified = classifyItem(con, { target: null });
    expect(classified.operation).toBe("CREATE");
    expect(classified.disposition).toBe("ready");
    expect(classified.patch["conduit_id"]).toBe("CON-201");
    expect(classified.patch["dest_endpoint_ref"]).toBe("FS-083");
    expect(classified.patch["source_endpoint_ref"]).toBeUndefined();
  });

  it("holds only the unknown upstream endpoint, never the creation", () => {
    const held = item("con-202-upstream-endpoint")!;
    expect(held.observation_class).toBe("HOLD_UNRESOLVED");
    expect(held.target_stable_id).toBe("CON-202");
    expect(classifyItem(item("con-202-flex")!, { target: null }).disposition).toBe("ready");
  });

  it("updates instead of creating when the identity already exists", () => {
    const classified = classifyItem(item("con-201-flex")!, { target });
    expect(classified.operation).not.toBe("CREATE");
  });

  it("refuses a raceway create whose stable ID is not canonical", () => {
    const bad = { ...item("con-201-flex")!, target_stable_id: "EMT-201" };
    expect(classifyItem(bad, { target: null }).disposition).toBe("hold");
  });
});
