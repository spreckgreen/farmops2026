/**
 * Phase 4.4 — one canonical-workbook session, shared by every electrical route.
 *
 * Parallel validation publishes the exact workbook it validated here; Load
 * adjudication (and its apply gates) consume that same object. Nothing is
 * written to the database and the workbook bytes are never persisted to disk.
 *
 * Deliberate durability rules:
 * - The bytes live in module memory only, so they survive client-side route
 *   navigation but NOT a hard refresh or a new tab.
 * - Only non-secret metadata (file name, SHA-256, parsed_at, authorization) is
 *   mirrored into sessionStorage. After a refresh the consumer therefore knows
 *   *which* workbook was validated and can say so, while still refusing to
 *   adjudicate until the bytes are reattached. Cached/hard-coded canonical
 *   values are never substituted.
 */
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";

export interface CanonicalWorkbookMeta {
  file_name: string;
  sha256: string;
  parsed_at: string;
  /** True only when sha256 is the confirmed Phase 4.4a baseline SHA. */
  baseline_authorized: boolean;
  /** Where this workbook was established. */
  established_by: "parallel_validation" | "load_adjudication";
}

export interface CanonicalWorkbookSession extends CanonicalWorkbookMeta {
  /** Raw workbook bytes, base64. Present only while this tab keeps them. */
  base64: string | null;
}

const STORAGE_KEY = "farmops:electrical:canonical-workbook-meta";

let bytes: string | null = null;
let meta: CanonicalWorkbookMeta | null = null;
let hydrated = false;
const listeners = new Set<() => void>();
/** Stable snapshot identity for useSyncExternalStore. */
let snapshot: CanonicalWorkbookSession | null = null;

function readStoredMeta(): CanonicalWorkbookMeta | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CanonicalWorkbookMeta;
    if (!parsed?.file_name || !parsed?.sha256) return null;
    return {
      ...parsed,
      baseline_authorized: parsed.sha256.toLowerCase() === PHASE_44A_BASELINE_SHA256,
    };
  } catch {
    return null;
  }
}

function writeStoredMeta(next: CanonicalWorkbookMeta | null) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Metadata mirroring is best-effort; the in-memory session is authoritative.
  }
}

function rebuildSnapshot() {
  snapshot = meta ? { ...meta, base64: bytes } : null;
}

function emit() {
  rebuildSnapshot();
  for (const l of [...listeners]) l();
}

function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  meta = readStoredMeta();
  rebuildSnapshot();
}

/** Publish the workbook that was just parsed/validated. */
export function setCanonicalWorkbookSession(input: {
  file_name: string;
  base64: string;
  sha256: string;
  parsed_at?: string;
  established_by: CanonicalWorkbookMeta["established_by"];
}) {
  ensureHydrated();
  const sha = input.sha256.toLowerCase();
  bytes = input.base64;
  meta = {
    file_name: input.file_name,
    sha256: sha,
    parsed_at: input.parsed_at ?? new Date().toISOString(),
    baseline_authorized: sha === PHASE_44A_BASELINE_SHA256,
    established_by: input.established_by,
  };
  writeStoredMeta(meta);
  emit();
}

/** Forget the workbook entirely (bytes and metadata). */
export function clearCanonicalWorkbookSession() {
  ensureHydrated();
  bytes = null;
  meta = null;
  writeStoredMeta(null);
  emit();
}

export function getCanonicalWorkbookSession(): CanonicalWorkbookSession | null {
  ensureHydrated();
  return snapshot;
}

/** True when the exact bytes are available in this tab right now. */
export function hasCanonicalWorkbookBytes(): boolean {
  ensureHydrated();
  return typeof bytes === "string" && bytes.length > 0;
}

export function subscribeCanonicalWorkbookSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * What a consumer route may do with the current session.
 *
 * `reattach_required` is the refresh case: we know which workbook was
 * validated, but the bytes are gone, so the caller must show an explicit
 * reattach control instead of calling the parser with undefined values.
 */
export type CanonicalWorkbookAvailability =
  | { state: "none" }
  | { state: "reattach_required"; meta: CanonicalWorkbookMeta }
  | { state: "available"; meta: CanonicalWorkbookMeta; base64: string };

export function canonicalWorkbookAvailability(
  session: CanonicalWorkbookSession | null,
): CanonicalWorkbookAvailability {
  if (!session) return { state: "none" };
  const { base64, ...meta } = session;
  if (!base64) return { state: "reattach_required", meta };
  return { state: "available", meta, base64 };
}
