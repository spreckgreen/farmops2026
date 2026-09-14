const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("farmopsDesktop",Object.freeze({selectBackupDestination:()=>ipcRenderer.invoke("farmops:select-backup-destination"),backupNow:()=>ipcRenderer.invoke("farmops:backup-now")}));
