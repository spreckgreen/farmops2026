// Scoped service principals for the read-only FarmOps Electrical API.
//
// A principal is a named key with a fixed scope set. Only the SHA-256 of the key
// is stored: the plaintext is returned once, at creation, and never again. While
// Phase 2/3 write scopes are unactivated, only read scopes can be granted.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import {
  API_SCOPES,
  isApiScope,
  sha256Hex,
  SCOPES_FOR_ENTITLEMENT,
  type ApiScope,
} from "@/lib/electrical-api-envelope";
import { WRITE_SCOPES_ACTIVATED } from "@/lib/electrical-api";

const TABLE = "electrical_api_principals";

export interface ApiPrincipalRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  note: string | null;
  disabled_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** Scopes a principal may be granted right now. */
export const GRANTABLE_SCOPES: ApiScope[] = WRITE_SCOPES_ACTIVATED
  ? (Object.keys(API_SCOPES) as ApiScope[])
  : SCOPES_FOR_ENTITLEMENT.read;

type LooseDb = { from: (table: string) => any };

function newKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `farmops_sk_${body}`;
}

export const listApiPrincipals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ principals: ApiPrincipalRow[]; grantable: ApiScope[] }> => {
    await requireElectricalAccess(context.supabase, context.userId, "read");
    const { data, error } = await (context.supabase as unknown as LooseDb)
      .from(TABLE)
      .select("id, name, key_prefix, scopes, note, disabled_at, expires_at, last_used_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { principals: (data ?? []) as ApiPrincipalRow[], grantable: GRANTABLE_SCOPES };
  });

export const createApiPrincipal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; scopes: string[]; note?: string | null; expires_at?: string | null }) => input)
  .handler(async ({ data, context }): Promise<{ principal: ApiPrincipalRow; key: string }> => {
    // Issuing a machine credential needs the full electrical entitlement.
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("Give the principal a name so its key can be recognised later.");
    const scopes = (data.scopes ?? []).filter(isApiScope).filter((s) => GRANTABLE_SCOPES.includes(s));
    if (!scopes.length) {
      throw new Error(
        `Grant at least one scope. Grantable right now: ${GRANTABLE_SCOPES.join(", ")}.`,
      );
    }
    const key = newKey();
    const { data: row, error } = await (context.supabase as unknown as LooseDb)
      .from(TABLE)
      .insert({
        user_id: context.userId,
        name,
        key_prefix: key.slice(0, 18),
        key_sha256: await sha256Hex(key),
        scopes,
        note: data.note ?? null,
        expires_at: data.expires_at ?? null,
      })
      .select("id, name, key_prefix, scopes, note, disabled_at, expires_at, last_used_at, created_at")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Could not create the principal.");
    await recordElectricalChange(context.supabase, context.userId, {
      section: "entities",
      entityKind: "api_principal",
      action: "create",
      entityUuid: String((row as ApiPrincipalRow).id),
      entityRef: name,
      summary: `Issued electrical API service principal "${name}" with scopes ${scopes.join(", ")}`,
      changes: [{ column: "scopes", before: null, after: scopes.join(", ") }],
    });
    return { principal: row as ApiPrincipalRow, key };
  });

export const setApiPrincipalDisabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; disabled: boolean }) => input)
  .handler(async ({ data, context }): Promise<{ id: string; disabled: boolean }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const disabled_at = data.disabled ? new Date().toISOString() : null;
    const { error } = await (context.supabase as unknown as LooseDb)
      .from(TABLE)
      .update({ disabled_at })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordElectricalChange(context.supabase, context.userId, {
      section: "entities",
      entityKind: "api_principal",
      action: "update",
      entityUuid: data.id,
      summary: data.disabled
        ? "Disabled an electrical API service principal"
        : "Re-enabled an electrical API service principal",
      changes: [{ column: "disabled_at", before: null, after: disabled_at }],
    });
    return { id: data.id, disabled: data.disabled };
  });
