// Rachio webhook receiver. Public endpoint; verifies the shared secret in the
// `external_id` query parameter (Rachio echoes back whatever externalId was set
// when the webhook was registered). For added safety, also accepts an
// `X-Rachio-Signature` header (HMAC-SHA256 of the raw body) if present.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/webhooks/rachio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const externalId = url.searchParams.get("token") || url.searchParams.get("external_id") || "";
        const expectedSecret = process.env.RACHIO_WEBHOOK_SECRET ?? "";
        const rawBody = await request.text();

        let signatureOk = false;
        if (expectedSecret && externalId) {
          const a = Buffer.from(externalId);
          const b = Buffer.from(expectedSecret);
          signatureOk = a.length === b.length && timingSafeEqual(a, b);
        }
        const hdrSig = request.headers.get("x-rachio-signature");
        if (!signatureOk && hdrSig && expectedSecret) {
          const computed = createHmac("sha256", expectedSecret).update(rawBody).digest("hex");
          const a = Buffer.from(hdrSig);
          const b = Buffer.from(computed);
          signatureOk = a.length === b.length && timingSafeEqual(a, b);
        }

        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* ignore */ }
        const eventType = String(
          (payload.type as string) || (payload.eventType as string) || (payload.category as string) || "",
        );

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: auditRow } = await supabaseAdmin
          .from("rachio_webhook_events")
          .insert({
            signature_ok: signatureOk,
            event_type: eventType || null,
            external_id: externalId || null,
            payload,
          })
          .select("id")
          .single();

        if (!signatureOk) {
          return new Response("Invalid signature", { status: 401 });
        }

        try {
          await processRachioEvent(supabaseAdmin, payload);
          if (auditRow) {
            await supabaseAdmin
              .from("rachio_webhook_events")
              .update({ processed_at: new Date().toISOString() })
              .eq("id", auditRow.id);
          }
        } catch (e) {
          if (auditRow) {
            await supabaseAdmin
              .from("rachio_webhook_events")
              .update({ error: e instanceof Error ? e.message : String(e) })
              .eq("id", auditRow.id);
          }
          return new Response("Processing error", { status: 200 });
        }

        return new Response("ok");
      },
    },
  },
});

type Admin = Awaited<ReturnType<typeof import("@/integrations/supabase/client.server")["__noop"]>> extends never
  ? never : never;
// We can't easily type the admin client here; use `any` shape internally.
async function processRachioEvent(
  admin: { from: (t: string) => any },
  payload: Record<string, unknown>,
): Promise<void> {
  const deviceId =
    (payload.deviceId as string) ||
    ((payload.device as { id?: string } | undefined)?.id) ||
    "";
  const zoneId =
    (payload.zoneId as string) ||
    ((payload.zone as { id?: string } | undefined)?.id) ||
    "";
  if (!deviceId && !zoneId) return;

  // Find the owning user via the zone (preferred) or controller.
  let userId: string | null = null;
  let dbZoneId: string | null = null;
  if (zoneId) {
    const { data: z } = await admin
      .from("rachio_zones")
      .select("id, user_id")
      .eq("rachio_id", zoneId)
      .maybeSingle();
    if (z) { userId = z.user_id; dbZoneId = z.id; }
  }
  if (!userId && deviceId) {
    const { data: c } = await admin
      .from("rachio_controllers")
      .select("user_id")
      .eq("rachio_id", deviceId)
      .maybeSingle();
    if (c) userId = c.user_id;
  }
  if (!userId || !dbZoneId) return;

  const type = String(payload.type ?? payload.eventType ?? payload.subType ?? "").toUpperCase();
  if (!type.includes("ZONE")) return;

  const startedAt =
    (typeof payload.timestamp === "number" && new Date(payload.timestamp).toISOString()) ||
    (typeof payload.eventDate === "number" && new Date(payload.eventDate).toISOString()) ||
    new Date().toISOString();
  const durationSeconds =
    typeof payload.durationInSeconds === "number" ? payload.durationInSeconds :
    typeof payload.duration === "number" ? payload.duration : null;
  const status = type.includes("COMPLETE")
    ? "completed"
    : type.includes("SKIP") ? "skipped"
    : type.includes("ABORT") || type.includes("STOP") ? "aborted"
    : type.includes("START") ? "running"
    : "unknown";
  const eventKey = (payload.externalId as string) || (payload.eventId as string)
    || `${deviceId}-${zoneId}-${startedAt}-${type}`;

  await admin.from("rachio_runs").upsert(
    {
      user_id: userId,
      zone_id: dbZoneId,
      rachio_event_id: eventKey,
      started_at: startedAt,
      ended_at: durationSeconds ? new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString() : null,
      duration_seconds: durationSeconds,
      gallons: typeof payload.gallons === "number" ? payload.gallons : null,
      source: String(payload.source ?? "scheduled").toLowerCase(),
      status,
      raw: payload,
    },
    { onConflict: "user_id,rachio_event_id" },
  );

  if (status === "completed") {
    const { data: zoneRow } = await admin
      .from("rachio_zones")
      .select("name")
      .eq("id", dbZoneId)
      .maybeSingle();
    const mins = durationSeconds ? Math.round(durationSeconds / 60) : null;
    const gal = typeof payload.gallons === "number" ? Math.round(payload.gallons) : null;
    const parts = [
      `🚿 Watered ${zoneRow?.name ?? "zone"}`,
      mins != null ? `${mins} min` : null,
      gal != null ? `${gal} gal` : null,
    ].filter(Boolean);
    await admin.from("activity_log").insert({
      user_id: userId,
      entry_type: "note",
      raw_content: parts.join(" · "),
    });
    await admin
      .from("rachio_zones")
      .update({ last_run_at: startedAt })
      .eq("id", dbZoneId);
  }
}
