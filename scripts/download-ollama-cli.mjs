#!/usr/bin/env node
/**
 * Downloads the official Ollama macOS binary bundle (ollama + dylibs) into build/bundled/ollama/
 * for packaging with electron-builder. Run before: npm run menubar:pack
 *
 * Pin OLLAMA_RELEASE_TAG to control version (see https://github.com/ollama/ollama/releases).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'build', 'bundled', 'ollama')
const TAG = process.env.OLLAMA_RELEASE_TAG || 'v0.20.2'
const TGZ_URL = `https://github.com/ollama/ollama/releases/download/${TAG}/ollama-darwin.tgz`

async function main() {
  if (process.platform !== 'darwin') {
    console.error('download-ollama-cli.mjs: only darwin is supported in this script (macOS DMG).')
    process.exit(1)
  }

  await mkdir(dirname(OUT_DIR), { recursive: true })
  if (existsSync(OUT_DIR)) {
    await rm(OUT_DIR, { recursive: true })
  }
  await mkdir(OUT_DIR, { recursive: true })

  const tgzPath = join(OUT_DIR, '..', 'ollama-darwin-download.tgz')
  console.log('Fetching', TGZ_URL)
  const res = await fetch(TGZ_URL)
  if (!res.ok || !res.body) {
    console.error('Download failed:', res.status, res.statusText)
    process.exit(1)
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgzPath))

  const r = spawnSync('tar', ['-xzf', tgzPath, '-C', OUT_DIR], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('tar extract failed')
    process.exit(1)
  }

  const bin = join(OUT_DIR, 'ollama')
  if (!existsSync(bin)) {
    console.error('Expected ollama binary at', bin)
    process.exit(1)
  }
  spawnSync('chmod', ['+x', bin])

  await rm(tgzPath, { force: true })
  await writeFile(
    join(OUT_DIR, 'README.txt'),
    `Ollama CLI bundle from ${TGZ_URL}
Shipped inside Hotate for offline-capable local inference after models are pulled.
License: see https://github.com/ollama/ollama/blob/main/LICENSE
`,
    'utf8'
  )

  console.log('Ollama CLI extracted to', OUT_DIR)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
