// Electrical terminology checker.
//
//   bun scripts/terminology-check.ts            # report + non-zero exit on errors
//   bun scripts/terminology-check.ts --report   # report only, always exit 0

import {
  SURFACE_LABEL,
  errorCount,
  type TerminologyFinding,
  type TerminologySurface,
} from "../src/lib/electrical-terminology-audit";
import { scanRepository } from "./lib/terminology-scan";

const { scanned, findings } = scanRepository();
const errors = errorCount(findings);
const grouped = new Map<TerminologySurface, TerminologyFinding[]>();
for (const f of findings) grouped.set(f.surface, [...(grouped.get(f.surface) ?? []), f]);

console.log(`Electrical terminology check \u2014 ${scanned} files scanned`);
for (const [surface, list] of grouped) {
  console.log(`\n${SURFACE_LABEL[surface]} (${list.length})`);
  for (const f of list) {
    console.log(
      `  ${f.severity.toUpperCase()} ${f.location}:${f.line} "${f.matched}" -> ${f.instead}`,
    );
  }
}
if (findings.length === 0) console.log("\nNo prohibited terminology found.");
console.log(`\n${errors} error(s), ${findings.length - errors} warning(s).`);

if (!process.argv.includes("--report") && errors > 0) process.exit(1);
