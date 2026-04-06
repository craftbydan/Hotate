#!/usr/bin/env node
/**
 * Smoke-test hotate-cmd on 20 common NL intents.
 * Validates: exit 0, non-empty stdout, no markdown fences, reasonable length.
 * Requires: Ollama + model (see HOTATE_LLM_MODEL).
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bin = join(__dirname, 'bin.mjs')
const root = join(__dirname, '..')

/** @type {{ intent: string, hints: RegExp[] }[]} */
const CORPUS = [
  {
    intent: 'move all PDF files from my Downloads folder to Documents',
    hints: [/mv|cp|rsync|find/i],
  },
  {
    intent: 'list every file in the current folder with human-readable sizes',
    hints: [/ls|g?du|find/i],
  },
  {
    intent: 'start a simple static file server on port 8765 in the current directory',
    hints: [/python|http\.server|npx|serve/i],
  },
  {
    intent: 'install the npm package typescript as a dev dependency in this project',
    hints: [/npm/i, /typescript|\-D|save-dev/],
  },
  {
    intent: 'rename all .txt files in the current directory to add the prefix old_',
    hints: [/rename|mv|for /i],
  },
  {
    intent: 'find files larger than 50 megabytes under my home directory, max depth 4',
    hints: [/find/i, /50|\+50|M/],
  },
  {
    intent: 'show disk usage for the current directory in human readable form',
    hints: [/du|df/i],
  },
  {
    intent: 'copy the folder notes to notes-backup in the same parent directory recursively',
    hints: [/cp|rsync/i],
  },
  {
    intent: 'delete all files ending in .tmp in the current directory only',
    hints: [/rm|find|trash/i],
  },
  {
    intent: 'create a new directory called archive-2026 if it does not exist',
    hints: [/mkdir/i],
  },
  { intent: 'run npm test in the current directory', hints: [/npm test/] },
  { intent: 'install jq using homebrew', hints: [/brew install/, /jq/] },
  {
    intent: 'show what process is listening on TCP port 3000',
    hints: [/lsof|ss |netstat/],
  },
  {
    intent: 'create a gzip compressed tarball of the src folder named src.tar.gz',
    hints: [/tar/],
  },
  {
    intent: 'count total lines in all .mjs files recursively under current directory',
    hints: [/wc|find|xargs|grep/],
  },
  { intent: 'open https://example.com in the default browser', hints: [/open|xdg-open/] },
  {
    intent: 'list the top 15 processes by memory usage',
    hints: [/ps|top|osascript/],
  },
  { intent: 'add execute permission for the owner on deploy.sh', hints: [/chmod/] },
  {
    intent: 'clone https://github.com/octocat/Hello-World.git into a folder named hello-sample',
    hints: [/git clone/],
  },
  { intent: 'print the absolute path of the current working directory', hints: [/pwd|realpath/] },
]

function validate(out, hints) {
  const t = out.trim()
  if (!t) return { ok: false, reason: 'empty output' }
  if (t.includes('```')) return { ok: false, reason: 'markdown fence in output' }
  if (t.length > 4000) return { ok: false, reason: 'output suspiciously long' }
  if (t.length < 2) return { ok: false, reason: 'too short' }
  for (const re of hints) {
    if (!re.test(t)) return { ok: false, reason: `missing hint ${re}` }
  }
  return { ok: true }
}

function main() {
  const os = process.platform === 'darwin' ? 'macos' : 'linux'
  const results = []

  console.log(
    `Running ${CORPUS.length} NL → shell tests via Ollama (target OS: ${os})…\n`
  )

  for (let i = 0; i < CORPUS.length; i++) {
    const { intent, hints } = CORPUS[i]
    const r = spawnSync(
      process.execPath,
      [bin, '--raw', '--env-fast', '-O', os, intent],
      {
        cwd: root,
        encoding: 'utf8',
        env: process.env,
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      }
    )
    const out = (r.stdout || '').trim()
    const err = (r.stderr || '').trim()
    const v =
      r.status === 0 ? validate(out, hints) : { ok: false, reason: `exit ${r.status}` }

    results.push({
      n: i + 1,
      intent: intent.slice(0, 72) + (intent.length > 72 ? '…' : ''),
      ok: v.ok,
      detail: v.ok ? '' : v.reason || err.slice(0, 120),
      sample: v.ok ? out.split('\n')[0].slice(0, 100) : '',
    })

    const mark = v.ok ? '✓' : '✗'
    process.stdout.write(
      `${mark} ${String(i + 1).padStart(2, '0')}/${CORPUS.length}  ${results.at(-1).sample || results.at(-1).detail}\n`
    )
  }

  const passed = results.filter((r) => r.ok).length
  console.log(
    `\n─── ${passed}/${CORPUS.length} passed (non-empty, no fences, hint regexes) ───`
  )
  console.log(
    'Note: command correctness is not formally verified; review outputs before running.'
  )

  process.exit(passed === CORPUS.length ? 0 : 1)
}

main()
