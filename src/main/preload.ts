import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  exitApp: () => ipcRenderer.invoke('exit-app'),
})

declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<{
        momentumTraderDataDir: string
        backendUrl: string
        mainAppUrl: string
      }>
      exitApp: () => Promise<void>
    }
  }
}
