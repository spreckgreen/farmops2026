// Server-only collector for the cross-deployment bundle. Read-only.
import {
  BUNDLE_KINDS,
  BUNDLE_KIND_LIST,
  buildPeerBundle,
  type BundleKind,
  type PeerBundle,
  type PeerBundleBatch,
} from "@/lib/electrical-peer-bundle";

type LooseDb = { from: (table: string) => any };

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

export async function collectPeerBundle(
  db: LooseDb,
  options: { origin: string; includeManifests?: boolean },
): Promise<PeerBundle> {
  const includeManifests = options.includeManifests !== false;
  const rows: Partial<Record<BundleKind, Record<string, unknown>[]>> = {};
  for (const kind of BUNDLE_KIND_LIST) {
    const c = BUNDLE_KINDS[kind];
    const { data, error } = await db
      .from(c.table)
      .select(["id", c.idColumn, "description", "updated_at", ...c.fields].join(", "));
    if (error) throw new Error(error.message);
    rows[kind] = (data ?? []) as Record<string, unknown>[];
  }

  const select = [
    "batch_id",
    "title",
    "status",
    "applied_at",
    "manifest_sha256",
    ...(includeManifests ? ["manifest"] : []),
  ].join(", ");
  const { data: batchRows, error } = await db
    .from("electrical_audit_batches")
    .select(select)
    .in("status", ["applied", "partially_applied"]);
  if (error) throw new Error(error.message);

  const batches: PeerBundleBatch[] = ((batchRows ?? []) as Record<string, unknown>[]).map((b) => ({
    batch_id: s(b["batch_id"]),
    title: s(b["title"]) || null,
    status: s(b["status"]) || null,
    applied_at: s(b["applied_at"]) || null,
    manifest_sha256: s(b["manifest_sha256"]) || null,
    manifest: includeManifests
      ? ((b["manifest"] ?? null) as Record<string, unknown> | null)
      : null,
  }));

  return buildPeerBundle({
    generatedAt: new Date().toISOString(),
    origin: options.origin,
    rows,
    batches,
  });
}
