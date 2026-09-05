import { describe, expect, it } from "vitest";
import {
  CLEANING_MODULES,
  clearOrder,
  decideRow,
  moduleByKey,
  moduleKeysForScope,
  modulesForScope,
  normalizeLocation,
  restoreOrder,
  scopeLabel,
  type ScopeDefinition,
  type TableSpec,
} from "@/lib/data-cleaning";

const farmShop: ScopeDefinition = {
  kind: "LOCATION",
  moduleKey: "electrical",
  siteName: "Bostead Farms",
  siteLocations: ["Farm Shop", "House", "Boiler"],
  locationLabel: "Farm Shop",
  singleSite: true,
};

const wholeSite: ScopeDefinition = { ...farmShop, kind: "WHOLE_SITE", moduleKey: null, locationLabel: null };

const loads: TableSpec = { table: "electrical_loads", owner: "user_id", locationColumn: "location" };
const breakers: TableSpec = { table: "electrical_breaker_positions", owner: "user_id" };

describe("scope matching", () => {
  it("matches a location case- and separator-insensitively", () => {
    expect(normalizeLocation("Farm_Shop")).toBe("farm shop");
    expect(decideRow({ location: "farm shop" }, loads, farmShop)).toEqual({
      inScope: true,
      reason: "LOCATION_MATCH",
    });
  });

  it("leaves other locations alone in a location clear", () => {
    expect(decideRow({ location: "House" }, loads, farmShop)).toEqual({
      inScope: false,
      reason: "OTHER_LOCATION",
    });
  });

  it("withholds rows without a location column from a location clear", () => {
    expect(decideRow({ id: "x" }, breakers, farmShop)).toEqual({
      inScope: false,
      reason: "NO_LOCATION_COLUMN",
    });
  });

  it("includes unlocated rows on a whole-site clear only when there is one site", () => {
    expect(decideRow({ id: "x" }, breakers, wholeSite).inScope).toBe(true);
    expect(decideRow({ id: "x" }, breakers, { ...wholeSite, singleSite: false })).toEqual({
      inScope: false,
      reason: "UNLOCATED_MULTI_SITE",
    });
  });

  it("matches any building on the site for a site-wide clear", () => {
    expect(decideRow({ location: "Boiler" }, loads, wholeSite)).toEqual({
      inScope: true,
      reason: "SITE_MATCH",
    });
  });

  it("follows the parent batch for child rows", () => {
    const items: TableSpec = {
      table: "electrical_audit_batch_items",
      owner: "created_by",
      parent: { table: "electrical_audit_batches", column: "batch_uuid" },
    };
    const parents = new Set(["b1"]);
    expect(decideRow({ batch_uuid: "b1" }, items, wholeSite, parents).inScope).toBe(true);
    expect(decideRow({ batch_uuid: "b2" }, items, wholeSite, parents)).toEqual({
      inScope: false,
      reason: "PARENT_OUT_OF_SCOPE",
    });
  });
});

describe("ordering", () => {
  it("clears children before parents and restores in reverse", () => {
    const clear = clearOrder(["electrical"]).map((entry) => entry.spec.table);
    const restore = restoreOrder(["electrical"]).map((spec) => spec.table);
    expect(clear.indexOf("electrical_breaker_positions")).toBeLessThan(clear.indexOf("electrical_panels"));
    expect(restore.indexOf("electrical_panels")).toBeLessThan(restore.indexOf("electrical_breaker_positions"));
    expect(restore).toEqual([...clear].reverse());
  });

  it("stages audit batch items before their batches when clearing", () => {
    const clear = clearOrder(["electrical"]).map((entry) => entry.spec.table);
    expect(clear.indexOf("electrical_audit_batch_items")).toBeLessThan(
      clear.indexOf("electrical_audit_batches"),
    );
  });
});

describe("module registry", () => {
  it("keeps the site module out of module and location clears", () => {
    expect(modulesForScope("MODULE").some((m) => m.key === "site")).toBe(false);
    expect(modulesForScope("LOCATION").some((m) => m.key === "site")).toBe(false);
    expect(modulesForScope("WHOLE_SITE").some((m) => m.key === "site")).toBe(true);
  });

  it("never lists an account, role, subscription or vault table", () => {
    const tables = CLEANING_MODULES.flatMap((m) => m.tables.map((t) => t.table));
    for (const forbidden of [
      "profiles",
      "user_roles",
      "app_subscriptions",
      "app_entitlements",
      "vault_secrets",
      "data_clean_backups",
    ]) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it("lists every table only once", () => {
    const tables = CLEANING_MODULES.flatMap((m) => m.tables.map((t) => t.table));
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("resolves module keys per scope", () => {
    expect(moduleKeysForScope(farmShop)).toEqual(["electrical"]);
    expect(moduleKeysForScope(wholeSite)).toContain("site");
    expect(moduleByKey("inventory")?.paid).toBe(true);
    expect(moduleByKey("procedures")?.paid).toBe(false);
  });

  it("labels a scope for the backup record", () => {
    expect(scopeLabel(farmShop)).toBe("Bostead Farms · Farm Shop · Electrical");
    expect(scopeLabel(wholeSite)).toBe("Bostead Farms · entire site");
  });
});
