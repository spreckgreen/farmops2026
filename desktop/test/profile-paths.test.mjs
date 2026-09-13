import test from "node:test"; import assert from "node:assert/strict"; import path from "node:path"; import { PROFILE_TYPES, profilePaths } from "../src/profile-paths.mjs";
test("profiles use isolated roots",()=>{const roots=PROFILE_TYPES.map(type=>profilePaths(path.join(path.sep,"tmp","farmops"),type).root);assert.equal(new Set(roots).size,3);});
test("profile assets cannot overlap",()=>{const live=profilePaths("/tmp/farmops","live");const demo=profilePaths("/tmp/farmops","demo");assert.notEqual(live.database,demo.database);assert.notEqual(live.attachments,demo.attachments);assert.notEqual(live.configuration,demo.configuration);});
test("rejects unknown profile types",()=>assert.throws(()=>profilePaths("/tmp/farmops","../live")));
