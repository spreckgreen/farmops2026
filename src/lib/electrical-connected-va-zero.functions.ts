// Phase 4.4b — server functions for the connected_va zero-artifact correction gate.
//
// Canonical evidence is never remembered: the caller supplies the .ods workbook,
// the server parses and hashes it in memory, and nothing may be applied unless
// that hash is the authorized Phase 4.4a baseline SHA.
//
// Preview writes nothing. Apply requires confirm: true AND an explicit approved
// list, and immediately before each write it re-reads the live row by UUID and
// re-verifies the stable ID, the exact numeric 0, the blank canonical cell, the
// zero-origin adjudication and the absence of newer evidence — then writes ONLY
// `electrical_loads.connected_va = NULL`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml, type Sheet } from "@/lib/electrical-ods";
import {
  baselineAuthorizesApply,
  PHASE_44A_BASELINE_SHA256,
} from "@/lib/electrical-adjudication-baseline";
import {
  base64ToBytes,
  odsBaselineInput,
  parseOdsBaselineInput,
  sha256Hex,
} from "@/lib/electrical-adjudication-baseline.functions";
import {
  classifyZeroOrigin,
  type LoadProvenanceRow,
  type ZeroDisposition,
  type ZeroOrigin,
} from "@/lib/electrical-zero-origin-provenance";
import type { NumericFinding } from "@/lib/electrical-numeric-diagnostics";
import {
  AUTHORIZED_ZERO_DISPOSITION,
  AUTHORIZED_ZERO_ORIGIN,
  CONNECTED_VA_ZERO_COLUMN,
  CONNECTED_VA_ZERO_GATE_VERSION,
  CONNECTED_VA_ZERO_TABLE,
  connectedVaZeroGateKey,
  EXCLUDED_LOAD_IDS,
  isExactNumericZero,
  stillSafeToRemoveConnectedVaZero,
  summarizeConnectedVaZeroGate,
  type ConnectedVaZeroGateRow,
  type ConnectedVaZeroGateStatus,
  type ConnectedVaZeroGateSummary,
} from "@/lib/electrical-connected-va-zero-gate";

type LooseDb = { from: (table: string) => any };

const SELECT =
  "id, load_id, description, connected_va, volts, amps, source_reference, notes, created_at, updated_at";

interface RawLoad {
  id: string;
  load_id: string;
  description: string | null;
  connected_va: number | null;
  volts: number | null;
  amps: number | null;
  source_reference: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const inputSchema = odsBaselineInput.extend({
  confirm: z.boolean().default(false),
  /** Approved rows as `electrical_loads|<stable_id>|connected_va`. */
  approved: z.array(z.string()).default([]),
});

export interface ConnectedVaZeroGateResult {
  applied: boolean;
  changed: number;
  skipped: number;
  generated_at: string;
  baseline: {
    ods_file_name: string;
    ods_sha256: string;
    expected_sha256: string;
    authorized: boolean;
    reason: string | null;
  };
  rows: ConnectedVaZeroGateRow[];
  summary: ConnectedVaZeroGateSummary;
}

/* ------------------------------------------------------- canonical workbook */

interface CanonicalCell {
  raw: string;
  state: ConnectedVaZeroGateRow["ods_state"];
  worksheet: string;
  row: number;
}

/** Read the connected VA cell for every load row in the workbook, verbatim. */
function canonicalConnectedVaCells(sheets: Sheet[]): Map<string, CanonicalCell> {
  const out = new Map<string, CanonicalCell>();
  const def = ENTITIES["load"];
  const targets = importColumns("load");
  for (const sheet of sheets) {
    if (classifySheet(sheet) !== "load") continue;
    const mapped = mapSheet(sheet, "load", targets, def.stableIdField);
    for (const row of mapped.rows) {
      const id = row.stableId.trim();
      if (!id || out.has(id)) continue;
      const raw = (row.values[CONNECTED_VA_ZERO_COLUMN] ?? "").trim();
      const state: CanonicalCell["state"] = !raw
        ? "blank"
        : Number.isFinite(Number(raw.replace(/,/g, "")))
          ? "value"
          : "text";
      out.set(id, { raw, state, worksheet: sheet.name, row: row.sourceRow });
    }
  }
  return out;
}

async function workbookFromUpload(data: { file_name: string; base64: string }) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const bytes = base64ToBytes(data.base64);
  const ods_sha256 = (await sha256Hex(bytes)).toLowerCase();
  const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
  const content = files["content.xml"];
  if (!content) {
    throw new Error("That file does not look like an .ods spreadsheet (no content.xml).");
  }
  const sheets = parseOdsContentXml(strFromU8(content));
  return {
    ods_file_name: data.file_name,
    ods_sha256,
    cells: canonicalConnectedVaCells(sheets),
    // A minimal baseline shell so the shared SHA guard can be reused verbatim.
    guard: baselineAuthorizesApply({
      version: "connected-va-zero-gate",
      ods_file_name: data.file_name,
      ods_sha256,
      parsed_at: new Date().toISOString(),
      is_phase_44a_baseline: ods_sha256 === PHASE_44A_BASELINE_SHA256,
      load_worksheets: [],
      loads: [],
      missing_load_ids: [],
    }),
  };
}

/* ------------------------------------------------------- FarmOps provenance */

const CITED = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (!s) return false;
  return !/^(tbd|unknown|n\/?a|none|yes|no|\d+(\.\d+)?\s*%)$/i.test(s);
};

interface Provenance {
  row: LoadProvenanceRow;
  /** Audit entries touching connected_va that did NOT come from this gate. */
  foreign_audit_entries: number;
  /** This gate's own prior removal, if any. */
  gate_applied_before: boolean;
}

async function readProvenance(db: LooseDb, loads: RawLoad[]): Promise<Map<string, Provenance>> {
  const batch = new Map<string, number>();
  for (const l of loads) {
    const k = (l.created_at ?? "").slice(0, 19);
    batch.set(k, (batch.get(k) ?? 0) + 1);
  }

  const foreign = new Map<string, number>();
  const gateApplied = new Set<string>();
  const { data: auditRows } = await db
    .from("electrical_change_audit")
    .select("entity_uuid, entity_ref, changes, summary")
    .eq("entity_kind", "load");
  for (const a of (auditRows ?? []) as {
    entity_uuid: string | null;
    entity_ref: string | null;
    changes: unknown;
    summary: string | null;
  }[]) {
    const changes = Array.isArray(a.changes) ? (a.changes as { field?: string; column?: string }[]) : [];
    const touches = changes.some(
      (c) => c.field === CONNECTED_VA_ZERO_COLUMN || c.column === CONNECTED_VA_ZERO_COLUMN,
    );
    if (!touches) continue;
    const keys = [a.entity_ref, a.entity_uuid].filter(Boolean) as string[];
    const fromGate = (a.summary ?? "").includes(CONNECTED_VA_ZERO_GATE_VERSION);
    for (const k of keys) {
      if (fromGate) gateApplied.add(k);
      else foreign.set(k, (foreign.get(k) ?? 0) + 1);
    }
  }

  const out = new Map<string, Provenance>();
  for (const l of loads) {
    const id = l.load_id.trim();
    const foreignCount = foreign.get(id) ?? foreign.get(l.id) ?? 0;
    out.set(id, {
      foreign_audit_entries: foreignCount,
      gate_applied_before: gateApplied.has(id) || gateApplied.has(l.id),
      row: {
        load_id: id,
        connected_va: l.connected_va,
        volts: l.volts,
        amps: l.amps,
        source_reference: l.source_reference,
        notes: l.notes,
        created_at: l.created_at,
        updated_at: l.updated_at,
        audit_entries: foreignCount,
        import_snapshot: false,
        creation_batch_size: batch.get((l.created_at ?? "").slice(0, 19)) ?? 1,
      },
    });
  }
  return out;
}

/** Synthesize the minimal finding shape the shared classifier reads. */
function syntheticFinding(cell: CanonicalCell | undefined): NumericFinding {
  return {
    ods_state: (cell?.state === "blank" || !cell ? "absent" : "value") as NumericFinding["ods_state"],
    ods_raw: cell?.raw ?? "",
  } as NumericFinding;
}

function newerEvidenceFor(p: Provenance): string[] {
  const out: string[] = [];
  if (CITED(p.row.source_reference)) {
    out.push(`a source reference has appeared (\u201C${p.row.source_reference}\u201D)`);
  }
  if (p.foreign_audit_entries > 0) {
    out.push(
      `${p.foreign_audit_entries} field-level audit entr${p.foreign_audit_entries === 1 ? "y" : "ies"} now record someone entering this value`,
    );
  }
  if (p.row.import_snapshot) out.push("an import snapshot now records an explicit value");
  return out;
}

function provenanceLine(p: Provenance): string {
  return [
    `created ${p.row.created_at ?? "?"}`,
    p.row.creation_batch_size > 1
      ? `bulk batch of ${p.row.creation_batch_size}`
      : "single-row creation",
    p.row.source_reference ? `source_reference "${p.row.source_reference}"` : "no source_reference",
    `${p.foreign_audit_entries} supporting audit entr${p.foreign_audit_entries === 1 ? "y" : "ies"}`,
    p.row.import_snapshot ? "import snapshot present" : "no import snapshot",
    p.gate_applied_before ? "zero already removed by this gate" : "",
  ]
    .filter(Boolean)
    .join(" \u00B7 ");
}

/* ------------------------------------------------------------------- the gate */

async function runGate(
  db: LooseDb,
  userId: string,
  supabase: unknown,
  workbook: Awaited<ReturnType<typeof workbookFromUpload>>,
  data: { confirm: boolean; approved: string[] },
): Promise<ConnectedVaZeroGateResult> {
  const approvedSet = new Set(data.approved);
  const generated_at = new Date().toISOString();
  const rows: ConnectedVaZeroGateRow[] = [];
  let changed = 0;
  let skipped = 0;

  const { data: found, error } = await db.from(CONNECTED_VA_ZERO_TABLE).select(SELECT);
  if (error) {
    const summary = summarizeConnectedVaZeroGate([], {
      authorized_rows: 0,
      baseline_ods_file: workbook.ods_file_name,
      baseline_sha256: workbook.ods_sha256,
      baseline_authorized: workbook.guard.ok,
    });
    throw new Error(`${error.message} (gate ${summary.gate_version})`);
  }
  const loads = (found ?? []) as RawLoad[];
  const provenance = await readProvenance(db, loads);

  interface Candidate {
    load: RawLoad;
    cell: CanonicalCell | undefined;
    prov: Provenance;
    origin: ZeroOrigin;
    disposition: ZeroDisposition | null;
    evidence: string[];
  }

  const candidates: Candidate[] = [];
  const authorized = new Set<string>();

  for (const load of loads) {
    const id = load.load_id.trim();
    if (!id) continue;
    if (EXCLUDED_LOAD_IDS.includes(id as (typeof EXCLUDED_LOAD_IDS)[number])) continue;
    const cell = workbook.cells.get(id);
    const odsBlank = !cell || cell.state === "blank";
    if (!odsBlank) continue;

    const prov = provenance.get(id)!;
    const zeroNow = isExactNumericZero(load.connected_va);
    // Rows this gate already cleared stay visible so the accounting still
    // balances after an apply; nothing else that is merely NULL is listed.
    if (!zeroNow && !prov.gate_applied_before) continue;

    const { origin, evidence } = classifyZeroOrigin(syntheticFinding(cell), prov.row);
    const disposition =
      origin === AUTHORIZED_ZERO_ORIGIN ? AUTHORIZED_ZERO_DISPOSITION : null;
    if (disposition === AUTHORIZED_ZERO_DISPOSITION && newerEvidenceFor(prov).length === 0) {
      authorized.add(id);
    }
    candidates.push({ load, cell, prov, origin, disposition, evidence });
  }

  candidates.sort((a, b) => a.load.load_id.localeCompare(b.load.load_id));

  for (const c of candidates) {
    const id = c.load.load_id.trim();
    const live =
      c.load.connected_va === null || c.load.connected_va === undefined
        ? null
        : Number(c.load.connected_va);
    const base = {
      table: CONNECTED_VA_ZERO_TABLE,
      stable_id: id,
      column: CONNECTED_VA_ZERO_COLUMN,
      proposed_value: null as null,
      ods_state: c.cell?.state ?? ("blank" as const),
      ods_raw: c.cell?.raw ?? "",
      ods_worksheet: c.cell?.worksheet ?? null,
      ods_row: c.cell?.row ?? null,
      zero_origin: c.origin,
      disposition: c.disposition,
      provenance: provenanceLine(c.prov),
      evidence: c.evidence,
      baseline_ods_file: workbook.ods_file_name,
      baseline_sha256: workbook.ods_sha256,
    };
    const push = (patch: {
      row_uuid?: string | null;
      live_connected_va?: number | null;
      status: ConnectedVaZeroGateStatus;
      detail?: string;
      applied_at?: string | null;
    }) =>
      rows.push({
        ...base,
        row_uuid: patch.row_uuid ?? null,
        live_connected_va: patch.live_connected_va ?? null,
        status: patch.status,
        applied_at: patch.applied_at ?? null,
        ...(patch.detail ? { detail: patch.detail } : {}),
      });

    const check = stillSafeToRemoveConnectedVaZero({
      stable_id: id,
      authorized,
      live_connected_va: live,
      ods_state: base.ods_state,
      ods_raw: base.ods_raw,
      zero_origin: c.origin,
      disposition: c.disposition,
      newer_evidence: newerEvidenceFor(c.prov),
      baseline: workbook.guard,
    });
    if (!check.ok) {
      push({
        row_uuid: c.load.id,
        live_connected_va: live,
        status: check.status,
        detail: check.reason,
      });
      skipped++;
      continue;
    }

    if (!data.confirm) {
      push({ row_uuid: c.load.id, live_connected_va: live, status: "would_change" });
      changed++;
      continue;
    }
    if (!approvedSet.has(connectedVaZeroGateKey({ table: CONNECTED_VA_ZERO_TABLE, stable_id: id }))) {
      push({
        row_uuid: c.load.id,
        live_connected_va: live,
        status: "not_approved",
        detail: "Not in the explicitly approved correction set.",
      });
      skipped++;
      continue;
    }

    // Immediately before the write: re-read this exact row by UUID and re-run
    // every protection against the freshest state.
    const { data: fresh, error: reErr } = await db
      .from(CONNECTED_VA_ZERO_TABLE)
      .select(SELECT)
      .eq("id", c.load.id)
      .maybeSingle();
    if (reErr || !fresh) {
      push({
        row_uuid: c.load.id,
        live_connected_va: live,
        status: reErr ? "failed" : "not_found",
        detail: reErr?.message ?? "Row disappeared before the write.",
      });
      skipped++;
      continue;
    }
    const f = fresh as RawLoad;
    const freshId = f.load_id.trim();
    const freshValue =
      f.connected_va === null || f.connected_va === undefined ? null : Number(f.connected_va);
    const freshProv = (await readProvenance(db, [f])).get(freshId)!;
    const freshCell = workbook.cells.get(freshId);
    const freshOrigin = classifyZeroOrigin(syntheticFinding(freshCell), freshProv.row);
    const stillOk = stillSafeToRemoveConnectedVaZero({
      stable_id: freshId,
      authorized,
      live_connected_va: freshValue,
      ods_state: freshCell?.state ?? "blank",
      ods_raw: freshCell?.raw ?? "",
      zero_origin: freshOrigin.origin,
      disposition:
        freshOrigin.origin === AUTHORIZED_ZERO_ORIGIN ? AUTHORIZED_ZERO_DISPOSITION : null,
      newer_evidence: newerEvidenceFor(freshProv),
      baseline: workbook.guard,
    });
    if (!stillOk.ok) {
      push({
        row_uuid: c.load.id,
        live_connected_va: freshValue,
        status: stillOk.status,
        detail: stillOk.reason,
      });
      skipped++;
      continue;
    }

    const appliedAt = new Date().toISOString();
    // Exactly one column, set to NULL. No VA is populated; voltage, amps,
    // demand VA, notes, references and relationships are never in this payload.
    const { error: upErr } = await db
      .from(CONNECTED_VA_ZERO_TABLE)
      .update({ [CONNECTED_VA_ZERO_COLUMN]: null })
      .eq("id", c.load.id);
    if (upErr) {
      push({
        row_uuid: c.load.id,
        live_connected_va: freshValue,
        status: "failed",
        detail: upErr.message,
      });
      skipped++;
      continue;
    }

    // Audit: preserve why the zero went away — an unsupported import/default
    // artifact, not an engineering value that was replaced.
    await recordElectricalChange(supabase, userId, {
      section: "loads",
      entityKind: "load",
      action: "update",
      entityUuid: c.load.id,
      entityRef: freshId,
      summary: `${CONNECTED_VA_ZERO_GATE_VERSION}: removed unsupported connected VA zero (${AUTHORIZED_ZERO_ORIGIN} / ${AUTHORIZED_ZERO_DISPOSITION}). The stored 0 was an import/default artifact with a blank canonical cell under ODS SHA-256 ${workbook.ods_sha256}, no source reference, no supporting audit evidence and no import snapshot establishing an explicit zero. The field now reads "not stated"; no VA was calculated or populated.`,
      changes: [
        {
          column: CONNECTED_VA_ZERO_COLUMN,
          before: String(freshValue ?? ""),
          after: null,
        },
      ],
    });

    push({
      row_uuid: c.load.id,
      live_connected_va: freshValue,
      status: "applied",
      applied_at: appliedAt,
    });
    changed++;
  }

  return {
    applied: data.confirm,
    changed,
    skipped,
    generated_at,
    baseline: {
      ods_file_name: workbook.ods_file_name,
      ods_sha256: workbook.ods_sha256,
      expected_sha256: PHASE_44A_BASELINE_SHA256,
      authorized: workbook.guard.ok,
      reason: workbook.guard.ok ? null : workbook.guard.reason,
    },
    rows,
    summary: summarizeConnectedVaZeroGate(rows, {
      authorized_rows: authorized.size,
      baseline_ods_file: workbook.ods_file_name,
      baseline_sha256: workbook.ods_sha256,
      baseline_authorized: workbook.guard.ok,
    }),
  };
}

export const previewConnectedVaZeroCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parseOdsBaselineInput(d))
  .handler(async ({ context, data }): Promise<ConnectedVaZeroGateResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const workbook = await workbookFromUpload(data);
    return runGate(
      context.supabase as unknown as LooseDb,
      context.userId,
      context.supabase,
      workbook,
      { confirm: false, approved: [] },
    );
  });

export const applyConnectedVaZeroCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    parseOdsBaselineInput(d);
    return inputSchema.parse({ ...(d as object), confirm: true });
  })
  .handler(async ({ context, data }): Promise<ConnectedVaZeroGateResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const workbook = await workbookFromUpload(data);
    if (!workbook.guard.ok) {
      // Hard refusal before any row is read: canonical evidence from another
      // workbook may never authorize a production write.
      throw new Error(workbook.guard.reason);
    }
    return runGate(
      context.supabase as unknown as LooseDb,
      context.userId,
      context.supabase,
      workbook,
      { confirm: true, approved: data.approved },
    );
  });
