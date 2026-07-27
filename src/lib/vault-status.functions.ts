// Reports whether the vault encryption key is configured on the server,
// plus rotation-relevant fingerprints so the UI can guide the operator.
// No raw key material is ever returned.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface VaultKeyStatus {
  configured: boolean;
  /** "hex" if 64 hex chars, "passphrase" if any other non-empty value, null if missing */
  format: "hex" | "passphrase" | null;
  /** 8-char SHA-256 prefix of the currently-loaded primary key, or null. */
  primaryFingerprint: string | null;
  /** 8-char SHA-256 prefix of VAULT_ENCRYPTION_KEY_OLD if set, else null. */
  oldFingerprint: string | null;
  /** True when VAULT_ENCRYPTION_KEY_OLD is set (rotation in progress). */
  oldKeyPresent: boolean;
}

export const getVaultKeyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<VaultKeyStatus> => {
    const raw = process.env.VAULT_ENCRYPTION_KEY;
    if (!raw) {
      return {
        configured: false,
        format: null,
        primaryFingerprint: null,
        oldFingerprint: null,
        oldKeyPresent: Boolean(process.env.VAULT_ENCRYPTION_KEY_OLD),
      };
    }
    const { getKeyFingerprints } = await import("./vault-crypto.server");
    const fp = await getKeyFingerprints();
    return {
      configured: true,
      format: /^[0-9a-fA-F]{64}$/.test(raw) ? "hex" : "passphrase",
      primaryFingerprint: fp.primary,
      oldFingerprint: fp.old,
      oldKeyPresent: fp.old !== null,
    };
  });
