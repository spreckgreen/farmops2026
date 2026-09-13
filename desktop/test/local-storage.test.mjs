import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProfileDatabase, DEMO_SEED_VERSION } from "../src/local-storage.mjs";

function tempRoot(){return fs.mkdtempSync(path.join(os.tmpdir(),"farmops-db-"));}

test("Demo receives versioned seed data while Live and Blank remain empty",()=>{
 const root=tempRoot(); const demo=openProfileDatabase(root,"demo"); const live=openProfileDatabase(root,"live"); const blank=openProfileDatabase(root,"blank");
 assert.equal(demo.db.prepare("SELECT count(*) count FROM sites").get().count,1);
 assert.equal(demo.db.prepare("SELECT value FROM app_metadata WHERE key='demo_seed_version'").get().value,String(DEMO_SEED_VERSION));
 assert.equal(live.db.prepare("SELECT count(*) count FROM sites").get().count,0);
 assert.equal(blank.db.prepare("SELECT count(*) count FROM sites").get().count,0);
 demo.db.close(); live.db.close(); blank.db.close(); fs.rmSync(root,{recursive:true,force:true});
});

test("opening Demo repeatedly is idempotent",()=>{
 const root=tempRoot(); let opened=openProfileDatabase(root,"demo"); opened.db.close(); opened=openProfileDatabase(root,"demo");
 assert.equal(opened.db.prepare("SELECT count(*) count FROM procedures").get().count,1);
 opened.db.close(); fs.rmSync(root,{recursive:true,force:true});
});
