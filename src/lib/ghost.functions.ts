// Send a report to the user's Ghost blog as a draft post.
// Uses the Ghost Admin API with a JWT signed from GHOST_ADMIN_API_KEY (id:secret).
// Server-only — never expose the admin key to the client.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = {
  title: string;
  html: string;
  tags?: string[];
  status?: "draft" | "published";
};

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Admin API secret is not valid hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

async function signGhostJwt(adminKey: string): Promise<string> {
  const [id, secretHex] = adminKey.split(":");
  if (!id || !secretHex) {
    throw new Error("GHOST_ADMIN_API_KEY must be 'id:secret' (Admin API key, not Content API).");
  }
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", kid: id };
  const payload = { iat, exp: iat + 5 * 60, aud: "/admin/" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const keyBytes = hexToBytes(secretHex);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const msg = new TextEncoder().encode(signingInput);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength) as ArrayBuffer,
  );
  return `${signingInput}.${b64url(sig)}`;
}

export const publishToGhost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d || typeof d.title !== "string" || typeof d.html !== "string") {
      throw new Error("title and html are required");
    }
    return {
      title: d.title.slice(0, 255),
      html: d.html,
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 10).map(String) : [],
      status: d.status === "published" ? "published" : "draft",
    } satisfies Required<Input>;
  })
  .handler(async ({ data }) => {
    const url = process.env.GHOST_API_URL;
    const adminKey = process.env.GHOST_ADMIN_API_KEY;
    if (!url) throw new Error("GHOST_API_URL is not configured on the server.");
    if (!adminKey) throw new Error("GHOST_ADMIN_API_KEY is not configured on the server.");

    const token = await signGhostJwt(adminKey);
    const endpoint = `${url.replace(/\/$/, "")}/ghost/api/admin/posts/?source=html`;
    const body = {
      posts: [
        {
          title: data.title,
          html: data.html,
          status: data.status,
          tags: data.tags.map((name) => ({ name })),
        },
      ],
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Ghost ${token}`,
        "Content-Type": "application/json",
        "Accept-Version": "v5.0",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("[ghost] publish failed", res.status, text.slice(0, 400));
      let msg = `Ghost API error ${res.status}`;
      try {
        const j = JSON.parse(text);
        const err = j?.errors?.[0];
        if (err?.message) msg = `${err.message}${err.context ? ` — ${err.context}` : ""}`;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const parsed = JSON.parse(text) as {
      posts?: Array<{ id: string; url?: string; status?: string }>;
    };
    const post = parsed.posts?.[0];
    return {
      ok: true as const,
      id: post?.id ?? null,
      url: post?.url ?? null,
      status: post?.status ?? data.status,
    };
  });
