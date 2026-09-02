// Phase 4.4 — server functions for the Load_Master deterministic mapping repair
// gate.
//
// The canonical workbook is never remembered: the caller supplies the .ods, and
// the server re-hashes and re-parses it in memory immediately before the preview
// and immediately before every apply operation. Only mappings the SHA-bound
// audit classifies as SHIFTED_COLUMN_MAPPING / WRONG_DESTINATION_FIELD at HIGH
// confidence may authorize a write, and each write touches exactly one column of
// one row. The canonical ODS is never edited.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml, type Sheet } from "@/lib/electrical-ods";
import {
  odsBaselineInput,
  parseOdsBaselineInput,
  sha256Hex,
  base64ToBytes,
} from "@/lib/electrical-adjudication-baseline.functions";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import {
  auditLoadMasterMapping,
  canonicalFieldForHeader,
  type LoadMappingAudit,
} from "@/lib/electrical-load-mapping-audit";
import {
  criticalFieldSummaries,
  eligibleColumns,
  projectRows,
  reconcileRuleEffects,
  repairAuditSummary,
  repairKey,
  ruleEffect,
  schemaGaps,
  stillSafeToRepair,
  summarizeRepair,
  typedForColumn,
  REPAIR_TABLE,
  type RepairFieldSummary,
  type RepairProposal,
  type RepairSummary,
  type RuleReconciliation,
  type SchemaGap,
} from "@/lib/electrical-mapping-repair-gate";
import type { LoadRow } from "@/lib/electrical-load-business-rules";

type LooseDb = { from: (table: string) => any };

const inputSchema = odsBaselineInput.extend({
  confirm: z.boolean().default(false),
  /** Approved mappings as `electrical_loads|<stable_id>|<destination>`. */
  approved: z.array(z.string()).default([]),
});

export interface MappingRepairResult {
  applied: boolean;
  generated_at: string;
  baseline: {
    ods_file_name: string;
    ods_sha256: string;
    expected_sha256: string;
    authorized: boolean;
    reason: string | null;
  };
  audit: {
    sheet: string;
    header_row: number;
    ods_row_count: number;
    farmops_row_count: number;
    deterministic_shift_detected: boolean;
    counts: LoadMappingAudit["counts"];
  };
  eligible_mappings: {
    semantic_field: string;
    destination: string;
    ods_physical_column: number;
    ods_header: string;
    defect: string;
    confidence: string;
    proposals: number;
  }[];
  critical_fields: RepairFieldSummary[];
  schema_gaps: SchemaGap[];
  proposals: RepairProposal[];
  rules: RuleReconciliation;
  summary: RepairSummary;
}

interface ParsedCanonical {
  sheet: Sheet;
  headerRow: number;
  sha256: string;
  /** 0-based worksheet row index + stable id for every canonical data row. */
  rows: { sourceRow: number; stableId: string }[];
  importerColumns: { source: string; target: string | null; collidedWith?: string }[];
}

/** Re-hash + re-parse the workbook. Called before preview and before each apply. */
async function parseCanonical(data: { file_name: string; base64: string }): Promise<ParsedCanonical> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const bytes = base64ToBytes(data.base64);
  const sha256 = await sha256Hex(bytes);
  const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
  const content = files["content.xml"];
  if (!content) {
    throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
  }
  const sheets = parseOdsContentXml(strFromU8(content));
  const loadSheet = sheets.find((s) => classifySheet(s) === "load");
  if (!loadSheet) throw new Error("No Load_Master sheet was found in that workbook.");
  const def = ENTITIES.load;
  const mapped = mapSheet(loadSheet, "load", importColumns("load"), def.stableIdField);
  return {
    sheet: loadSheet,
    headerRow: mapped.headerRow,
    sha256,
    // mapSheet reports 1-based worksheet rows; we index sheet.rows.
    rows: mapped.rows.map((r) => ({ sourceRow: r.sourceRow - 1, stableId: r.stableId })),
    importerColumns: mapped.columns,
  };
}

const cellAt = (sheet: Sheet, row: number, col1: number): string =>
  String(sheet.rows[row]?.[col1 - 1] ?? "").trim();

function baselineGuard(sha: string): { ok: true } | { ok: false; reason: string } {
  return sha.toLowerCase() === PHASE_44A_BASELINE_SHA256
    ? { ok: true }
    : {
        ok: false,
        reason: `The attached workbook (SHA-256 ${sha}) is not the authorized Phase 4.4 canonical baseline (${PHASE_44A_BASELINE_SHA256}). No repair may be applied from it.`,
      };
}

/**
 * Canonical ODS-derived load rows: every canonical field that has a FarmOps
 * destination, taken from its own physical column. This is the view the
 * post-repair business-rule output must reconcile to.
 */
function canonicalRows(parsed: ParsedCanonical): LoadRow[] {
  const header = parsed.sheet.rows[parsed.headerRow] ?? [];
  const bindings: { col1: number; destination: string }[] = [];
  for (let i = 0; i < header.length; i++) {
    const field = canonicalFieldForHeader(header[i] ?? "");
    if (field?.destination) bindings.push({ col1: i + 1, destination: field.destination });
  }
  return parsed.rows.map((r) => {
    const row: LoadRow = { load_id: r.stableId };
    for (const b of bindings) {
      const typed = typedForColumn(b.destination, cellAt(parsed.sheet, r.sourceRow, b.col1));
      row[b.destination] = typed === undefined ? null : typed;
    }
    return row;
  });
}

/**
 * Field-level evidence recorded AFTER the import for a given row+column.
 * Any such entry supersedes the imported value and blocks the repair.
 */
async function supersedingEvidence(
  db: LooseDb,
  uuids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!uuids.length) return out;
  const { data } = await db
    .from("electrical_change_audit")
    .select("entity_uuid, section, summary, changes, created_at")
    .eq("entity_kind", "load")
    .in("entity_uuid", uuids);
  for (const a of (data ?? []) as {
    entity_uuid: string | null;
    section: string | null;
    summary: string | null;
    changes: unknown;
    created_at: string | null;
  }[]) {
    // Our own mapping repairs are not "newer evidence" about the value.
    if (a.section === REPAIR_SECTION) continue;
    const changes = Array.isArray(a.changes) ? (a.changes as { column?: string }[]) : [];
    for (const c of changes) {
      if (!c.column || !a.entity_uuid) continue;
      out.set(
        `${a.entity_uuid}|${c.column}`,
        `${a.summary ?? "field change"} recorded ${a.created_at ?? "previously"} (section ${a.section ?? "unknown"}).`,
      );
    }
  }
  return out;
}

const REPAIR_SECTION = "load_mapping_repair";

const SELECT = "*";

async function runGate(
  db: LooseDb,
  supabase: unknown,
  userId: string,
  data: { file_name: string; base64: string; confirm: boolean; approved: string[] },
): Promise<MappingRepairResult> {
  const generated_at = new Date().toISOString();
  const parsed = await parseCanonical(data);
  const guard = baselineGuard(parsed.sha256);
  const approved = new Set(data.approved);

  const { data: dbRows, error } = await db.from(REPAIR_TABLE).select(SELECT);
  if (error) throw new Error(error.message);
  const liveRows = (dbRows ?? []) as Record<string, unknown>[];

  const audit = auditLoadMasterMapping({
    sheet: parsed.sheet,
    headerRow: parsed.headerRow,
    importerColumns: parsed.importerColumns,
    odsRows: parsed.rows,
    dbRows: liveRows,
  });

  const byStableId = new Map<string, Record<string, unknown>>();
  for (const r of liveRows) {
    const id = String(r["load_id"] ?? "").trim();
    if (id) byStableId.set(id, r);
  }

  const columns = eligibleColumns(audit);
  const gaps = schemaGaps(audit);
  const evidence = await supersedingEvidence(
    db,
    liveRows.map((r) => String(r["id"] ?? "")).filter(Boolean),
  );

  const proposals: RepairProposal[] = [];
  const appliedProposals: RepairProposal[] = [];

  for (const col of columns) {
    const destination = col.expected_destination as string;
    const semantic = col.semantic_field as string;
    for (const r of parsed.rows) {
      const live = byStableId.get(r.stableId.trim());
      if (!live) continue;
      const canonical_raw = cellAt(parsed.sheet, r.sourceRow, col.physical_column);
      const currentRaw = live[destination];
      const proposed_value = typedForColumn(destination, canonical_raw);
      const base: RepairProposal = {
        table: REPAIR_TABLE,
        stable_id: r.stableId.trim(),
        row_uuid: (live["id"] as string | undefined) ?? null,
        ods_physical_column: col.physical_column,
        ods_header: col.ods_header,
        semantic_field: semantic,
        destination,
        canonical_raw,
        proposed_value: proposed_value === undefined ? null : proposed_value,
        current_farmops_value: String(currentRaw ?? ""),
        defect: col.status,
        confidence: col.confidence,
        baseline_sha256: parsed.sha256,
        status: "would_change",
        applied_at: null,
      };

      const key = repairKey(base);
      const safe = stillSafeToRepair({
        stable_id: base.stable_id,
        destination,
        live_value: currentRaw,
        previewed_current: currentRaw,
        canonical_raw_now: canonical_raw,
        previewed_canonical_raw: canonical_raw,
        proposed_value,
        defect: col.status,
        confidence: col.confidence,
        baseline: guard,
        supersedingEvidence: base.row_uuid
          ? evidence.get(`${base.row_uuid}|${destination}`) ?? null
          : null,
        // Preview only reports approval state at apply time.
        approved: data.confirm ? approved.has(key) : true,
      });

      if (!safe.ok) {
        proposals.push({ ...base, status: safe.status, detail: safe.reason });
        continue;
      }
      if (!data.confirm) {
        proposals.push(base);
        continue;
      }

      // Immediately before the write: re-read this exact row by UUID and
      // re-verify canonical cell, stored value, classification and evidence.
      const { data: fresh, error: reErr } = await db
        .from(REPAIR_TABLE)
        .select(SELECT)
        .eq("id", base.row_uuid)
        .maybeSingle();
      if (reErr || !fresh) {
        proposals.push({
          ...base,
          status: "failed",
          detail: reErr?.message ?? "Row disappeared before the write.",
        });
        continue;
      }
      const f = fresh as Record<string, unknown>;
      if (String(f["load_id"] ?? "").trim() !== base.stable_id) {
        proposals.push({ ...base, status: "failed", detail: "Stable ID mismatch on the live row." });
        continue;
      }
      const reparsed = await parseCanonical(data);
      const reGuard = baselineGuard(reparsed.sha256);
      const freshRow = reparsed.rows.find((x) => x.stableId.trim() === base.stable_id);
      const canonicalNow = freshRow
        ? cellAt(reparsed.sheet, freshRow.sourceRow, col.physical_column)
        : "";
      const stillOk = stillSafeToRepair({
        stable_id: base.stable_id,
        destination,
        live_value: f[destination],
        previewed_current: currentRaw,
        canonical_raw_now: canonicalNow,
        previewed_canonical_raw: canonical_raw,
        proposed_value,
        defect: col.status,
        confidence: col.confidence,
        baseline: reGuard,
        supersedingEvidence: evidence.get(`${base.row_uuid}|${destination}`) ?? null,
        approved: approved.has(key),
      });
      if (!stillOk.ok) {
        proposals.push({ ...base, status: stillOk.status, detail: stillOk.reason });
        continue;
      }

      const { error: upErr } = await db
        .from(REPAIR_TABLE)
        .update({ [destination]: base.proposed_value })
        .eq("id", base.row_uuid);
      if (upErr) {
        proposals.push({ ...base, status: "failed", detail: upErr.message });
        continue;
      }
      const appliedRow: RepairProposal = {
        ...base,
        status: "applied",
        applied_at: new Date().toISOString(),
      };
      proposals.push(appliedRow);
      appliedProposals.push(appliedRow);
      await recordElectricalChange(supabase, userId, {
        section: REPAIR_SECTION,
        entityKind: "load",
        action: "update",
        entityUuid: base.row_uuid,
        entityRef: base.stable_id,
        summary: repairAuditSummary(appliedRow),
        changes: [
          {
            column: destination,
            before: base.current_farmops_value || null,
            after: base.proposed_value === null ? null : String(base.proposed_value),
          },
        ],
      });
    }
  }

  // Business-rule effects: before, projected-after and the canonical ODS view
  // the post-repair output must reconcile to.
  const projectable = proposals.filter(
    (p) => p.status === "would_change" || p.status === "applied",
  );
  const before = ruleEffect(liveRows as LoadRow[]);
  const after = ruleEffect(projectRows(liveRows as LoadRow[], projectable));
  const canonical = ruleEffect(canonicalRows(parsed));

  return {
    applied: data.confirm,
    generated_at,
    baseline: {
      ods_file_name: data.file_name,
      ods_sha256: parsed.sha256,
      expected_sha256: PHASE_44A_BASELINE_SHA256,
      authorized: guard.ok,
      reason: guard.ok ? null : guard.reason,
    },
    audit: {
      sheet: audit.sheet,
      header_row: audit.header_row,
      ods_row_count: audit.ods_row_count,
      farmops_row_count: audit.farmops_row_count,
      deterministic_shift_detected: audit.deterministic_shift_detected,
      counts: audit.counts,
    },
    eligible_mappings: columns.map((c) => ({
      semantic_field: c.semantic_field as string,
      destination: c.expected_destination as string,
      ods_physical_column: c.physical_column,
      ods_header: c.ods_header,
      defect: c.status,
      confidence: c.confidence,
      proposals: proposals.filter((p) => p.ods_physical_column === c.physical_column).length,
    })),
    critical_fields: criticalFieldSummaries(audit, proposals),
    schema_gaps: gaps,
    proposals,
    rules: reconcileRuleEffects(before, after, canonical),
    summary: summarizeRepair(proposals, gaps, {
      sha256: parsed.sha256,
      authorized: guard.ok,
    }),
  };
}

export const previewLoadMappingRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parseOdsBaselineInput(d))
  .handler(async ({ context, data }): Promise<MappingRepairResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    return runGate(context.supabase as unknown as LooseDb, context.supabase, context.userId, {
      ...data,
      confirm: false,
      approved: [],
    });
  });

export const applyLoadMappingRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    parseOdsBaselineInput(d);
    const parsed = inputSchema.parse({ ...(d as object), confirm: true });
    if (!parsed.approved.length) {
      throw new Error("No mappings were approved. Nothing was written.");
    }
    return parsed;
  })
  .handler(async ({ context, data }): Promise<MappingRepairResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    return runGate(context.supabase as unknown as LooseDb, context.supabase, context.userId, {
      file_name: data.file_name,
      base64: data.base64,
      confirm: true,
      approved: data.approved,
    });
  });
