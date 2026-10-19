import { app, BrowserWindow, dialog, safeStorage, session, shell } from 'electron'
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
import { startChromeBridge } from './bridge/chromeBridge'
import { backupBeforeMerge, copyPrivateImages, findPrivateCopies, markPrivateCopyMerged, mergePrivateCopy, runningInPrivateSpace, type MergeReport } from './dataSplit'

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
      sandbox: false,
      // The Articles section's in-app browser (locked down in secureArticleBrowser).
      webviewTag: true
    }
  })
  secureArticleBrowser(mainWindow)

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

/** The in-app browser's own storage (cookies, logins), separate from the app's. */
const ARTICLE_PARTITION = 'persist:articles'

/**
 * The Articles in-app browser is a Chromium <webview>. Websites run sandboxed with no access to the
 * app; our small preload only reports the text you select and the readable article text. Pages can't
 * open popups (links open in the same view), leave http/https, or use camera/mic/location.
 */
function secureArticleBrowser(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== ARTICLE_PARTITION || !/^(https?:\/\/|about:blank)/.test(params.src ?? '')) {
      event.preventDefault()
      return
    }
    webPreferences.preload = join(__dirname, '../preload/article.js')
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void guest.loadURL(url)
      return { action: 'deny' }
    })
    guest.on('will-navigate', (e, url) => {
      if (!/^(https?:\/\/|about:blank)/.test(url)) e.preventDefault()
    })
  })
}

function lockArticleSession(): void {
  const ses = session.fromPartition(ARTICLE_PARTITION)
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write'])
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
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
    const userData = app.getPath('userData')
    // Started by another (packaged) program, e.g. the Claude app: Windows would save everything in that
    // program's private folder and the words would seem to disappear later. Don't start like that.
    if (runningInPrivateSpace(userData)) {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'English Learning Companion',
        message: 'Please open English Learning Companion from its Desktop or Start-menu shortcut.',
        detail:
          'It was started by another program (for example the Claude app). Windows would then save your words in that program’s private folder, so they would seem to disappear later. Nothing was changed. Close this message and open the app from its shortcut.'
      })
      app.quit()
      return
    }
    // Words saved earlier while the app ran inside another program's private folder: back up, then add them here.
    const privateCopies = findPrivateCopies(userData)
    let backupDir: string | null = null
    if (privateCopies.length) {
      try {
        backupDir = backupBeforeMerge(userData, privateCopies)
      } catch (err) {
        console.warn('Backup before merging failed; not merging:', err)
      }
    }
    const db = openDatabase(join(userData, 'english-companion.db'))
    const merged: MergeReport[] = []
    const mergeErrors: string[] = []
    if (backupDir) {
      const decrypt = (stored: string): string | null => {
        try {
          const [scheme, payload] = stored.split(':', 2)
          const buf = Buffer.from(payload ?? '', 'base64')
          return scheme === 'enc' ? safeStorage.decryptString(buf) : buf.toString('utf8')
        } catch {
          return null
        }
      }
      const encrypt = (plain: string): string =>
        safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : `raw:${Buffer.from(plain, 'utf8').toString('base64')}`
      for (const dir of privateCopies) {
        try {
          merged.push(mergePrivateCopy(db, join(dir, 'english-companion.db'), decrypt, encrypt))
          copyPrivateImages(dir, userData)
          markPrivateCopyMerged(dir)
        } catch (err) {
          mergeErrors.push(err instanceof Error ? err.message : String(err))
        }
      }
    }
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
    lockArticleSession()
    // Text selected in Chrome (English Companion extension) arrives here, like subtitles from VLC.
    startChromeBridge((sel) => {
      send(mainWindow, 'articles:external', sel)
      if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true)
    })

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
    if (merged.length || mergeErrors.length) {
      const sum = (k: keyof Pick<MergeReport, 'notes' | 'flashcards' | 'vocabBookWords' | 'articles' | 'chats'>): number => merged.reduce((n, m) => n + m[k], 0)
      const unreadable = [...new Set(merged.flatMap((m) => m.secretsUnreadable))]
      mainWindow?.webContents.once('did-finish-load', () => {
        void dialog.showMessageBox(mainWindow!, {
          type: mergeErrors.length ? 'warning' : 'info',
          title: 'English Learning Companion',
          message: mergeErrors.length ? 'Some saved words could not be brought back automatically.' : 'Your words are all in one place again.',
          detail: [
            `Added from the copy that was saved while the app ran inside another program: ${sum('notes')} saved items, ${sum('flashcards')} flashcards, ${sum('vocabBookWords')} Vocabulary Book words, ${sum('articles')} articles, ${sum('chats')} chats.`,
            merged.some((m) => m.googleBackupSaved) ? 'A second Google sign-in was found and kept in reserve: it is used automatically if the current one was revoked.' : '',
            unreadable.length ? `Could not read from that copy (encrypted there): ${unreadable.join(', ')}. If something is missing, enter it again in Settings.` : '',
            mergeErrors.length ? `Problem: ${mergeErrors.join('; ')}` : '',
            `A backup of everything is in: ${backupDir}`
          ]
            .filter(Boolean)
            .join('\n\n')
        })
      })
    }

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
