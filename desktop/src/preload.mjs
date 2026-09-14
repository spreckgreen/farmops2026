import {contextBridge,ipcRenderer} from "electron";
contextBridge.exposeInMainWorld("farmopsDesktop",Object.freeze({selectBackupDestination:()=>ipcRenderer.invoke("farmops:select-backup-destination")}));
