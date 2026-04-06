const { app, ipcMain, nativeImage, Menu, clipboard, dialog } = require('electron')
const { menubar } = require('menubar')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ollamaService = require('./ollama-service.cjs')

let currentWorkspace = path.join(__dirname, '..')
const REPO_ROOT = path.join(__dirname, '..')

function friendlyWorkspacePath(cwd) {
  const abs = path.resolve(cwd)
  const home = os.homedir()
  if (home && (abs === home || abs.startsWith(home + path.sep))) {
    return '~' + abs.slice(home.length).split(path.sep).join('/')
  }
  return abs.split(path.sep).join('/')
}

function shortenPathLabel(s, max = 42) {
  const t = String(s || '')
  if (t.length <= max) return t
  const head = Math.ceil(max / 2) - 2
  const tail = max - head - 3
  return t.slice(0, head) + '…' + t.slice(-tail)
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

function runPlan(intent) {
  const bin = path.join(REPO_ROOT, 'cli', 'bin.mjs')
  const ollamaUrl = ollamaService.getOllamaBaseUrl(app)
  const r = spawnSync(
    process.execPath,
    [bin, '--json', '--raw', '--env-fast', '-O', 'auto', intent],
    {
      cwd: currentWorkspace,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        HOTATE_OLLAMA_URL: ollamaUrl,
      },
    }
  )

  if (r.error) {
    return { error: r.error.message }
  }

  const out = (r.stdout || '').trim()
  if (!out) {
    return {
      error: (r.stderr || '').trim() || 'Planner returned nothing',
    }
  }

  try {
    return JSON.parse(out)
  } catch {
    return {
      error: 'Could not read planner output',
      raw: out.slice(0, 400),
    }
  }
}

ipcMain.handle('hotate-plan', (_event, intent) => {
  const s = String(intent || '').trim()
  if (!s) return { error: 'Missing intent' }
  return runPlan(s)
})

ipcMain.handle('hotate-get-context', async () => {
  const rt = ollamaService.getRuntime(app)
  const running = await ollamaService.isOllamaReachable(app)
  const pathFriendly = friendlyWorkspacePath(currentWorkspace)
  return {
    cwd: currentWorkspace,
    folder: path.basename(currentWorkspace),
    pathFriendly,
    pathShort: shortenPathLabel(pathFriendly),
    ollama: running,
    ollamaUrl: rt.baseUrl,
    bundledOllama: rt.bundled,
    defaultModel: ollamaService.DEFAULT_MODEL,
  }
})

ipcMain.handle('hotate-select-folder', async () => {
  if (!mb || !mb.window) return null
  const result = await dialog.showOpenDialog(mb.window, {
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  currentWorkspace = result.filePaths[0]
  return currentWorkspace
})

ipcMain.handle('hotate-copy-text', (_event, text) => {
  const s = String(text ?? '').trim()
  if (!s) return false
  clipboard.writeText(s)
  return true
})

ipcMain.handle('hotate-start-ollama', async () => {
  if (await ollamaService.isOllamaReachable(app)) return { status: 'running' }
  const rt = ollamaService.getRuntime(app)
  if (rt.bundled) {
    ollamaService.startBundledServe(app)
  } else {
    ollamaService.startSystemServe()
  }
  const ok = await ollamaService.waitForServer(app, { maxMs: 25000 })
  return ok ? { status: 'running' } : { status: 'timeout' }
})

ipcMain.handle('hotate-quit', () => {
  app.quit()
})

ipcMain.handle('hotate-reload-window', () => {
  app.relaunch()
  app.exit()
})

ipcMain.handle('hotate-check-for-updates', async () => {
  if (!app.isPackaged) {
    return { skipped: true, reason: 'development_build' }
  }
  if (process.env.HOTATE_SKIP_UPDATES === '1') {
    return { skipped: true, reason: 'env_skip' }
  }
  try {
    const { autoUpdater } = require('electron-updater')
    const r = await autoUpdater.checkForUpdates()
    return {
      ok: true,
      updateInfo: r?.updateInfo
        ? {
            version: r.updateInfo.version,
            releaseDate: r.updateInfo.releaseDate,
          }
        : null,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('hotate-download-update', async () => {
  if (!app.isPackaged) return { skipped: true }
  try {
    const { autoUpdater } = require('electron-updater')
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('hotate-quit-and-install', () => {
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.quitAndInstall(false, true)
  } catch {
    app.relaunch()
    app.exit()
  }
})

const indexHtml = pathToFileURL(path.join(__dirname, 'renderer', 'chat.html')).href

const browserWindow = {
  width: 340,
  height: 580,
  resizable: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
}
if (process.platform === 'darwin') {
  browserWindow.transparent = true
  browserWindow.backgroundColor = '#00000000'
} else {
  browserWindow.backgroundColor = '#f3f3f5'
}

const templatePng = path.join(__dirname, 'IconTemplate.png')
let trayIcon = nativeImage.createFromPath(templatePng)

if (process.platform === 'darwin' && !trayIcon.isEmpty()) {
  trayIcon.setTemplateImage(true)
}

const mb = menubar({
  index: indexHtml,
  icon: trayIcon,
  tooltip: 'Hotate',
  windowPosition: process.platform === 'darwin' ? 'trayRight' : undefined,
  browserWindow,
})

function wireAutoUpdater() {
  if (!app.isPackaged || process.env.HOTATE_SKIP_UPDATES === '1') return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = false
    autoUpdater.allowPrerelease = false

    const send = (payload) => {
      const w = mb.window
      if (w && !w.isDestroyed()) {
        w.webContents.send('hotate-update-event', payload)
      }
    }

    autoUpdater.on('checking-for-update', () =>
      send({ type: 'checking' })
    )
    autoUpdater.on('update-available', (info) =>
      send({ type: 'available', version: info.version, releaseDate: info.releaseDate })
    )
    autoUpdater.on('update-not-available', (info) =>
      send({ type: 'not-available', version: info?.version })
    )
    autoUpdater.on('error', (err) =>
      send({ type: 'error', message: err?.message || String(err) })
    )
    autoUpdater.on('download-progress', (p) =>
      send({
        type: 'progress',
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
      })
    )
    autoUpdater.on('update-downloaded', (info) =>
      send({ type: 'downloaded', version: info.version })
    )

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 4000)
  } catch {
    /* electron-updater optional in weird installs */
  }
}

mb.on('ready', () => {
  if (process.platform === 'darwin') {
    app.dock?.hide?.()
  }

  wireAutoUpdater()

  ollamaService
    .bootstrapOllama({
      app,
      model: process.env.HOTATE_LLM_MODEL || ollamaService.DEFAULT_MODEL,
      send: (channel, payload) => {
        const w = mb.window
        if (w && !w.isDestroyed()) {
          w.webContents.send(channel, payload)
        }
      },
    })
    .catch(() => {})

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Hotate',
      click: () => {
        mb.showWindow()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'Command+Q',
      click: () => {
        app.quit()
      },
    },
  ])

  mb.tray.on('right-click', () => {
    mb.tray.popUpContextMenu(contextMenu)
  })
})

app.on('second-instance', () => {
  if (mb && mb.window) {
    if (mb.window.isMinimized()) mb.window.restore()
    mb.window.focus()
    mb.showWindow()
  }
})

app.on('window-all-closed', () => {})
