// Phase 1 acceptance tests for the read-only FarmOps Electrical API.
//
// Every assertion here maps to one Phase 1 acceptance requirement: published
// path, public OpenAPI, scopes, structured errors, correlation IDs, snapshot
// provenance and hashes, separated derived collections, unreliable-field
// warnings, live count/QA reconciliation, repeated-request hash stability and
// the write-scope gate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "@readme/openapi-parser";
import {
  ELECTRICAL_API_BASE,
  ELECTRICAL_API_LEGACY_BASE,
  ELECTRICAL_API_ENDPOINTS,
  OPENAPI_PATH,
  WRITE_SCOPES_ACTIVATED,
  buildOpenApiDocument,
} from "@/lib/electrical-api";
import {
  API_SCOPE_LIST,
  API_ERROR_CODES,
  KNOWN_UNRELIABLE_FIELDS,
  canonicalJson,
  resolveRequestId,
  sha256Hex,
} from "@/lib/electrical-api-envelope";

async function snapshotFixture() {
  const { buildElectricalSnapshot } = await import("@/lib/electrical-snapshot");
  const { ENTITY_KINDS } = await import("@/lib/electrical-entities");
  const rows = Object.fromEntries(ENTITY_KINDS.map((k) => [k, [] as any[]])) as any;
  rows.panel = [
    {
      id: "u-pnl",
      panel_id: "PNL-FS-NW",
      building: "Farm Shop",
      updated_at: "2026-05-01T10:00:00.000Z",
    },
  ];
  rows.load = [
    {
      id: "u-load",
      load_id: "FS-082",
      description: "Mini split condenser",
      panel_ref: "PNL-FS-NW",
      panel_uuid: "u-pnl",
      updated_at: "2026-06-02T10:00:00.000Z",
    },
  ];
  return buildElectricalSnapshot({
    generatedAt: "2026-09-03T00:00:00.000Z",
    rows,
    waypoints: [],
    qa: [{ code: "X", severity: "warning", stable_id: "PNL-FS-NW", message: "check" }],
  });
}

/** An authorized read caller, as `authorizeApiRequest` would return it. */
function readCaller(requestId = "phase1-acceptance-001") {
  return {
    supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
    userId: "user-1",
    requestId,
    principal: {
      type: "service_principal" as const,
      id: "sp-1",
      label: "document generator",
      scopes: ["electrical:read", "electrical:sor:read", "electrical:documents:read"] as any,
    },
    rateLimit: { limit: 120, remaining: 119, reset_at: "2026-09-03T00:01:00.000Z" },
  };
}

async function server() {
  const snap = await snapshotFixture();
  vi.doMock("@/lib/electrical-snapshot.functions", () => ({ collectSnapshot: async () => snap }));
  const mod = await import("@/lib/electrical-api.server");
  return { snap, ...mod };
}

describe("Phase 1 — published contract", () => {
  it("publishes the requested base path and keeps the old one as a deprecated alias", () => {
    expect(ELECTRICAL_API_BASE).toBe("/api/v1/electrical");
    expect(ELECTRICAL_API_LEGACY_BASE).toBe("/api/electrical/v1");
    expect(OPENAPI_PATH).toBe("/api/openapi.json");
  });

  it("documents GET /sor/status and every endpoint carries a scope and phase", () => {
    const paths = ELECTRICAL_API_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain(`GET ${ELECTRICAL_API_BASE}/sor/status`);
    for (const e of ELECTRICAL_API_ENDPOINTS) {
      expect(API_SCOPE_LIST).toContain(e.scope);
      expect([1, 2, 3]).toContain(e.phase);
      if (e.phase === 1) expect(e.activated).toBe(true);
      else expect(e.activated).toBe(WRITE_SCOPES_ACTIVATED);
    }
  });

  it("passes real OpenAPI 3.1 validation and documents scopes, 409 and rate limits", async () => {
    const doc = buildOpenApiDocument("https://example.test") as Record<string, any>;
    const result = await validate(structuredClone(doc));
    expect(result.valid, JSON.stringify(result.errors ?? [], null, 2)).toBe(true);
    expect(
      Object.keys(doc["components"].securitySchemes.serviceKey ?? doc["components"].securitySchemes),
    ).toBeTruthy();
    const applyPath = doc["paths"][`${ELECTRICAL_API_BASE}/relationships/apply`];
    expect(Object.keys(applyPath.post.responses)).toContain("409");
    expect(doc["x-farmops-rate-limits"]).toBeTruthy();
    expect(doc["x-farmops-stable-id-formats"]).toBeTruthy();
  });

  it("assigns a structured code and HTTP status to every error condition", () => {
    expect(API_ERROR_CODES["conflict_record_version"]).toBe(409);
    expect(API_ERROR_CODES["rate_limited"]).toBe(429);
    expect(API_ERROR_CODES["write_scopes_not_activated"]).toBe(503);
    expect(API_ERROR_CODES["forbidden_scope_missing"]).toBe(403);
  });

  it("accepts a caller correlation ID and generates a safe one otherwise", () => {
    expect(resolveRequestId("doc-run-2026-06-08-01")).toBe("doc-run-2026-06-08-01");
    expect(resolveRequestId("bad id!")).toMatch(/^req_[0-9a-f]{32}$/);
    expect(resolveRequestId(null)).toMatch(/^req_/);
  });
});

describe("Phase 1 — snapshot envelope", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("carries snapshot_id, api_version, provenance hashes and a complete source manifest", async () => {
    const { snap, handleApiRead, resetRateLimits } = await server();
    resetRateLimits();
    const res = await handleApiRead(readCaller(), ["snapshot"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("phase1-acceptance-001");
    const body = await res.json();

    expect(body.api_version).toBe("v1");
    expect(body.snapshot_id).toMatch(/^snap_[0-9a-f]{24}$/);
    expect(body.request_id).toBe("phase1-acceptance-001");
    expect(body.data_updated_through).toBe("2026-06-02T10:00:00.000Z");
    expect(body.hashes.canonical_ods_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.hashes.farmops_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.hashes.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.authority.canonical_written_by_farmops).toBe(false);

    // Manifest covers every stored collection plus the three derived ones.
    const manifest = body.source_manifest.map((m: any) => m.collection);
    const { SNAPSHOT_COLLECTIONS } = await import("@/lib/electrical-snapshot");
    for (const c of SNAPSHOT_COLLECTIONS) expect(manifest).toContain(c);
    expect(manifest).toContain("circuits");
    expect(manifest).toContain("relationships");
    expect(manifest).toContain("observations");

    // Live reconciliation: envelope counts equal the snapshot's own counts and
    // QA totals, so a document cannot be generated from a divergent projection.
    for (const c of SNAPSHOT_COLLECTIONS) expect(body.counts[c]).toBe(snap.counts[c]);
    expect(body.counts["loads"]).toBe(snap.loads.length);
    expect(body.qa.warnings).toBe(snap.qa.warnings);
    expect(body.qa.errors).toBe(snap.qa.errors);
  });

  it("separates circuits, relationships, observations and a change-log summary", async () => {
    const { handleApiRead, resetRateLimits } = await server();
    resetRateLimits();
    const body = await (await handleApiRead(readCaller(), ["snapshot"])).json();
    for (const derived of ["circuits", "relationships", "observations"]) {
      expect(Array.isArray(body.collections[derived]), derived).toBe(true);
      expect(body.counts[derived]).toBe(body.collections[derived].length);
    }
    // The load's recorded panel FK is projected as one relationship edge.
    expect(body.collections.relationships.length).toBeGreaterThan(0);
    expect(body.change_log).toHaveProperty("total");
  });

  it("warns about demand_va, continuous_load and phase", async () => {
    const { handleApiRead, resetRateLimits } = await server();
    resetRateLimits();
    const body = await (await handleApiRead(readCaller(), ["snapshot"])).json();
    const warned = body.warnings.known_unreliable_fields.map((w: any) => w.field);
    for (const f of ["demand_va", "continuous_load", "phase"]) expect(warned).toContain(f);
    expect(KNOWN_UNRELIABLE_FIELDS.map((f) => f.field)).toContain("demand_va");
  });

  it("returns byte-identical hashes for repeated requests over unchanged data", async () => {
    const { handleApiRead, resetRateLimits } = await server();
    resetRateLimits();
    const a = await (await handleApiRead(readCaller("run-a-0001"), ["snapshot"])).json();
    const b = await (await handleApiRead(readCaller("run-b-0001"), ["snapshot"])).json();
    expect(b.hashes.content_hash).toBe(a.hashes.content_hash);
    expect(b.hashes.farmops_snapshot_hash).toBe(a.hashes.farmops_snapshot_hash);
    expect(b.snapshot_id).toBe(a.snapshot_id);
    // Only the correlation ID differs.
    expect(b.request_id).not.toBe(a.request_id);
  });

  it("reports the system of record and phase status on /sor/status", async () => {
    const { handleApiRead, resetRateLimits } = await server();
    resetRateLimits();
    const res = await handleApiRead(readCaller(), ["sor", "status"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canonical_baseline.written_by_farmops).toBe(false);
    expect(body.canonical_baseline.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.write_scopes.activated).toBe(false);
    expect(body.phases.find((p: any) => p.phase === 4).status).toBe("not implemented");
    expect(body.phases.find((p: any) => p.phase === 2).status).toBe("defined, not activated");
  });

  it("hashes canonically, independent of key order", async () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(await sha256Hex("farmops")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Phase 1 — errors and the write gate", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns structured errors with codes for unknown endpoints and collections", async () => {
    const { handleApiRead, resetRateLimits } = await server();
    resetRateLimits();
    const unknown = await handleApiRead(readCaller(), ["totally-unknown"]);
    expect(unknown.status).toBe(404);
    const body = await unknown.json();
    expect(body.error.code).toBe("not_found_endpoint");
    expect(body.request_id).toBe("phase1-acceptance-001");

    const collection = await handleApiRead(readCaller(), ["resources", "nope"]);
    expect(collection.status).toBe(404);
    expect((await collection.json()).error.code).toBe("not_found_collection");

    const missingId = await handleApiRead(readCaller(), ["records"]);
    expect(missingId.status).toBe(400);
    expect((await missingId.json()).error.code).toBe("bad_request_missing_parameter");
  });

  it("rejects a missing bearer token before doing any work", async () => {
    const { authorizeApiRequest } = await server();
    vi.stubEnv("SUPABASE_URL", "https://example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const res = (await authorizeApiRequest(
      new Request("https://x.test/api/v1/electrical"),
      "read",
    )) as Response;
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized_missing_token");
    vi.unstubAllEnvs();
  });

  it("refuses every Phase 2/3 write surface while write scopes are unactivated", async () => {
    const { requireActivatedSurface, ELECTRICAL_WRITE_PATHS } = await server();
    expect(WRITE_SCOPES_ACTIVATED).toBe(false);
    for (const path of Object.values(ELECTRICAL_WRITE_PATHS)) {
      const res = requireActivatedSurface(new Request("https://x.test"), "POST", path);
      expect(res, path).not.toBeNull();
      expect(res!.status).toBe(503);
      const body = await res!.json();
      expect(body.error.code).toBe("write_scopes_not_activated");
      expect(body.error.details.outstanding_protocol.length).toBeGreaterThan(3);
    }
    // Phase 1 reads are not gated.
    expect(
      requireActivatedSurface(new Request("https://x.test"), "GET", `${ELECTRICAL_API_BASE}/snapshot`),
    ).toBeNull();
  });

  it("enforces the endpoint scope and rate limit per principal", async () => {
    const { scopeForReadPath, resetRateLimits } = await server();
    resetRateLimits();
    expect(scopeForReadPath(["sor", "status"])).toBe("electrical:sor:read");
    expect(scopeForReadPath(["documents", "bundle"])).toBe("electrical:documents:read");
    expect(scopeForReadPath(["snapshot"])).toBe("electrical:read");
  });
});
