#!/usr/bin/env node
/**
 * hotate-cmd — build shell commands from intent + context (OS-aware).
 * Usage: hotate-cmd [options] <intent words...>
 *    or: echo "intent" | hotate-cmd [options]
 */
import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import {
  detectOS,
  generateCommand,
  llmConfig,
} from './lib/generate.mjs'

function printHelp() {
  console.log(`
hotate-cmd — intent → shell command (macOS / Linux aware; nl2bash-style prompting)

Usage:
  hotate-cmd [options] <intent...>
  printf '%s' "intent" | hotate-cmd [options]

Options:
  -c, --context <text>   Extra context (cwd, files, constraints)
  -f, --file <path>      Read more context from file (utf-8)
  -O, --os <auto|macos|linux>   Target OS (default: auto from this machine)
  -e, --explain          Ask model to add a # comment line before the command
      --json             Print JSON { "os", "intent", "command" }
  -h, --help             Show this help

Environment:
  HOTATE_OLLAMA_URL       Ollama base URL (overrides OLLAMA_HOST if set)
  OLLAMA_HOST             Ollama base URL (default: http://127.0.0.1:11434)
  HOTATE_LLM_MODEL       Ollama model tag (default: qwen2.5:0.5b)

  Requires Ollama with Qwen 2.5 0.5B, e.g.  ollama pull qwen2.5:0.5b

Examples:
  hotate-cmd "compress ~/Documents/photos into a zip excluding raw"
  hotate-cmd -c "repo has package.json" "install deps and run tests"
  hotate-cmd -O linux "watch a log file for errors and beep once"
`.trim())
}

async function readStdinNonInteractive() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  let { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      context: { type: 'string', short: 'c' },
      file: { type: 'string', short: 'f' },
      os: { type: 'string', short: 'O', default: 'auto' },
      explain: { type: 'boolean', short: 'e', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  })

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  let intent = positionals.join(' ').trim()
  if (!intent) {
    intent = await readStdinNonInteractive()
  }
  if (!intent) {
    printHelp()
    console.error('\nError: provide intent as arguments or stdin.')
    process.exit(1)
  }

  let context = values.context || ''
  if (values.file) {
    try {
      const extra = await readFile(values.file, 'utf8')
      context = context ? `${context}\n\n--- file:${values.file} ---\n${extra}` : extra
    } catch (e) {
      console.error(`Error reading --file: ${e.message}`)
      process.exit(1)
    }
  }

  const osOpt = values.os === 'auto' ? undefined : values.os
  const osKind = detectOS(osOpt)
  if (osKind === 'unknown' && osOpt) {
    console.error('Error: --os must be macos, linux, or auto')
    process.exit(1)
  }

  try {
    const command = await generateCommand({
      intent,
      context,
      osKind,
      explain: values.explain,
    })

    if (values.json) {
      const { host, model } = llmConfig()
      console.log(
        JSON.stringify(
          { os: osKind, intent, command, ollama: { host, model } },
          null,
          2
        )
      )
    } else {
      console.log(command)
    }
  } catch (e) {
    if (e.code === 'LLM_CONNECTION') {
      console.error(e.message)
      process.exit(2)
    }
    console.error(e.message || e)
    process.exit(1)
  }
}

main()
