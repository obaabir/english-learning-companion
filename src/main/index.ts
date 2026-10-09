import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db'
import { getSetting } from './db/repos/settings'
import { getSecret } from './secrets'
import { MpvClient } from './mpv/MpvClient'
import { VlcClient } from './player/VlcClient'
import type { Player } from './player/Player'
import { DEFAULT_MODEL, GeminiService } from './ai/gemini'
import { GoogleService } from './google/GoogleService'
import { registerIpc, send } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    // Small enough to snap to half (or a third) of a laptop screen next to VLC or a browser.
    minWidth: 520,
    minHeight: 480,
    show: false,
    title: 'English Learning Companion',
    backgroundColor: '#f7f6f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // Open external links (e.g. Google Docs) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    const db = openDatabase(join(app.getPath('userData'), 'english-companion.db'))
    const players: Record<'vlc' | 'mpv', Player> = { vlc: new VlcClient(), mpv: new MpvClient() }
    const gemini = new GeminiService(
      () => getSecret(db, 'geminiApiKey'),
      () => getSetting(db, 'geminiModel') || DEFAULT_MODEL
    )
    const google = new GoogleService(db)

    for (const p of Object.values(players)) {
      p.on('status', (status) => send(mainWindow, 'player:status', status))
      p.on('subtitle', (line) => send(mainWindow, 'player:subtitle', line))
    }

    registerIpc({ db, players, gemini, google, window: () => mainWindow })

    // The embedded YouTube player requires a Referer identifying the embedding app. Desktop apps
    // have none, so identify this app by its id (as YouTube asks of native/WebView apps).
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] },
      (details, callback) => {
        if (!details.requestHeaders['Referer']?.startsWith('http://localhost')) {
          details.requestHeaders['Referer'] = 'https://com.abir.english-learning-companion/'
        }
        callback({ requestHeaders: details.requestHeaders })
      }
    )
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    app.on('before-quit', () => {
      for (const p of Object.values(players)) p.quit()
      db.close()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
