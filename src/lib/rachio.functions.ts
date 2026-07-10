// User-facing server functions for the Rachio irrigation integration.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RachioConnectionStatus {
  connected: boolean;
  lastSyncAt: string | null;
  controllerCount: number;
  webhookUrl: string;
}

export interface RachioZoneRow {
  id: string;
  controller_id: string;
  controller_name: string | null;
  rachio_id: string;
  zone_number: number | null;
  name: string | null;
  enabled: boolean | null;
  nozzle: string | null;
  area_sqft: number | null;
  garden_plot_id: string | null;
  orchard_tree_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
}
export interface RachioControllerRow {
  id: string;
  rachio_id: string;
  name: string | null;
  model: string | null;
  serial_number: string | null;
  status: string | null;
  last_synced_at: string | null;
}
export interface RachioRunRow {
  id: string;
  zone_id: string;
  zone_name: string | null;
  rachio_event_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  gallons: number | null;
  source: string | null;
  status: string | null;
}

export interface RachioDashboard {
  status: RachioConnectionStatus;
  controllers: RachioControllerRow[];
  zones: RachioZoneRow[];
  runs: RachioRunRow[];
}

function publicWebhookUrl(): string {
  // PUBLIC_APP_URL should be the externally reachable origin of this app
  // (e.g. https://farm.example.com). Falls back to the hosted default.
  const base = process.env.PUBLIC_APP_URL || "https://bostead.lovable.app";
  return `${base.replace(/\/+$/, "")}/api/public/webhooks/rachio`;
}

export const getRachioConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RachioConnectionStatus> => {
    const { getRachioTokenForUser } = await import("./rachio-client.server");
    const tok = await getRachioTokenForUser(context.userId);
    const { data: ctrls } = await context.supabase
      .from("rachio_controllers")
      .select("id, last_synced_at")
      .order("last_synced_at", { ascending: false });
    const lastSyncAt = ctrls?.[0]?.last_synced_at ?? null;
    return {
      connected: !!tok,
      lastSyncAt: lastSyncAt as string | null,
      controllerCount: ctrls?.length ?? 0,
      webhookUrl: publicWebhookUrl(),
    };
  });

export const saveRachioToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) => {
    const t = String(d?.token ?? "").trim();
    if (!t) throw new Error("token is required");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
      throw new Error("Invalid Rachio token format (expected UUID)");
    }
    return { token: t };
  })
  .handler(async ({ context, data }): Promise<{ ok: true; personId: string }> => {
    const { rachioPersonInfo, RACHIO_TOKEN_VAULT_TITLE } = await import("./rachio-client.server");
    const info = await rachioPersonInfo(data.token);
    const { seal } = await import("./vault-crypto.server");
    const sealed = await seal(data.token);
    // Upsert into vault: find existing by (owner_user_id, title) and update; else insert.
    const { data: existing } = await context.supabase
      .from("vault_secrets")
      .select("id")
      .eq("scope", "personal")
      .eq("owner_user_id", context.userId)
      .eq("title", RACHIO_TOKEN_VAULT_TITLE)
      .maybeSingle();
    if (existing) {
      const { error } = await context.supabase
        .from("vault_secrets")
        .update({
          value_ciphertext: sealed.ciphertext,
          value_iv: sealed.iv,
          value_tag: sealed.tag,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("vault_secrets").insert({
        scope: "personal",
        owner_user_id: context.userId,
        created_by: context.userId,
        title: RACHIO_TOKEN_VAULT_TITLE,
        value_ciphertext: sealed.ciphertext,
        value_iv: sealed.iv,
        value_tag: sealed.tag,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true, personId: info.id };
  });

export const syncRachioInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ controllers: number; zones: number }> => {
    const { getRachioTokenForUser, rachioPersonInfo, rachioPerson } = await import(
      "./rachio-client.server"
    );
    const tok = await getRachioTokenForUser(context.userId);
    if (!tok) throw new Error("No Rachio token saved — connect Rachio first.");
    const info = await rachioPersonInfo(tok.token);
    const person = await rachioPerson(tok.token, info.id);
    const now = new Date().toISOString();
    let ctrlCount = 0;
    let zoneCount = 0;
    for (const dev of person.devices ?? []) {
      const { data: ctrl, error: ctrlErr } = await context.supabase
        .from("rachio_controllers")
        .upsert(
          {
            user_id: context.userId,
            rachio_id: dev.id,
            name: dev.name ?? null,
            model: dev.model ?? null,
            serial_number: dev.serialNumber ?? null,
            status: dev.status ?? null,
            last_synced_at: now,
            raw: dev as any,
          },
          { onConflict: "user_id,rachio_id" },
        )
        .select("id")
        .single();
      if (ctrlErr) throw new Error(ctrlErr.message);
      ctrlCount++;
      for (const z of dev.zones ?? []) {
        const { error: zErr } = await context.supabase.from("rachio_zones").upsert(
          {
            user_id: context.userId,
            controller_id: ctrl.id,
            rachio_id: z.id,
            zone_number: z.zoneNumber ?? null,
            name: z.name ?? null,
            enabled: z.enabled ?? true,
            nozzle: z.customNozzle?.name ?? null,
            area_sqft: z.yardAreaSquareFeet ?? null,
            last_run_at: z.lastWateredDate ? new Date(z.lastWateredDate).toISOString() : null,
            raw: z as any,
          },
          { onConflict: "user_id,rachio_id" },
        );
        if (zErr) throw new Error(zErr.message);
        zoneCount++;
      }
    }
    return { controllers: ctrlCount, zones: zoneCount };
  });

export const syncRachioRecentRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) => ({
    days: Math.max(1, Math.min(30, Number(d?.days ?? 7))),
  }))
  .handler(async ({ context, data }): Promise<{ runs: number }> => {
    const { getRachioTokenForUser, rachioDeviceEvents } = await import("./rachio-client.server");
    const tok = await getRachioTokenForUser(context.userId);
    if (!tok) throw new Error("No Rachio token saved — connect Rachio first.");
    const { data: ctrls } = await context.supabase
      .from("rachio_controllers")
      .select("id, rachio_id");
    const { data: zones } = await context.supabase
      .from("rachio_zones")
      .select("id, rachio_id");
    const zoneByRachio = new Map((zones ?? []).map((z) => [z.rachio_id as string, z.id as string]));
    const end = Date.now();
    const start = end - data.days * 24 * 3600 * 1000;
    let total = 0;
    for (const c of ctrls ?? []) {
      const events = await rachioDeviceEvents(tok.token, c.rachio_id as string, start, end);
      for (const ev of events) {
        const type = (ev.type || ev.category || "").toUpperCase();
        if (!type.includes("ZONE")) continue;
        const dataMap = Object.fromEntries((ev.eventDatas ?? []).map((d) => [d.key, d.value]));
        const zoneRachio = dataMap.zoneId || dataMap.zone_id;
        if (!zoneRachio) continue;
        const zoneId = zoneByRachio.get(zoneRachio);
        if (!zoneId) continue;
        const startedAt = ev.eventDate ? new Date(ev.eventDate).toISOString() : null;
        if (!startedAt) continue;
        const durationSeconds = dataMap.durationInSeconds
          ? Number(dataMap.durationInSeconds)
          : dataMap.duration
            ? Number(dataMap.duration)
            : null;
        const endedAt = durationSeconds && ev.eventDate
          ? new Date(ev.eventDate + durationSeconds * 1000).toISOString()
          : null;
        const subType = (ev.subType || ev.type || "").toUpperCase();
        const status = subType.includes("COMPLETE")
          ? "completed"
          : subType.includes("SKIP")
            ? "skipped"
            : subType.includes("ABORT") || subType.includes("STOP")
              ? "aborted"
              : "running";
        const source = (dataMap.source || "scheduled").toLowerCase();
        const eventId = ev.id ?? `${c.rachio_id}-${ev.eventDate}-${zoneRachio}-${subType}`;
        const { error } = await context.supabase.from("rachio_runs").upsert(
          {
            user_id: context.userId,
            zone_id: zoneId,
            rachio_event_id: eventId,
            started_at: startedAt,
            ended_at: endedAt,
            duration_seconds: durationSeconds,
            gallons: dataMap.gallons ? Number(dataMap.gallons) : null,
            source,
            status,
            raw: ev as any,
          },
          { onConflict: "user_id,rachio_event_id" },
        );
        if (error) throw new Error(error.message);
        total++;
      }
    }
    return { runs: total };
  });

export const linkRachioZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { zoneId: string; gardenPlotId?: string | null; orchardTreeId?: string | null }) => {
    const zoneId = String(d?.zoneId ?? "");
    if (!zoneId) throw new Error("zoneId is required");
    return {
      zoneId,
      gardenPlotId: d?.gardenPlotId ?? null,
      orchardTreeId: d?.orchardTreeId ?? null,
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("rachio_zones")
      .update({
        garden_plot_id: data.gardenPlotId,
        orchard_tree_id: data.orchardTreeId,
      })
      .eq("id", data.zoneId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRachioDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) => ({
    days: Math.max(1, Math.min(60, Number(d?.days ?? 14))),
  }))
  .handler(async ({ context, data }): Promise<RachioDashboard> => {
    const { getRachioTokenForUser } = await import("./rachio-client.server");
    const tok = await getRachioTokenForUser(context.userId);
    const [ctrlRes, zoneRes, runsRes] = await Promise.all([
      context.supabase
        .from("rachio_controllers")
        .select("id, rachio_id, name, model, serial_number, status, last_synced_at")
        .order("name", { ascending: true }),
      context.supabase
        .from("rachio_zones")
        .select(
          "id, controller_id, rachio_id, zone_number, name, enabled, nozzle, area_sqft, garden_plot_id, orchard_tree_id, last_run_at, next_run_at",
        )
        .order("zone_number", { ascending: true }),
      context.supabase
        .from("rachio_runs")
        .select("id, zone_id, rachio_event_id, started_at, ended_at, duration_seconds, gallons, source, status")
        .gte("started_at", new Date(Date.now() - data.days * 24 * 3600 * 1000).toISOString())
        .order("started_at", { ascending: false })
        .limit(500),
    ]);
    const controllers = (ctrlRes.data ?? []) as RachioControllerRow[];
    const ctrlNameById = new Map(controllers.map((c) => [c.id, c.name]));
    const zones = (zoneRes.data ?? []).map((z) => ({
      ...(z as RachioZoneRow),
      controller_name: ctrlNameById.get((z as RachioZoneRow).controller_id) ?? null,
    })) as RachioZoneRow[];
    const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));
    const runs = (runsRes.data ?? []).map((r) => ({
      ...(r as RachioRunRow),
      zone_name: zoneNameById.get((r as RachioRunRow).zone_id) ?? null,
    })) as RachioRunRow[];
    return {
      status: {
        connected: !!tok,
        lastSyncAt: controllers[0]?.last_synced_at ?? null,
        controllerCount: controllers.length,
        webhookUrl: publicWebhookUrl(),
      },
      controllers,
      zones,
      runs,
    };
  });

export interface GardenPlotOption { id: string; row_label: string; position: number; plant_name: string | null }
export interface OrchardTreeOption { id: string; species: string; variety: string | null; location: string | null }

export const listLinkTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ plots: GardenPlotOption[]; trees: OrchardTreeOption[] }> => {
    const [plots, trees] = await Promise.all([
      context.supabase.from("garden_plots").select("id, row_label, position, plant_name").order("row_label").order("position"),
      context.supabase.from("orchard_trees").select("id, species, variety, location").order("species"),
    ]);
    return {
      plots: (plots.data ?? []) as GardenPlotOption[],
      trees: (trees.data ?? []) as OrchardTreeOption[],
    };
  });
