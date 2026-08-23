// Server-only Rachio API client. Reads the user's Personal API token from the
// vault on demand. Never imported from browser code.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { open as openSealed } from "./vault-crypto.server";

const RACHIO_BASE = "https://api.rach.io/1/public";
export const RACHIO_TOKEN_VAULT_TITLE = "rachio.personal_api_token";

export type RachioToken = { token: string; vaultItemId: string };

/** Fetch a user's Rachio personal API token from the vault (decrypted). */
export async function getRachioTokenForUser(userId: string): Promise<RachioToken | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server env not configured");
  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .from("vault_secrets")
    .select("id, value_ciphertext, value_iv, value_tag")
    .eq("scope", "personal")
    .eq("owner_user_id", userId)
    .eq("title", RACHIO_TOKEN_VAULT_TITLE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const token = await openSealed({
    ciphertext: data.value_ciphertext as string,
    iv: data.value_iv as string,
    tag: data.value_tag as string,
  }, `Rachio API token (vault item ${data.id})`);
  return { token, vaultItemId: data.id as string };
}

export async function rachioFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RACHIO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Rachio ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface RachioZoneApi {
  id: string;
  zoneNumber: number;
  name: string;
  enabled: boolean;
  customNozzle?: { name?: string } | null;
  yardAreaSquareFeet?: number;
  lastWateredDate?: number;
}
export interface RachioDeviceApi {
  id: string;
  name?: string;
  model?: string;
  serialNumber?: string;
  status?: string;
  zones: RachioZoneApi[];
}
export interface RachioPersonInfo { id: string; username?: string }
export interface RachioPerson {
  id: string;
  username?: string;
  fullName?: string;
  email?: string;
  devices: RachioDeviceApi[];
}
export interface RachioEvent {
  id?: string;
  eventDate?: number;
  category?: string;
  type?: string;
  subType?: string;
  summary?: string;
  topic?: string;
  eventDatas?: Array<{ key: string; value: string }>;
}

export async function rachioPersonInfo(token: string) {
  return rachioFetch<RachioPersonInfo>(token, "/person/info");
}
export async function rachioPerson(token: string, personId: string) {
  return rachioFetch<RachioPerson>(token, `/person/${personId}`);
}
export async function rachioDeviceEvents(token: string, deviceId: string, startMs: number, endMs: number) {
  return rachioFetch<RachioEvent[]>(
    token,
    `/device/${deviceId}/event?startTime=${startMs}&endTime=${endMs}`,
  );
}
