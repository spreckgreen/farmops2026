import { describe, expect, it } from "vitest";

import {
  R3_OUTLET_AUDITED_LOADS,
  R3_OUTLET_CANDIDATE_LOADS,
  R3_OUTLET_COMPENSATES_BATCH_ID,
  R3_OUTLET_METADATA_BATCH_ID,
  R3_OUTLET_PERMITTED_FIELDS,
  buildOutletMetadataR3,
  type OutletLoadRow,
} from "@/lib/electrical-outlet-metadata-r3";
import { fieldsAllowed } from "@/lib/electrical-audit-batch";
import {
  NOT_RECORDED,
  displayAmps,
  isRecordedNumber,
  loadCurrentForCapacity,
} from "@/lib/electrical-current-display";

const audited = (): OutletLoadRow[] =>
  R3_OUTLET_AUDITED_LOADS.map((id, i) => ({
    load_id: id,
    dedicated: true,
    dedicated_shared: null,
    amps: i < 13 ? 3.75 : 0,
    connected_va: i < 13 ? 450 : 0,
    amps_semantic: null,
    amps_semantic_provenance: null,
    circuit_group_uuid: "11111111-1111-1111-1111-111111111111",
  }));

const build = (rows = audited()) =>
  buildOutletMetadataR3({
    audited: rows,
    candidates: R3_OUTLET_CANDIDATE_LOADS.map((id) => ({ load_id: id, amps: 15 })),
  });

describe("FA-FS-2026-09-03-PM-R3-OUTLET-METADATA", () => {
  it("is an immutable metadata-only batch that compensates R2 without replacing it", () => {
    const { manifest } = build();
    expect(manifest.batch_id).toBe(R3_OUTLET_METADATA_BATCH_ID);
    expect(manifest.compensates_batch_id).toBe(R3_OUTLET_COMPENSATES_BATCH_ID);
    expect(manifest.items).toHaveLength(18);
    for (const item of manifest.items) {
      expect(item.entity_kind).toBe("load");
      expect(item.operation).toBe("UPDATE");
      // Only the permitted metadata fields may appear — no relationship, no
      // description, no location, no voltage, no lifecycle state.
      for (const key of Object.keys(item.fields ?? {})) {
        expect(R3_OUTLET_PERMITTED_FIELDS as readonly string[]).toContain(key);
      }
    }
  });

  it("stages shared class, cleared current and provenance with exact before values", () => {
    const { corrections, manifest } = build();
    expect(corrections).toHaveLength(18);
    const first = corrections[0]!;
    expect(first.before.amps).toBe(3.75);
    expect(first.before.connected_va).toBe(450);
    expect(first.after.dedicated).toBe(false);
    expect(first.after.dedicated_shared).toBe("S");
    expect(first.after.amps).toBeNull();
    expect(first.after.connected_va).toBeNull();
    expect(first.after.amps_semantic).toBeNull();
    expect(String(first.after.amps_semantic_provenance)).toContain("branch-circuit rating");
    expect(manifest.items[0]!.notes).toContain("amps=3.75");
  });

  it("never stages a relationship, breaker or identity change", () => {
    const { manifest } = build();
    const forbidden = [
      "circuit_group_uuid",
      "circuit_group_ref",
      "source_circuit",
      "load_id",
      "description",
      "location",
      "volts",
      "install_status",
    ];
    for (const item of manifest.items) {
      for (const key of forbidden) expect(item.fields).not.toHaveProperty(key);
    }
  });

  it("holds audited loads that have no record and skips already-correct rows", () => {
    const rows = audited().filter((r) => r.load_id !== "FS-036");
    rows[0] = {
      ...rows[0]!,
      dedicated: false,
      dedicated_shared: "S",
      amps: null,
      connected_va: null,
      amps_semantic: null,
      amps_semantic_provenance: build().corrections[0]!.after
        .amps_semantic_provenance as string,
    };
    const out = buildOutletMetadataR3({ audited: rows, candidates: [] });
    expect(out.loadsNotFound).toEqual(["FS-036"]);
    expect(out.alreadyCorrect).toContain(rows[0]!.load_id);
    const held = out.manifest.items.find((i) => i.target_stable_id === "FS-036");
    expect(held?.operation).toBe("HOLD_UNRESOLVED");
    expect(held?.fields).toEqual({});
  });

  it("reports the nine unaudited candidates read-only", () => {
    const out = build();
    expect(out.candidates).toHaveLength(9);
    expect(out.manifest.items.map((i) => i.target_stable_id)).not.toContain("FS-041");
    for (const c of out.candidates) expect(c.note).toMatch(/without its own field evidence|nothing staged/);
  });

  it("permits the legacy current fields only for FIELD_AS_BUILT load observations", () => {
    const asBuilt = fieldsAllowed("load", "FIELD_AS_BUILT");
    for (const f of ["amps", "connected_va", "amps_semantic", "amps_semantic_provenance"]) {
      expect(asBuilt).toContain(f);
      expect(fieldsAllowed("load", "PLANNED")).not.toContain(f);
      expect(fieldsAllowed("load", "ROUGH_IN")).not.toContain(f);
    }
  });
});

describe("recorded current display", () => {
  it("shows a missing value as not recorded and never as zero", () => {
    expect(displayAmps(null)).toBe(NOT_RECORDED);
    expect(displayAmps(undefined)).toBe(NOT_RECORDED);
    expect(displayAmps(0)).toBe("0 A");
    expect(isRecordedNumber(null)).toBe(false);
    expect(isRecordedNumber(0)).toBe(true);
  });

  it("does not let a capacity calculation substitute zero for a missing current", () => {
    expect(loadCurrentForCapacity(null).known).toBe(false);
    expect(loadCurrentForCapacity(3.75)).toEqual({ known: true, amps: 3.75 });
  });
});
