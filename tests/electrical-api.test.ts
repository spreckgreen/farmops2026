import { describe, expect, it } from "vitest";
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
    expect(ELECTRICAL_API_BASE).toBe("/api/electrical/v1");
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
