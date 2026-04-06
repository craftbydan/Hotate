#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Kill existing instances of the menubar app
spawnSync('pkill', ['-f', 'menubar/main.cjs'])

// Find electron path
const electron = process.platform === 'win32' ? 'electron.cmd' : 'electron'

// Start new instance
const mainPath = join(__dirname, 'main.cjs')
const child = spawn(electron, [mainPath], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
})
child.unref()

console.log('Hotate Menubar killed and restarted.')
process.exit(0)
