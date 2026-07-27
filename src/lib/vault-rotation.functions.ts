// Admin-only server functions to rotate VAULT_ENCRYPTION_KEY safely.
//
// The operator sets VAULT_ENCRYPTION_KEY (new) + VAULT_ENCRYPTION_KEY_OLD
// (previous) on the server and restarts. `open()` in vault-crypto now
// accepts either key; `seal()` always uses the new one. This function
// walks every row and re-seals it with the new key so eventually every
// entry is on the new key alone — at which point the operator can remove
// VAULT_ENCRYPTION_KEY_OLD.
//
// Progress is tracked via vault_secrets.key_version, which is derived
// deterministically from the primary key's fingerprint. That makes the
// job idempotent and safely resumable if it's interrupted.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RotationStatus {
  configured: boolean;
  primaryFingerprint: string | null;
  oldFingerprint: string | null;
  oldKeyPresent: boolean;
  /** smallint target version derived from the primary key. */
  targetVersion: number | null;
  rowsTotal: number;
  rowsOnTarget: number;
  rowsOnOther: number;
  /** map of key_version -> row count for the UI. */
  versionBreakdown: Array<{ key_version: number; count: number }>;
}

export interface RotationRunResult {
  processed: number;
  failed: number;
  remaining: number;
  errors: Array<{ id: string; message: string }>;
  targetVersion: number;
  primaryFingerprint: string;
  oldKeyPresent: boolean;
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

/** Deterministic 15-bit target version from primary key bytes.
 *  Same key → same version; different key → different version.
 *  Fits in smallint (0..32767). */
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
  // 15 bits, avoids the smallint sign bit and value 0 (reserved for legacy default rows)
  const v = ((h[0] << 8) | h[1]) & 0x7fff;
  return v === 0 ? 1 : v;
}

export const getRotationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RotationStatus> => {
    await requireAdmin(context.supabase, context.userId);
    const configured = Boolean(process.env.VAULT_ENCRYPTION_KEY);
    if (!configured) {
      return {
        configured: false,
        primaryFingerprint: null,
        oldFingerprint: null,
        oldKeyPresent: Boolean(process.env.VAULT_ENCRYPTION_KEY_OLD),
        targetVersion: null,
        rowsTotal: 0,
        rowsOnTarget: 0,
        rowsOnOther: 0,
        versionBreakdown: [],
      };
    }

    const { getKeyFingerprints } = await import("./vault-crypto.server");
    const fp = await getKeyFingerprints();
    const targetVersion = await computeTargetVersion();

    const { data: rows, error } = await context.supabase
      .from("vault_secrets")
      .select("key_version");
    if (error) throw new Error(error.message);

    const counts = new Map<number, number>();
    for (const r of rows ?? []) {
      const v = Number((r as { key_version: number }).key_version ?? 1);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const versionBreakdown = Array.from(counts.entries())
      .map(([key_version, count]) => ({ key_version, count }))
      .sort((a, b) => a.key_version - b.key_version);
    const rowsTotal = rows?.length ?? 0;
    const rowsOnTarget = counts.get(targetVersion) ?? 0;
    const rowsOnOther = rowsTotal - rowsOnTarget;

    return {
      configured: true,
      primaryFingerprint: fp.primary,
      oldFingerprint: fp.old,
      oldKeyPresent: fp.old !== null,
      targetVersion,
      rowsTotal,
      rowsOnTarget,
      rowsOnOther,
      versionBreakdown,
    };
  });

export const rotateVaultKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchSize?: number } | undefined) => ({
    batchSize: Math.max(1, Math.min(200, Number(d?.batchSize ?? 50))),
  }))
  .handler(async ({ context, data }): Promise<RotationRunResult> => {
    await requireAdmin(context.supabase, context.userId);
    if (!process.env.VAULT_ENCRYPTION_KEY) {
      throw new Error("VAULT_ENCRYPTION_KEY is not configured");
    }
    const { tryOpenIdentify, seal, getKeyFingerprints } = await import(
      "./vault-crypto.server"
    );
    const fp = await getKeyFingerprints();
    const targetVersion = await computeTargetVersion();

    const { data: batch, error } = await context.supabase
      .from("vault_secrets")
      .select(
        "id, value_ciphertext, value_iv, value_tag, notes_ciphertext, notes_iv, notes_tag, key_version",
      )
      .neq("key_version", targetVersion)
      .limit(data.batchSize);
    if (error) throw new Error(error.message);

    let processed = 0;
    let failed = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const row of batch ?? []) {
      const r = row as {
        id: string;
        value_ciphertext: string;
        value_iv: string;
        value_tag: string;
        notes_ciphertext: string | null;
        notes_iv: string | null;
        notes_tag: string | null;
      };
      try {
        const openedValue = await tryOpenIdentify({
          ciphertext: r.value_ciphertext,
          iv: r.value_iv,
          tag: r.value_tag,
        });
        if (!openedValue) {
          throw new Error(
            "value could not be decrypted with either the primary or the old key",
          );
        }
        let notesPlain: string | null = null;
        if (r.notes_ciphertext && r.notes_iv && r.notes_tag) {
          const openedNotes = await tryOpenIdentify({
            ciphertext: r.notes_ciphertext,
            iv: r.notes_iv,
            tag: r.notes_tag,
          });
          if (!openedNotes) {
            throw new Error(
              "notes could not be decrypted with either the primary or the old key",
            );
          }
          notesPlain = openedNotes.plaintext;
        }

        const v = await seal(openedValue.plaintext);
        const n = notesPlain != null ? await seal(notesPlain) : null;

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
        processed++;
      } catch (e) {
        failed++;
        errors.push({ id: r.id, message: e instanceof Error ? e.message : String(e) });
      }
    }

    // Count remaining after this batch.
    const { count: remainingCount, error: cntErr } = await context.supabase
      .from("vault_secrets")
      .select("id", { count: "exact", head: true })
      .neq("key_version", targetVersion);
    if (cntErr) throw new Error(cntErr.message);

    return {
      processed,
      failed,
      remaining: remainingCount ?? 0,
      errors,
      targetVersion,
      primaryFingerprint: fp.primary,
      oldKeyPresent: fp.old !== null,
    };
  });
