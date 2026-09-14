const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("farmopsDesktop",Object.freeze({selectBackupDestination:()=>ipcRenderer.invoke("farmops:select-backup-destination")}));
