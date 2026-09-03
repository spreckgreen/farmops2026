// Versioned document bundle file.
//
// The document screen used to read only the live API snapshot, so a reprint
// always reflected "now". Field work needs the opposite too: reprint the exact
// bundle a wall sheet came from. A versioned bundle file is that artefact — the
// unmodified API bundle wrapped in an envelope that carries the API version,
// snapshot schema version, snapshot timestamp, who captured it and a content
// digest. Documents generated from the file stamp the file's snapshot values,
// never the current clock, so a reprint reproduces the original version code.
//
// Nothing here writes records or alters the bundle: the envelope is additive
// metadata around a byte-faithful copy.
import { contentDigest, fullDigest } from "@/lib/electrical-doc-version";
import type { DocumentBundle } from "@/lib/electrical-documents";

export const BUNDLE_ENVELOPE_FORMAT = "farmops.electrical.bundle.v1";

export interface VersionedBundleFile {
  envelope_format: string;
  /** Human-readable code for the captured bundle, e.g. FS-BUNDLE-1.2-3A9C10FF. */
  bundle_version_code: string;
  api_version: string;
  schema_version: string;
  /** Snapshot generated_at from the API — the version of the truth. */
  generated_at: string;
  /** When this file was captured (not the snapshot time). */
  captured_at: string;
  captured_by: string;
  /** Full SHA-256 over the bundle, deterministic key order. */
  digest: string;
  bundle: DocumentBundle;
}

export function bundleVersionCode(schemaVersion: string, digest8: string): string {
  return `FS-BUNDLE-${schemaVersion}-${digest8}`;
}

export async function buildVersionedBundleFile(
  bundle: DocumentBundle,
  meta: { apiVersion: string; capturedBy: string; capturedAt?: string },
): Promise<VersionedBundleFile> {
  const digest = await fullDigest(bundle);
  return {
    envelope_format: BUNDLE_ENVELOPE_FORMAT,
    bundle_version_code: bundleVersionCode(bundle.schema_version, digest.slice(0, 8)),
    api_version: meta.apiVersion,
    schema_version: bundle.schema_version,
    generated_at: bundle.generated_at,
    captured_at: meta.capturedAt ?? new Date().toISOString(),
    captured_by: meta.capturedBy,
    digest,
    bundle,
  };
}

export function versionedBundleFileName(file: VersionedBundleFile): string {
  return `farmops-electrical-bundle-${file.generated_at.slice(0, 10)}-${file.bundle_version_code}.json`;
}

/**
 * Parse a captured bundle. Rejects anything that is not this envelope rather
 * than guessing, so a document is never stamped with a version it cannot prove.
 */
export function parseVersionedBundleFile(text: string): VersionedBundleFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const o = raw as Partial<VersionedBundleFile>;
  if (!o || typeof o !== "object") throw new Error("That file is not a bundle envelope.");
  if (o.envelope_format !== BUNDLE_ENVELOPE_FORMAT) {
    throw new Error(
      `Unsupported envelope: expected ${BUNDLE_ENVELOPE_FORMAT}, found ${
        typeof o.envelope_format === "string" ? o.envelope_format : "no envelope_format"
      }.`,
    );
  }
  const bundle = o.bundle as DocumentBundle | undefined;
  if (!bundle || typeof bundle !== "object" || !bundle.snapshot) {
    throw new Error("The envelope carries no snapshot bundle.");
  }
  if (typeof bundle.schema_version !== "string" || typeof bundle.generated_at !== "string") {
    throw new Error("The captured bundle is missing its schema version or snapshot timestamp.");
  }
  return {
    envelope_format: BUNDLE_ENVELOPE_FORMAT,
    bundle_version_code:
      typeof o.bundle_version_code === "string"
        ? o.bundle_version_code
        : bundleVersionCode(bundle.schema_version, "UNKNOWN"),
    api_version: typeof o.api_version === "string" ? o.api_version : "unknown",
    schema_version: bundle.schema_version,
    generated_at: bundle.generated_at,
    captured_at: typeof o.captured_at === "string" ? o.captured_at : "",
    captured_by: typeof o.captured_by === "string" ? o.captured_by : "",
    digest: typeof o.digest === "string" ? o.digest : "",
    bundle,
  };
}

export type BundleIntegrity = "verified" | "digest-mismatch" | "no-digest";

/** Recompute the digest so a tampered or truncated capture is visible. */
export async function verifyVersionedBundleFile(
  file: VersionedBundleFile,
): Promise<{ status: BundleIntegrity; digest: string }> {
  const digest = await fullDigest(file.bundle);
  if (!file.digest) return { status: "no-digest", digest };
  return { status: digest === file.digest ? "verified" : "digest-mismatch", digest };
}

/** Short digest for display when the envelope carries no code. */
export async function shortBundleDigest(bundle: DocumentBundle): Promise<string> {
  return contentDigest(bundle);
}
