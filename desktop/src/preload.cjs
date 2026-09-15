const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "farmopsDesktop",
  Object.freeze({
    selectBackupDestination: () => ipcRenderer.invoke("farmops:select-backup-destination"),
    backupNow: () => ipcRenderer.invoke("farmops:backup-now"),
    selectRestorePreview: () => ipcRenderer.invoke("farmops:select-restore-preview"),
    confirmRestore: () => ipcRenderer.invoke("farmops:confirm-restore"),
    cleanupRestoreRollbacks: () => ipcRenderer.invoke("farmops:cleanup-restore-rollbacks"),
    previewBackupRetention: () => ipcRenderer.invoke("farmops:preview-backup-retention"),
    applyBackupRetention: () => ipcRenderer.invoke("farmops:apply-backup-retention"),
    getBackupScheduleStatus: () => ipcRenderer.invoke("farmops:backup-schedule-status"),
    setBackupScheduleEnabled: (enabled) => ipcRenderer.invoke("farmops:set-backup-schedule", enabled),
    listProcedures: () => ipcRenderer.invoke("farmops:list-procedures"),
    createProcedure: (input) => ipcRenderer.invoke("farmops:create-procedure", input),
    updateProcedure: (input) => ipcRenderer.invoke("farmops:update-procedure", input),
    deleteProcedure: (input) => ipcRenderer.invoke("farmops:delete-procedure", input),
  }),
);