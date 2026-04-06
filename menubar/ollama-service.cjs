const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn, spawnSync } = require('node:child_process')

const DEFAULT_MODEL = process.env.HOTATE_LLM_MODEL || 'qwen2.5:0.5b'

/** @param {{ host: string, port: number, path?: string, timeout?: number }} o */
function httpGet(o) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: o.host,
        port: o.port,
        path: o.path || '/api/tags',
        method: 'GET',
        timeout: o.timeout ?? 1500,
      },
      (res) => {
        let body = ''
        res.on('data', (c) => {
          body += c
        })
        res.on('end', () => {
          resolve({ ok: res.statusCode === 200, status: res.statusCode, body })
        })
      }
    )
    req.on('error', () => resolve({ ok: false, status: 0, body: '' }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, body: '' })
    })
    req.end()
  })
}

function bundledOllamaDir(resourcesPath) {
  return path.join(resourcesPath, 'bundled', 'ollama')
}

function hasBundledOllama(resourcesPath) {
  const dir = bundledOllamaDir(resourcesPath)
  const bin = path.join(dir, 'ollama')
  return fs.existsSync(bin) && fs.statSync(bin).isFile()
}

/**
 * Packaged app uses an isolated port + bundled binary so we do not fight the user's system Ollama.
 */
function resolveRuntime({ isPackaged, resourcesPath }) {
  const bundled = isPackaged && hasBundledOllama(resourcesPath)
  const port = bundled ? 11435 : 11434
  const host = '127.0.0.1'
  const baseUrl = `http://${host}:${port}`
  const ollamaBinDir = bundled ? bundledOllamaDir(resourcesPath) : null
  const ollamaBin = bundled ? path.join(ollamaBinDir, 'ollama') : 'ollama'
  return { bundled, port, host, baseUrl, ollamaBinDir, ollamaBin }
}

let cachedRuntime = null

function getElectronApp(app) {
  return app || require('electron').app
}

function getRuntime(app) {
  if (cachedRuntime) return cachedRuntime
  const ap = getElectronApp(app)
  const isPackaged = ap.isPackaged
  const resourcesPath = process.resourcesPath
  const r = resolveRuntime({ isPackaged, resourcesPath })
  r.modelsDir = path.join(ap.getPath('userData'), 'ollama-models')
  cachedRuntime = r
  return r
}

function getOllamaBaseUrl(app) {
  return getRuntime(app).baseUrl
}

async function isOllamaReachable(app) {
  const { host, port } = getRuntime(app)
  const r = await httpGet({ host, port, path: '/api/tags', timeout: 1200 })
  return r.ok
}

function mkdirModels(modelsDir) {
  fs.mkdirSync(modelsDir, { recursive: true })
}

function startBundledServe(app) {
  const rt = getRuntime(app)
  if (!rt.bundled) return { ok: false, reason: 'no_bundle' }
  mkdirModels(rt.modelsDir)
  const env = {
    ...process.env,
    OLLAMA_HOST: `${rt.host}:${rt.port}`,
    OLLAMA_MODELS: rt.modelsDir,
  }
  const child = spawn(rt.ollamaBin, ['serve'], {
    cwd: rt.ollamaBinDir,
    detached: true,
    stdio: 'ignore',
    env,
  })
  child.unref()
  return { ok: true, reason: 'spawned' }
}

function startSystemServe() {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()
  return { ok: true, reason: 'spawned_system' }
}

async function waitForServer(app, { maxMs = 20000, interval = 400 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    if (await isOllamaReachable(app)) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  return false
}

async function listModels(app) {
  const { host, port } = getRuntime(app)
  const r = await httpGet({ host, port, path: '/api/tags', timeout: 5000 })
  if (!r.ok) return []
  try {
    const j = JSON.parse(r.body)
    const models = j.models || j.Models || []
    return models.map((m) => m.name || m.model || '').filter(Boolean)
  } catch {
    return []
  }
}

function modelIsPresent(names, want) {
  const w = String(want || '').trim()
  if (!w) return false
  return names.some((n) => n === w || n.startsWith(w + ':') || w.startsWith(n.split(':')[0]))
}

/**
 * Pull default model; stream lines to onLine for UI.
 * @param {import('electron').App} app
 */
function pullModel(app, modelName, onLine) {
  const rt = getRuntime(app)
  if (rt.bundled) mkdirModels(rt.modelsDir)
  const env = {
    ...process.env,
    OLLAMA_HOST: `${rt.host}:${rt.port}`,
  }
  if (rt.bundled) {
    env.OLLAMA_MODELS = rt.modelsDir
  }
  const bin = rt.bundled ? rt.ollamaBin : 'ollama'
  const cwd = rt.bundled ? rt.ollamaBinDir : undefined
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['pull', modelName], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const onData = (buf) => {
      const s = buf.toString()
      for (const line of s.split('\n')) {
        if (line.trim() && onLine) onLine(line.trim())
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ollama pull exited ${code}`))
    })
  })
}

/**
 * @param {object} opts
 * @param {import('electron').App} opts.app
 * @param {(channel: string, payload: unknown) => void} opts.send
 */
async function bootstrapOllama(opts) {
  const { app, send } = opts
  const model = opts.model || DEFAULT_MODEL
  const rt = getRuntime(app)

  send('hotate-setup', { phase: 'check', message: 'Checking AI runtime…' })

  if (rt.bundled) {
    startBundledServe(app)
  } else if (app.isPackaged) {
    send('hotate-setup', {
      phase: 'warn',
      message:
        'Bundled Ollama was not found in this build — using a system install if available. For a fully self-contained DMG, run npm run bundle:ollama before packaging.',
    })
    startSystemServe()
  }

  let up = await isOllamaReachable(app)
  if (!up && !rt.bundled && !app.isPackaged) {
    send('hotate-setup', { phase: 'start', message: 'Starting Ollama…' })
    startSystemServe()
    up = await waitForServer(app)
  } else if (!up && rt.bundled) {
    send('hotate-setup', { phase: 'start', message: 'Starting bundled Ollama…' })
    up = await waitForServer(app)
  } else if (!up && app.isPackaged && !rt.bundled) {
    up = await waitForServer(app)
  }

  if (!up) {
    send('hotate-setup', {
      phase: 'error',
      message:
        'Could not reach Ollama. If you use your own install, run `ollama serve` or open the Ollama app.',
    })
    return
  }

  send('hotate-setup', { phase: 'ready', message: 'Ollama is running.' })

  let names = await listModels(app)
  if (modelIsPresent(names, model)) {
    send('hotate-setup', { phase: 'done', message: 'Model is ready.' })
    return
  }

  send('hotate-setup', {
    phase: 'pull',
    message: `Downloading model ${model} (one-time, needs internet)…`,
    model,
  })

  try {
    await pullModel(app, model, (line) => {
      send('hotate-setup', { phase: 'pull', message: line, model })
    })
    names = await listModels(app)
    if (modelIsPresent(names, model)) {
      send('hotate-setup', { phase: 'done', message: 'Model is ready.' })
    } else {
      send('hotate-setup', {
        phase: 'error',
        message: `Model ${model} still missing after pull. Try: ollama pull ${model}`,
      })
    }
  } catch (e) {
    send('hotate-setup', {
      phase: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

module.exports = {
  DEFAULT_MODEL,
  getOllamaBaseUrl,
  getRuntime,
  isOllamaReachable,
  startBundledServe,
  startSystemServe,
  waitForServer,
  bootstrapOllama,
  hasBundledOllama,
}
