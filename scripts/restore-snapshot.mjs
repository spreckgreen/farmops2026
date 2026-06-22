#!/usr/bin/env node
// Self-hosted CLI restore for Bostead snapshot files.
//
// Mirrors the admin `importApplicationData` server function (see
// src/lib/admin.functions.ts) but talks directly to PostgREST using
// SUPABASE_SERVICE_ROLE_KEY, so it works on any host that has the .env
// values check-env.sh validates — Docker containers and bare Node.js
// deployments included.
//
// Usage:
//   node scripts/restore-snapshot.mjs \
//     --file ./bostead-snapshot-2026-06-22.json \
//     --mode merge
//
//   node scripts/restore-snapshot.mjs \
//     --file ./bostead-snapshot-2026-06-22.json \
//     --mode replace --confirm REPLACE --yes
//
// Flags:
//   --file <path>                Snapshot JSON to restore (required).
//   --mode <merge|replace>       merge (default): upsert by id.
//                                replace: delete every operational row first.
//   --confirm REPLACE            Required when --mode replace.
//   --allow-missing-integrity    Allow pre-integrity (legacy) snapshots.
//   --yes                        Skip the interactive confirmation prompt.
//   --env <path>                 .env file to load (default: ./.env).
//
// Exit codes: 0 ok, 1 user/config error, 2 integrity failure,
// 3 one or more table writes failed.

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit, env } from "node:process";
import { createClient } from "@supabase/supabase-js";

// Must match RESTORE_INSERT_ORDER in src/lib/admin.functions.ts
// (parents before children to satisfy FK constraints).
const RESTORE_INSERT_ORDER = [
  "food_price_history",
  "food_plan_people",
  "food_plan_foods",
  "food_plan_entries",
  "food_storage_plan",
  "food_storage_items",
  "plant_seasons",
  "livestock_animals",
  "orchard_trees",
  "garden_plots",
  "crop_plantings",
  "crop_harvests",
  "inventory_items",
  "consumables",
  "maintenance_records",
  "projects",
  "tasks",
  "daily_notes",
  "summaries",
  "activity_log",
];

function parseArgs(rawArgs) {
  const out = { mode: "merge", env: ".env" };
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    const take = () => rawArgs[++i];
    switch (a) {
      case "--file": out.file = take(); break;
      case "--mode": out.mode = take(); break;
      case "--confirm": out.confirm = take(); break;
      case "--env": out.env = take(); break;
      case "--allow-missing-integrity": out.allowMissingIntegrity = true; break;
      case "--yes": case "-y": out.yes = true; break;
      case "--help": case "-h": out.help = true; break;
      default:
        console.error(`Unknown flag: ${a}`);
        exit(1);
    }
  }
  return out;
}

async function loadDotEnv(path) {
  try {
    const txt = await readFile(path, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in env)) env[m[1]] = v;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

// Inlined canonical stringify + sha256 (matches src/lib/snapshot-integrity.ts).
function canonicalize(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    out[k] = canonicalize(v[k]);
  }
  return out;
}
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyIntegrity(snapshot) {
  const integ = snapshot.integrity;
  if (!integ) return { ok: false, missing: true };
  const subset = {};
  for (const k of integ.covered) subset[k] = snapshot[k];
  const actual = await sha256Hex(JSON.stringify(canonicalize(subset)));
  return actual === integ.value
    ? { ok: true, value: integ.value }
    : { ok: false, expected: integ.value, actual };
}

async function main() {
  const args = parseArgs(argv.slice(2));
  if (args.help || !args.file) {
    console.log("Usage: node scripts/restore-snapshot.mjs --file <snapshot.json> [--mode merge|replace] [--confirm REPLACE] [--allow-missing-integrity] [--yes]");
    exit(args.help ? 0 : 1);
  }
  if (args.mode !== "merge" && args.mode !== "replace") {
    console.error(`--mode must be 'merge' or 'replace' (got '${args.mode}')`);
    exit(1);
  }
  if (args.mode === "replace" && args.confirm !== "REPLACE") {
    console.error('--mode replace requires --confirm REPLACE');
    exit(1);
  }

  await loadDotEnv(args.env);
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Run scripts/check-env.sh first.");
    exit(1);
  }

  console.log(`→ Reading snapshot: ${args.file}`);
  const snapshot = JSON.parse(await readFile(args.file, "utf8"));
  if (snapshot.app !== "bostead" || snapshot.version !== 1) {
    console.error('Not a Bostead v1 snapshot (expected {"app":"bostead","version":1}).');
    exit(1);
  }

  console.log("→ Verifying SHA-256 integrity…");
  const verdict = await verifyIntegrity(snapshot);
  if (verdict.missing) {
    if (!args.allowMissingIntegrity) {
      console.error("  ✗ Snapshot has no integrity digest. Re-export, or pass --allow-missing-integrity.");
      exit(2);
    }
    console.warn("  ! No digest present — proceeding because --allow-missing-integrity was set.");
  } else if (!verdict.ok) {
    console.error(`  ✗ Checksum mismatch — refusing to restore.`);
    console.error(`    expected ${verdict.expected}`);
    console.error(`    actual   ${verdict.actual}`);
    exit(2);
  } else {
    console.log(`  ✓ Verified (${verdict.value.slice(0, 12)}…)`);
  }

  console.log(`→ Target:  ${url}`);
  console.log(`→ Mode:    ${args.mode}${args.mode === "replace" ? " (DESTRUCTIVE — every operational row will be deleted first)" : ""}`);
  console.log(`→ Tables:  ${snapshot.tables.length} in snapshot`);

  if (!args.yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    const ans = await rl.question("Proceed? [y/N] ");
    rl.close();
    if (!/^y(es)?$/i.test(ans.trim())) {
      console.log("Aborted.");
      exit(1);
    }
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const byTable = new Map(snapshot.tables.map((t) => [t.table, t]));
  const results = [];
  const startedAt = new Date();

  for (const table of RESTORE_INSERT_ORDER) {
    const snap = byTable.get(table);
    const rows = snap?.rows ?? [];
    let deleted = 0;
    let succeeded = 0;
    let error;
    try {
      if (args.mode === "replace") {
        const { count, error: delErr } = await supabase
          .from(table).delete({ count: "exact" }).not("id", "is", null);
        if (delErr) throw new Error(`delete failed: ${delErr.message}`);
        deleted = count ?? 0;
      }
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const q = args.mode === "replace"
          ? supabase.from(table).insert(chunk)
          : supabase.from(table).upsert(chunk, { onConflict: "id" });
        const { error: wErr } = await q;
        if (wErr) throw new Error(`write failed at chunk ${i}: ${wErr.message}`);
        succeeded += chunk.length;
      }
    } catch (e) {
      error = e.message;
    }
    results.push({ table, attempted: rows.length, deleted, succeeded, error });
    const status = error ? "✗" : "✓";
    const detail = args.mode === "replace" ? `deleted=${deleted} inserted=${succeeded}/${rows.length}` : `upserted=${succeeded}/${rows.length}`;
    console.log(`  ${status} ${table.padEnd(24)} ${detail}${error ? `  — ${error}` : ""}`);
  }

  const ok = results.every((r) => !r.error);
  const ms = Date.now() - startedAt.getTime();
  console.log(`\n${ok ? "✓ Restore complete" : "✗ Restore finished with errors"} in ${ms} ms.`);
  exit(ok ? 0 : 3);
}

main().catch((e) => {
  console.error(`\nFatal: ${e.message}`);
  exit(1);
});
