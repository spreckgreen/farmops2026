// Repo-wide terminology scan, shared by scripts/terminology-check.ts and the
// vitest suite so the same rules gate typecheck-time documentation validation.
//
// Scans UI strings and tooltips, database comments/enums in migrations, API and
// OpenAPI descriptions, audit manifests, CSV headers, diagram legends, Standards
// documentation and AI prompt context for prohibited terminology.
//
// A line may opt out with a `terminology-ok` comment when it legitimately quotes
// a deprecated word (alias tables, this checker, the registry itself).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  scanText,
  type TerminologyFinding,
  type TerminologySurface,
} from "../../src/lib/electrical-terminology-audit";

const ROOT = new URL("../..", import.meta.url).pathname;

const SKIP_FILES = new Set([
  "src/lib/electrical-terminology.ts",
  "src/lib/electrical-terminology-audit.ts",
  "scripts/terminology-check.ts",
  "tests/electrical-terminology.test.ts",
  "docs/ELECTRICAL_TERMINOLOGY.md",
]);

interface Target {
  dir: string;
  match: RegExp;
  surface: TerminologySurface;
}

const TARGETS: Target[] = [
  { dir: "src/routes", match: /^electrical.*\.tsx$/, surface: "ui_string" },
  { dir: "src/components/electrical", match: /\.tsx$/, surface: "ui_string" },
  { dir: "src/lib", match: /^electrical-.*ai-(context|scenarios)\.ts$/, surface: "ai_prompt" },
  { dir: "src/lib", match: /^electrical-standards.*\.ts$/, surface: "standards_doc" },
  { dir: "src/lib", match: /^electrical-audit-.*\.ts$/, surface: "audit_manifest" },
  { dir: "src/lib", match: /^electrical-api.*\.ts$/, surface: "api_description" },
  { dir: "src/lib", match: /^electrical-export.*\.ts$/, surface: "csv_export" },
  { dir: "supabase/migrations", match: /electrical.*\.sql$/, surface: "db_comment_or_enum" },
  { dir: "docs", match: /^ELECTRICAL.*\.md$/, surface: "standards_doc" },
];

function listFiles(dir: string, match: RegExp): string[] {
  const abs = join(ROOT, dir);
  let names: string[] = [];
  try {
    names = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    const p = join(abs, n);
    if (statSync(p).isDirectory()) continue;
    if (match.test(n)) out.push(p);
  }
  return out;
}

export interface RepoScanResult {
  scanned: number;
  findings: TerminologyFinding[];
}

/** Scan every audited surface in the repository. */
export function scanRepository(): RepoScanResult {
  const findings: TerminologyFinding[] = [];
  let scanned = 0;
  for (const t of TARGETS) {
    for (const abs of listFiles(t.dir, t.match)) {
      const rel = relative(ROOT, abs);
      if (SKIP_FILES.has(rel)) continue;
      scanned += 1;
      findings.push(
        ...scanText(readFileSync(abs, "utf8"), {
          surface: t.surface,
          location: rel,
          aliasesAllowed: t.surface === "csv_export" || t.surface === "audit_manifest",
        }),
      );
    }
  }
  return { scanned, findings };
}
