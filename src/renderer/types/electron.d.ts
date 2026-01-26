export {}

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
