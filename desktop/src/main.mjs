import { app, BrowserWindow } from "electron";
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { openProfileDatabase } from "./local-storage.mjs";

let profileDatabase;
if (!app.requestSingleInstanceLock()) app.quit();
function ensureIdentity(root){const file=path.join(root,"installation.json");fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({installationId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString()},null,2));}
function createWindow(){const userData=app.getPath("userData");ensureIdentity(userData);const opened=openProfileDatabase(userData,process.env.FARMOPS_PROFILE??"demo");profileDatabase=opened.db;const window=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});const url=process.env.FARMOPS_DESKTOP_URL;if(url)window.loadURL(url);else window.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent("<main><h1>FarmOps Desktop</h1><p>Desktop shell is ready. Configure FARMOPS_DESKTOP_URL for the FarmOps UI during development.</p></main>"));}
app.whenReady().then(createWindow);app.on("before-quit",()=>{profileDatabase?.close();profileDatabase=undefined;});app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
