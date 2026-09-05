/**
 * Service-principal ownership scoping for the audit-batch export path.
 *
 * A `farmops_sk_*` key has no Supabase session, so RLS cannot scope it. The
 * ownership boundary is re-imposed by ownerScopedDb(), which must use each
 * table's REAL owner column (`created_by` on electrical_audit_batches) and must
 * refuse tables that carry no owner column at all
 * (electrical_audit_batch_items) — those are reachable only through an
 * owner-scoped parent batch.
 */
import { describe, expect, it } from "vitest";

import {
  fetchOwnedBatchItems,
  handleApiRead,
  ownerColumnFor,
  ownerScopedDb,
  type ApiCaller,
} from "@/lib/electrical-api.server";
import { manifestChecksum } from "@/lib/electrical-audit-batch";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const R2 = "FA-FS-2026-09-03-PM-R2";

const R2_MANIFEST = {
  schema_version: "farmops.electrical.audit-batch.v1",
  batch_id: R2,
  title: "Farm Shop field audit (R2)",
  items: [
    {
      item_key: "cg1",
      entity_kind: "circuit_group",
      target_stable_id: "CG-FS-008",
      operation: "CREATE",
      fields: { circuit_rating_amps: 20 },
    },
  ],
};

interface BatchRow {
  id: string;
  batch_id: string;
  created_by: string;
  manifest?: unknown;
  manifest_sha256?: string | null;
  status?: string;
  [key: string]: unknown;
}

/**
 * Minimal PostgREST-shaped fake. It applies `.eq()` filters itself, so any
 * missing owner filter shows up as a cross-owner row leaking into the result.
 */
function fakeAdmin(options?: { failTable?: string }) {
  const batches: BatchRow[] = [
    {
      id: "batch-uuid-owner",
      batch_id: R2,
      created_by: OWNER,
      status: "validated",
      manifest: R2_MANIFEST,
      created_at: "2026-09-03T18:00:00Z",
    },
    {
      id: "batch-uuid-other",
      batch_id: "FA-OTHER-2026-09-01",
      created_by: OTHER,
      status: "applied",
      manifest: { schema_version: "x", batch_id: "FA-OTHER-2026-09-01", items: [] },
      created_at: "2026-09-01T18:00:00Z",
    },
  ];
  const items: Record<string, unknown>[] = [
    { id: "i1", batch_uuid: "batch-uuid-owner", item_key: "cg1" },
    { id: "i2", batch_uuid: "batch-uuid-other", item_key: "secret" },
  ];
  const tables: Record<string, Record<string, unknown>[]> = {
    electrical_audit_batches: batches as unknown as Record<string, unknown>[],
    electrical_audit_batch_items: items,
  };
  const touched: string[] = [];

  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    const chain = {
      eq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] === value);
        return chain;
      },
      order() {
        return chain;
      },
      maybeSingle() {
        if (options?.failTable === table) {
          return Promise.resolve({ data: null, error: { message: "connection reset" } });
        }
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        if (options?.failTable === table) {
          return Promise.resolve({ data: null, error: { message: "connection reset" } }).then(resolve);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return chain;
  }

  return {
    admin: {
      from(table: string) {
        touched.push(table);
        return {
          select: () => builder(table),
          insert: () => builder(table),
          upsert: () => builder(table),
          update: () => builder(table),
          delete: () => builder(table),
        };
      },
    },
    touched,
  };
}

function callerFor(ownerUserId: string, options?: { failTable?: string }): ApiCaller {
  const { admin } = fakeAdmin(options);
  return {
    supabase: ownerScopedDb(admin, ownerUserId),
    userId: ownerUserId,
    principal: {
      type: "service_principal",
      id: "principal-1",
      label: "peer puller",
      scopes: ["electrical:read", "electrical:audit-batches:read"],
    },
  } as ApiCaller;
}

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("owner column per table", () => {
  it("scopes audit batches by created_by and ordinary records by user_id", () => {
    expect(ownerColumnFor("electrical_audit_batches")).toBe("created_by");
    expect(ownerColumnFor("electrical_loads")).toBe("user_id");
    expect(ownerColumnFor("electrical_panels")).toBe("user_id");
  });

  it("has no owner column for batch items", () => {
    expect(ownerColumnFor("electrical_audit_batch_items")).toBeNull();
  });

  it("refuses any direct unscoped service-role read of batch items", () => {
    const { admin } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    expect(() => db.from("electrical_audit_batch_items").select("*")).toThrow(/no owner column/);
    expect(() => db.from("electrical_audit_batch_items").insert({})).toThrow(/no owner column/);
    expect(() => db.from("electrical_audit_batch_items").delete()).toThrow(/no owner column/);
  });
});

describe("audit-batch list and manifest export", () => {
  it("lists the owner's R2 batch and nothing belonging to another owner", async () => {
    const res = await handleApiRead(callerFor(OWNER), ["audit-batches"]);
    expect(res.status).toBe(200);
    const payload = await body(res);
    const ids = (payload["batches"] as Record<string, unknown>[]).map((b) => b["batch_id"]);
    expect(ids).toContain(R2);
    expect(ids).not.toContain("FA-OTHER-2026-09-01");
  });

  it("returns 200 with the original fingerprint for the owner's R2 manifest", async () => {
    const res = await handleApiRead(callerFor(OWNER), ["audit-batches", R2, "manifest"]);
    expect(res.status).toBe(200);
    const payload = await body(res);
    expect(payload["batch_id"]).toBe(R2);
    expect(payload["recomputed_manifest_sha256"]).toBe(await manifestChecksum(R2_MANIFEST));
    expect(payload["manifest"]).toEqual(R2_MANIFEST);
  });

  it("hides another owner's batch behind a 404", async () => {
    const res = await handleApiRead(callerFor(OWNER), [
      "audit-batches",
      "FA-OTHER-2026-09-01",
      "manifest",
    ]);
    expect(res.status).toBe(404);
    const payload = await body(res);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("reports a query failure as 500 backend_query_failed, not 'batch not found'", async () => {
    const failing = callerFor(OWNER, { failTable: "electrical_audit_batches" });
    const manifestRes = await handleApiRead(failing, ["audit-batches", R2, "manifest"]);
    expect(manifestRes.status).toBe(500);
    expect(JSON.stringify(await body(manifestRes))).toContain("backend_query_failed");

    const listRes = await handleApiRead(failing, ["audit-batches"]);
    expect(listRes.status).toBe(500);
    expect(JSON.stringify(await body(listRes))).toContain("backend_query_failed");
  });

  it("states the importer contract: staging only, approval required, no auto-apply", async () => {
    const payload = await body(await handleApiRead(callerFor(OWNER), ["audit-batches", R2, "manifest"]));
    const contract = payload["staging_contract"] as Record<string, unknown>;
    expect(contract["direction"]).toBe("export only");
    const requirements = (contract["importer_requirements"] as string[]).join(" ");
    expect(requirements).toMatch(/never auto-apply/);
    expect(requirements).toMatch(/per-item owner approval/);
    // No approval state of any kind is transferable through the export.
    expect(payload["approved_items"]).toBeUndefined();
    expect(payload["approvals"]).toBeUndefined();
    const manifest = payload["manifest"] as { items: Record<string, unknown>[] };
    for (const item of manifest.items) {
      expect(item["approved"]).toBeUndefined();
      expect(item["approved_at"]).toBeUndefined();
      expect(item["approved_by"]).toBeUndefined();
    }
  });
});

describe("batch items via an owner-scoped parent", () => {
  it("returns only the parent batch's items", async () => {
    const { admin } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    const result = await fetchOwnedBatchItems(db, R2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i["item_key"])).toEqual(["cg1"]);
  });

  it("cannot cross the parent ownership boundary", async () => {
    const { admin } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    const result = await fetchOwnedBatchItems(db, "FA-OTHER-2026-09-01");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });

  it("distinguishes a query failure from a missing batch", async () => {
    const { admin } = fakeAdmin({ failTable: "electrical_audit_batches" });
    const db = ownerScopedDb(admin, OWNER);
    const result = await fetchOwnedBatchItems(db, R2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("query_failed");
  });
});
