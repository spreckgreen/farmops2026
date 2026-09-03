import { describe, expect, it, vi } from "vitest";
import {
  API_RESOURCES,
  ELECTRICAL_API_BASE,
  ELECTRICAL_API_ENDPOINTS,
  ELECTRICAL_API_EXCLUSIONS,
  ELECTRICAL_API_VERSION,
  RELATIONSHIP_CAPABILITIES,
  apiResource,
  buildOpenApiDocument,
  relationSpec,
  relationshipWritableColumns,
  validateObservationProposal,
  validateRelationshipProposal,
} from "@/lib/electrical-api";
import { SNAPSHOT_COLLECTIONS } from "@/lib/electrical-snapshot";

describe("electrical API contract", () => {
  it("is versioned under a stable base path", () => {
    expect(ELECTRICAL_API_VERSION).toBe("v1");
    expect(ELECTRICAL_API_BASE).toBe("/api/v1/electrical");
  });

  it("exposes exactly the snapshot collections as resources", () => {
    expect(API_RESOURCES.map((r) => r.name)).toEqual([...SNAPSHOT_COLLECTIONS]);
    for (const r of API_RESOURCES) {
      expect(r.table).toMatch(/^electrical_/);
      expect(r.purpose.length).toBeGreaterThan(10);
      expect(r.intended_use.length).toBeGreaterThan(10);
    }
    expect(apiResource("loads")?.table).toBe("electrical_loads");
    expect(apiResource("nope")).toBeUndefined();
  });

  it("documents only two write endpoints, both approval-bearing field writes", () => {
    const writes = ELECTRICAL_API_ENDPOINTS.filter((e) => e.writes);
    expect(writes.map((e) => e.path)).toEqual([
      `${ELECTRICAL_API_BASE}/relationships/apply`,
      `${ELECTRICAL_API_BASE}/field-observations/apply`,
    ]);
    for (const w of writes) expect(w.access).toBe("field_write");
    // No generic mutation surface.
    expect(
      ELECTRICAL_API_ENDPOINTS.some((e) => /\{table\}|\/sql|\/query/.test(e.path)),
    ).toBe(false);
  });

  it("states the three exclusions", () => {
    expect(ELECTRICAL_API_EXCLUSIONS.map((e) => e.id)).toEqual([
      "sor_administration",
      "canonical_ods_write_back",
      "unrestricted_mutation",
    ]);
  });

  it("builds a valid OpenAPI document covering every documented path", () => {
    const doc = buildOpenApiDocument("https://example.test") as Record<string, any>;
    expect(doc["openapi"]).toBe("3.1.0");
    expect(doc["servers"][0].url).toBe("https://example.test");
    for (const e of ELECTRICAL_API_ENDPOINTS) {
      const path = e.path;
      expect(doc["paths"][path], `missing ${path}`).toBeTruthy();
      expect(doc["paths"][path][e.method.toLowerCase()]).toBeTruthy();
    }
    expect(doc["components"].securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(doc["x-farmops-exclusions"]).toHaveLength(3);
  });
});

describe("relationship proposals", () => {
  it("accepts a known relation and lists only its writable columns", () => {
    const p = {
      kind: "raceway",
      stable_id: "EMT-104",
      relation: "source_panel_uuid",
      target_stable_id: "PNL-FS-NW",
    };
    expect(validateRelationshipProposal(p)).toEqual([]);
    const spec = relationSpec(p.kind, p.relation)!;
    expect(relationshipWritableColumns(spec)).toEqual([
      "source_panel_uuid",
      "source_endpoint_ref",
      "source_endpoint_type",
    ]);
  });

  it("rejects unknown kinds, unknown relations and non-relationship columns", () => {
    expect(validateRelationshipProposal({ kind: "wormhole", stable_id: "X", relation: "a" })[0]).toMatch(
      /Unknown entity kind/,
    );
    expect(
      validateRelationshipProposal({ kind: "raceway", stable_id: "EMT-104", relation: "amps" }),
    ).toEqual(['"amps" is not a recordable relationship for kind "raceway".']);
    expect(
      validateRelationshipProposal({ kind: "raceway", stable_id: "", relation: "source_panel_uuid" }),
    ).toContain("stable_id is required.");
  });

  it("only advertises capabilities that map to a real FK plus mirror column", () => {
    expect(RELATIONSHIP_CAPABILITIES.length).toBeGreaterThan(5);
    for (const c of RELATIONSHIP_CAPABILITIES) {
      const spec = relationSpec(c.kind, c.relation);
      expect(spec).toBeTruthy();
      expect(spec!.refColumn).toBe(c.mirror_column);
    }
  });
});

describe("field observation proposals", () => {
  it("requires the verbatim observation", () => {
    expect(
      validateObservationProposal({ stable_id: "PNL-FS-NW", field: "install_status", observed_text: "" }),
    ).toContain("observed_text is required — record what was actually seen.");
  });

  it("constrains confidence and verification status", () => {
    const errors = validateObservationProposal({
      stable_id: "FS-082",
      field: "grid",
      observed_text: "C3",
      confidence: "certain",
      verification_status: "done",
    });
    expect(errors).toHaveLength(2);
    expect(
      validateObservationProposal({
        stable_id: "FS-082",
        field: "grid",
        observed_text: "C3",
        confidence: "high",
        verification_status: "verified_as_installed",
      }),
    ).toEqual([]);
  });
});

describe("read handlers project the reconciliation snapshot", () => {
  it("serves collections, records, qa and the document bundle from one snapshot", async () => {
    const { buildElectricalSnapshot, SNAPSHOT_COLLECTIONS: cols } = await import(
      "@/lib/electrical-snapshot"
    );
    const { ENTITY_KINDS } = await import("@/lib/electrical-entities");
    const rows = Object.fromEntries(ENTITY_KINDS.map((k) => [k, [] as any[]])) as any;
    rows.panel = [{ id: "u1", panel_id: "PNL-FS-NW", building: "Farm Shop" }];
    const snap = buildElectricalSnapshot({
      generatedAt: "2026-09-03T00:00:00.000Z",
      rows,
      waypoints: [],
      qa: [{ code: "X", severity: "warning", stable_id: "PNL-FS-NW", message: "check" }],
    });
    vi.doMock("@/lib/electrical-snapshot.functions", () => ({
      collectSnapshot: async () => snap,
    }));
    const { handleApiRead } = await import("@/lib/electrical-api.server");
    const caller = { supabase: {}, userId: "user" };

    const panels = await (await handleApiRead(caller, ["resources", "panels"])).json();
    expect(panels.count).toBe(1);
    expect(panels.records).toEqual(snap.panels);

    const record = await (await handleApiRead(caller, ["records", "PNL-FS-NW"])).json();
    expect(record.count).toBe(1);
    expect(record.collections.panels[0].stable_id).toBe("PNL-FS-NW");
    expect((await handleApiRead(caller, ["records", "PNL-NOPE"])).status).toBe(404);

    const qa = await (await handleApiRead(caller, ["qa"])).json();
    expect(qa.warnings).toBe(snap.qa.warnings);

    const bundle = await (await handleApiRead(caller, ["documents", "bundle"])).json();
    expect(bundle.manifest).toHaveLength(cols.length);
    // The envelope adds derived collections (circuits/relationships/observations)
    // alongside the stored counts, so the stored counts must still match exactly.
    expect(bundle.snapshot.counts).toMatchObject(snap.counts);
    expect(bundle.excluded_by_design).toHaveLength(3);

    expect((await handleApiRead(caller, ["totally-unknown"])).status).toBe(404);
    const index = await (await handleApiRead(caller, [])).json();
    expect(index.base_path).toBe(ELECTRICAL_API_BASE);
    vi.doUnmock("@/lib/electrical-snapshot.functions");
  });
});
