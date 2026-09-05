// FARMOPS-ELEC-DESIGN-TO-FIELD-V1 — authenticated read/preview/apply.
//
// Each step writes only its own narrow column set, one row at a time, after a
// fresh re-read that confirms the record has not changed since the preview.
// Every applied step also writes one history row, so the design submission and
// the later field acceptance are both reviewable side by side.
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import {
  DESIGN_STEP_COLUMNS,
  DESIGN_TO_FIELD_SECTION,
  DESIGN_TO_FIELD_VERSION,
  FIELD_STEP_COLUMNS,
  designPatch,
  effectiveLocationOf,
  fieldEvidencePatch,
  historyEvents,
  previewDesignStep,
  previewFieldStep,
  provenanceLine,
  stepSummary,
  validateDesignSubmission,
  validateFieldEvidence,
  type DesignToFieldRow,
  type HistoryEvent,
  type StepPreview,
} from "@/lib/electrical-design-to-field";

const SELECT = [
  "id",
  "load_id",
  "description",
  "install_status",
  "design_x_ft",
  "design_y_ft",
  "design_grid",
  "design_location_source",
  "grid_migration_provenance",
  "location_x_ft",
  "location_y_ft",
  "field_grid_reference",
  "grid_reference",
  "grid_reference_precision",
  "location_evidence",
  "field_verification_status",
  "verified_at",
  "legacy_grid",
  "grid",
  "corner_reference",
  "mounting_wall_face",
  "coverage_direction",
  "pole_scheme",
  "pole_location_kind",
  "pole_ref_start",
  "pole_ref_end",
  "updated_at",
].join(", ");

export interface DesignToFieldRecord {
  stableId: string;
  description: string | null;
  installStatus: string | null;
  designXFt: number | null;
  designYFt: number | null;
  designGrid: string | null;
  designApproval: string | null;
  fieldXFt: number | null;
  fieldYFt: number | null;
  fieldGrid: string | null;
  fieldEvidence: string | null;
  verifiedAt: string | null;
  effectiveSource: string | null;
  provenance: string;
  warnings: string[];
  needsAdjudication: boolean;
  updatedAt: string;
}

export interface DesignToFieldPayload {
  version: string;
  generatedAt: string;
  records: DesignToFieldRecord[];
  history: HistoryEvent[];
}

const shape = (row: DesignToFieldRow): DesignToFieldRecord => {
  const resolved = effectiveLocationOf(row);
  return {
    stableId: row.load_id,
    description: row.description,
    installStatus: row.install_status,
    designXFt: row.design_x_ft,
    designYFt: row.design_y_ft,
    designGrid: row.design_grid,
    designApproval: row.grid_migration_provenance,
    fieldXFt: row.location_x_ft,
    fieldYFt: row.location_y_ft,
    fieldGrid: row.field_grid_reference,
    fieldEvidence: row.location_evidence,
    verifiedAt: row.verified_at,
    effectiveSource: resolved.effective?.source ?? null,
    provenance: provenanceLine(row),
    warnings: resolved.warnings.map((w) => w.message),
    needsAdjudication: resolved.conflicts.length > 0,
    updatedAt: row.updated_at,
  };
};

async function readRows(db: {
  from: (t: string) => any;
}): Promise<DesignToFieldRow[]> {
  const { data, error } = await db
    .from("electrical_loads")
    .select(SELECT)
    .order("load_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DesignToFieldRow[];
}

async function readHistory(db: { from: (t: string) => any }): Promise<HistoryEvent[]> {
  const { data, error } = await db
    .from("electrical_change_audit")
    .select("id, entity_ref, created_at, actor_email, summary, changes")
    .eq("section", DESIGN_TO_FIELD_SECTION)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return historyEvents((data ?? []) as never);
}

/** Records, their derived effective location, and the change history. */
export const loadDesignToFieldWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DesignToFieldPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as { from: (t: string) => any };
    const [rows, history] = await Promise.all([readRows(db), readHistory(db)]);
    return {
      version: DESIGN_TO_FIELD_VERSION,
      generatedAt: new Date().toISOString(),
      records: rows.map(shape),
      history,
    };
  });

type StepInput = {
  stableId: string;
  xFt: number;
  yFt: number;
  /** Design step: who approved it. Field step: what was observed. */
  reference: string;
  observedAt?: string | null;
  confirm?: boolean;
};

const findRow = (rows: DesignToFieldRow[], stableId: string) =>
  rows.find((r) => (r.load_id ?? "").trim().toUpperCase() === stableId) ?? null;

async function stepHandler(
  context: { supabase: unknown; userId: string },
  data: StepInput,
  step: "design" | "field",
): Promise<{ preview: StepPreview; applied: boolean }> {
  await requireElectricalAccess(
    context.supabase,
    context.userId,
    step === "design" ? "write" : "field_write",
  );
  const db = context.supabase as unknown as { from: (t: string) => any };
  const rows = await readRows(db);

  if (step === "design") {
    const checked = validateDesignSubmission({
      stableId: data.stableId,
      xFt: data.xFt,
      yFt: data.yFt,
      approvalReference: data.reference,
    });
    if (!checked.ok) throw new Error(checked.error);
    const row = findRow(rows, checked.value.stableId);
    if (!row) throw new Error(`No electrical record with stable ID ${checked.value.stableId}.`);
    const preview = previewDesignStep(row, checked.value);
    if (!data.confirm || !preview.changes.length) return { preview, applied: false };

    const patch = designPatch(checked.value);
    for (const column of Object.keys(patch)) {
      if (!(DESIGN_STEP_COLUMNS as readonly string[]).includes(column)) {
        throw new Error(`Design step refused to write ${column}.`);
      }
    }
    const { data: written, error } = await db
      .from("electrical_loads")
      .update(patch)
      .eq("id", row.id)
      .eq("updated_at", preview.expectedUpdatedAt)
      .select("id");
    if (error) throw new Error(error.message);
    if (!written?.length) {
      throw new Error(
        "This record changed since the preview was built. Reload and review the values again.",
      );
    }
    await recordElectricalChange(context.supabase, context.userId, {
      section: DESIGN_TO_FIELD_SECTION,
      entityKind: "load",
      action: "update",
      entityUuid: row.id,
      entityRef: row.load_id,
      summary: stepSummary(preview),
      changes: preview.changes.map((c) => ({
        column: c.column,
        before: c.before === null ? null : String(c.before),
        after: c.after === null ? null : String(c.after),
      })),
    });
    return { preview, applied: true };
  }

  const checked = validateFieldEvidence({
    stableId: data.stableId,
    xFt: data.xFt,
    yFt: data.yFt,
    evidence: data.reference,
    observedAt: data.observedAt ?? null,
  });
  if (!checked.ok) throw new Error(checked.error);
  const row = findRow(rows, checked.value.stableId);
  if (!row) throw new Error(`No electrical record with stable ID ${checked.value.stableId}.`);
  const preview = previewFieldStep(row, checked.value);
  if (!data.confirm || !preview.changes.length) return { preview, applied: false };

  const patch = fieldEvidencePatch(checked.value);
  for (const column of Object.keys(patch)) {
    if (!(FIELD_STEP_COLUMNS as readonly string[]).includes(column)) {
      throw new Error(`Field-evidence step refused to write ${column}.`);
    }
  }
  const { data: written, error } = await db
    .from("electrical_loads")
    .update(patch)
    .eq("id", row.id)
    .eq("updated_at", preview.expectedUpdatedAt)
    .select("id");
  if (error) throw new Error(error.message);
  if (!written?.length) {
    throw new Error(
      "This record changed since the preview was built. Reload and review the values again.",
    );
  }
  await recordElectricalChange(context.supabase, context.userId, {
    section: DESIGN_TO_FIELD_SECTION,
    entityKind: "load",
    action: "update",
    entityUuid: row.id,
    entityRef: row.load_id,
    summary: stepSummary(preview),
    changes: preview.changes.map((c) => ({
      column: c.column,
      before: c.before === null ? null : String(c.before),
      after: c.after === null ? null : String(c.after),
    })),
  });
  return { preview, applied: true };
}

/** Step 1 — approved design coordinates. Preview unless `confirm` is true. */
export const submitApprovedDesign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StepInput) => input)
  .handler(async ({ data, context }) => stepHandler(context, data, "design"));

/** Step 2 — accepted field evidence. Preview unless `confirm` is true. */
export const acceptFieldEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StepInput) => input)
  .handler(async ({ data, context }) => stepHandler(context, data, "field"));
