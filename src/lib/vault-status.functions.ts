// Reports whether the vault encryption key is configured on the server.
// No secret material is ever returned — only a boolean + shape hint.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface VaultKeyStatus {
  configured: boolean;
  /** "hex" if 64 hex chars, "passphrase" if any other non-empty value, null if missing */
  format: "hex" | "passphrase" | null;
}

export const getVaultKeyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<VaultKeyStatus> => {
    const raw = process.env.VAULT_ENCRYPTION_KEY;
    if (!raw) return { configured: false, format: null };
    return {
      configured: true,
      format: /^[0-9a-fA-F]{64}$/.test(raw) ? "hex" : "passphrase",
    };
  });
