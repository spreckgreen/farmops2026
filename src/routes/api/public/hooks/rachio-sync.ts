// Daily cron entry point. Walks every connected Rachio user and refreshes
// inventory + the last 2 days of runs. Acts as a safety net for missed webhooks.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/hooks/rachio-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RACHIO_WEBHOOK_SECRET ?? "";
        const provided = request.headers.get("x-rachio-cron-secret") ?? "";
        if (!secret || provided.length !== secret.length ||
            !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { rachioPersonInfo, rachioPerson, rachioDeviceEvents, getRachioTokenForUser } =
          await import("@/lib/rachio-client.server");

        // Find every user with a saved Rachio token by listing matching vault rows.
        const { data: tokens } = await supabaseAdmin
          .from("vault_secrets")
          .select("owner_user_id")
          .eq("scope", "personal")
          .eq("title", "rachio.personal_api_token");

        const userIds = Array.from(new Set((tokens ?? []).map((t) => t.owner_user_id as string).filter(Boolean)));
        const results: Array<{ userId: string; ok: boolean; error?: string; controllers?: number; runs?: number }> = [];

        const end = Date.now();
        const start = end - 2 * 24 * 3600 * 1000;

        for (const userId of userIds) {
          try {
            const tok = await getRachioTokenForUser(userId);
            if (!tok) { results.push({ userId, ok: false, error: "no token" }); continue; }
            const info = await rachioPersonInfo(tok.token);
            const person = await rachioPerson(tok.token, info.id);
            const now = new Date().toISOString();
            let ctrlCount = 0; let runCount = 0;
            for (const dev of person.devices ?? []) {
              const { data: ctrl } = await supabaseAdmin
                .from("rachio_controllers")
                .upsert(
                  {
                    user_id: userId,
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
              ctrlCount++;
              for (const z of dev.zones ?? []) {
                await supabaseAdmin.from("rachio_zones").upsert(
                  {
                    user_id: userId,
                    controller_id: ctrl?.id,
                    rachio_id: z.id,
                    zone_number: z.zoneNumber ?? null,
                    name: z.name ?? null,
                    enabled: z.enabled ?? true,
                    nozzle: z.customNozzle?.name ?? null,
                    area_sqft: z.yardAreaSquareFeet ?? null,
                    raw: z as any,
                  },
                  { onConflict: "user_id,rachio_id" },
                );
              }
              const events = await rachioDeviceEvents(tok.token, dev.id, start, end);
              const { data: zoneRows } = await supabaseAdmin
                .from("rachio_zones")
                .select("id, rachio_id")
                .eq("user_id", userId);
              const zoneByRachio = new Map((zoneRows ?? []).map((z) => [z.rachio_id as string, z.id as string]));
              for (const ev of events) {
                const dataMap = Object.fromEntries((ev.eventDatas ?? []).map((d) => [d.key, d.value]));
                const zoneRachio = dataMap.zoneId || dataMap.zone_id;
                const dbZoneId = zoneRachio ? zoneByRachio.get(zoneRachio) : undefined;
                if (!dbZoneId || !ev.eventDate) continue;
                const subType = (ev.subType || ev.type || "").toUpperCase();
                const status = subType.includes("COMPLETE") ? "completed"
                  : subType.includes("SKIP") ? "skipped"
                  : subType.includes("ABORT") || subType.includes("STOP") ? "aborted" : "running";
                const durationSeconds = dataMap.durationInSeconds ? Number(dataMap.durationInSeconds)
                  : dataMap.duration ? Number(dataMap.duration) : null;
                const eventId = ev.id ?? `${dev.id}-${ev.eventDate}-${zoneRachio}-${subType}`;
                await supabaseAdmin.from("rachio_runs").upsert(
                  {
                    user_id: userId,
                    zone_id: dbZoneId,
                    rachio_event_id: eventId,
                    started_at: new Date(ev.eventDate).toISOString(),
                    ended_at: durationSeconds ? new Date(ev.eventDate + durationSeconds * 1000).toISOString() : null,
                    duration_seconds: durationSeconds,
                    gallons: dataMap.gallons ? Number(dataMap.gallons) : null,
                    source: (dataMap.source || "scheduled").toLowerCase(),
                    status,
                    raw: ev as any,
                  },
                  { onConflict: "user_id,rachio_event_id" },
                );
                runCount++;
              }
            }
            results.push({ userId, ok: true, controllers: ctrlCount, runs: runCount });
          } catch (e) {
            results.push({ userId, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }

        return Response.json({ users: results.length, results });
      },
    },
  },
});
