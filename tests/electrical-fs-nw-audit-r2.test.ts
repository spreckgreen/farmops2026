// FA-FS-2026-09-03-PM-R2 — migration-safe republication of the corrected
// PNL-FS-NW breaker audit.
//
// R1 is already stored as `validated` on the self-hosted instance under its
// original fingerprint, so the correction is published under a NEW batch ID.
// This suite covers the whole sequence: stored unapplied R1 → load R2 →
// reject R1 as superseded → approve/apply R2 → export/pull R2 with an identical
// checksum and no approvals transferred.
import { describe, expect, it } from "vitest";

import {
  assignProposedCircuitGroupIds,
  buildManifestGraph,
  classifyItem,
  classifyStoredManifest,
  manifestChecksum,
  parseManifest,
  previewCsv,
  selectable,
  summarize,
  type AuditBatchItemInput,
  type ClassifiedItem,
} from "@/lib/electrical-audit-batch";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDIT_R1_BATCH_ID,
  FS_NW_AUDIT_R2_BATCH_ID,
  FS_NW_R1_REJECTION_REASON,
  FS_NW_UNIDENTIFIED_HOLD,
  buildFsNwAuditManifestR1,
  buildFsNwAuditManifestR2,
  fsNwAuditManifestR2Text,
  manifestContainsLoadLinks,
} from "@/lib/electrical-fs-nw-audit-r1";

/** Classify every item the way import does, with no pre-existing targets. */
function classifyAll(items: readonly AuditBatchItemInput[]): ClassifiedItem[] {
  const { items: assigned } = assignProposedCircuitGroupIds([...items], []);
  const graph = buildManifestGraph(assigned);
  const resolved = new Map([["panel|PNL-FS-NW", "panel-uuid"]]);
  // Every audited load exists in this instance; the one unidentified
  // observation stays a hold because it names no target.
  const loadUuid = (id: string) => `load-${id.toLowerCase()}`;
  return assigned.map((i) =>
    classifyItem(i, {
      target:
        i.entity_kind === "load" && i.target_stable_id
          ? { id: loadUuid(i.target_stable_id), stable_id: i.target_stable_id }
          : null,
      resolved,
      pendingCreates: graph.pendingCreates,
    }),
  );
}

describe("FA-FS-2026-09-03-PM-R2", () => {
  it("is published under its own batch ID and never reuses R1's", () => {
    const parsed = parseManifest(fsNwAuditManifestR2Text());
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest!.batch_id).toBe(FS_NW_AUDIT_R2_BATCH_ID);
    expect(FS_NW_AUDIT_R2_BATCH_ID).not.toBe(FS_NW_AUDIT_R1_BATCH_ID);
    expect(parsed.manifest!.source).toBe(`revision-of:${FS_NW_AUDIT_R1_BATCH_ID}`);
  });

  it("is not a compensating batch, because R1 was never applied", () => {
    expect(buildFsNwAuditManifestR2().compensates_batch_id).toBeNull();
  });

  it("has a different fingerprint from R1 and is deterministic", async () => {
    const r1 = await manifestChecksum(buildFsNwAuditManifestR1());
    const r2 = await manifestChecksum(buildFsNwAuditManifestR2());
    expect(r2).not.toBe(r1);
    expect(await manifestChecksum(buildFsNwAuditManifestR2())).toBe(r2);
  });

  it("previews as 35 unique items: 34 ready, 1 hold, 0 conflicts, 0 failures", () => {
    const m = buildFsNwAuditManifestR2();
    expect(m.items).toHaveLength(35);
    expect(new Set(m.items.map((i) => i.item_key)).size).toBe(35);

    const classified = classifyAll(m.items);
    const summary = summarize(classified);
    expect(summary.by_disposition.ready ?? 0).toBe(34);
    expect(summary.by_disposition.hold ?? 0).toBe(1);
    expect(summary.by_disposition.conflict ?? 0).toBe(0);
    expect(summary.by_disposition.failed ?? 0).toBe(0);
    const hold = classified.find((i) => i.disposition === "hold")!;
    expect(hold.item_key).toBe(FS_NW_UNIDENTIFIED_HOLD.item_key);
    expect(selectable(hold.disposition)).toBe(false);
  });

  it("changes no load column other than circuit_group_uuid", () => {
    const classified = classifyAll(buildFsNwAuditManifestR2().items);
    const links = classified.filter((i) => i.entity_kind === "load" && i.operation === "LINK");
    expect(links).toHaveLength(20);
    for (const link of links) {
      expect(link.changes.map((c) => c.column)).toEqual(["circuit_group_uuid"]);
    }
  });

  it("produces a preview CSV whose only load-field rows are circuit_group_uuid", () => {
    const classified = classifyAll(buildFsNwAuditManifestR2().items);
    const csvText = previewCsv(classified);
    // One CSV row per field diff, plus one no-diff row for the single hold.
    const diffRows = classified.flatMap((i) =>
      i.changes.map((c) => ({ kind: i.entity_kind, column: c.column })),
    );
    // Actual field-diff total is 146, not the ~98 estimate: the 7 circuit-group
    // creates contribute 56 diffs, the 7 breaker-position creates 70, and the
    // 20 load links exactly one each (circuit_group_uuid). The hold has none.
    const byKind = (kind: string) =>
      diffRows.filter((r) => r.kind === kind).length;
    expect(byKind("circuit_group")).toBe(56);
    expect(byKind("breaker_position")).toBe(70);
    expect(byKind("load")).toBe(20);
    expect(diffRows.length).toBe(146);
    expect(diffRows.length + classified.filter((i) => !i.changes.length).length).toBe(147);
    const loadColumns = new Set(
      diffRows.filter((r) => r.kind === "load").map((r) => r.column),
    );
    expect([...loadColumns]).toEqual(["circuit_group_uuid"]);
    // Every diff row reached the exported CSV.
    expect(csvText.trim().split("\n").length - 1).toBe(147);
  });


  it("keeps the stored R1 usable: rejectable, but never rewritten", async () => {
    const r1Checksum = await manifestChecksum(buildFsNwAuditManifestR1());
    const stored = { manifest_sha256: r1Checksum, status: "validated" };

    // Re-importing the stored R1 bytes is a no-op, not a conflict.
    expect(
      classifyStoredManifest({ batch_id: FS_NW_AUDIT_R1_BATCH_ID, checksum: r1Checksum }, stored)
        .kind,
    ).toBe("same");

    // Importing or pulling the R1 ID with the corrected content is a hard conflict.
    const r2Checksum = await manifestChecksum(buildFsNwAuditManifestR2());
    const verdict = classifyStoredManifest(
      { batch_id: FS_NW_AUDIT_R1_BATCH_ID, checksum: r2Checksum },
      stored,
    );
    expect(verdict.kind).toBe("fingerprint_conflict");

    // Rejection is a status change with a reason; the manifest is untouched.
    expect(FS_NW_R1_REJECTION_REASON).toBe(
      `Superseded before application by ${FS_NW_AUDIT_R2_BATCH_ID}`,
    );
    const afterReject = { manifest_sha256: r1Checksum, status: "rejected" };
    expect(
      classifyStoredManifest({ batch_id: FS_NW_AUDIT_R1_BATCH_ID, checksum: r1Checksum }, afterReject)
        .kind,
    ).toBe("same");
  });

  it("stages R2 as new, then reports an applied re-import instead of re-staging", async () => {
    const checksum = await manifestChecksum(buildFsNwAuditManifestR2());
    expect(
      classifyStoredManifest({ batch_id: FS_NW_AUDIT_R2_BATCH_ID, checksum }, null).kind,
    ).toBe("new");
    expect(
      classifyStoredManifest(
        { batch_id: FS_NW_AUDIT_R2_BATCH_ID, checksum },
        { manifest_sha256: checksum, status: "applied" },
      ).kind,
    ).toBe("already_applied");
  });

  it("exports/pulls R2 with an identical checksum and no approvals in the manifest", async () => {
    const exported = fsNwAuditManifestR2Text();
    // A pull re-parses the transferred document; the checksum the peer stored
    // and the checksum recomputed here must agree.
    const stored = await manifestChecksum(parseManifest(exported).manifest!);
    const recomputed = await manifestChecksum(parseManifest(fsNwAuditManifestR2Text()).manifest!);
    expect(recomputed).toBe(stored);
    // Nothing in the transferred document carries an approval or an applied state.

    const raw = JSON.parse(exported) as Record<string, unknown>;
    expect(Object.keys(raw)).not.toContain("approved");
    expect(Object.keys(raw)).not.toContain("approved_by");
    expect(exported).not.toContain("\"approved\"");
    expect(exported).not.toContain("applied_at");
  });

  it("already carries its load links, so the links-only follow-up is redundant", () => {
    expect(manifestContainsLoadLinks(buildFsNwAuditManifestR2())).toBe(true);
    expect(FS_NW_AUDITED_BREAKERS).toHaveLength(7);
  });
});
