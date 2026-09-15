import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { initializeProfile } from "./profile-manager.mjs";

export const DESKTOP_SCHEMA_VERSION = 1;
export const DEMO_SEED_VERSION = 1;

const DEMO_SITE = Object.freeze({ id: "demo-farm", name: "Demonstration Farm", kind: "demo" });

const PROFILE_SITE_DEFAULTS = Object.freeze({
  live: { id: "live-farm", name: "Live Farm" },
  demo: DEMO_SITE,
  blank: { id: "blank-farm", name: "Blank Farm" },
});

export function openProfileDatabase(userDataRoot, profileType) {
  const profile = initializeProfile(userDataRoot, profileType);
  const db = new DatabaseSync(profile.database);
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('live','demo','blank')));
    CREATE TABLE IF NOT EXISTS procedures (id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL);`);
  db.prepare("INSERT OR REPLACE INTO app_metadata(key,value) VALUES (?,?)").run("schema_version", String(DESKTOP_SCHEMA_VERSION));
  if (profileType === "demo") seedDemo(db);
  return { db, profile };
}

export function listProcedures(db) {
  return db
    .prepare(
      "SELECT id, site_id AS siteId, title, body FROM procedures ORDER BY title COLLATE NOCASE ASC",
    )
    .all()
    .map((row) => ({
      id: row.id,
      siteId: row.siteId,
      title: row.title,
      body: row.body,
    }));
}

export function createProcedure(db, profileType, input) {
  const { title, body } = normalizeProcedureInput(input);

  const siteId = ensurePrimarySite(db, profileType);
  const id = `procedure-${crypto.randomUUID()}`;
  db.prepare("INSERT INTO procedures(id, site_id, title, body) VALUES (?,?,?,?)").run(
    id,
    siteId,
    title,
    body,
  );

  return { id, siteId, title, body };
}

export function updateProcedure(db, input) {
  const id = String(input?.id ?? "").trim();
  if (!id) throw new Error("Procedure id is required");

  const existing = db
    .prepare("SELECT id, site_id AS siteId FROM procedures WHERE id = ?")
    .get(id);
  if (!existing) throw new Error("Procedure not found");

  const { title, body } = normalizeProcedureInput(input);
  db.prepare("UPDATE procedures SET title = ?, body = ? WHERE id = ?").run(title, body, id);
  return { id, siteId: existing.siteId, title, body };
}

export function deleteProcedure(db, input) {
  const id = String(input?.id ?? "").trim();
  if (!id) throw new Error("Procedure id is required");

  const existing = db.prepare("SELECT id FROM procedures WHERE id = ?").get(id);
  if (!existing) throw new Error("Procedure not found");

  db.prepare("DELETE FROM procedures WHERE id = ?").run(id);
  return { id };
}

function normalizeProcedureInput(input) {
  const title = String(input?.title ?? "").trim();
  const body = String(input?.body ?? "").trim();
  if (!title) throw new Error("Procedure title is required");
  if (!body) throw new Error("Procedure body is required");
  return { title, body };
}

function ensurePrimarySite(db, profileType) {
  const existing = db.prepare("SELECT id FROM sites ORDER BY id LIMIT 1").get();
  if (existing?.id) return existing.id;

  const fallback = PROFILE_SITE_DEFAULTS[profileType] ?? PROFILE_SITE_DEFAULTS.blank;
  db.prepare("INSERT INTO sites(id, name, kind) VALUES (?,?,?)").run(
    fallback.id,
    fallback.name,
    profileType,
  );
  return fallback.id;
}

function seedDemo(db) {
  const current = db.prepare("SELECT value FROM app_metadata WHERE key=?").get("demo_seed_version");
  if (current?.value === String(DEMO_SEED_VERSION)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR REPLACE INTO sites(id,name,kind) VALUES (?,?,?)").run(DEMO_SITE.id, DEMO_SITE.name, DEMO_SITE.kind);
    db.prepare("INSERT OR REPLACE INTO procedures(id,site_id,title,body) VALUES (?,?,?,?)").run("demo-procedure-well-check", DEMO_SITE.id, "Weekly well-system check", "Inspect pressure, leaks, and pump status; record findings.");
    db.prepare("INSERT OR REPLACE INTO app_metadata(key,value) VALUES (?,?)").run("demo_seed_version", String(DEMO_SEED_VERSION));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
