import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createProcedure,
	deleteProcedure,
	listProcedures,
	openProfileDatabase,
	updateProcedure,
	DEMO_SEED_VERSION,
} from "../src/local-storage.mjs";

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

test("creating a procedure on blank creates a local site and returns the new row",()=>{
 const root=tempRoot(); const opened=openProfileDatabase(root,"blank");
 const created=createProcedure(opened.db,"blank",{title:"Barn lockout",body:"Verify power is isolated before service."});
 const procedures=listProcedures(opened.db);
 assert.equal(created.siteId,"blank-farm");
 assert.equal(opened.db.prepare("SELECT count(*) count FROM sites").get().count,1);
 assert.equal(procedures.length,1);
 assert.equal(procedures[0].title,"Barn lockout");
 assert.equal(procedures[0].body,"Verify power is isolated before service.");
 opened.db.close(); fs.rmSync(root,{recursive:true,force:true});
});

test("creating a procedure requires title and body",()=>{
 const root=tempRoot(); const opened=openProfileDatabase(root,"blank");
 assert.throws(()=>createProcedure(opened.db,"blank",{title:"",body:"x"}),/title is required/);
 assert.throws(()=>createProcedure(opened.db,"blank",{title:"x",body:""}),/body is required/);
 opened.db.close(); fs.rmSync(root,{recursive:true,force:true});
});

test("updating and deleting a procedure changes the local list",()=>{
 const root=tempRoot(); const opened=openProfileDatabase(root,"blank");
 const created=createProcedure(opened.db,"blank",{title:"Barn lockout",body:"Verify power is isolated before service."});
 const updated=updateProcedure(opened.db,{id:created.id,title:"Barn lockout updated",body:"Confirm lockout before opening the panel."});
 assert.equal(updated.title,"Barn lockout updated");
 assert.equal(listProcedures(opened.db)[0].title,"Barn lockout updated");
 deleteProcedure(opened.db,{id:created.id});
 assert.equal(listProcedures(opened.db).length,0);
 opened.db.close(); fs.rmSync(root,{recursive:true,force:true});
});

test("updating and deleting require an existing procedure",()=>{
 const root=tempRoot(); const opened=openProfileDatabase(root,"blank");
 assert.throws(()=>updateProcedure(opened.db,{id:"",title:"x",body:"y"}),/id is required/);
 assert.throws(()=>deleteProcedure(opened.db,{id:""}),/id is required/);
 assert.throws(()=>updateProcedure(opened.db,{id:"missing",title:"x",body:"y"}),/not found/);
 assert.throws(()=>deleteProcedure(opened.db,{id:"missing"}),/not found/);
 opened.db.close(); fs.rmSync(root,{recursive:true,force:true});
});
