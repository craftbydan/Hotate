#!/usr/bin/env node
/**
 * hotate-env — print machine context block (PATH, OS, installed tools).
 */
import { parseArgs } from 'node:util'
import {
  gatherMachineContext,
  formatContextForPrompt,
} from './lib/context-injector.mjs'

function help() {
  console.log(`
hotate-env — dump context for hotate-cmd --context (cwd, OS, PATH, tools)

Usage:
  hotate-env [options]

Options:
      --json         Full JSON (includes full PATH string)
      --no-versions  Skip node/npm/python/brew/etc. version probes (faster)
  -h, --help

Pipe or copy into prompts, or use: hotate-cmd --env "your intent"
`.trim())
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'boolean', default: false },
      'no-versions': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  })

  if (values.help) {
    help()
    process.exit(0)
  }

  const ctx = gatherMachineContext({ versions: !values['no-versions'] })

  if (values.json) {
    console.log(JSON.stringify(ctx, null, 2))
  } else {
    console.log(formatContextForPrompt(ctx))
  }
}

main()
