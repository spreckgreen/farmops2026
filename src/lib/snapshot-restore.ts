import type { Snapshot } from "./admin.functions";
import {
  normalizeIntegrityEnvelope,
  verifyIntegrity,
  type IntegrityEnvelope,
} from "./snapshot-integrity";

export type RestoreIntegrityStatus =
  | { kind: "verified"; algo: string; value: string }
  | { kind: "missing" }
  | { kind: "mismatch"; reason: string; expected: string; actual: string };

export type ParseRestoreSnapshotResult =
  | {
      ok: true;
      snapshot: Snapshot;
      integrity: RestoreIntegrityStatus;
      totalRows: number;
    }
  | { ok: false; message: string; integrity?: RestoreIntegrityStatus };

function snapshotPayload(snapshot: Snapshot) {
  return { app: snapshot.app, version: snapshot.version, tables: snapshot.tables };
}

export async function parseRestoreSnapshotJson(
  text: string,
): Promise<ParseRestoreSnapshotResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: `Could not parse file: ${(err as Error).message}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, message: "Could not parse file: snapshot must be a JSON object." };
  }

  const snapshot = parsed as Snapshot;
  if (snapshot.app !== "bostead" || snapshot.version !== 1) {
    return { ok: false, message: "This file is not a Bostead v1 snapshot." };
  }
  if (!Array.isArray(snapshot.tables)) {
    return { ok: false, message: "Snapshot is missing the 'tables' array." };
  }

  const payload = snapshotPayload(snapshot);
  const rawIntegrity = (parsed as { integrity?: unknown }).integrity;
  const normalizedIntegrity = normalizeIntegrityEnvelope(rawIntegrity, payload);
  let integrity: RestoreIntegrityStatus;

  if (normalizedIntegrity) {
    let verdict: Awaited<ReturnType<typeof verifyIntegrity>>;
    try {
      verdict = await verifyIntegrity(payload, normalizedIntegrity as IntegrityEnvelope);
    } catch (err) {
      return {
        ok: false,
        message: `Could not verify snapshot integrity: ${(err as Error).message}.`,
      };
    }

    if (verdict.ok) {
      integrity = {
        kind: "verified",
        algo: normalizedIntegrity.algo,
        value: normalizedIntegrity.value,
      };
    } else {
      integrity = {
        kind: "mismatch",
        reason: verdict.reason,
        expected: verdict.expected,
        actual: verdict.actual,
      };
      return {
        ok: false,
        message: "Snapshot integrity check failed — see details below.",
        integrity,
      };
    }
  } else {
    integrity = { kind: "missing" };
  }

  const totalRows = snapshot.tables.reduce((n, t) => n + (t.rows?.length ?? 0), 0);
  return { ok: true, snapshot, integrity, totalRows };
}