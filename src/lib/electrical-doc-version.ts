// Embedded version stamp for every generated electrical document or export.
//
// Why: a printed sheet on the shop wall outlives the data it was printed from.
// Every file therefore carries the same block — document type + format version,
// API/schema version, snapshot timestamp, record counts and a content digest —
// so anyone holding a print can ask "is this still the truth?" and get a yes/no
// instead of a guess.
//
// The digest is computed from the *rendered record set*, not the PDF bytes, so
// reprinting unchanged data produces the same code (a PDF embeds its own
// creation date, so byte hashes would differ on every reprint).

/** Bumped when the printed layout/content of a document type changes. */
export const DOC_FORMAT_VERSIONS = {
  "farm-shop-sheet": "1.0",
  "avery-labels": "1.0",
  "grid-map": "1.0",
} as const;

export type DocType = keyof typeof DOC_FORMAT_VERSIONS;

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  "farm-shop-sheet": "Farm Shop electrical sheet",
  "avery-labels": "Avery label sheet",
  "grid-map": "Farm Shop grid map",
};

/** Short prefix used in the human-readable version code. */
const DOC_CODE_PREFIX: Record<DocType, string> = {
  "farm-shop-sheet": "FS-SHEET",
  "avery-labels": "FS-LABEL",
  "grid-map": "FS-MAP",
};

export interface VersionStampInput {
  docType: DocType;
  /** API version the data came from, e.g. "v1". */
  apiVersion: string;
  /** Snapshot schema version reported by the API, e.g. "1.2". */
  schemaVersion: string;
  /** Snapshot generated_at, ISO 8601 UTC. */
  generatedAt: string;
  /** Record counts actually rendered, by section/collection. */
  counts: Record<string, number>;
  qaErrors: number;
  qaWarnings: number;
  /** Who asked for the document (email or user id). */
  generatedBy: string;
  /** When the file was produced, ISO 8601. */
  printedAt: string;
  /** Canonical workbook SHA, when the document depends on canonical values. */
  canonicalSha?: string | null;
  /** Canonical binding version, e.g. "load_master.contract.v3". */
  canonicalBinding?: string | null;
  /** Free-form scope description, e.g. "Farm Shop / PNL-FS-NW". */
  scope?: string;
}

export interface VersionStamp extends VersionStampInput {
  docLabel: string;
  formatVersion: string;
  /** Truncated digest of the rendered records, uppercase hex. */
  digest: string;
  /** Human-readable code printed on the document, e.g. FS-SHEET-1.0-9F3A21C7. */
  versionCode: string;
  /** One-line footer, repeated on every page. */
  footer: string;
  /** Multi-line block for the cover / drawing margin. */
  lines: string[];
}

/**
 * Deterministic serialization: object keys are sorted at every depth so two
 * runs over the same records hash identically regardless of key order coming
 * out of the database or JSON.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * SHA-256 over the stable serialization, truncated to 8 hex characters — short
 * enough to read off a printed label out loud, long enough that an accidental
 * collision between two revisions of the same document is not a practical
 * concern (the full digest is also available via `fullDigest`).
 */
export async function fullDigest(payload: unknown): Promise<string> {
  const text = stableStringify(payload);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await cryptoObj.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  // No Web Crypto (very old runtime): fall back to a deterministic 64-bit
  // FNV-1a so versioning still works rather than silently printing nothing.
  return fnv1a64(text).toUpperCase();
}

export async function contentDigest(payload: unknown): Promise<string> {
  return (await fullDigest(payload)).slice(0, 8);
}

function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Local time rendered next to UTC, so a field print is readable on site. */
export function formatStampTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().replace(".000", "").replace(/\.\d{3}Z$/, "Z")} (local ${d.toLocaleString()})`;
}

/**
 * Build the printed stamp. `records` is whatever the document actually renders;
 * it is hashed, never stored.
 */
export async function buildVersionStamp(
  input: VersionStampInput,
  records: unknown,
): Promise<VersionStamp> {
  const formatVersion = DOC_FORMAT_VERSIONS[input.docType];
  const digest = await contentDigest({
    docType: input.docType,
    formatVersion,
    schemaVersion: input.schemaVersion,
    generatedAt: input.generatedAt,
    records,
  });
  const versionCode = `${DOC_CODE_PREFIX[input.docType]}-${formatVersion}-${digest}`;
  const totalRecords = Object.values(input.counts).reduce((n, v) => n + v, 0);

  const footer =
    `${input.docType} v${formatVersion} · API ${input.apiVersion} · schema ${input.schemaVersion}` +
    ` · data ${input.generatedAt} · ${versionCode}`;

  const lines: string[] = [
    `Document: ${DOC_TYPE_LABEL[input.docType]} (${input.docType} v${formatVersion})`,
    `Version code: ${versionCode}`,
    `Data source: FarmOps Electrical API ${input.apiVersion}, snapshot schema ${input.schemaVersion}`,
    `Snapshot generated: ${formatStampTime(input.generatedAt)}`,
    `Printed: ${formatStampTime(input.printedAt)} by ${input.generatedBy}`,
    `Scope: ${input.scope || "All records"}`,
    `Records rendered: ${totalRecords} (${Object.entries(input.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")})`,
    `QA: ${input.qaErrors} errors, ${input.qaWarnings} warnings — reported, never enforced`,
  ];
  if (input.canonicalSha) {
    lines.push(`Canonical workbook SHA: ${input.canonicalSha}`);
  }
  if (input.canonicalBinding) {
    lines.push(`Canonical binding: ${input.canonicalBinding}`);
  }
  lines.push(
    "Records only: any value absent from the record prints NOT IN RECORD. Nothing is inferred.",
  );

  return { ...input, docLabel: DOC_TYPE_LABEL[input.docType], formatVersion, digest, versionCode, footer, lines };
}

/** PDF document metadata, so the version survives a cropped footer. */
export function stampPdfMetadata(stamp: VersionStamp): {
  title: string;
  subject: string;
  keywords: string;
  creator: string;
} {
  return {
    title: `${stamp.docLabel} — ${stamp.versionCode}`,
    subject: `FarmOps Electrical API ${stamp.apiVersion}, snapshot schema ${stamp.schemaVersion}, data ${stamp.generatedAt}`,
    keywords: [
      stamp.docType,
      `format:${stamp.formatVersion}`,
      `schema:${stamp.schemaVersion}`,
      `generated_at:${stamp.generatedAt}`,
      `digest:${stamp.digest}`,
      stamp.canonicalSha ? `canonical_sha:${stamp.canonicalSha}` : "",
    ]
      .filter(Boolean)
      .join(", "),
    creator: "FarmOps",
  };
}

/** Filename that carries the version, so downloads stay distinguishable. */
export function stampFileName(stamp: VersionStamp, ext: string): string {
  const day = stamp.printedAt.slice(0, 10);
  return `${stamp.docType}-${day}-${stamp.versionCode}.${ext}`;
}

/** Leading metadata rows for a CSV/JSON export of the same data. */
export function stampCsvHeader(stamp: VersionStamp): string {
  return stamp.lines.map((l) => `# ${l}`).join("\n");
}

export type VerifyResult =
  | { status: "current"; message: string }
  | { status: "superseded"; message: string }
  | { status: "unknown"; message: string };

/**
 * Compare a code read off a printed document against the code the same document
 * would carry right now.
 */
export function verifyVersionCode(pasted: string, currentCode: string): VerifyResult {
  const given = pasted.trim().toUpperCase();
  const current = currentCode.trim().toUpperCase();
  if (!given) return { status: "unknown", message: "Enter the version code printed on the document." };
  if (given === current) {
    return {
      status: "current",
      message: "This print matches the current records exactly — it is safe to work from.",
    };
  }
  const prefix = (code: string) => code.split("-").slice(0, 3).join("-");
  if (prefix(given) === prefix(current)) {
    return {
      status: "superseded",
      message: `Same document type and format, but the data has changed since it was printed. Current code is ${currentCode}. Reprint before relying on it.`,
    };
  }
  return {
    status: "unknown",
    message: `That code does not match any document generated for the current scope (current: ${currentCode}). Check the document type and scope, then reprint.`,
  };
}
