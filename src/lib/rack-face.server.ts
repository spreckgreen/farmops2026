// Generated front-panel pictures for rack gear.
//
// Each inventory item that lives in a rack can carry one picture of its front
// panel, drawn to the standard 19-inch rack width and the exact number of rack
// spaces (U) the part occupies, so the rack elevation reads like the real rack.
// Pictures are stored privately in the "rack-faces" bucket and handed to the
// browser as short-lived signed links.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "rack-faces";
const SIGNED_URL_SECONDS = 60 * 60 * 6;

/** Front-panel proportions: 19 in wide, 1.75 in per rack space. */
export function faceAspectRatio(rackUnits: number): string {
  const ratio = 19 / (1.75 * rackUnits);
  return `${ratio.toFixed(2)}:1 (19 inches wide by ${(1.75 * rackUnits).toFixed(2)} inches tall)`;
}

export function buildFacePrompt(part: {
  name: string;
  description?: string | null;
  itemType?: string | null;
  rackUnits: number;
}): string {
  const details = [part.description, part.itemType].filter(Boolean).join(" · ");
  return [
    `A straight-on, dead-centre orthographic photograph of the front panel of this piece of equipment mounted in a 19-inch equipment rack: ${part.name}.`,
    details ? `Additional detail: ${details}.` : "",
    `The panel must fill the whole frame edge to edge with the proportions of a ${part.rackUnits}U rack panel — aspect ratio ${faceAspectRatio(part.rackUnits)} — including the rack ears at both ends with mounting holes.`,
    "Product-catalogue lighting, neutral dark grey studio background, no perspective, no shadow falloff, no watermark, no added text or labels beyond what the real front panel would carry, no people, no rack frame around it.",
    "If the exact model is not known, draw a plain, generic panel of the correct type and size rather than inventing brand markings.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Ask Lovable AI for the front-panel picture. Streams so the connection keeps
 * flowing while the model renders; only the finished frame is kept.
 */
export async function renderFaceImage(prompt: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI image generation is not configured on this server.");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("The picture service is busy — try again in a minute.");
    if (res.status === 402)
      throw new Error(body || "Not enough AI credits left to draw this picture.");
    if (res.status === 403)
      throw new Error(body || "AI picture generation is turned off for this workspace.");
    throw new Error(body || `Picture generation failed (${res.status}).`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let last: string | undefined;
  let streamError: string | undefined;
  let sawEvent = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const payload = JSON.parse(raw) as {
              type?: string;
              b64_json?: string;
              error?: { message?: string };
            };
            sawEvent = true;
            if (payload.type === "error") {
              streamError = payload.error?.message ?? "Picture generation failed.";
            } else if (payload.b64_json) {
              last = payload.b64_json;
            }
          } catch {
            /* partial frame — keep reading */
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (streamError) throw new Error(streamError);
  if (!last) {
    if (!sawEvent) {
      // Zero events: transport hiccup. Replay once, non-streamed.
      const replay = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-pro-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });
      if (!replay.ok) {
        throw new Error(
          (await replay.text().catch(() => "")) || `Picture generation failed (${replay.status}).`,
        );
      }
      const json = (await replay.json()) as { data?: { b64_json?: string }[] };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error("The picture service returned no image.");
      return b64;
    }
    throw new Error("The picture was not finished — try again.");
  }
  return last;
}

/** Store the finished picture privately and return its storage path. */
export async function storeFaceImage(
  userId: string,
  itemId: string,
  b64: string,
): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${userId}/${itemId}-${Date.now()}.png`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

/** Short-lived links for stored pictures, keyed by storage path. */
export async function signFacePaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) return out; // a missing picture must never break the rack view
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
