// Pure, environment-free logic for the Bitwarden mirror.
//
// Bitwarden's Password Manager has no server API a hosted app can call, so the
// mirror is driven by a bridge running the `bw` CLI on the owner's own network.
// This module holds the parts that must behave identically on both sides:
// the change fingerprint and the per-entry sync decision.
//
// Nothing here touches the database, the network, or process.env — so it is
// fully unit-testable and safe to import from the browser.

export type MirrorScope = "personal" | "shared";

export type MirrorStatus =
  | "in_sync"
  | "conflict"
  | "push_pending"
  | "pull_pending"
  | "unreadable"
  | "orphan"
  | "deleted_remote"
  | "deleted_local";

/** Separator used when hashing value+notes together. The bridge uses the same
 *  literal, so a fingerprint computed by `bw` output matches ours byte for byte. */
export const FINGERPRINT_SEPARATOR = "\n--farmops--\n";

/** Canonical bytes that get hashed for a mirror fingerprint. */
export function fingerprintPayload(value: string, notes?: string | null): string {
  return `${value}${FINGERPRINT_SEPARATOR}${notes ?? ""}`;
}

export interface DecisionInput {
  /** SHA-256 of the FarmOps side, or null when the entry cannot be decrypted. */
  localFingerprint: string | null;
  /** SHA-256 of the Bitwarden side, or null when no Bitwarden item exists. */
  remoteFingerprint: string | null;
  /** Fingerprint FarmOps last pushed into Bitwarden. */
  lastPushedFingerprint?: string | null;
  /** Fingerprint FarmOps last pulled out of Bitwarden. */
  lastPulledFingerprint?: string | null;
  /** True when a FarmOps vault entry still exists for this link. */
  localExists: boolean;
  /** True when a Bitwarden item still exists for this link. */
  remoteExists: boolean;
  /** True when this link has been paired before (has a sync baseline). */
  everSynced: boolean;
}

export interface Decision {
  status: MirrorStatus;
  reason: string;
}

/**
 * Decide what should happen to one entry.
 *
 * Rules, in order of precedence:
 *  - a side that cannot be read is never mirrored,
 *  - a disappearance is never propagated automatically,
 *  - a change on exactly one side is copied,
 *  - a change on both sides since the baseline is a conflict and nothing moves.
 */
export function decideMirrorAction(input: DecisionInput): Decision {
  const {
    localFingerprint,
    remoteFingerprint,
    lastPushedFingerprint,
    lastPulledFingerprint,
    localExists,
    remoteExists,
    everSynced,
  } = input;

  if (localExists && localFingerprint === null && !remoteExists) {
    return { status: "unreadable", reason: "FarmOps cannot decrypt this entry, so it is not mirrored." };
  }
  if (!localExists && !remoteExists) {
    return { status: "orphan", reason: "Neither side has this entry any more." };
  }
  if (!localExists && remoteExists) {
    return everSynced
      ? { status: "deleted_local", reason: "Removed in FarmOps. Confirm before it is removed in Bitwarden." }
      : { status: "pull_pending", reason: "New Bitwarden item — will be added to the FarmOps vault." };
  }
  if (localExists && !remoteExists) {
    if (localFingerprint === null) {
      return { status: "unreadable", reason: "FarmOps cannot decrypt this entry, so it is not mirrored." };
    }
    return everSynced
      ? { status: "deleted_remote", reason: "Removed in Bitwarden. Confirm before it is removed in FarmOps." }
      : { status: "push_pending", reason: "New FarmOps entry — will be added to Bitwarden." };
  }

  if (localFingerprint === null) {
    return { status: "unreadable", reason: "FarmOps cannot decrypt this entry, so it is not mirrored." };
  }
  if (localFingerprint === remoteFingerprint) {
    return { status: "in_sync", reason: "Both sides hold the same value." };
  }

  const baseline = lastPushedFingerprint ?? lastPulledFingerprint ?? null;
  const localChanged = baseline === null ? true : localFingerprint !== baseline;
  const remoteChanged = baseline === null ? true : remoteFingerprint !== baseline;

  if (localChanged && remoteChanged) {
    return {
      status: "conflict",
      reason: "Changed in FarmOps and in Bitwarden since the last run. Pick which one wins.",
    };
  }
  if (localChanged) return { status: "push_pending", reason: "Changed in FarmOps — will be copied to Bitwarden." };
  return { status: "pull_pending", reason: "Changed in Bitwarden — will be copied to FarmOps." };
}

export function mirrorStatusLabel(status: MirrorStatus): string {
  switch (status) {
    case "in_sync":
      return "In sync";
    case "conflict":
      return "Needs your decision";
    case "push_pending":
      return "Waiting to copy to Bitwarden";
    case "pull_pending":
      return "Waiting to copy to FarmOps";
    case "unreadable":
      return "Cannot read — not mirrored";
    case "orphan":
      return "Gone from both sides";
    case "deleted_remote":
      return "Removed in Bitwarden";
    case "deleted_local":
      return "Removed in FarmOps";
  }
}

export function mirrorStatusTone(status: MirrorStatus): "ok" | "warn" | "danger" | "muted" {
  switch (status) {
    case "in_sync":
      return "ok";
    case "push_pending":
    case "pull_pending":
      return "muted";
    case "conflict":
    case "deleted_remote":
    case "deleted_local":
      return "danger";
    case "unreadable":
    case "orphan":
      return "warn";
  }
}

/** Title used for the Bitwarden item that mirrors a vault entry. */
export function bitwardenItemName(title: string, envKey?: string | null): string {
  const trimmed = title.trim() || "Untitled";
  return envKey ? `FarmOps · ${trimmed} (${envKey})` : `FarmOps · ${trimmed}`;
}

/** Recover the FarmOps title from a mirrored Bitwarden item name. */
export function farmOpsTitleFromItemName(name: string): string {
  const withoutPrefix = name.replace(/^FarmOps\s*·\s*/, "").trim();
  return withoutPrefix.replace(/\s*\([A-Z0-9_]+\)$/, "").trim() || withoutPrefix || name.trim();
}

/** Bounded batch size for both directions, so one run can never be unbounded. */
export const MIRROR_BATCH_LIMIT = 25;

export function clampBatch(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return MIRROR_BATCH_LIMIT;
  return Math.min(MIRROR_BATCH_LIMIT, Math.floor(v));
}
