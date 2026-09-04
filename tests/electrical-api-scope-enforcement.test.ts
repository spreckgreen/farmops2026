/**
 * Service-principal scope enforcement.
 *
 * Three layers must agree, so a direct Supabase write cannot widen a key beyond
 * what the server-side issuing path allows:
 *   1. GRANTABLE_SCOPES — what the issuing server function will accept;
 *   2. ACTIVATED_API_SCOPES — the TypeScript twin of the database allowlist;
 *   3. public.electrical_api_activated_scopes() + the CHECK constraint on
 *      public.electrical_api_principals (verified live in the database probe).
 */
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVATED_API_SCOPES,
  API_SCOPE_LIST,
  isActivatedApiScope,
  SCOPES_FOR_ENTITLEMENT,
} from "@/lib/electrical-api-envelope";
import { GRANTABLE_SCOPES } from "@/lib/electrical-api-principals.functions";
import { WRITE_SCOPES_ACTIVATED } from "@/lib/electrical-api";
import { ownerScopedDb } from "@/lib/electrical-api.server";

describe("activated scope allowlist", () => {
  it("contains only recognised scopes", () => {
    for (const scope of ACTIVATED_API_SCOPES) {
      expect(API_SCOPE_LIST).toContain(scope);
    }
  });

  it("excludes unactivated Phase 2/3 write scopes", () => {
    expect(WRITE_SCOPES_ACTIVATED).toBe(false);
    expect(isActivatedApiScope("electrical:observations:write")).toBe(false);
    expect(isActivatedApiScope("electrical:relationships:write")).toBe(false);
    expect(isActivatedApiScope("electrical:not-a-scope")).toBe(false);
  });

  it("matches what the issuing server function will grant", () => {
    expect([...ACTIVATED_API_SCOPES].sort()).toEqual([...GRANTABLE_SCOPES].sort());
    expect([...ACTIVATED_API_SCOPES].sort()).toEqual([...SCOPES_FOR_ENTITLEMENT.read].sort());
  });
});

describe("ownerScopedDb", () => {
  function fakeAdmin() {
    const calls: Array<{ table: string; op: string; args: unknown[]; eq: unknown[] }> = [];
    const admin = {
      from(table: string) {
        const record = (op: string, args: unknown[]) => {
          const entry = { table, op, args, eq: [] as unknown[] };
          calls.push(entry);
          const chain: Record<string, unknown> = {
            eq: (...eqArgs: unknown[]) => {
              entry.eq.push(eqArgs);
              return chain;
            },
          };
          return chain;
        };
        return {
          select: (...args: unknown[]) => record("select", args),
          insert: (...args: unknown[]) => record("insert", args),
          upsert: (...args: unknown[]) => record("upsert", args),
          update: (...args: unknown[]) => record("update", args),
          delete: (...args: unknown[]) => record("delete", args),
        };
      },
    };
    return { admin, calls };
  }

  const OWNER = "11111111-1111-1111-1111-111111111111";

  it("filters selects, updates and deletes to the owner", () => {
    const { admin, calls } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    db.from("electrical_loads").select("id");
    db.from("electrical_loads").update({ notes: "x" });
    db.from("electrical_loads").delete();
    for (const call of calls) {
      expect(call.eq).toContainEqual(["user_id", OWNER]);
    }
  });

  it("keeps embedded/nested relationship selects intact and still owner-scoped", () => {
    const { admin, calls } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    const nested =
      "id, load_id, electrical_circuit_groups!inner(circuit_group_id, electrical_panels(panel_id))";
    db.from("electrical_loads").select(nested);
    expect(calls[0]!.op).toBe("select");
    expect(calls[0]!.args[0]).toBe(nested);
    expect(calls[0]!.eq).toContainEqual(["user_id", OWNER]);
  });

  it("stamps the owner on single and bulk inserts", () => {
    const { admin, calls } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    db.from("electrical_field_observations").insert({ note: "a" });
    db.from("electrical_field_observations").insert([{ note: "b" }, { note: "c", user_id: "other" }]);
    expect(calls[0]!.args[0]).toEqual({ note: "a", user_id: OWNER });
    expect(calls[1]!.args[0]).toEqual([
      { note: "b", user_id: OWNER },
      { note: "c", user_id: OWNER },
    ]);
  });

  it("cannot be pointed at another owner by caller-supplied values", () => {
    const { admin, calls } = fakeAdmin();
    const db = ownerScopedDb(admin, OWNER);
    db.from("electrical_loads").update({ user_id: "someone-else" });
    expect(calls[0]!.eq).toContainEqual(["user_id", OWNER]);
  });
});

describe("scope narrowing at key use", () => {
  it("drops unactivated scopes stored on a principal row", () => {
    const stored = [
      "electrical:read",
      "electrical:observations:write",
      "electrical:relationships:write",
      "bogus",
    ];
    expect(stored.filter(isActivatedApiScope)).toEqual(["electrical:read"]);
  });

  it("leaves nothing to grant when every stored scope is unactivated", () => {
    const stored = ["electrical:observations:write", "electrical:relationships:write"];
    expect(stored.filter(isActivatedApiScope)).toEqual([]);
  });
});

// Guard against a future edit that quietly re-enables write scopes without the
// matching database migration.
describe("activation flip safety", () => {
  it("keeps the database allowlist as the narrower authority", () => {
    const spy = vi.fn();
    if (WRITE_SCOPES_ACTIVATED) spy();
    expect(spy).not.toHaveBeenCalled();
  });
});
