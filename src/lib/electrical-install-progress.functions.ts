// Install progress: record what is actually installed — panel status, breaker
// positions, circuits, and which loads are wired to which circuit. Every write
// is additive/updating on the authoritative electrical tables so
// /electrical/wiring and the critical-load study read real data.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { stageCompletionPercent } from "@/lib/electrical-lifecycle";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";

export const INSTALL_STATUSES = [
  "planned",
  "material_ready",
  "rough_in_started",
  "raceway_installed",
  "conductors_installed",
  "device_side_connected",
  "source_side_connected",
  "tested",
  "complete",
  "as_built_verified",
] as const;

export const LABEL_STATUSES = ["none", "queued", "printed", "installed", "reprint"] as const;

export interface InstallPanel {
  id: string;
  panel_id: string;
  description: string | null;
  building: string | null;
  install_status: string | null;
  completion_percent: number | null;
  label_status: string | null;
  spaces: number | null;
  notes: string | null;
}

export interface InstallCircuit {
  id: string;
  circuit_group_id: string;
  description: string | null;
  panel_uuid: string | null;
  breaker_number: number | null;
  circuit_rating_amps: number | null;
  voltage: number | null;
  install_status: string | null;
  completion_percent: number | null;
  notes: string | null;
}

export interface InstallPosition {
  id: string;
  panel_uuid: string;
  side: string;
  position: number;
  poles: number;
  breaker_number: number | null;
  ocp_amps: number | null;
  label: string | null;
  circuit_group_uuid: string | null;
  install_status: string | null;
  notes: string | null;
}

export interface InstallLoad {
  id: string;
  load_id: string | null;
  description: string | null;
  area: string | null;
  suggested_panel: string | null;
  circuit_group_uuid: string | null;
  install_status: string | null;
}

export interface InstallProgressSnapshot {
  panels: InstallPanel[];
  circuits: InstallCircuit[];
  positions: InstallPosition[];
  loads: InstallLoad[];
}

type LooseDb = { from: (table: string) => any };

const statusEnum = z.enum(INSTALL_STATUSES);
const labelEnum = z.enum(LABEL_STATUSES);
const optNum = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  });
const optText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v == null || v === "" ? null : v));

/** Everything the install page needs, scoped to the signed-in owner. */
export const loadInstallProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InstallProgressSnapshot> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const db = context.supabase as unknown as LooseDb;
    const panels = await db
      .from("electrical_panels")
      .select(
        "id,panel_id,description,building,install_status,completion_percent,label_status,spaces,notes",
      )
      .order("panel_id");
    if (panels.error) throw new Error(panels.error.message);
    const circuits = await db
      .from("electrical_circuit_groups")
      .select(
        "id,circuit_group_id,description,panel_uuid,breaker_number,circuit_rating_amps,voltage,install_status,completion_percent,notes",
      )
      .order("circuit_group_id");
    if (circuits.error) throw new Error(circuits.error.message);
    const positions = await db
      .from("electrical_breaker_positions")
      .select(
        "id,panel_uuid,side,position,poles,breaker_number,ocp_amps,label,circuit_group_uuid,install_status,notes",
      )
      .order("position");
    if (positions.error) throw new Error(positions.error.message);
    const loads = await db
      .from("electrical_loads")
      .select("id,load_id,description,area,suggested_panel,circuit_group_uuid,install_status")
      .order("load_id");
    if (loads.error) throw new Error(loads.error.message);
    return {
      panels: (panels.data ?? []) as InstallPanel[],
      circuits: (circuits.data ?? []) as InstallCircuit[],
      positions: (positions.data ?? []) as InstallPosition[],
      loads: (loads.data ?? []) as InstallLoad[],
    };
  });

/** Record installed state on a panel. */
export const savePanelInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        panelUuid: z.string().uuid(),
        installStatus: statusEnum,
        labelStatus: labelEnum.optional(),
        completionPercent: optNum,
        spaces: optNum,
        notes: optText,
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const patch: Record<string, unknown> = { install_status: data.installStatus };
    if (data.labelStatus) patch.label_status = data.labelStatus;
    // Complete % always mirrors the recorded stage.
    patch.completion_percent = stageCompletionPercent(data.installStatus) ?? data.completionPercent;
    if (data.spaces != null) patch.spaces = data.spaces;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await db
      .from("electrical_panels")
      .update(patch)
      .eq("id", data.panelUuid)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Create or update an installed circuit on a panel. */
export const saveCircuitInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        circuitUuid: z.string().uuid().optional(),
        panelUuid: z.string().uuid(),
        circuitGroupId: z.string().trim().min(1).max(60),
        description: optText,
        breakerNumber: optNum,
        ratingAmps: optNum,
        voltage: optNum,
        installStatus: statusEnum,
        completionPercent: optNum,
        notes: optText,
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const row: Record<string, unknown> = {
      user_id: context.userId,
      circuit_group_id: data.circuitGroupId,
      description: data.description,
      panel_uuid: data.panelUuid,
      breaker_number: data.breakerNumber,
      circuit_rating_amps: data.ratingAmps,
      voltage: data.voltage,
      install_status: data.installStatus,
      notes: data.notes,
    };
    if (data.completionPercent != null) row.completion_percent = data.completionPercent;

    if (data.circuitUuid) {
      const { error } = await db
        .from("electrical_circuit_groups")
        .update(row)
        .eq("id", data.circuitUuid)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { id: data.circuitUuid };
    }
    const { data: inserted, error } = await db
      .from("electrical_circuit_groups")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

/** Create or update one breaker position in a panel. */
export const saveBreakerPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        positionUuid: z.string().uuid().optional(),
        panelUuid: z.string().uuid(),
        side: z.enum(["Left", "Right"]),
        position: z.coerce.number().int().min(1).max(200),
        poles: z.coerce.number().int().min(1).max(3),
        breakerNumber: optNum,
        ocpAmps: optNum,
        label: optText,
        circuitGroupUuid: z.string().uuid().nullish(),
        installStatus: statusEnum,
        notes: optText,
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const row: Record<string, unknown> = {
      user_id: context.userId,
      panel_uuid: data.panelUuid,
      side: data.side,
      position: data.position,
      poles: data.poles,
      breaker_number: data.breakerNumber,
      ocp_amps: data.ocpAmps,
      label: data.label,
      circuit_group_uuid: data.circuitGroupUuid ?? null,
      install_status: data.installStatus,
      notes: data.notes,
    };
    if (data.positionUuid) {
      const { error } = await db
        .from("electrical_breaker_positions")
        .update(row)
        .eq("id", data.positionUuid)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { id: data.positionUuid };
    }
    const { data: inserted, error } = await db
      .from("electrical_breaker_positions")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (inserted as { id: string }).id };
  });

/** Wire loads to a circuit (or clear the link when circuitUuid is null). */
export const wireLoadsToCircuit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        circuitUuid: z.string().uuid().nullable(),
        loadUuids: z.array(z.string().uuid()).min(1).max(500),
        installStatus: statusEnum.optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ updated: number }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const patch: Record<string, unknown> = { circuit_group_uuid: data.circuitUuid };
    if (data.installStatus) patch.install_status = data.installStatus;
    const { error, count } = await db
      .from("electrical_loads")
      .update(patch, { count: "exact" })
      .in("id", data.loadUuids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { updated: count ?? data.loadUuids.length };
  });
