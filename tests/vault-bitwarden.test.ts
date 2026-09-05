import { describe, expect, it } from "vitest";
import {
  bitwardenItemName,
  clampBatch,
  decideMirrorAction,
  farmOpsTitleFromItemName,
  fingerprintPayload,
  MIRROR_BATCH_LIMIT,
  mirrorStatusLabel,
} from "@/lib/vault-bitwarden";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

describe("fingerprint payload", () => {
  it("separates value from notes so a shifted boundary changes the hash input", () => {
    expect(fingerprintPayload("ab", "c")).not.toBe(fingerprintPayload("a", "bc"));
  });

  it("treats missing notes as empty", () => {
    expect(fingerprintPayload("v", null)).toBe(fingerprintPayload("v", ""));
  });
});

describe("decideMirrorAction", () => {
  const base = { localExists: true, remoteExists: true, everSynced: true };

  it("reports in sync when both sides match", () => {
    expect(
      decideMirrorAction({ ...base, localFingerprint: A, remoteFingerprint: A, lastPushedFingerprint: A }).status,
    ).toBe("in_sync");
  });

  it("pushes when only FarmOps changed", () => {
    expect(
      decideMirrorAction({ ...base, localFingerprint: B, remoteFingerprint: A, lastPushedFingerprint: A }).status,
    ).toBe("push_pending");
  });

  it("pulls when only Bitwarden changed", () => {
    expect(
      decideMirrorAction({ ...base, localFingerprint: A, remoteFingerprint: B, lastPushedFingerprint: A }).status,
    ).toBe("pull_pending");
  });

  it("conflicts when both changed since the baseline", () => {
    expect(
      decideMirrorAction({ ...base, localFingerprint: B, remoteFingerprint: C, lastPushedFingerprint: A }).status,
    ).toBe("conflict");
  });

  it("never mirrors an entry FarmOps cannot decrypt", () => {
    expect(
      decideMirrorAction({ ...base, localFingerprint: null, remoteFingerprint: A, lastPushedFingerprint: A }).status,
    ).toBe("unreadable");
    expect(
      decideMirrorAction({
        localFingerprint: null,
        remoteFingerprint: null,
        localExists: true,
        remoteExists: false,
        everSynced: false,
      }).status,
    ).toBe("unreadable");
  });

  it("never auto-propagates a removal on either side", () => {
    expect(
      decideMirrorAction({
        localFingerprint: A,
        remoteFingerprint: null,
        lastPushedFingerprint: A,
        localExists: true,
        remoteExists: false,
        everSynced: true,
      }).status,
    ).toBe("deleted_remote");

    expect(
      decideMirrorAction({
        localFingerprint: null,
        remoteFingerprint: A,
        lastPulledFingerprint: A,
        localExists: false,
        remoteExists: true,
        everSynced: true,
      }).status,
    ).toBe("deleted_local");
  });

  it("treats never-paired entries as new in the direction they exist", () => {
    expect(
      decideMirrorAction({
        localFingerprint: A,
        remoteFingerprint: null,
        localExists: true,
        remoteExists: false,
        everSynced: false,
      }).status,
    ).toBe("push_pending");

    expect(
      decideMirrorAction({
        localFingerprint: null,
        remoteFingerprint: A,
        localExists: false,
        remoteExists: true,
        everSynced: false,
      }).status,
    ).toBe("pull_pending");
  });

  it("conflicts rather than guessing when there is no baseline and the sides differ", () => {
    expect(
      decideMirrorAction({ ...base, localFingerprint: A, remoteFingerprint: B, everSynced: false }).status,
    ).toBe("conflict");
  });
});

describe("naming and bounds", () => {
  it("round-trips a title through the Bitwarden item name", () => {
    expect(farmOpsTitleFromItemName(bitwardenItemName("Rachio key", "RACHIO_API_KEY"))).toBe("Rachio key");
    expect(farmOpsTitleFromItemName(bitwardenItemName("Rachio key"))).toBe("Rachio key");
  });

  it("caps batches", () => {
    expect(clampBatch(500)).toBe(MIRROR_BATCH_LIMIT);
    expect(clampBatch(3)).toBe(3);
    expect(clampBatch("x")).toBe(MIRROR_BATCH_LIMIT);
  });

  it("labels every status in plain language", () => {
    expect(mirrorStatusLabel("conflict")).toBe("Needs your decision");
    expect(mirrorStatusLabel("unreadable")).toContain("Cannot read");
  });
});
