// Printed-document version history (browser-local).
//
// A label sheet on a panel door has no metadata a person can read at a glance
// beyond the tiny version code in each cell. This history keeps the record of
// what was printed — version code, snapshot the data came from, scope, counts
// and whether the print came from the live snapshot or a captured bundle file —
// so "which FarmOps version is that sheet?" is answerable after the fact.
//
// Storage is localStorage on purpose: it records printing activity, not farm
// records, so it never enters the audited record set.
import type { DocType, VersionStamp } from "@/lib/electrical-doc-version";

const KEY = "farmops.electrical.doc-history.v1";
const MAX_PER_TYPE = 50;

export type DocSourceKind = "live" | "captured-bundle";

export interface DocVersionHistoryEntry {
  id: string;
  docType: DocType;
  versionCode: string;
  formatVersion: string;
  apiVersion: string;
  schemaVersion: string;
  /** Snapshot generated_at the print was built from. */
  generatedAt: string;
  printedAt: string;
  printedBy: string;
  scope: string;
  counts: Record<string, number>;
  qaErrors: number;
  qaWarnings: number;
  sourceKind: DocSourceKind;
  /** Bundle version code when printed from a captured bundle. */
  sourceLabel: string;
  fileName: string;
}

function readAll(): DocVersionHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DocVersionHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: DocVersionHistoryEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // History is a convenience; a full or blocked store must not break printing.
  }
}

export function docVersionHistory(docType?: DocType): DocVersionHistoryEntry[] {
  const all = readAll().filter((e) => !docType || e.docType === docType);
  return all.sort((a, b) => (a.printedAt < b.printedAt ? 1 : -1));
}

export function recordDocVersion(
  stamp: VersionStamp,
  source: { kind: DocSourceKind; label: string },
  fileName: string,
): DocVersionHistoryEntry {
  const entry: DocVersionHistoryEntry = {
    id: `${stamp.docType}-${stamp.printedAt}-${stamp.digest}`,
    docType: stamp.docType,
    versionCode: stamp.versionCode,
    formatVersion: stamp.formatVersion,
    apiVersion: stamp.apiVersion,
    schemaVersion: stamp.schemaVersion,
    generatedAt: stamp.generatedAt,
    printedAt: stamp.printedAt,
    printedBy: stamp.generatedBy,
    scope: stamp.scope || "All records",
    counts: stamp.counts,
    qaErrors: stamp.qaErrors,
    qaWarnings: stamp.qaWarnings,
    sourceKind: source.kind,
    sourceLabel: source.label,
    fileName,
  };
  const all = readAll().filter((e) => e.id !== entry.id);
  all.unshift(entry);
  // Trim per type so one busy document cannot evict another's history.
  const kept: DocVersionHistoryEntry[] = [];
  const seen: Partial<Record<DocType, number>> = {};
  for (const e of all) {
    const n = (seen[e.docType] ?? 0) + 1;
    seen[e.docType] = n;
    if (n <= MAX_PER_TYPE) kept.push(e);
  }
  writeAll(kept);
  return entry;
}

export function clearDocVersionHistory(docType: DocType): void {
  writeAll(readAll().filter((e) => e.docType !== docType));
}

export function historyCsv(entries: DocVersionHistoryEntry[]): string {
  const head = [
    "version_code",
    "doc_type",
    "format_version",
    "api_version",
    "schema_version",
    "snapshot_generated_at",
    "printed_at",
    "printed_by",
    "scope",
    "counts",
    "qa_errors",
    "qa_warnings",
    "source",
    "source_version",
    "file_name",
  ];
  const rows = entries.map((e) => [
    e.versionCode,
    e.docType,
    e.formatVersion,
    e.apiVersion,
    e.schemaVersion,
    e.generatedAt,
    e.printedAt,
    e.printedBy,
    e.scope,
    Object.entries(e.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" | "),
    String(e.qaErrors),
    String(e.qaWarnings),
    e.sourceKind,
    e.sourceLabel,
    e.fileName,
  ]);
  return [head, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
