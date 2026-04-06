import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function hotatePlanApiPlugin() {
  return {
    name: 'hotate-plan-api',
    configureServer(server) {
      server.middlewares.use('/api/plan', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          let intent = ''
          try {
            intent = String(JSON.parse(body || '{}').intent || '').trim()
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
            return
          }
          if (!intent) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing intent' }))
            return
          }
          const bin = path.join(__dirname, 'cli/bin.mjs')
          const r = spawnSync(
            process.execPath,
            [bin, '--json', '--raw', '--env-fast', '-O', 'auto', intent],
            {
              cwd: __dirname,
              encoding: 'utf8',
              maxBuffer: 8 * 1024 * 1024,
              env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
            }
          )
          res.setHeader('Content-Type', 'application/json')
          if (r.error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: r.error.message }))
            return
          }
          const out = (r.stdout || '').trim()
          if (!out) {
            res.statusCode = r.status === 2 ? 502 : 500
            res.end(
              JSON.stringify({
                error: (r.stderr || '').trim() || 'Planner returned nothing',
              })
            )
            return
          }
          try {
            const json = JSON.parse(out)
            res.end(JSON.stringify(json))
          } catch {
            res.statusCode = 500
            res.end(
              JSON.stringify({
                error: 'Could not read planner output',
                raw: out.slice(0, 400),
              })
            )
          }
        })
      })
    },
  }
}

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  plugins: [hotatePlanApiPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'app.html'),
        functions: path.resolve(__dirname, 'functions.html'),
      },
    },
  },
})
