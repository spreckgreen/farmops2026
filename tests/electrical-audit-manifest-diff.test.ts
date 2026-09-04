import { describe, expect, it } from "vitest";

import {
  diffManifests,
  revisionRoot,
  sameRevisionFamily,
} from "@/lib/electrical-audit-manifest-diff";
import type { AuditBatchManifest } from "@/lib/electrical-audit-batch";

const base = {
  schema_version: "farmops.electrical.audit-batch.v1",
  batch_id: "FA-FS-2026-09-03-PM",
  title: "Farm Shop PM audit",
  scope: "PNL-FS-NW",
  building: "Farm Shop",
  observed_date: "2026-09-03",
  observed_time_precision: "PM",
  timezone: "America/New_York",
  source: "field",
  compensates_batch_id: null,
  evidence: [{ name: "photo-1" }],
  items: [
    {
      item_key: "bp:B37",
      entity_kind: "circuit_group",
      target_stable_id: null,
      observation_class: "FIELD_AS_BUILT",
      operation: "CREATE",
      fields: { amps: 20, poles: 1 },
      notes: "observed",
    },
    {
      item_key: "link:FS-044",
      entity_kind: "load",
      target_stable_id: "FS-044",
      observation_class: "FIELD_AS_BUILT",
      operation: "LINK",
      fields: {},
      refs: { circuit_group: "pending:bp:B37" },
    },
  ],
} as unknown as AuditBatchManifest;

const revision = {
  ...base,
  batch_id: "FA-FS-2026-09-03-PM-R1",
  title: "Farm Shop PM audit (R1)",
  items: [
    {
      ...(base.items[0] as Record<string, unknown>),
      fields: { amps: 20, poles: 1 },
    },
    {
      ...(base.items[1] as Record<string, unknown>),
      refs: { circuit_group: "pending:bp:B37" },
      notes: "direct evidence",
    },
    {
      item_key: "hold:B29-second",
      entity_kind: "load",
      target_stable_id: null,
      observation_class: "FIELD_AS_BUILT",
      operation: "HOLD_UNRESOLVED",
      fields: {},
    },
  ],
} as unknown as AuditBatchManifest;

describe("manifest revision diff", () => {
  it("classifies added, changed and unchanged items", () => {
    const d = diffManifests(base, revision);
    expect(d.counts).toMatchObject({ added: 1, removed: 0, changed: 1, unchanged: 1 });
    expect(d.items.find((i) => i.item_key === "hold:B29-second")?.status).toBe("added");
    expect(d.items.find((i) => i.item_key === "bp:B37")?.status).toBe("unchanged");
    const changed = d.items.find((i) => i.item_key === "link:FS-044");
    expect(changed?.changes).toEqual([{ path: "notes", before: null, after: "direct evidence" }]);
    expect(d.identical).toBe(false);
  });

  it("reports header changes as text values", () => {
    const d = diffManifests(base, revision);
    expect(d.header_changes).toEqual([
      { path: "title", before: "Farm Shop PM audit", after: "Farm Shop PM audit (R1)" },
    ]);
  });

  it("reports removals", () => {
    const trimmed = { ...revision, items: [revision.items[0]] } as unknown as AuditBatchManifest;
    const d = diffManifests(revision, trimmed);
    expect(d.counts.removed).toBe(2);
  });

  it("treats identical manifests as identical", () => {
    const d = diffManifests(base, { ...base } as AuditBatchManifest);
    expect(d.identical).toBe(true);
  });

  it("groups revisions by root batch id", () => {
    expect(revisionRoot("FA-FS-2026-09-03-PM-R1-LINKS")).toBe("FA-FS-2026-09-03-PM");
    expect(revisionRoot("FA-FS-2026-09-03-PM-REVERT")).toBe("FA-FS-2026-09-03-PM");
    expect(sameRevisionFamily("FA-FS-2026-09-03-PM", "FA-FS-2026-09-03-PM-R1")).toBe(true);
    expect(sameRevisionFamily("FA-FS-2026-09-03-PM", "FA-FS-2026-09-03-PM")).toBe(false);
    expect(sameRevisionFamily("FA-FS-2026-09-03-PM", "FA-BR-2026-01-01-AM")).toBe(false);
  });
});
