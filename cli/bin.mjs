#!/usr/bin/env node
/**
 * hotate-cmd — build shell commands from intent + context (OS-aware).
 * Usage: hotate-cmd [options] <intent words...>
 *    or: echo "intent" | hotate-cmd [options]
 */
import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { detectOS, llmConfig } from './lib/generate.mjs'
import {
  gatherMachineContext,
  formatContextForPrompt,
  readShallowCwdListing,
} from './lib/context-injector.mjs'
import {
  formatIrreversiblePreview,
  formatSignificantPreview,
} from './lib/destructive-detect.mjs'
import { promptTripleChoice } from './lib/confirm-flow.mjs'
import { runHotatePipeline } from './lib/run-pipeline.mjs'
import { createTheme, colorEnabledFor } from './lib/terminal-theme.mjs'
import {
  renderConsequencePanel,
  renderCommandBlock,
  renderHumanCommandResult,
} from './lib/cli-ui.mjs'
import {
  loadRunModeSettings,
  saveRunModeSettings,
  shouldShowTripleConfirm,
} from './lib/user-run-mode.mjs'
import {
  runShellCommandForUser,
  shouldExecuteInProcess,
} from './lib/execute-shell.mjs'

function printHelp() {
  console.log(`
hotate-cmd — intent → shell command (macOS / Linux aware; nl2bash-style prompting)

Usage:
  hotate-cmd [options] <intent...>
  printf '%s' "intent" | hotate-cmd [options]

Options:
  -c, --context <text>   Extra context (cwd, files, constraints)
  -f, --file <path>      Read more context from file (utf-8)
      --env              Inject machine context (cwd, OS, PATH summary, CLI tools)
      --env-fast         With --env: skip version subprocesses (faster)
  -O, --os <auto|macos|linux>   Target OS (default: auto from this machine)
  -e, --explain          Ask model to add a # comment line before the command
      --json             Print JSON (safety + consequence tier + previews)
      --raw              No stderr previews or confirmation (for scripts)
      --ui               Hotate-themed panels on stdout (no plain stderr previews)
      --ask              Extra triple prompt for edits/deletes (reversible tiers still go straight to stdout)
      --yes              Skip confirmation even for irreversible commands (non-interactive)
      --no-run           Print the command only (no execution), when stdin is a TTY
  -h, --help             Show this help

Consequence tiers (stderr styling, unless --raw / unless --ui):
  🟡 Light / read-only — runs automatically in this terminal when safe
  🟠 Can change things — installs, overwrites, chmod, … — confirm before run (unless --yes or always-run mode)
  🔴 Hard to undo      — full preview; confirm before run (same exceptions)

  --ui: paper-toned colors, monospace command block, severity borders (stdout).
  Use hotate for a full-screen repl. Use --ask for stricter prompts (still skips reversible).

Environment:
  HOTATE_OLLAMA_URL       Ollama base URL (overrides OLLAMA_HOST if set)
  OLLAMA_HOST             Ollama base URL (default: http://127.0.0.1:11434)
  HOTATE_LLM_MODEL       Ollama model tag (default: qwen2.5:0.5b)
  HOTATE_NUM_PREDICT     Max tokens to generate (default 512; lower = faster)
  HOTATE_ASK=1            Same as --ask (ignored with --raw)
  HOTATE_CWD_LISTING=1    Add shallow cwd filenames to context (helps router fit paths)

Saved preference ~/.config/hotate/settings.json:
  runMode approve      — significant / irreversible commands require Confirm before run (default)
  runMode always_run   — run those tiers after preview without the triple prompt ( hotate repl: mode always-run )

  Non-interactive use (piped stdin) prints the command only. Interactive runs it unless --no-run or HOTATE_NO_EXEC=1.
  Captured runs are summarized in a “Result” section; HOTATE_EXEC_INHERIT=1 streams live in the terminal instead.

  Requires Ollama with Qwen 2.5 0.5B, e.g.  ollama pull qwen2.5:0.5b

Examples:
  hotate-cmd "compress ~/Documents/photos into a zip excluding raw"
  hotate-cmd -c "repo has package.json" "install deps and run tests"
  hotate-cmd -O linux "watch a log file for errors and beep once"
  hotate-cmd --env "install ffmpeg if missing"   # injects cwd, PATH, brew/node/python…
  npm run envctx -- --json > machine.json        # inspect context only
  hotate-cmd --ask "remove all .tmp files here"  # interactive three-button flow
  hotate-cmd --ui "copy notes folder to backup"   # themed panels on stdout
  npm run hotate                                  # full repl (same as: hotate)
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
      raw: { type: 'boolean', default: false },
      ui: { type: 'boolean', default: false },
      ask: { type: 'boolean', default: false },
      'no-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      env: { type: 'boolean', default: false },
      'env-fast': { type: 'boolean', default: false },
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
  let cwdEntries = []
  const wantListing =
    values.env || process.env.HOTATE_CWD_LISTING === '1'
  if (values.env) {
    const ctx = gatherMachineContext({
      versions: !values['env-fast'],
      cwdListing: wantListing,
    })
    cwdEntries = ctx.cwdEntries || []
    const block = formatContextForPrompt(ctx)
    context = context ? `${block}\n\n${context}` : block
  } else if (wantListing) {
    cwdEntries = readShallowCwdListing(process.cwd(), 48)
    const cwd = process.cwd()
    const snap = `## cwd snapshot (for fitting paths)\n- cwd: ${cwd}\n- cwd entries: ${cwdEntries.length ? cwdEntries.join(', ') : '(empty or unreadable)'}`
    context = context ? `${snap}\n\n${context}` : snap
  }
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

  const ask =
    values.ask ||
    (process.env.HOTATE_ASK === '1' && !values.raw)
  if (ask && values.json) {
    console.error('Error: --ask cannot be used with --json')
    process.exit(1)
  }
  if (values.ui && values.json) {
    console.error('Error: --ui cannot be used with --json')
    process.exit(1)
  }
  if (values.ui && values.raw) {
    console.error('Error: --ui cannot be used with --raw')
    process.exit(1)
  }
  if (
    ask &&
    (!process.stdin.isTTY ||
      (values.ui ? !process.stdout.isTTY : !process.stderr.isTTY))
  ) {
    console.error(
      'Error: --ask needs an interactive terminal (stdin + stderr, or stdin + stdout with --ui)'
    )
    process.exit(1)
  }

  const { runMode } = await loadRunModeSettings()

  try {
    const pipelineResult = await runHotatePipeline({
      intent,
      context,
      osKind,
      explain: values.explain,
      cwd: process.cwd(),
      session: { runMode, alwaysAsk: ask },
      cwdEntries,
    })

    if (pipelineResult.resultKind === 'repl') {
      const r = pipelineResult.repl
      if (r.type === 'run_mode') {
        await saveRunModeSettings(r.mode)
        console.error(`Saved run mode: ${r.mode}`)
        process.exit(0)
      }
      if (r.type === 'session_ask') {
        console.error(
          'Session extra confirm applies in the hotate repl. Use `hotate --ask` for this one-shot command.'
        )
        process.exit(0)
      }
      if (r.type === 'chat') {
        if (values.json)
          console.log(
            JSON.stringify(
              { resultKind: 'repl', replType: 'chat', message: r.message },
              null,
              2
            )
          )
        else console.log(r.message)
        process.exit(0)
      }
    }

    const { command, safety, classification, consequence } = pipelineResult

    const theme = createTheme(colorEnabledFor(process.stdout))
    const confirmOut = values.ui ? process.stdout : process.stderr
    const willExec = shouldExecuteInProcess({
      flags: {
        json: values.json,
        raw: values.raw,
        noRun: values['no-run'],
      },
    })

    if (values.ui) {
      process.stdout.write(
        renderConsequencePanel(theme, classification, consequence, safety)
      )
      process.stdout.write(renderCommandBlock(theme, command))
    } else if (!values.raw) {
      if (classification.tier === 'irreversible') {
        process.stderr.write(
          formatIrreversiblePreview(command, safety, consequence?.summary)
        )
      } else if (classification.tier === 'significant') {
        process.stderr.write(
          formatSignificantPreview(
            command,
            classification.reasons,
            consequence?.summary
          )
        )
      }
    }

    const needTripleConfirm =
      !values.json &&
      !values.raw &&
      process.stdin.isTTY &&
      (values.ui ? process.stdout.isTTY : process.stderr.isTTY) &&
      shouldShowTripleConfirm({
        yes: values.yes,
        alwaysAsk: ask,
        needsConfirmation: classification.needsConfirmation,
        runMode,
        tier: classification.tier,
      })

    if (needTripleConfirm) {
      /** @param {typeof consequence} cons */
      const showFirstDetail = (cons) => {
        const o = confirmOut
        if (values.ui) {
          o.write(`\n${theme.dim()}── Show me first ──${theme.reset()}\n`)
          o.write(`${theme.text()}Intent:${theme.reset()} ${intent}\n`)
          o.write(`${theme.text()}Folder:${theme.reset()} ${process.cwd()}\n`)
          o.write(
            `${theme.text()}Tier:${theme.reset()} ${classification.emoji} ${classification.label}\n`
          )
          if (cons?.structured) {
            const st = cons.structured
            if (typeof st.fileCount === 'number')
              o.write(
                `${theme.text()}Preview file count:${theme.reset()} ${st.fileCount}\n`
              )
            if (st.folderPath)
              o.write(
                `${theme.text()}Path:${theme.reset()} ${st.folderPath}\n`
              )
          }
          o.write(
            `${theme.mutedText()}Tags:${theme.reset()} ${classification.reasons.join(', ')}\n`
          )
          o.write(`${theme.dim()}${command}${theme.reset()}\n`)
          o.write(`${theme.dim()}─────────────────${theme.reset()}\n`)
        } else {
          o.write('\n── Show me first — extra detail ──\n')
          o.write(`What you asked for: ${intent}\n`)
          o.write(`Working folder right now: ${process.cwd()}\n`)
          o.write(
            `Consequence: ${classification.emoji} ${classification.label}\n`
          )
          if (cons?.structured) {
            const st = cons.structured
            const bits = []
            if (typeof st.fileCount === 'number')
              bits.push(
                `${st.fileCount} file${st.fileCount === 1 ? '' : 's'}`
              )
            if (typeof st.dirCount === 'number' && st.dirCount)
              bits.push(
                `${st.dirCount} folder${st.dirCount === 1 ? '' : 's'}`
              )
            if (bits.length)
              o.write(
                `From a quick look at your disk, that lines up with about ${bits.join(
                  ' and '
                )}.\n`
              )
            if (st.folderPath)
              o.write(`Main place that applies: ${st.folderPath}\n`)
          }
          o.write(
            `Matched patterns: ${classification.reasons.join(', ') || 'none listed'}\n`
          )
          o.write('\nCommand (runs after you choose Confirm):\n')
          o.write(`${command}\n`)
          o.write('─────────────────────────────────\n')
        }
      }

      for (;;) {
        const choice = await promptTripleChoice({
          inputStream: process.stdin,
          outputStream: confirmOut,
          theme: values.ui ? theme : undefined,
        })
        if (choice === 'cancel') {
          confirmOut.write(
            values.ui
              ? `\n${theme.mutedText()}Cancelled — nothing else on stdout.${theme.reset()}\n`
              : '\nCancelled. Nothing was written to standard output.\n'
          )
          process.exit(0)
        }
        if (choice === 'show') {
          showFirstDetail(consequence)
          continue
        }
        if (values.ui) {
          confirmOut.write(
            `\n${theme.fg('green')}Confirmed.${theme.reset()} ${theme.mutedText()}Running next.${theme.reset()}\n`
          )
        } else {
          confirmOut.write('\nConfirmed — running next.\n')
        }
        break
      }
    } else if (
      !values.json &&
      !values.raw &&
      classification.needsConfirmation &&
      runMode === 'always_run' &&
      !ask &&
      !values.yes
    ) {
      confirmOut.write(
        values.ui
          ? `\n${theme.mutedText()}always-run:${theme.reset()} ${theme.dim()}No confirm step (see ~/.config/hotate/settings.json). Running next.${theme.reset()}\n`
          : '\n(always-run: no approve prompt; running next. See ~/.config/hotate/settings.json)\n'
      )
    }

    if (values.json) {
      const { host, model } = llmConfig()
      console.log(
        JSON.stringify(
          {
            os: osKind,
            intent,
            command,
            destructive: safety.destructive,
            previewRequired: safety.previewRequired,
            riskReasons: safety.reasons,
            consequenceTier: classification.tier,
            consequenceEmoji: classification.emoji,
            consequenceLabel: classification.label,
            consequenceNeedsConfirmation: classification.needsConfirmation,
            consequencePreview: consequence?.summary ?? null,
            consequence: consequence?.structured ?? null,
            runMode,
            ollama: { host, model },
          },
          null,
          2
        )
      )
      process.exit(0)
    }

    if (willExec && command.trim()) {
      if (values.ui)
        process.stdout.write(`\n${theme.dim()}── Running ──${theme.reset()}\n`)
      else process.stderr.write('\n── Running ──\n')
      const r = runShellCommandForUser(command, { cwd: process.cwd() })
      if (
        r.error &&
        r.mode === 'capture' &&
        !r.stdout &&
        !r.stderr
      ) {
        console.error(r.error.message)
        process.exit(1)
      }
      if (r.skipped) {
        if (!values.ui) console.log(command)
        process.exit(0)
      }
      const outStream = values.ui ? process.stdout : process.stderr
      const outTheme = values.ui
        ? theme
        : createTheme(colorEnabledFor(process.stderr))
      outStream.write(renderHumanCommandResult(outTheme, r))
      let exitCode = 0
      if (r.signal) exitCode = 1
      else if (typeof r.code === 'number') exitCode = r.code
      process.exit(exitCode)
    }

    if (!values.ui) console.log(command)
    process.exit(0)
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
