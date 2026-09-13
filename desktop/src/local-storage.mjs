import { DatabaseSync } from "node:sqlite";
import { initializeProfile } from "./profile-manager.mjs";

export const DESKTOP_SCHEMA_VERSION = 1;
export const DEMO_SEED_VERSION = 1;

const DEMO_SITE = Object.freeze({ id: "demo-farm", name: "Demonstration Farm", kind: "demo" });

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
