/**
 * Shared: intent → (model router | legacy generate) → command + safety + consequence.
 */
import {
  generateCommand,
  applyDeterministicFixes,
  isOnlyHashCommentLines,
  normalizeModelCommand
} from './generate.mjs'
import { runAgentLoop } from './agent.mjs'
import { analyzeCommandSafety } from './destructive-detect.mjs'
import { classifyConsequence } from './consequence-classifier.mjs'
import { summarizeConsequences } from './consequence-preview.mjs'

/**
 * @param {string} command
 * @param {string} cwd
 */
async function finishShellPath(command, cwd) {
  const safety = analyzeCommandSafety(command)
  const classification = classifyConsequence(command)
  let consequence = /** @type {{ summary: string, structured: object|null }|null} */ (null)
  if (classification.tier !== 'reversible') {
    try {
      consequence = await summarizeConsequences({ command, cwd })
    } catch {
      consequence = null
    }
  }
  return { command, safety, classification, consequence }
}

/**
 * @param {object} opts
 * @param {string} opts.intent
 * @param {string} opts.context
 * @param {'macos'|'linux'|'unknown'} opts.osKind
 * @param {boolean} [opts.explain]
 * @param {string} opts.cwd
 * @param {{ runMode: 'approve'|'always_run', alwaysAsk: boolean }} [opts.session]
 * @param {string[]} [opts.cwdEntries] shallow cwd listing for intent router fit merging
 */
export async function runHotatePipeline({
  intent,
  context,
  osKind,
  explain = false,
  cwd,
  session,
  cwdEntries = [],
}) {
  const legacy = process.env.HOTATE_LEGACY_ROUTER === '1'

  if (!legacy) {
    try {
      const plan = await runAgentLoop({
        intent,
        context,
        osKind,
        cwd
      })

      if (plan.kind === 'CHAT') {
        return {
          resultKind: 'repl',
          repl: {
            type: 'chat',
            message: plan.message,
            note: plan.note,
          },
        }
      }

      if (plan.kind === 'EXECUTE_SHELL') {
        let command = applyDeterministicFixes(
          intent,
          osKind,
          normalizeModelCommand(plan.command.trim())
        )
        if (!command || isOnlyHashCommentLines(command))
          command = await generateCommand({
            intent,
            context,
            osKind,
            explain,
            cwd,
          })
        const shell = await finishShellPath(command, cwd)
        return {
          resultKind: 'shell',
          planNote: plan.note,
          ...shell,
        }
      }
    } catch (e) {
      if (process.env.HOTATE_ROUTER_STRICT === '1') throw e
    }
  }

  const command = await generateCommand({
    intent,
    context,
    osKind,
    explain,
    cwd,
  })
  const shell = await finishShellPath(command, cwd)
  return { resultKind: 'shell', ...shell }
}
