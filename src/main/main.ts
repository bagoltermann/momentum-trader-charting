import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Momentum Trader Charts',
  })

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    // DevTools: press Ctrl+Shift+I to open manually
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Signal backend to shutdown before quitting
    try {
      const http = require('http')
      const req = http.request({
        hostname: 'localhost',
        port: 8081,
        path: '/api/shutdown',
        method: 'POST',
      })
      req.on('error', () => {}) // Ignore errors - backend might already be down
      req.end()
    } catch (e) {
      // Ignore - backend might already be down
    }
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// IPC handlers for backend communication
ipcMain.handle('get-config', async () => {
  // Return configuration
  return {
    momentumTraderDataDir: '../momentum-trader/data',
    backendUrl: 'http://localhost:8081',
    mainAppUrl: 'http://localhost:8080',
  }
})

// Exit app handler - signals backend to shutdown, then quits
ipcMain.handle('exit-app', async () => {
  try {
    // Signal backend to shutdown (launcher watches for Electron exit and cleans up)
    const http = require('http')
    const req = http.request({
      hostname: 'localhost',
      port: 8081,
      path: '/api/shutdown',
      method: 'POST',
    })
    req.on('error', () => {}) // Ignore errors - backend might already be down
    req.end()
  } catch (e) {
    // Ignore - backend might already be down
  }
  app.quit()
})
