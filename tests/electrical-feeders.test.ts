// Phase 4.2 — Feeders became a normalized entity instead of a text note on a
// panel. Stable IDs released in the canonical workbook are never renamed.
import { describe, expect, it } from "vitest";
import { ENTITIES, importColumns, writableColumns } from "@/lib/electrical-entities";
import { relationsFor } from "@/lib/electrical-relations";
import { checkStableId, nextStableId } from "@/lib/electrical";
import {
  buildElectricalSnapshot,
  COLLECTION_FOR_KIND,
  SNAPSHOT_COLLECTIONS,
  type RawRow,
} from "@/lib/electrical-snapshot";
import { buildSorStatus, cutoverBlockers, latestChange } from "@/lib/electrical-sor";
import type { ElectricalEntityKind } from "@/lib/electrical";

const PANEL_A = "11111111-1111-4111-8111-111111111111";
const PANEL_B = "22222222-2222-4222-8222-222222222222";

function rows(feeders: RawRow[] = []): Record<ElectricalEntityKind, RawRow[]> {
  return {
    panel: [
      { id: PANEL_A, panel_id: "PNL-H1", updated_at: "2026-08-01T00:00:00Z" },
      { id: PANEL_B, panel_id: "PNL-FS-NE", updated_at: "2026-08-02T00:00:00Z" },
    ],
    load: [],
    circuit_group: [],
    feeder: feeders,
    raceway: [],
    jbox: [],
    branch: [],
  };
}

describe("feeder entity", () => {
  it("is its own table with a stable Feeder ID", () => {
    expect(ENTITIES.feeder.table).toBe("electrical_feeders");
    expect(ENTITIES.feeder.stableIdField).toBe("feeder_id");
    expect(writableColumns("feeder")).toContain("ocp_rating_amps");
    // Derived legacy mirrors are never writable from the in-app form.
    expect(writableColumns("feeder")).not.toContain("source_endpoint_ref");
    expect(importColumns("feeder")).toContain("source_endpoint_ref");
  });

  it("links upstream and downstream panels plus the raceway it is pulled through", () => {
    const specs = relationsFor("feeder");
    expect(specs.map((s) => s.fkColumn)).toEqual([
      "source_panel_uuid",
      "dest_panel_uuid",
      "raceway_uuid",
    ]);
    expect(specs.find((s) => s.fkColumn === "raceway_uuid")!.slot).toBeUndefined();
  });

  it("validates FDR-### and keeps workbook-released IDs valid with a warning", () => {
    expect(checkStableId("feeder", "FDR-001").ok).toBe(true);
    const legacy = checkStableId("feeder", "FD-1");
    expect(legacy.ok).toBe(true);
    expect(legacy.warning).toBeTruthy();
    expect(checkStableId("feeder", "FEEDER ONE").ok).toBe(false);
    expect(nextStableId("feeder", ["FDR-001", "FD-2"])).toBe("FDR-003");
  });

  it("exports feeders with uuid + stable id pairs and null unknown topology", () => {
    const snap = buildElectricalSnapshot({
      generatedAt: "2026-08-30T02:00:00.000Z",
      rows: rows([
        {
          id: "33333333-3333-4333-8333-333333333333",
          feeder_id: "FDR-001",
          source_panel_uuid: PANEL_A,
          dest_panel_uuid: null,
          ocp_rating_amps: 200,
          updated_at: "2026-08-29T00:00:00Z",
        },
      ]),
      waypoints: [],
    });
    expect(COLLECTION_FOR_KIND.feeder).toBe("feeders");
    expect(SNAPSHOT_COLLECTIONS).toContain("feeders");
    const feeder = snap.feeders[0]!;
    expect(feeder["stable_id"]).toBe("FDR-001");
    expect(feeder["source_panel_stable_id"]).toBe("PNL-H1");
    expect(feeder["dest_panel_uuid"]).toBeNull();
    expect(feeder["dest_panel_stable_id"]).toBeNull();
    expect(snap.field_ownership.feeders["ocp_rating_amps"]).toBe("engineering_design");
    expect(snap.field_ownership.feeders["measured_length_ft"]).toBe("farmops_as_built");
  });
});

describe("SOR status", () => {
  const input = {
    counts: Object.fromEntries(SNAPSHOT_COLLECTIONS.map((c) => [c, 1])) as Record<
      (typeof SNAPSHOT_COLLECTIONS)[number],
      number
    >,
    lastRecordChange: "2026-08-29T00:00:00Z",
    lastReconciliation: "2026-08-30T02:00:00.000Z",
    qa: { errors: 0, warnings: 3 },
  };

  it("reports the canonical ODS as authoritative until cutover", () => {
    const status = buildSorStatus(input);
    expect(status.authority).toBe("canonical_ods");
    expect(status.farmops_role).toMatch(/Candidate SOR/);
    expect(status.cutover.approved).toBe(false);
    expect(status.snapshot_schema_version).toBe("1.3");
    expect(status.phase).toBe("4.4");
  });

  it("lists cutover blockers and never clears them on warnings alone", () => {
    expect(cutoverBlockers(input).some((b) => /4.5 cutover requires explicit/.test(b))).toBe(true);
    const withErrors = cutoverBlockers({ ...input, qa: { errors: 2, warnings: 0 } });
    expect(withErrors[0]).toMatch(/2 unresolved electrical QA errors/);
  });

  it("derives the newest record change across collections", () => {
    expect(
      latestChange([[{ updated_at: "2026-01-01T00:00:00Z" }], [{ updated_at: "2026-05-05T00:00:00Z" }]]),
    ).toBe("2026-05-05T00:00:00Z");
    expect(latestChange([[], [{}]])).toBeNull();
  });
});
