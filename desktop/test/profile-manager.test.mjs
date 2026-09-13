import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeProfile, resetDisposableProfile } from "../src/profile-manager.mjs";

test("resetting Demo never changes Live Farm", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"farmops-profile-"));
  const live=initializeProfile(root,"live"); const demo=initializeProfile(root,"demo");
  fs.writeFileSync(path.join(live.root,"keep.txt"),"live"); fs.writeFileSync(path.join(demo.root,"remove.txt"),"demo");
  resetDisposableProfile(root,"demo");
  assert.equal(fs.readFileSync(path.join(live.root,"keep.txt"),"utf8"),"live");
  assert.equal(fs.existsSync(path.join(demo.root,"remove.txt")),false);
  fs.rmSync(root,{recursive:true,force:true});
});

test("generic reset refuses Live Farm",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"farmops-profile-"));assert.throws(()=>resetDisposableProfile(root,"live"),/audited clear-site/);fs.rmSync(root,{recursive:true,force:true});});
