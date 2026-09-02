// Phase 4.4d — controlled canonical ODS revision generation (server side).
//
// Generates a CANDIDATE workbook from the authorized baseline plus the Phase
// 4.4c approved correction manifest. It never writes FarmOps, never persists a
// file, and never overwrites the owner-supplied baseline: the candidate bytes
// are returned to the caller as a new artifact for review and download.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import {
  base64ToBytes,
  odsBaselineInput,
  parseOdsBaselineInput,
  sha256Hex,
} from "@/lib/electrical-adjudication-baseline.functions";
import {
  makeAdjudicationBaseline,
  PHASE_44A_BASELINE_SHA256,
} from "@/lib/electrical-adjudication-baseline";
import { parseOdsContentXml } from "@/lib/electrical-ods";
import {
  buildCandidateReport,
  candidateFileName,
  diffSheetCells,
  manifestAuthorizesRevision,
  manifestFingerprintSource,
  resolveRevisionTargets,
  revisionManifest,
  rewriteOdsNumericCell,
  type CandidateRevisionReport,
} from "@/lib/electrical-ods-revision";

export interface CandidateRevisionResult {
  report: CandidateRevisionReport;
  /** Candidate workbook bytes, base64. A NEW artifact — the baseline is intact. */
  candidate_base64: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export async function generateCandidateRevision(
  data: { file_name: string; base64: string },
  generatedAt?: string,
): Promise<CandidateRevisionResult> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");

  // 1. Re-hash the input workbook and require the authorized baseline SHA.
  const bytes = base64ToBytes(data.base64);
  const baselineSha = await sha256Hex(bytes);
  if (baselineSha !== PHASE_44A_BASELINE_SHA256) {
    throw new Error(
      `This workbook hashes to ${baselineSha}, which is not the authorized canonical baseline ${PHASE_44A_BASELINE_SHA256}. Revision generation is refused for a foreign or stale baseline.`,
    );
  }

  const files = unzipSync(bytes);
  const content = files["content.xml"];
  if (!content) throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
  const baselineXml = strFromU8(content);
  const baselineSheets = parseOdsContentXml(baselineXml);
  const baseline = makeAdjudicationBaseline({
    ods_file_name: data.file_name,
    ods_sha256: baselineSha,
    sheets: baselineSheets,
  });

  // 2. Build the manifest from this workbook and require exactly the two
  //    approved corrections and four withheld values.
  const manifest = revisionManifest(baseline, generatedAt);
  const manifestGuard = manifestAuthorizesRevision(manifest);
  if (!manifestGuard.ok) throw new Error(manifestGuard.reason);
  const manifestSha = await sha256Hex(strToU8(manifestFingerprintSource(manifest)));

  // 3. Re-parse FS-082 / FS-083 and verify their raw Volts cells are still 120.
  const { targets, errors } = resolveRevisionTargets(baseline, baselineSheets);
  if (errors.length) throw new Error(errors.join(" "));
  if (targets.length !== 2) {
    throw new Error(
      `Resolved ${targets.length} authorized source cells; exactly 2 are required. Generation refused.`,
    );
  }

  // 4. Pre-mutation assertion: each authorized target must resolve, through the
  //    canonical parser's own addressing, to a cell whose parsed value is the
  //    authorized baseline value. Fail closed with the full trace otherwise.
  const traces = targets.map((t) =>
    inspectRevisionTarget(baselineXml, {
      stable_id: t.stable_id,
      field: t.field,
      worksheet: t.worksheet,
      row: t.row,
      column: t.column,
      expected: t.baseline_value,
      next: t.candidate_value,
    }),
  );
  const failed = traces.filter((t) => t.assertion !== "PASS");
  if (failed.length) {
    const table = traces
      .map((t) => `${revisionTraceRow(t).join(" | ")} | ${t.assertion}${t.reason ? ` — ${t.reason}` : ""}`)
      .join("\n");
    throw new Error(
      `Pre-mutation target assertion failed for ${failed.length} of ${traces.length} authorized cells. No cell was rewritten.\n` +
        "stable_id | logical row | logical column/field | physical XML row | physical XML cell index | repeated-column offset | value-type | office:value | display text | assertion\n" +
        table,
    );
  }

  // 5. Rewrite exactly those two cells. Everything else stays byte-identical.
  let candidateXml = baselineXml;
  for (const t of targets) {
    candidateXml = rewriteOdsNumericCell(candidateXml, {
      stable_id: t.stable_id,
      field: t.field,
      worksheet: t.worksheet,
      row: t.row,
      column: t.column,
      expected: t.baseline_value,
      next: t.candidate_value,
    });
  }


  // 5. Repackage as a NEW artifact, mimetype stored first and uncompressed.
  const zipInput: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const names = Object.keys(files).sort((a, b) =>
    a === "mimetype" ? -1 : b === "mimetype" ? 1 : 0,
  );
  for (const name of names) {
    const body = name === "content.xml" ? strToU8(candidateXml) : files[name];
    zipInput[name] = [body, { level: name === "mimetype" ? 0 : 6 }];
  }
  const candidateBytes = zipSync(zipInput as never);
  const candidateSha = await sha256Hex(candidateBytes);

  // 6. Verify the candidate by re-parsing it, cell by cell.
  const candidateFiles = unzipSync(candidateBytes);
  const candidateSheets = parseOdsContentXml(strFromU8(candidateFiles["content.xml"]));
  const candidate = makeAdjudicationBaseline({
    ods_file_name: candidateFileName(data.file_name, candidateSha),
    ods_sha256: candidateSha,
    sheets: candidateSheets,
  });
  const nonContentChanged = Object.keys(files).filter(
    (n) => n !== "content.xml" && !sameBytes(files[n], candidateFiles[n]),
  ).length;

  const report = buildCandidateReport({
    baseline,
    candidate,
    manifest,
    manifest_sha256: manifestSha,
    candidate_sha256: candidateSha,
    candidate_file_name: candidate.ods_file_name,
    targets,
    cell_diff: diffSheetCells(baselineSheets, candidateSheets),
    non_content_archive_entries_changed: nonContentChanged,
    generated_at: generatedAt,
  });

  return { report, candidate_base64: bytesToBase64(candidateBytes) };
}

/** Preview a new ODS revision. Read-only with respect to FarmOps and the ODS. */
export const previewCanonicalOdsRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parseOdsBaselineInput(d))
  .handler(async ({ context, data }): Promise<CandidateRevisionResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    return generateCandidateRevision(data as typeof odsBaselineInput._output);
  });
