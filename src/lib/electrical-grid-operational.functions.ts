// Farm Shop operational install-location feed + audited field-verification write.
//
// The read path never writes. The write path only touches FarmOps operational /
// as-built columns on loads and panels (as-built grid, X/Y, precision,
// verification status, evidence, notes, verified_at) and records the previous
// value in immutable audit history. Design location is stored separately and is
// never replaced by an as-built observation. The canonical ODS is never written.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import {
  buildOperationalAssets,
  summarizeOperational,
  PLACEMENT_SOURCE_LABEL,
  PLACEMENT_SOURCE_ORDER,
  VERIFICATION_STATUSES,
  verificationOf,

  type AssetKind,
  type OperationalAsset,
  type OperationalInput,
  type PendingObservation,
  type OperationalSummary,
} from "@/lib/electrical-grid-operational";

type LooseDb = { from: (table: string) => any };
type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const str = (v: unknown): string | null => {
  const t = s(v);
  return t ? t : null;
};
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const FARM_SHOP = /farm\s*shop/i;
const isShopText = (v: unknown) => FARM_SHOP.test(s(v));

export interface OperationalPayload {
  generated_at: string;
  assets: OperationalAsset[];
  summary: OperationalSummary;
  panels: { panel: string; count: number; basis: string }[];
  gaps: string[];
}

function baseInput(kind: AssetKind, row: Row, id: string): OperationalInput {
  return {
    kind,
    stableId: id,
    description: str(row["description"]),
    grid: str(row["grid"]),
    designGrid: str(row["design_grid"]),
    legacyGrid: str(row["legacy_grid"]),
    gridReference: str(row["grid_reference"]),
    storedPrecision: str(row["grid_reference_precision"]),
    xFt: num(row["location_x_ft"]),
    yFt: num(row["location_y_ft"]),
    designXFt: num(row["design_x_ft"]),
    designYFt: num(row["design_y_ft"]),
    installStatus: str(row["install_status"]),
    verification: str(row["field_verification_status"]),
    verificationNotes: str(row["verification_notes"]),
    locationEvidence: str(row["location_evidence"]),
    verifiedAt: str(row["verified_at"]),
    updatedAt: str(row["updated_at"]),
    location: str(row["location"]) ?? str(row["building"]) ?? str(row["location_note"]),
    panel: null,
    panelBasis: null,
    circuitClass: null,
    circuitClassBasis: null,
    fieldGridReference: str(row["field_grid_reference"]),
    poleScheme: str(row["pole_scheme"]),
    poleLocationKind: str(row["pole_location_kind"]),
    poleRefStart: str(row["pole_ref_start"]),
    poleRefEnd: str(row["pole_ref_end"]),
    pendingObservation: null,
  };
}

/** Location columns an applied audit writes onto a record. */
const OBSERVED_LOCATION_COLS =
  "field_grid_reference, pole_scheme, pole_location_kind, pole_ref_start, pole_ref_end";

/**
 * Staged field observations: audit-batch items that state a location but have not
 * been approved or applied. They are read only to show a clearly separate pending
 * layer; nothing here is written to any record.
 */
async function pendingObservations(db: LooseDb): Promise<Map<string, PendingObservation>> {
  const out = new Map<string, PendingObservation>();
  const [batches, items] = await Promise.all([
    db
      .from("electrical_audit_batches")
      .select("id, batch_id, status, observed_date, applied_at"),
    db
      .from("electrical_audit_batch_items")
      .select(
        "batch_uuid, item_key, target_stable_id, payload, approved, applied_at, disposition, created_at",
      )
      .order("created_at"),
  ]);
  if (batches.error || items.error) return out;
  const batchById = new Map<string, Row>();
  for (const b of (batches.data ?? []) as Row[]) batchById.set(s(b["id"]), b);

  for (const it of (items.data ?? []) as Row[]) {
    if (it["approved"] === true || s(it["applied_at"])) continue;
    const target = s(it["target_stable_id"]);
    if (!target) continue;
    const batch = batchById.get(s(it["batch_uuid"]));
    if (!batch || s(batch["applied_at"])) continue;
    const payload = (it["payload"] ?? {}) as Row;
    const grid = str(payload["field_grid_reference"]);
    const kind = str(payload["pole_location_kind"]);
    if (!grid && !kind) continue;
    out.set(target, {
      batchId: s(batch["batch_id"]) || s(batch["id"]),
      itemKey: s(it["item_key"]),
      fieldGridReference: grid,
      poleScheme: str(payload["pole_scheme"]),
      poleLocationKind: kind,
      poleRefStart: str(payload["pole_ref_start"]),
      poleRefEnd: str(payload["pole_ref_end"]),
      observedAt: str(batch["observed_date"]),
      evidence: str(payload["location_evidence"]),
    });
  }
  return out;
}


export const electricalGridOperational = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperationalPayload> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;

    const [loads, panels, groups, positions, jboxes, devices, assets, racks, raceways] =
      await Promise.all([
        db
          .from("electrical_loads")
          .select(
            "id, load_id, description, area, location, grid, design_grid, design_x_ft, design_y_ft, legacy_grid, grid_reference, grid_reference_precision, location_x_ft, location_y_ft, install_status, field_verification_status, verification_notes, location_evidence, verified_at, updated_at, " +
            OBSERVED_LOCATION_COLS +
            ", dedicated, dedicated_shared, circuit_group_ref, circuit_group_uuid, suggested_panel",
          )
          .order("load_id"),
        db
          .from("electrical_panels")
          .select(
            "id, panel_id, description, building, grid, design_grid, design_x_ft, design_y_ft, legacy_grid, grid_reference, grid_reference_precision, location_x_ft, location_y_ft, install_status, field_verification_status, verification_notes, location_evidence, verified_at, updated_at, " +
            OBSERVED_LOCATION_COLS,
          )
          .order("panel_id"),
        db.from("electrical_circuit_groups").select("id, circuit_group_id, panel_uuid"),
        db.from("electrical_breaker_positions").select("panel_uuid, load_uuid, circuit_group_uuid"),
        db
          .from("electrical_junction_boxes")
          .select(
            "jbox_id, description, building, grid, install_status, updated_at, " +
              OBSERVED_LOCATION_COLS,
          ),
        db
          .from("electrical_devices")
          .select("device_id, description, building, location_note, grid, install_status, updated_at"),
        db
          .from("electrical_power_assets")
          .select(
            "power_asset_id, description, building, location_note, grid, install_status, updated_at",
          ),
        db
          .from("electrical_racks")
          .select(
            "rack_id, description, building, site_area, location_note, grid, install_status, updated_at",
          ),
        db
          .from("electrical_raceways")
          .select(
            "conduit_id, description, source_building, dest_building, source_grid, dest_grid, install_status, updated_at",
          ),
      ]);
    for (const r of [loads, panels, groups, positions, jboxes, devices, assets, racks, raceways]) {
      if (r.error) throw new Error(r.error.message);
    }

    const panelById = new Map<string, string>();
    for (const p of (panels.data ?? []) as Row[]) panelById.set(s(p["id"]), s(p["panel_id"]));
    const groupById = new Map<string, Row>();
    for (const g of (groups.data ?? []) as Row[]) groupById.set(s(g["id"]), g);
    const posByLoad = new Map<string, Row>();
    const posByGroup = new Map<string, Row>();
    for (const p of (positions.data ?? []) as Row[]) {
      if (s(p["load_uuid"])) posByLoad.set(s(p["load_uuid"]), p);
      if (s(p["circuit_group_uuid"])) posByGroup.set(s(p["circuit_group_uuid"]), p);
    }

    const inputs: OperationalInput[] = [];

    for (const row of (loads.data ?? []) as Row[]) {
      const id = s(row["load_id"]);
      if (!(id.toUpperCase().startsWith("FS-") || isShopText(row["area"]))) continue;
      const group = groupById.get(s(row["circuit_group_uuid"])) ?? null;
      const pos =
        posByLoad.get(s(row["id"])) ?? (group ? posByGroup.get(s(group["id"])) : undefined) ?? null;
      let panel: string | null = null;
      let panelBasis: string | null = null;
      if (group && panelById.get(s(group["panel_uuid"]))) {
        panel = panelById.get(s(group["panel_uuid"]))!;
        panelBasis = `Proven: circuit ${s(group["circuit_group_id"]) || "group"} → panel.`;
      } else if (pos && panelById.get(s(pos["panel_uuid"]))) {
        panel = panelById.get(s(pos["panel_uuid"]))!;
        panelBasis = "Proven: breaker position → panel.";
      } else if (s(row["suggested_panel"])) {
        panel = s(row["suggested_panel"]);
        panelBasis = "Design intent only (Suggested Panel); no proven breaker relationship.";
      }
      const ds = s(row["dedicated_shared"]).toUpperCase();
      inputs.push({
        ...baseInput("load", row, id),
        panel,
        panelBasis,
        circuitClass: ds || (row["dedicated"] === true ? "D" : row["dedicated"] === false ? "S" : null),
        circuitClassBasis: ds
          ? "Dedicated/Shared as recorded."
          : "Dedicated/Shared derived from the Dedicated flag; blank when neither is in the record.",
      });
    }

    for (const row of (panels.data ?? []) as Row[]) {
      const id = s(row["panel_id"]);
      if (!(id.toUpperCase().startsWith("PNL-FS") || isShopText(row["building"]))) continue;
      inputs.push({ ...baseInput("panel", row, id), panel: id, panelBasis: "Panel record." });
    }

    const simple: [AssetKind, Row[], string, string[]][] = [
      ["junction_box", (jboxes.data ?? []) as Row[], "jbox_id", ["building"]],
      ["device", (devices.data ?? []) as Row[], "device_id", ["building", "location_note"]],
      [
        "power_asset",
        (assets.data ?? []) as Row[],
        "power_asset_id",
        ["building", "location_note"],
      ],
      ["rack", (racks.data ?? []) as Row[], "rack_id", ["building", "site_area", "location_note"]],
    ];
    for (const [kind, rows, idField, shopFields] of simple) {
      for (const row of rows) {
        const id = s(row[idField]);
        if (!id) continue;
        const inShop =
          shopFields.some((f) => isShopText(row[f])) || /-FS-|^FS-/.test(id.toUpperCase());
        if (!inShop) continue;
        inputs.push(baseInput(kind, row, id));
      }
    }

    for (const row of (raceways.data ?? []) as Row[]) {
      const id = s(row["conduit_id"]);
      if (!id) continue;
      const inShop =
        isShopText(row["source_building"]) ||
        isShopText(row["dest_building"]) ||
        /-FS-|^FS-/.test(id.toUpperCase());
      if (!inShop) continue;
      // A raceway is plotted at its source end; the destination grid is shown
      // in the detail panel rather than being averaged into a fake midpoint.
      inputs.push({
        ...baseInput("raceway", row, id),
        grid: str(row["source_grid"]),
        location: [str(row["source_building"]), str(row["dest_building"])]
          .filter(Boolean)
          .join(" → "),
        verificationNotes: str(row["dest_grid"])
          ? `Destination grid in record: ${s(row["dest_grid"])}`
          : null,
      });
    }

    const pending = await pendingObservations(db);
    for (const input of inputs) {
      const p = pending.get(input.stableId);
      if (p) input.pendingObservation = p;
    }

    const built = buildOperationalAssets(inputs);
    const summary = summarizeOperational(built);


    const panelCounts = new Map<string, { count: number; basis: string }>();
    for (const a of built) {
      const key = a.panel ?? "NOT IN RECORD";
      const cur = panelCounts.get(key) ?? {
        count: 0,
        basis: a.panelBasis ?? "No panel relationship in the record.",
      };
      cur.count += 1;
      panelCounts.set(key, cur);
    }
    const panelList = [...panelCounts.entries()]
      .map(([panel, v]) => ({ panel, count: v.count, basis: v.basis }))
      .sort((a, b) =>
        a.panel === "NOT IN RECORD" ? 1 : b.panel === "NOT IN RECORD" ? -1 : a.panel.localeCompare(b.panel),
      );

    const gaps: string[] = [];
    if (summary.precision.UNRESOLVED) {
      gaps.push(
        `${summary.precision.UNRESOLVED} record(s) have no usable install location and are deliberately not plotted.`,
      );
    }
    if (summary.precision.NON_FIXED) {
      gaps.push(
        `${summary.precision.NON_FIXED} record(s) are mobile / non-fixed and stay unplotted until they are explicitly converted to a permanent installation.`,
      );
    }
    if (summary.precision.INTERVAL) {
      gaps.push(
        `${summary.precision.INTERVAL} record(s) keep an interval location — the dot marks the span, not a final install point.`,
      );
    }
    if (!summary.placementSources.VERIFIED_FIELD_OBSERVATION_XY) {
      const reviewed = built.filter(
        (a) => verificationOf(a.verification) !== "NOT_REVIEWED",
      ).length;
      gaps.push(
        reviewed
          ? `${reviewed} record(s) in this FarmOps instance's database carry a field verification, but none of them stores a verified X/Y coordinate, so plotted positions still come from the accepted grid assignment. A verified grid reference (for example A1–F9 or a post callout) fixes the record to that grid cell, not to a measured point. Another deployment (for example a self-hosted copy) has its own database and may already hold an applied field audit.`
          : "This FarmOps instance's database holds no applied field verification for the Farm Shop — no verified X/Y and no verified grid reference — so every plotted position here comes from the accepted grid assignment. A completed walkaround only changes this instance once its audit batch is imported and applied here; another deployment (for example a self-hosted copy) has its own database and may already show it as applied.",
      );

    }

    if (summary.placementSources.PROVISIONAL_RECORDED_XY) {
      gaps.push(
        `${summary.placementSources.PROVISIONAL_RECORDED_XY} record(s) are plotted from provisional, unverified X/Y because the record carries no accepted grid assignment. They need field verification before the coordinates are treated as installed.`,
      );
    }
    if (summary.placementDisagreements) {
      gaps.push(
        `${summary.placementDisagreements} record(s) have disagreeing placement sources (recorded X/Y vs accepted grid vs canonical/recovery-derived). Nothing was overwritten; each is listed with every available value and the source that was selected.`,
      );
    }
    if (summary.placementSources.PENDING_FIELD_OBSERVATION) {
      gaps.push(
        `${summary.placementSources.PENDING_FIELD_OBSERVATION} record(s) are plotted from a field observation that is still staged in an audit batch — not approved and not applied. They are drawn as a separate pending layer and stay provisional until each item is approved.`,
      );
    }
    {
      const postOnly = inputs.filter((i) => {
        const applied = (i.poleLocationKind ?? "").trim();
        const staged = (i.pendingObservation?.poleLocationKind ?? "").trim();
        const kind = applied || staged;
        const grid = (i.fieldGridReference ?? i.pendingObservation?.fieldGridReference ?? "").trim();
        return !!kind && kind !== "NOT_APPLICABLE" && !grid;
      }).length;
      if (postOnly && !POST_GEOMETRY_CONFIRMED) {
        gaps.push(
          `${postOnly} record(s) state only a perimeter post callout. ${POST_GEOMETRY_REVIEW_NOTE}`,
        );
      }
    }
    gaps.push(POST_GEOMETRY_REVIEW_NOTE);
    gaps.push(
      `Placement source counts: ${PLACEMENT_SOURCE_ORDER.filter((k) => summary.placementSources[k])

        .map((k) => `${PLACEMENT_SOURCE_LABEL[k]} ${summary.placementSources[k]}`)
        .join(" · ")}.`,
    );

    return {
      generated_at: new Date().toISOString(),
      assets: built,
      summary,
      panels: panelList,
      gaps,
    };
  });

/* ------------------------------------------------- field-verification write */

const TABLE: Record<"load" | "panel", { table: string; idField: string }> = {
  load: { table: "electrical_loads", idField: "load_id" },
  panel: { table: "electrical_panels", idField: "panel_id" },
};

const verifySchema = z.object({
  kind: z.enum(["load", "panel"]),
  stable_id: z.string().trim().min(1).max(60),
  field_verification_status: z.enum(
    VERIFICATION_STATUSES as unknown as [string, ...string[]],
  ),
  /** As-built install location observed in the field. */
  as_built_grid: z.string().trim().max(30).optional(),
  as_built_x_ft: z.number().finite().min(0).max(200).nullable().optional(),
  as_built_y_ft: z.number().finite().min(0).max(200).nullable().optional(),
  precision: z
    .enum(["EXACT", "NEAREST", "INTERVAL", "GRIDLINE", "NON_FIXED", "UNRESOLVED"])
    .optional(),
  location_evidence: z.string().trim().min(4).max(2000),
  verification_notes: z.string().trim().max(2000).optional(),
});

export interface VerificationWriteResult {
  stable_id: string;
  written: Record<string, string | null>;
  previous: Record<string, string | null>;
}

export const saveGridFieldVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => verifySchema.parse(d))
  .handler(async ({ context, data }): Promise<VerificationWriteResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const cfg = TABLE[data.kind];

    const { data: existing, error: readErr } = await db
      .from(cfg.table)
      .select(
        `id, ${cfg.idField}, grid, design_grid, design_x_ft, design_y_ft, legacy_grid, grid_reference, grid_reference_precision, location_x_ft, location_y_ft, field_verification_status, verification_notes, location_evidence, verified_at, install_status`,
      )
      .eq(cfg.idField, data.stable_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error(`${data.stable_id} is not in the record.`);
    const before = existing as Row;

    const mobile = data.field_verification_status === "INTENTIONALLY_MOBILE";
    const notInstalled = data.field_verification_status === "NOT_YET_INSTALLED";

    const patch: Record<string, unknown> = {
      field_verification_status: data.field_verification_status,
      location_evidence: data.location_evidence,
      verification_notes: data.verification_notes ?? before["verification_notes"] ?? null,
      verified_at: new Date().toISOString(),
    };

    // Mobile equipment keeps no fixed install point, and a not-yet-installed
    // record keeps its design location untouched — its as-built fields stay
    // empty until it is actually installed.
    if (mobile) {
      patch["grid_reference_precision"] = "NON_FIXED";
      patch["location_x_ft"] = null;
      patch["location_y_ft"] = null;
    } else if (!notInstalled) {
      if (data.as_built_grid) patch["grid"] = data.as_built_grid;
      if (data.as_built_x_ft !== undefined) patch["location_x_ft"] = data.as_built_x_ft;
      if (data.as_built_y_ft !== undefined) patch["location_y_ft"] = data.as_built_y_ft;
      if (data.precision) patch["grid_reference_precision"] = data.precision;
    }

    // Design intent is preserved the first time an as-built value appears, so
    // the two locations stay visibly distinct.
    if (!before["design_grid"] && before["grid"]) patch["design_grid"] = before["grid"];
    if (before["design_x_ft"] == null && before["location_x_ft"] != null) {
      patch["design_x_ft"] = before["location_x_ft"];
      patch["design_y_ft"] = before["location_y_ft"];
    }

    const { error: upErr } = await db
      .from(cfg.table)
      .update(patch)
      .eq("id", s(before["id"]));
    if (upErr) throw new Error(upErr.message);

    const previous: Record<string, string | null> = {};
    for (const key of Object.keys(patch)) {
      previous[key] = before[key] == null ? null : String(before[key]);
    }

    await recordElectricalChange(context.supabase, context.userId, {
      section: "grid_field_verification",
      entityKind: data.kind,
      action: "update",
      entityUuid: s(before["id"]),
      entityRef: data.stable_id,
      summary: `Farm Shop install location verification for ${data.stable_id}: ${data.field_verification_status}. Evidence: ${data.location_evidence}. Design location preserved separately; canonical ODS untouched.`,
      changes: Object.keys(patch).map((column) => ({
        column,
        before: previous[column] ?? null,
        after: patch[column] == null ? null : String(patch[column]),
      })),
    });

    const written: Record<string, string | null> = {};
    for (const key of Object.keys(patch)) {
      written[key] = patch[key] == null ? null : String(patch[key]);
    }
    return { stable_id: data.stable_id, written, previous };
  });
