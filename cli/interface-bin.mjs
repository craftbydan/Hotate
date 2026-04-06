#!/usr/bin/env node
/**
 * hotate — interactive CLI: Hotate-themed prompt, consequence panel, command block.
 */
import { parseArgs } from 'node:util'
import readline from 'node:readline/promises'
import { detectOS, llmConfig } from './lib/generate.mjs'
import {
  gatherMachineContext,
  formatContextForPrompt,
  readShallowCwdListing,
} from './lib/context-injector.mjs'
import { runHotatePipeline } from './lib/run-pipeline.mjs'
import { createTheme, colorEnabledFor } from './lib/terminal-theme.mjs'
import {
  configureUi,
  isCompactUi,
  renderBanner,
  renderReplPermissionField,
  renderReplInputLabel,
  renderReplOutputOpen,
  renderReplOutputClose,
  renderConsequencePanel,
  renderCommandBlock,
  renderHelpFooter,
  renderRunModeHelp,
  renderHumanCommandResult,
} from './lib/cli-ui.mjs'
import { promptTripleChoice } from './lib/confirm-flow.mjs'
import {
  loadRunModeSettings,
  saveRunModeSettings,
  shouldShowTripleConfirm,
  getRunModeConfigPath,
} from './lib/user-run-mode.mjs'
import { runShellCommandForUser } from './lib/execute-shell.mjs'

/** Strip a stray leading "[" (common on mobile) or matching [ … ] wrappers. */
function intentFromReplLine(s) {
  let t = s.trim()
  if (t.startsWith('[') && t.endsWith(']') && t.length > 2)
    t = t.slice(1, -1).trim()
  else if (t.startsWith('[')) t = t.slice(1).trim()
  return t
}

function printHelp() {
  console.log(`
hotate — interactive terminal (Hotate theme · severity colors · monospace command)

Usage:
  hotate [options]

Options:
      --env              Start with machine context on (toggle with "env" in the repl)
      --env-fast         With --env: skip version probes
  -O, --os <auto|macos|linux>
      --ask              Extra prompts for edits/deletes (simple lookups stay quick)
  --yes              Skip confirmation even for irreversible commands
  -h, --help

Saved run mode (~/.config/hotate/settings.json):
  approve      — triple prompt before running the riskiest commands
  always-run   — run those without the extra prompt (still shown first)

Repl:  mode   show current + how to change ·  mode approve  ·  mode always-run
       ask    toggle extra confirm (risky only; not pwd/ls-style)
       confirm all | confirm off   same as ask on/off
       Natural language (cwd + OS): the local model picks shell vs saved mode vs session “ask” vs a plain reply.

Environment: HOTATE_OLLAMA_URL, HOTATE_LLM_MODEL, HOTATE_NUM_PREDICT
  HOTATE_LEGACY_ROUTER=1  Skip JSON intent router; use older NL→shell generator only
  HOTATE_ROUTER_STRICT=1  Do not fall back if the router errors (debugging)
  HOTATE_CWD_LISTING=1     Include shallow cwd filenames in the model payload (without full --env)
  HOTATE_ROUTER_DIRECT_SETTINGS=0  Never short-circuit; router model handles all settings phrases (tiny models often misroute)
  HOTATE_NO_EXEC=1      Show the command only; do not run it
  HOTATE_EXEC_INHERIT=1 Run with a live TTY (no framed “Result” box; for vim/ssh)
  HOTATE_COMPACT=1      Always use the short, easy layout
Narrow terminals auto-use compact layout unless you pass  --wide .
NO_COLOR / FORCE_COLOR respected.
`.trim())
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      os: { type: 'string', short: 'O', default: 'auto' },
      yes: { type: 'boolean', default: false },
      ask: { type: 'boolean', default: false },
      env: { type: 'boolean', default: false },
      'env-fast': { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
      wide: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  })

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('hotate needs an interactive terminal.')
    process.exit(1)
  }

  let useEnv = values.env
  const envFast = values['env-fast']
  let alwaysAsk = values.ask
  let runMode = (await loadRunModeSettings()).runMode
  const osKind = detectOS(values.os === 'auto' ? undefined : values.os)
  const t = createTheme(colorEnabledFor(process.stdout))

  configureUi({
    compact: values.compact,
    autoSmallScreen: !values.wide,
  })

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  process.stdout.write(renderBanner(t))
  const _cfg = llmConfig()
  if (!isCompactUi()) {
    process.stdout.write(
      `  ${t.mutedText()}Model:${t.reset()} ${t.dim()}${_cfg.model}${t.reset()}\n`
    )
  } else {
    process.stdout.write(
      `  ${t.mutedText()}AI:${t.reset()} ${t.dim()}${_cfg.model}${t.reset()}\n`
    )
  }
  process.stdout.write(
    `  ${t.mutedText()}Each turn:${t.reset()} ${t.dim()}Permission (status) → Input → then Output for the reply.${t.reset()}\n`
  )
  process.stdout.write(renderHelpFooter(t))

  const outOpen = () => process.stdout.write(renderReplOutputOpen(t))
  const outClose = () => process.stdout.write(renderReplOutputClose(t))

  try {
    while (true) {
      process.stdout.write(
        renderReplPermissionField(t, runMode, alwaysAsk, process.cwd())
      )
      process.stdout.write(renderReplInputLabel(t))
      const line = await rl.question('')
      const trimmed = line.trim()
      if (!trimmed) continue
      if (/^(exit|quit|q)$/i.test(trimmed)) break
      if (/^help$/i.test(trimmed)) {
        outOpen()
        process.stdout.write(renderHelpFooter(t))
        outClose()
        continue
      }
      if (/^mode\s*$/i.test(trimmed)) {
        outOpen()
        process.stdout.write(
          renderRunModeHelp(t, getRunModeConfigPath(), runMode)
        )
        outClose()
        continue
      }
      const modeArg = trimmed.match(/^mode\s+(approve|always-run|always_run)\s*$/i)
      if (modeArg) {
        const next = /^approve$/i.test(modeArg[1]) ? 'approve' : 'always_run'
        runMode = await saveRunModeSettings(next)
        outOpen()
        process.stdout.write(
          `  ${t.fg('green')}saved${t.reset()} ${t.dim()}${getRunModeConfigPath()}${t.reset()}\n`
        )
        outClose()
        continue
      }
      if (/^env$/i.test(trimmed)) {
        useEnv = !useEnv
        outOpen()
        process.stdout.write(
          `  ${t.fg('green')}context ${useEnv ? 'on' : 'off'}${t.reset()}\n`
        )
        outClose()
        continue
      }
      if (/^update\s*$/i.test(trimmed)) {
        outOpen()
        process.stdout.write(`  ${t.dim()}⋯ killing and restarting menubar app⋯${t.reset()}\n`)
        try {
          const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'menubar', 'cli.mjs')
          spawnSync('node', [cliPath], { stdio: 'ignore' })
          process.stdout.write(`  ${t.fg('green')}done${t.reset()}\n`)
        } catch (e) {
          process.stdout.write(`  ${t.fg('red')}error: ${e.message}${t.reset()}\n`)
        }
        outClose()
        continue
      }
      if (/^confirm\s+all$/i.test(trimmed)) {
        alwaysAsk = true
        outOpen()
        process.stdout.write(
          `  ${t.fg('gold')}always confirm on${t.reset()} ${t.dim()}(triple prompt for edits/deletes, not simple lookups)${t.reset()}\n`
        )
        outClose()
        continue
      }
      if (/^confirm\s+off$/i.test(trimmed)) {
        alwaysAsk = false
        outOpen()
        process.stdout.write(
          `  ${t.fg('gold')}always confirm off${t.reset()}\n`
        )
        outClose()
        continue
      }
      if (/^ask$/i.test(trimmed)) {
        alwaysAsk = !alwaysAsk
        outOpen()
        process.stdout.write(
          `  ${t.fg('gold')}always confirm ${alwaysAsk ? 'on' : 'off'}${t.reset()} ${t.dim()}(risky commands only; reversible stays quick)${t.reset()}\n`
        )
        outClose()
        continue
      }

      let context = ''
      let cwdEntries = []
      const wantListing =
        useEnv || process.env.HOTATE_CWD_LISTING === '1'
      if (useEnv) {
        const ctx = gatherMachineContext({
          versions: !envFast,
          cwdListing: wantListing,
        })
        cwdEntries = ctx.cwdEntries || []
        context = formatContextForPrompt(ctx)
      } else if (wantListing) {
        cwdEntries = readShallowCwdListing(process.cwd(), 48)
        const cwd = process.cwd()
        context = `## cwd snapshot (for fitting paths)\n- cwd: ${cwd}\n- cwd entries: ${cwdEntries.length ? cwdEntries.join(', ') : '(empty or unreadable)'}`
      }

      outOpen()
      try {
        process.stdout.write(
          isCompactUi()
            ? `  ${t.dim()}…one moment${t.reset()}\n`
            : `  ${t.dim()}⋯ asking local model…${t.reset()}${t.mutedText()} (first run can be a few seconds)${t.reset()}\n`
        )
        const pipelineResult = await runHotatePipeline({
          intent: intentFromReplLine(trimmed),
          context,
          osKind,
          cwd: process.cwd(),
          session: { runMode, alwaysAsk },
          cwdEntries,
        })

        if (pipelineResult.resultKind === 'repl') {
          const r = pipelineResult.repl
          if (r.type === 'run_mode') {
            runMode = await saveRunModeSettings(r.mode)
            const label =
              r.mode === 'always_run' ? t.fg('gold') + 'always-run' : t.fg('green') + 'approve'
            process.stdout.write(
              `  ${t.text()}Saved:${t.reset()} ${label}${t.reset()} ${t.mutedText()}→ ${getRunModeConfigPath()}${t.reset()}\n`
            )
          } else if (r.type === 'session_ask') {
            alwaysAsk = r.enabled
            process.stdout.write(
              `  ${t.text()}Session:${t.reset()} ${t.fg('gold')}extra confirm ${r.enabled ? 'on' : 'off'}${t.reset()} ${t.mutedText()}(risky edits/deletes).${t.reset()}\n`
            )
          } else if (r.type === 'chat') {
            process.stdout.write(`  ${t.text()}${r.message}${t.reset()}\n`)
          } else if (r.type === 'update_menubar') {
            process.stdout.write(`  ${t.dim()}⋯ killing and restarting menubar app⋯${t.reset()}\n`)
            try {
              const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'menubar', 'cli.mjs')
              spawnSync('node', [cliPath], { stdio: 'ignore' })
              process.stdout.write(`  ${t.fg('green')}done${t.reset()}\n`)
            } catch (e) {
              process.stdout.write(`  ${t.fg('red')}error: ${e.message}${t.reset()}\n`)
            }
          }
          continue
        }

        const { command, safety, classification, consequence } = pipelineResult

        process.stdout.write(
          renderConsequencePanel(t, classification, consequence, safety)
        )
        process.stdout.write(renderCommandBlock(t, command))

        const needConfirm = shouldShowTripleConfirm({
          yes: values.yes,
          alwaysAsk,
          needsConfirmation: classification.needsConfirmation,
          runMode,
          tier: classification.tier,
        })

        const execDisabled = process.env.HOTATE_NO_EXEC === '1'

        const runAndReport = () => {
          if (!command.trim()) return
          if (execDisabled) {
            process.stdout.write(
              `\n  ${t.mutedText()}HOTATE_NO_EXEC=1 — not running. Command:${t.reset()}\n${t.dim()}${command}${t.reset()}\n\n`
            )
            return
          }
          process.stdout.write(`\n${t.dim()}── Running ──${t.reset()}\n`)
          const result = runShellCommandForUser(command, { cwd: process.cwd() })
          if (
            result.error &&
            result.mode === 'capture' &&
            !result.stdout &&
            !result.stderr
          ) {
            process.stdout.write(
              `\n${t.fg('red')}${result.error.message}${t.reset()}\n\n`
            )
            return
          }
          if (result.skipped) return
          process.stdout.write(renderHumanCommandResult(t, result))
        }

        if (
          !needConfirm &&
          classification.tier === 'reversible' &&
          !alwaysAsk &&
          !isCompactUi()
        ) {
          process.stdout.write(
            `  ${t.mutedText()}Tip:${t.reset()} ${t.dim()}${t.fg('rust')}always-run${t.reset()} / ${t.fg('rust')}approve${t.reset()}${t.dim()} = when to ask before risky runs · ${t.fg('rust')}help${t.reset()}\n`
          )
        }

        if (needConfirm) {
          const runShowFirst = () => {
            process.stdout.write(`\n${t.dim()}── Detail ──${t.reset()}\n`)
            process.stdout.write(`${t.text()}Asked:${t.reset()} ${trimmed}\n`)
            process.stdout.write(
              `${t.text()}Folder:${t.reset()} ${process.cwd()}\n`
            )
            if (consequence?.structured?.fileCount != null)
              process.stdout.write(
                `${t.text()}Files matched (preview):${t.reset()} ${consequence.structured.fileCount}\n`
              )
            process.stdout.write(
              `${t.mutedText()}Tags:${t.reset()} ${classification.reasons.join(', ')}\n`
            )
            process.stdout.write(
              `${t.dim()}${command}${t.reset()}\n${t.dim()}────────${t.reset()}\n`
            )
          }

          for (;;) {
            const choice = await promptTripleChoice({
              outputStream: process.stdout,
              theme: t,
              rl,
            })
            if (choice === 'cancel') {
              process.stdout.write(
                `\n${t.mutedText()}Cancelled — command was not run.${t.reset()}\n`
              )
              break
            }
            if (choice === 'show') {
              runShowFirst()
              continue
            }
            runAndReport()
            break
          }
        } else {
          if (
            classification.needsConfirmation &&
            runMode === 'always_run' &&
            !alwaysAsk
          ) {
            process.stdout.write(
              `  ${t.fg('gold')}always-run:${t.reset()} ${t.mutedText()}Running without the triple prompt. ${t.dim()}Change with${t.reset()} ${t.fg('rust')}mode approve${t.reset()}\n`
            )
          }
          runAndReport()
        }
      } catch (e) {
        if (e.code === 'LLM_CONNECTION') {
          process.stdout.write(`\n${t.fg('red')}${e.message}${t.reset()}\n`)
        } else {
          process.stdout.write(`\n${t.fg('red')}${e.message || e}${t.reset()}\n`)
        }
      } finally {
        outClose()
      }
    }
  } finally {
    rl.close()
  }
}

main()
