#!/usr/bin/env node
/**
 * hotate-intent — sentence → intent category (rules + optional Ollama fallback).
 */
import { parseArgs } from 'node:util'
import {
  classifyIntent,
  classifyRuleBased,
  classifyWithLLM,
  INTENT_CATEGORIES,
} from './lib/intent-classifier.mjs'

function help() {
  console.log(`
hotate-intent — classify a sentence into: ${INTENT_CATEGORIES.join(', ')}

Usage:
  hotate-intent [options] <sentence...>
  printf '%s' "sentence" | hotate-intent [options]

Options:
      --json              Full result object
      --rules-only        Rule-based only (no Ollama); default category query if no match
      --llm-only          Skip rules; call Ollama only
  -T, --trust <medium|high>  When using both: trust rules at medium or only high confidence (default: medium)
  -h, --help

Environment (LLM path): same as hotate-cmd — Ollama + HOTATE_LLM_MODEL / URLs

Examples:
  hotate-intent "delete old downloads and empty trash"
  hotate-intent --rules-only "brew install ffmpeg"
  hotate-intent --json "what is using port 8080"
`.trim())
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'boolean', default: false },
      'rules-only': { type: 'boolean', default: false },
      'llm-only': { type: 'boolean', default: false },
      trust: { type: 'string', short: 'T', default: 'medium' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  })

  if (values.help) {
    help()
    process.exit(0)
  }

  let sentence = positionals.join(' ').trim()
  if (!sentence) sentence = await readStdin()
  if (!sentence) {
    help()
    console.error('\nError: provide a sentence as args or stdin.')
    process.exit(1)
  }

  const threshold =
    values.trust === 'high' ? 'high' : 'medium'

  if (values['llm-only']) {
    try {
      const category = await classifyWithLLM(sentence)
      if (values.json) {
        console.log(JSON.stringify({ category, source: 'llm' }, null, 2))
      } else {
        console.log(category)
      }
    } catch (e) {
      console.error(e.message || e)
      process.exit(1)
    }
    return
  }

  if (values['rules-only']) {
    const r = classifyRuleBased(sentence)
    const category = r.category || 'query'
    if (values.json) {
      console.log(JSON.stringify({ ...r, category }, null, 2))
    } else {
      console.log(category)
    }
    return
  }

  try {
    const out = await classifyIntent(sentence, {
      llmFallback: true,
      ruleConfidenceThreshold: threshold,
    })
    if (values.json) {
      console.log(JSON.stringify(out, null, 2))
    } else {
      console.log(out.category)
    }
  } catch (e) {
    console.error(e.message || e)
    process.exit(1)
  }
}

main()
