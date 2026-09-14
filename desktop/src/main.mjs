import { app, BrowserWindow } from "electron";
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { openProfileDatabase, DESKTOP_SCHEMA_VERSION } from "./local-storage.mjs"; import { buildDesktopHealthHtml } from "./health-screen.mjs";

let profileDatabase;
if (!app.requestSingleInstanceLock()) app.quit();
function ensureIdentity(root){const file=path.join(root,"installation.json");fs.mkdirSync(root,{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({installationId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString()},null,2));}
function createWindow(){const userData=app.getPath("userData");ensureIdentity(userData);const profileType=process.env.FARMOPS_PROFILE??"demo";const opened=openProfileDatabase(userData,profileType);profileDatabase=opened.db;const window=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});const url=process.env.FARMOPS_DESKTOP_URL;if(url)window.loadURL(url);else window.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(buildDesktopHealthHtml({profileType,schemaVersion:DESKTOP_SCHEMA_VERSION,databasePath:opened.profile.database,appVersion:app.getVersion()})));}
app.whenReady().then(createWindow);app.on("before-quit",()=>{profileDatabase?.close();profileDatabase=undefined;});app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
