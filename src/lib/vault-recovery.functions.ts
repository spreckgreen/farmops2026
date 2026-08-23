// Admin-only "re-encrypt with the CURRENT VAULT_ENCRYPTION_KEY" recovery
// workflow.
//
// The plain rotation tool (vault-rotation.functions.ts) can only drain rows it
// can decrypt, i.e. rows sealed with VAULT_ENCRYPTION_KEY or
// VAULT_ENCRYPTION_KEY_OLD. When a key was rotated without setting OLD, rows go
// dark and the only fix used to be editing .env and redeploying.
//
// This module closes that gap: the operator can paste one or more *candidate*
// old keys in the admin UI. They are used in memory for this request only —
// never logged, never persisted, never returned — and every row they can open
// is immediately re-sealed with the current primary key. Rows nothing can open
// are reported (title / scope / env_key only, never ciphertext) so the operator
// can re-enter those few values by hand or delete them.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface UnrecoverableRow {
  id: string;
  title: string;
  scope: string;
  envKey: string | null;
  keyVersion: number | null;
}

export interface ReencryptResult {
  scanned: number;
  resealed: number;
  /** rows already sealed with the current key (no work needed) */
  alreadyCurrent: number;
  unrecoverable: UnrecoverableRow[];
  /** fingerprints of the keys that actually opened data, for the audit trail */
  keysUsed: Array<{ fingerprint: string; source: "primary" | "old" | "recovery"; rows: number }>;
  primaryFingerprint: string;
  recoveryKeyFingerprints: Array<{ fingerprint: string; shape: string }>;
  errors: Array<{ id: string; message: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

function parseKeys(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[\r\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Walk every vault row, decrypt it with whatever key works (current key, OLD
 * env key, or an operator-supplied recovery key) and re-seal it with the
 * current VAULT_ENCRYPTION_KEY. Idempotent and safe to re-run.
 */
export const reencryptVaultWithCurrentKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { recoveryKeys?: string; limit?: number } | undefined) => ({
    recoveryKeys: typeof d?.recoveryKeys === "string" ? d.recoveryKeys : "",
    limit: Math.max(1, Math.min(500, Number(d?.limit ?? 200))),
  }))
  .handler(async ({ context, data }): Promise<ReencryptResult> => {
    await requireAdmin(context.supabase, context.userId);
    if (!process.env.VAULT_ENCRYPTION_KEY) {
      throw new Error(
        "VAULT_ENCRYPTION_KEY is not set on the server, so there is no key to re-encrypt with. " +
          "Set it (64 hex chars, e.g. `openssl rand -hex 32`) and restart the app first.",
      );
    }

    const {
      tryOpenWithRecoveryKeys,
      fingerprintRecoveryKeys,
      seal,
      getKeyFingerprints,
    } = await import("./vault-crypto.server");

    const recoveryKeys = parseKeys(data.recoveryKeys);
    const fp = await getKeyFingerprints();
    const recoveryKeyFingerprints = await fingerprintRecoveryKeys(recoveryKeys);

    const { data: rows, error } = await context.supabase
      .from("vault_secrets")
      .select(
        "id, title, scope, env_key, key_version, value_ciphertext, value_iv, value_tag, notes_ciphertext, notes_iv, notes_tag",
      )
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const usage = new Map<string, { fingerprint: string; source: "primary" | "old" | "recovery"; rows: number }>();
    const unrecoverable: UnrecoverableRow[] = [];
    const errors: Array<{ id: string; message: string }> = [];
    let resealed = 0;
    let alreadyCurrent = 0;

    for (const row of rows ?? []) {
      const r = row as {
        id: string;
        title: string;
        scope: string;
        env_key: string | null;
        key_version: number | null;
        value_ciphertext: string;
        value_iv: string;
        value_tag: string;
        notes_ciphertext: string | null;
        notes_iv: string | null;
        notes_tag: string | null;
      };
      try {
        const value = await tryOpenWithRecoveryKeys(
          { ciphertext: r.value_ciphertext, iv: r.value_iv, tag: r.value_tag },
          recoveryKeys,
        );
        if (!value) {
          unrecoverable.push({
            id: r.id,
            title: r.title,
            scope: r.scope,
            envKey: r.env_key,
            keyVersion: r.key_version,
          });
          continue;
        }

        let notesPlain: string | null = null;
        if (r.notes_ciphertext && r.notes_iv && r.notes_tag) {
          const notes = await tryOpenWithRecoveryKeys(
            { ciphertext: r.notes_ciphertext, iv: r.notes_iv, tag: r.notes_tag },
            recoveryKeys,
          );
          notesPlain = notes ? notes.plaintext : null;
        }

        const seen = usage.get(`${value.source}:${value.fingerprint}`) ?? {
          fingerprint: value.fingerprint,
          source: value.source,
          rows: 0,
        };
        seen.rows++;
        usage.set(`${value.source}:${value.fingerprint}`, seen);

        if (value.source === "primary") {
          alreadyCurrent++;
          // Still normalise key_version so the rotation dashboard reads clean.
        }

        const v = await seal(value.plaintext);
        const n = notesPlain != null ? await seal(notesPlain) : null;
        const targetVersion = await computeTargetVersion();

        const { error: upErr } = await context.supabase
          .from("vault_secrets")
          .update({
            value_ciphertext: v.ciphertext,
            value_iv: v.iv,
            value_tag: v.tag,
            notes_ciphertext: n?.ciphertext ?? null,
            notes_iv: n?.iv ?? null,
            notes_tag: n?.tag ?? null,
            key_version: targetVersion,
          })
          .eq("id", r.id);
        if (upErr) throw new Error(upErr.message);
        if (value.source !== "primary") resealed++;
      } catch (e) {
        errors.push({ id: r.id, message: e instanceof Error ? e.message : String(e) });
      }
    }

    // Any shared env override we just re-sealed must be re-read by the runtime.
    const { invalidateServerEnv } = await import("./server-env.server");
    for (const row of rows ?? []) {
      const envKey = (row as { env_key: string | null }).env_key;
      if (envKey) invalidateServerEnv(envKey);
    }

    return {
      scanned: rows?.length ?? 0,
      resealed,
      alreadyCurrent,
      unrecoverable,
      keysUsed: Array.from(usage.values()).sort((a, b) => b.rows - a.rows),
      primaryFingerprint: fp.primary,
      recoveryKeyFingerprints,
      errors,
    };
  });

/** Deterministic key_version for the current primary key (mirrors the rotation tool). */
async function computeTargetVersion(): Promise<number> {
  const { cryptoProvider, utf8encode } = await import("./crypto-provider.server");
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not configured");
  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
  } else {
    bytes = await cryptoProvider.sha256(utf8encode(raw));
  }
  const h = await cryptoProvider.sha256(bytes);
  const v = ((h[0] << 8) | h[1]) & 0x7fff;
  return v === 0 ? 1 : v;
}

/** Delete rows that no available key can open. Requires explicit ids + confirm. */
export const purgeUnrecoverableVaultRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; confirm: boolean }) => {
    if (!d?.confirm) throw new Error("Confirmation required before deleting vault rows");
    const ids = (d.ids ?? []).filter((id) => typeof id === "string" && id.length > 0);
    if (!ids.length) throw new Error("No rows selected");
    return { ids };
  })
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    await requireAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("vault_secrets")
      .delete()
      .in("id", data.ids)
      .select("id, env_key");
    if (error) throw new Error(error.message);
    const { invalidateServerEnv } = await import("./server-env.server");
    for (const r of rows ?? []) {
      const envKey = (r as { env_key: string | null }).env_key;
      if (envKey) invalidateServerEnv(envKey);
    }
    return { deleted: rows?.length ?? 0 };
  });
