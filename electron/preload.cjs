const { contextBridge, ipcRenderer } = require("electron");

/** 只暴露桌面壳自己的两个动作；教材业务仍走本机 HTTP 服务。 */
contextBridge.exposeInMainWorld("desktop", {
  openLogs: () => ipcRenderer.invoke("desktop:open-logs"),
  openWorkspace: () => ipcRenderer.invoke("desktop:open-workspace"),
  pickLibraryFiles: () => ipcRenderer.invoke("desktop:pick-library-files"),
  pickLibraryFolder: () => ipcRenderer.invoke("desktop:pick-library-folder"),
});
