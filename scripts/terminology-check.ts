// Electrical terminology checker.
//
//   bun scripts/terminology-check.ts            # report + non-zero exit on errors
//   bun scripts/terminology-check.ts --report   # report only, always exit 0
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
  errorCount,
  SURFACE_LABEL,
  type TerminologyFinding,
  type TerminologySurface,
} from "../src/lib/electrical-terminology-audit";

const ROOT = new URL("..", import.meta.url).pathname;

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

const errors = errorCount(findings);
const grouped = new Map<string, TerminologyFinding[]>();
for (const f of findings) {
  const k = `${f.surface}`;
  grouped.set(k, [...(grouped.get(k) ?? []), f]);
}

console.log(`Electrical terminology check — ${scanned} files scanned`);
for (const [surface, list] of grouped) {
  console.log(`\n${SURFACE_LABEL[surface as TerminologySurface]} (${list.length})`);
  for (const f of list) {
    console.log(
      `  ${f.severity.toUpperCase()} ${f.location}:${f.line} "${f.matched}" -> ${f.instead}`,
    );
  }
}
if (findings.length === 0) console.log("\nNo prohibited terminology found.");
console.log(`\n${errors} error(s), ${findings.length - errors} warning(s).`);

if (!process.argv.includes("--report") && errors > 0) process.exit(1);
