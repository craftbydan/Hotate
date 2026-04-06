const { app, ipcMain, nativeImage, Menu, clipboard, dialog } = require('electron')
const { menubar } = require('menubar')
const path = require('node:path')
const os = require('node:os')
const { spawnSync, spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const http = require('node:http')

let currentWorkspace = path.join(__dirname, '..')
const REPO_ROOT = path.join(__dirname, '..') // Keep for CLI binary path resolution

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

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

function isOllamaRunning() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 11434,
        path: '/api/tags',
        method: 'GET',
        timeout: 1000,
      },
      (res) => {
        resolve(res.statusCode === 200)
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

function runPlan(intent) {
  const bin = path.join(REPO_ROOT, 'cli/bin.mjs')
  const r = spawnSync(
    process.execPath,
    [bin, '--json', '--raw', '--env-fast', '-O', 'auto', intent],
    {
      cwd: currentWorkspace,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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
  const running = await isOllamaRunning()
  const pathFriendly = friendlyWorkspacePath(currentWorkspace)
  return {
    cwd: currentWorkspace,
    folder: path.basename(currentWorkspace),
    pathFriendly,
    pathShort: shortenPathLabel(pathFriendly),
    ollama: running,
  }
})

ipcMain.handle('hotate-select-folder', async () => {
  if (!mb || !mb.window) return null
  const result = await dialog.showOpenDialog(mb.window, {
    properties: ['openDirectory', 'createDirectory']
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
  if (await isOllamaRunning()) return { status: 'running' }

  // Try to start ollama serve
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return { status: 'starting' }
})

ipcMain.handle('hotate-quit', () => {
  app.quit()
})

ipcMain.handle('hotate-update', () => {
  app.relaunch()
  app.exit()
})

const indexHtml = pathToFileURL(
  path.join(__dirname, 'renderer', 'chat.html')
).href

const browserWindow = {
  width: 340,
  height: 460,
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
  // Removed native macOS vibrancy to lean into custom app themes
} else {
  browserWindow.backgroundColor = '#f3f3f5'
}

const templatePng = path.join(__dirname, 'IconTemplate.png')
let trayIcon = nativeImage.createFromPath(templatePng)

if (process.platform === 'darwin' && !trayIcon.isEmpty()) {
  // macOS automatically tints images ending in 'Template' or flagged as template
  trayIcon.setTemplateImage(true)
}

const mb = menubar({
  index: indexHtml,
  icon: trayIcon,
  tooltip: 'Hotate',
  windowPosition: process.platform === 'darwin' ? 'trayRight' : undefined,
  browserWindow,
})

mb.on('ready', () => {
  if (process.platform === 'darwin') {
    app.dock?.hide?.()
  }

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

app.on('window-all-closed', () => {
  // Keep menu bar app alive (tray); menubar manages its own window lifecycle.
})
