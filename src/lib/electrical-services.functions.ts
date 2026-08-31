// Server functions for utility services, their configuration revisions, the
// panels each revision feeds, and service interties. Thin wrappers: every rule
// lives in `electrical-services.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAddon } from "@/lib/addons.server";
import {
  INTERTIE_LIFECYCLE_STATES,
  SERVICE_LIFECYCLE_STATES,
  checkIntertieId,
  checkServiceId,
  planCommissionIntertieConfiguration,
  planCommissionServiceConfiguration,
  validateServiceState,
  type Row,
} from "@/lib/electrical-services";

type LooseDb = { from: (table: string) => any };

const SERVICES = "electrical_services";
const CONFIGS = "electrical_service_configurations";
const SERVICE_PANELS = "electrical_service_panels";
const INTERTIES = "electrical_interties";
const INTERTIE_CONFIGS = "electrical_intertie_configurations";

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();
const nullableNumber = z.number().min(0).max(100000).nullable().optional();
const nullableDate = z.string().trim().max(10).nullable().optional();

async function rows(db: LooseDb, table: string, order: string): Promise<Row[]> {
  const { data, error } = await db.from(table).select("*").order(order);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

/** Everything the services page needs, plus current-state QA findings. */
export const serviceState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const [services, configs, servicePanels, interties, intertieConfigs, panels] =
      await Promise.all([
        rows(db, SERVICES, "service_id"),
        rows(db, CONFIGS, "created_at"),
        rows(db, SERVICE_PANELS, "sequence"),
        rows(db, INTERTIES, "intertie_id"),
        rows(db, INTERTIE_CONFIGS, "created_at"),
        rows(db, "electrical_panels", "panel_id"),
      ]);
    return {
      services,
      configs,
      servicePanels,
      interties,
      intertieConfigs,
      panels,
      findings: validateServiceState({ services, configs, interties, intertieConfigs }),
    };
  });

export const saveService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        service_id: z.string().trim().min(1).max(40),
        name: text(160),
        site_code: text(20),
        building: text(80),
        utility_account: text(80),
        notes: text(4000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const serviceId = data.service_id.trim().toUpperCase();
    const check = checkServiceId(serviceId);
    if (!check.ok) throw new Error(check.error);
    const payload = { ...data, service_id: serviceId, user_id: context.userId };
    delete (payload as Record<string, unknown>)["id"];
    if (data.id) {
      const { error } = await db.from(SERVICES).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await db.from(SERVICES).insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: String((inserted as Row)["id"]) };
  });

export const saveServiceConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        service_uuid: z.string().uuid(),
        lifecycle_state: z.enum(SERVICE_LIFECYCLE_STATES as unknown as [string, ...string[]]),
        revision_label: text(120),
        ampacity_amps: nullableNumber,
        voltage: text(40),
        phase: text(40),
        service_equipment: text(240),
        meter_arrangement: text(240),
        entry_point: text(240),
        effective_date: nullableDate,
        commissioned_date: nullableDate,
        notes: text(4000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { data: service, error: svcError } = await db
      .from(SERVICES)
      .select("service_id")
      .eq("id", data.service_uuid)
      .maybeSingle();
    if (svcError) throw new Error(svcError.message);
    const payload: Record<string, unknown> = {
      ...data,
      service_ref: (service as Row | null)?.["service_id"] ?? null,
      user_id: context.userId,
    };
    delete payload["id"];
    // A revision only becomes current through the explicit commission step.
    if (data.id) {
      const { error } = await db.from(CONFIGS).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await db.from(CONFIGS).insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: String((inserted as Row)["id"]) };
  });

/**
 * Explicit lifecycle transition. Until it runs, a planned 400 A revision stays
 * a stored design and current-state QA keeps evaluating the existing topology.
 */
export const commissionServiceConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), date: nullableDate }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { data: target, error: tErr } = await db
      .from(CONFIGS)
      .select("service_uuid")
      .eq("id", data.id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    const serviceUuid = (target as Row | null)?.["service_uuid"];
    if (!serviceUuid) throw new Error("Configuration revision not found.");
    const { data: siblings, error } = await db
      .from(CONFIGS)
      .select("*")
      .eq("service_uuid", serviceUuid);
    if (error) throw new Error(error.message);
    const patches = planCommissionServiceConfiguration(
      (siblings ?? []) as Row[],
      data.id,
      data.date ? { date: data.date } : {},
    );
    // Retire the outgoing revisions first so the one-current index never trips.
    for (const p of patches.filter((x) => x.id !== data.id)) {
      const { error: uErr } = await db.from(CONFIGS).update(p.patch).eq("id", p.id);
      if (uErr) throw new Error(uErr.message);
    }
    const own = patches.find((x) => x.id === data.id);
    if (own) {
      const { error: uErr } = await db.from(CONFIGS).update(own.patch).eq("id", data.id);
      if (uErr) throw new Error(uErr.message);
    }
    return { patches };
  });

export const deleteServiceConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { data: row, error } = await db
      .from(CONFIGS)
      .select("is_current")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if ((row as Row | null)?.["is_current"] === true) {
      throw new Error(
        "The current as-built configuration cannot be deleted. Commission a replacement revision first — history is retired, never removed.",
      );
    }
    const { error: dErr } = await db.from(CONFIGS).delete().eq("id", data.id);
    if (dErr) throw new Error(dErr.message);
    return { ok: true };
  });

/** Panel membership belongs to a revision, so topology can be redesigned. */
export const saveServicePanelLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        service_config_uuid: z.string().uuid(),
        panel_uuid: nullableUuid,
        panel_ref: text(60),
        role: text(60),
        sequence: z.number().int().min(1).max(999).nullable().optional(),
        notes: text(2000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const payload: Record<string, unknown> = { ...data, user_id: context.userId };
    delete payload["id"];
    if (data.id) {
      const { error } = await db.from(SERVICE_PANELS).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await db
      .from(SERVICE_PANELS)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: String((inserted as Row)["id"]) };
  });

export const deleteServicePanelLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { error } = await db.from(SERVICE_PANELS).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveIntertie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        intertie_id: z.string().trim().min(1).max(60),
        name: text(160),
        notes: text(4000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const tieId = data.intertie_id.trim().toUpperCase();
    const check = checkIntertieId(tieId);
    if (!check.ok) throw new Error(check.error);
    const payload: Record<string, unknown> = {
      ...data,
      intertie_id: tieId,
      user_id: context.userId,
    };
    delete payload["id"];
    if (data.id) {
      const { error } = await db.from(INTERTIES).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await db.from(INTERTIES).insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: String((inserted as Row)["id"]) };
  });

export const saveIntertieConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        intertie_uuid: z.string().uuid(),
        lifecycle_state: z.enum(INTERTIE_LIFECYCLE_STATES as unknown as [string, ...string[]]),
        revision_label: text(120),
        endpoint_a_service_uuid: nullableUuid,
        endpoint_b_service_uuid: nullableUuid,
        endpoint_a_panel_uuid: nullableUuid,
        endpoint_b_panel_uuid: nullableUuid,
        transfer_method: text(240),
        isolation_method: text(240),
        capacity_amps: nullableNumber,
        normal_state: text(120),
        permitted_states: text(2000),
        effective_date: nullableDate,
        commissioned_date: nullableDate,
        notes: text(4000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const payload: Record<string, unknown> = { ...data, user_id: context.userId };
    delete payload["id"];
    if (data.id) {
      const { error } = await db.from(INTERTIE_CONFIGS).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await db
      .from(INTERTIE_CONFIGS)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: String((inserted as Row)["id"]) };
  });

export const commissionIntertieConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), date: nullableDate }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAddon(context.supabase, context.userId, "electrical");
    const db = context.supabase as unknown as LooseDb;
    const { data: target, error: tErr } = await db
      .from(INTERTIE_CONFIGS)
      .select("intertie_uuid")
      .eq("id", data.id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    const tieUuid = (target as Row | null)?.["intertie_uuid"];
    if (!tieUuid) throw new Error("Intertie revision not found.");
    const { data: siblings, error } = await db
      .from(INTERTIE_CONFIGS)
      .select("*")
      .eq("intertie_uuid", tieUuid);
    if (error) throw new Error(error.message);
    const patches = planCommissionIntertieConfiguration(
      (siblings ?? []) as Row[],
      data.id,
      data.date ? { date: data.date } : {},
    );
    for (const p of patches.filter((x) => x.id !== data.id)) {
      const { error: uErr } = await db.from(INTERTIE_CONFIGS).update(p.patch).eq("id", p.id);
      if (uErr) throw new Error(uErr.message);
    }
    const own = patches.find((x) => x.id === data.id);
    if (own) {
      const { error: uErr } = await db.from(INTERTIE_CONFIGS).update(own.patch).eq("id", data.id);
      if (uErr) throw new Error(uErr.message);
    }
    return { patches };
  });
