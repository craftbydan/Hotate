/**
 * Themed panels: consequence preview + monospace command block (Hotate palette).
 * Call configureUi() once at startup (narrow terminal → simpler, shorter layout).
 */

import { homedir } from 'node:os'

let UI_W = 58
let UI_COMPACT = false

/**
 * @param {object} [opts]
 * @param {boolean} [opts.compact]  force compact (or set HOTATE_COMPACT=1)
 * @param {boolean} [opts.autoSmallScreen] default true: columns < 64 → compact
 */
export function configureUi(opts = {}) {
  const cols = process.stdout?.columns || 58
  const envC = process.env.HOTATE_COMPACT === '1'
  const auto = opts.autoSmallScreen !== false && cols > 0 && cols < 64
  UI_COMPACT = !!opts.compact || envC || auto
  UI_W = Math.max(34, Math.min(Math.max(cols - 2, 34), UI_COMPACT ? 56 : 78))
}

/** @returns {boolean} */
export function isCompactUi() {
  return UI_COMPACT
}

function W() {
  return UI_W
}

/**
 * @param {string} s
 * @param {number} width
 */
function padLine(s, width) {
  const len = [...s].length
  if (len >= width) return s.slice(0, width)
  return s + ' '.repeat(width - len)
}

function rule(t) {
  return t.dim() + '─'.repeat(W() - 2) + t.reset()
}

/** @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t */
export function renderBanner(t) {
  if (UI_COMPACT) {
    return [
      '',
      `  ${t.fg('rust')}${t.bold()}HOTATE${t.reset()} ${t.text()}Describe a task — we run it and show a readable Result.${t.reset()}`,
      `  ${t.dim()}${rule(t)}${t.reset()}`,
      '',
    ].join('\n')
  }
  const line = t.dim() + '─'.repeat(W()) + t.reset()
  return [
    '',
    line,
    `  ${t.fg('rust')}${t.bold()}HOTATE${t.reset()} ${t.dim()}natural language → shell${t.reset()}`,
    `  ${t.mutedText()}${padLine('Runs your command here, then shows a clear Result summary. help = modes · HOTATE_NO_EXEC=1 = preview only.', W() - 2)}${t.reset()}`,
    line,
    '',
  ].join('\n')
}

/**
 * @param {string} cwd absolute path
 * @param {number} [maxGraphemes]
 */
export function formatPromptCwd(cwd, maxGraphemes = 38) {
  const home = homedir()
  let d = cwd || process.cwd()
  if (home && d.startsWith(home)) d = `~${d.slice(home.length)}`
  const g = [...d]
  if (g.length > maxGraphemes)
    d = `…${g.slice(-(maxGraphemes - 1)).join('')}`
  return d
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {string} [cwd]
 */
export function renderWorkingDirLine(t, cwd) {
  const path = formatPromptCwd(cwd || process.cwd(), UI_COMPACT ? 44 : 52)
  return `  ${t.mutedText()}In:${t.reset()} ${t.dim()}${path}${t.reset()}\n`
}

/**
 * Fixed “Permission” strip — shown before every Input so status is always visible.
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {'approve'|'always_run'} runMode
 * @param {boolean} alwaysAsk
 * @param {string} [cwd]
 */
export function renderReplPermissionField(t, runMode, alwaysAsk, cwd) {
  const path = formatPromptCwd(cwd || process.cwd(), UI_COMPACT ? 36 : 54)
  const saved =
    runMode === 'always_run'
      ? `${t.fg('gold')}always-run${t.reset()} ${t.dim()}(🔴 shown → run, no triple prompt)${t.reset()}`
      : `${t.fg('green')}approve${t.reset()} ${t.dim()}(🔴 triple prompt before run)${t.reset()}`
  const sess = alwaysAsk
    ? `${t.fg('rust')}extra confirm on${t.reset()} ${t.dim()}(prompts on 🟠/🔴 when relevant)${t.reset()}`
    : `${t.mutedText()}extra confirm off${t.reset()}`
  if (UI_COMPACT) {
    return [
      '',
      `  ${t.bold()}Permission${t.reset()} ${t.dim()}│${t.reset()} ${saved} ${t.dim()}·${t.reset()} ${sess}`,
      `  ${t.bold()}Folder${t.reset()}     ${t.dim()}│${t.reset()} ${t.dim()}${path}${t.reset()}`,
      '',
    ].join('\n')
  }
  return [
    '',
    `  ${t.dim()}${rule(t)}${t.reset()}`,
    `  ${t.bold()}Permission${t.reset()}`,
    `    ${t.mutedText()}Saved mode:${t.reset()} ${saved}`,
    `    ${t.mutedText()}Session:${t.reset()}   ${sess}`,
    `  ${t.bold()}Folder${t.reset()}       ${t.dim()}${path}${t.reset()}`,
    `  ${t.dim()}${rule(t)}${t.reset()}`,
    '',
  ].join('\n')
}

/** Label for the input line (path lives in Permission → Folder). */
export function renderReplInputLabel(t) {
  return `  ${t.bold()}Input${t.reset()}    ${t.fg('rust')}${t.bold()}›${t.reset()} `
}

/**
 * Opens the Output region for one turn (model, panels, run, result).
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 */
export function renderReplOutputOpen(t) {
  if (UI_COMPACT) {
    return `\n  ${t.bold()}Output${t.reset()} ${t.dim()}────────${t.reset()}\n`
  }
  return [
    '',
    `  ${t.dim()}${rule(t)}${t.reset()}`,
    `  ${t.bold()}Output${t.reset()} ${t.mutedText()}(this turn — model, command, run)${t.reset()}`,
    `  ${t.dim()}${rule(t)}${t.reset()}`,
    '',
  ].join('\n')
}

/** Optional closer under a turn’s output. */
export function renderReplOutputClose(t) {
  return `  ${t.dim()}${'─'.repeat(Math.min(W() - 4, 56))}${t.reset()}\n`
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {string} [cwd]
 */
export function renderPrompt(t, cwd = process.cwd()) {
  const path = formatPromptCwd(cwd, UI_COMPACT ? 28 : 34)
  if (UI_COMPACT) {
    return `${t.dim()}${path}${t.reset()} ${t.fg('rust')}${t.bold()}>${t.reset()} `
  }
  return `${t.dim()}${path}${t.reset()} ${t.fg('rust')}${t.bold()}~${t.reset()} ${t.dim()}${t.italic()}what do you want to do?${t.reset()} `
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {'reversible'|'significant'|'irreversible'} tier
 * @param {string[]} lines
 */
export function renderConsequenceBody(t, tier, lines) {
  const tr = t.tier(tier)
  const border = tr.border + '·' + t.reset()
  const out = []
  const wrap = W() - 4
  for (const raw of lines) {
    const parts = wrapText(raw, wrap)
    for (const p of parts) {
      out.push(`  ${border} ${t.text()}${padLine(p, wrap)}${t.reset()}`)
    }
  }
  return out.join('\n')
}

/**
 * @param {string} text
 * @param {number} maxW
 */
function wrapText(text, maxW) {
  if (!text) return ['']
  const words = text.split(/\s+/)
  /** @type {string[]} */
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if ([...next].length <= maxW) cur = next
    else {
      if (cur) lines.push(cur)
      cur = [...w].length > maxW ? w.slice(0, maxW) : w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {import('./consequence-classifier.mjs').ConsequenceClassification} classification
 * @param {{ summary: string }|null} consequence
 * @param {import('./destructive-detect.mjs').SafetyAnalysis} safety
 */
export function renderConsequencePanel(t, classification, consequence, safety) {
  const tier = classification.tier
  const tr = t.tier(tier)
  const w = W()
  const top = tr.border + '─'.repeat(w - 2) + t.reset()
  const badge = `  ${classification.emoji} ${tr.label}${classification.label}${t.reset()}`

  /** @type {string[]} */
  const bodyLines = []
  if (consequence?.summary) {
    for (const line of consequence.summary.split('\n')) {
      if (line.trim()) bodyLines.push(line.trim())
    }
  } else if (tier !== 'reversible') {
    bodyLines.push(
      UI_COMPACT
        ? 'Couldn’t preview exact paths from here — read the line slowly before running.'
        : 'We couldn’t list exact files from your wording alone, so read the command line slowly before you run it.'
    )
  }

  if (classification.reasons.length && !UI_COMPACT) {
    bodyLines.push(
      `Heads-up: ${classification.reasons.slice(0, 8).join(', ')}${classification.reasons.length > 8 ? '…' : ''}`
    )
  } else if (classification.reasons.length && UI_COMPACT) {
    bodyLines.push(`Note: ${classification.reasons.slice(0, 4).join(', ')}`)
  }

  const body =
    tier === 'reversible'
      ? `  ${t.mutedText()}${UI_COMPACT ? 'Light touch — mostly looking, not changing much. Quick check never hurts.' : 'This one is probably fine for a quick peek (read-only). Give it a once-over anyway.'}${t.reset()}`
      : renderConsequenceBody(t, tier, bodyLines)

  const risk =
    tier === 'irreversible' && safety.reasons.length
      ? `\n  ${t.fg('red')}${t.dim()}${UI_COMPACT ? 'Careful: ' : 'Risk scan: '}${safety.reasons.slice(0, 5).join(', ')}${t.reset()}`
      : ''

  if (UI_COMPACT) {
    return ['', top, badge, body, risk, top, ''].join('\n')
  }
  return ['', top, badge, body, risk, top, ''].join('\n')
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {string} command
 */
export function renderCommandBlock(t, command) {
  const tr = t.tier('reversible')
  const w = W()
  const bar = tr.border + '─'.repeat(w - 2) + t.reset()
  const title = UI_COMPACT
    ? `  ${t.mutedText()}Command${t.reset()} ${t.dim()}(about to run)${t.reset()}`
    : `  ${t.mutedText()}Command${t.reset()} ${t.fg('gold')}${t.dim()}(runs next in this terminal unless you cancel)${t.reset()}`
  const lines = command.split(/\r?\n/)
  /** @type {string[]} */
  const out = [bar, title, bar]
  const wrap = w - 4
  for (const ln of lines) {
    const wrapped = wrapText(ln, wrap)
    for (const wx of wrapped) {
      out.push(
        `  ${t.fg('gold')}${t.bold()}│${t.reset()} ${t.text()}${wx}${t.reset()}`
      )
    }
  }
  out.push(`  ${t.fg('gold')}${t.bold()}│${t.reset()}`, bar, '')
  return out.join('\n')
}

/**
 * Readable summary + framed stdout/stderr after a captured run.
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {import('./execute-shell.mjs').UserRunResult} result
 */
export function renderHumanCommandResult(t, result) {
  if (result.skipped) return ''
  const lines = ['', `  ${t.bold()}${t.text()}Result${t.reset()}`]

  if (result.mode === 'inherit') {
    if (result.error) {
      lines.push(`  ${t.fg('red')}${result.error.message}${t.reset()}`, '')
      return lines.join('\n')
    }
    if (result.signal)
      lines.push(
        `  ${t.fg('gold')}That ran directly in your terminal — stopped (${result.signal}).${t.reset()}`
      )
    else if (result.code !== 0 && result.code != null)
      lines.push(
        `  ${t.fg('gold')}That ran directly in your terminal — exit ${result.code}.${t.reset()}`
      )
    else
      lines.push(
        `  ${t.fg('green')}That ran directly in your terminal — all good (exit 0).${t.reset()}`
      )
    lines.push('')
    return lines.join('\n')
  }

  if (result.error) {
    lines.push(`  ${t.fg('red')}${result.error.message}${t.reset()}`, '')
    return lines.join('\n')
  }

  if (result.signal)
    lines.push(`  ${t.fg('gold')}Interrupted (${result.signal}).${t.reset()}`)
  else if ((result.code ?? 0) === 0)
    lines.push(`  ${t.fg('green')}Success — exit 0.${t.reset()}`)
  else
    lines.push(
      `  ${t.fg('gold')}Exit ${result.code} — review the output below.${t.reset()}`
    )

  const stdout = (result.stdout ?? '').replace(/\r\n/g, '\n')
  const stderr = (result.stderr ?? '').replace(/\r\n/g, '\n')
  const maxLines = UI_COMPACT ? 80 : 200

  if (stdout.trim()) {
    lines.push(`  ${t.dim()}──────── output ────────${t.reset()}`)
    const outLines = stdout.replace(/\n$/, '').split('\n')
    const slice = outLines.slice(0, maxLines)
    for (const ln of slice)
      lines.push(`  ${t.dim()}│${t.reset()} ${t.text()}${ln}${t.reset()}`)
    if (outLines.length > slice.length)
      lines.push(
        `  ${t.mutedText()}… ${outLines.length - slice.length} more lines. ${t.dim()}HOTATE_EXEC_INHERIT=1 streams everything live.${t.reset()}`
      )
  } else if (!stderr.trim())
    lines.push(`  ${t.mutedText()}(No printed output.)${t.reset()}`)

  if (stderr.trim()) {
    lines.push(`  ${t.dim()}──────── stderr ────────${t.reset()}`)
    for (const ln of stderr.trimEnd().split('\n').slice(0, 60))
      lines.push(`  ${t.dim()}│${t.reset()} ${t.fg('gold')}${ln}${t.reset()}`)
  }

  if (result.truncated)
    lines.push(
      `  ${t.mutedText()}Output hit the size cap — try HOTATE_MAX_OUTPUT or HOTATE_EXEC_INHERIT=1.${t.reset()}`
    )

  lines.push('')
  return lines.join('\n')
}

/** @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t */
export function renderHelpFooter(t) {
  if (UI_COMPACT) {
    return (
      `  ${t.mutedText()}Quick:${t.reset()} ${t.fg('rust')}mode${t.reset()} ${t.dim()}·${t.reset()} ` +
      `${t.fg('rust')}always-run${t.reset()} ${t.dim()}·${t.reset()} ` +
      `${t.fg('rust')}approve${t.reset()} ${t.dim()}·${t.reset()} ` +
      `${t.fg('rust')}help${t.reset()}\n`
    )
  }
  return (
    `  ${t.mutedText()}Repl:${t.reset()} ${t.fg('rust')}help${t.reset()} ${t.dim()}·${t.reset()} ` +
    `${t.fg('rust')}mode${t.reset()} ${t.dim()}·${t.reset()} ` +
    `${t.fg('rust')}always-run${t.reset()} ${t.dim()}/${t.reset()} ${t.fg('rust')}approve${t.reset()} ${t.dim()}·${t.reset()} ` +
    `${t.fg('rust')}env${t.reset()} ${t.dim()}·${t.reset()} ` +
    `${t.fg('rust')}ask${t.reset()} ${t.dim()}·${t.reset()} ` +
    `${t.fg('rust')}exit${t.reset()}\n`
  )
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {'approve'|'always_run'} runMode
 * @param {boolean} alwaysAsk
 */
export function renderRunModeBannerLine(t, runMode, alwaysAsk) {
  const modePart =
    runMode === 'always_run'
      ? `${t.fg('gold')}always-run${t.reset()} ${t.dim()}(${UI_COMPACT ? 'no extra confirm' : '🔴 shown; no approve step'})${t.reset()}`
      : `${t.fg('green')}approve${t.reset()} ${t.dim()}(${UI_COMPACT ? 'confirm risky ones' : '🔴 needs Confirm'})${t.reset()}`
  const askPart = alwaysAsk
    ? ` ${t.mutedText()}·${t.reset()} ${t.fg('rust')}extra confirm${t.reset()}`
    : ''
  return `  ${t.mutedText()}Safety:${t.reset()} ${modePart}${askPart}\n`
}

/**
 * @param {ReturnType<import('./terminal-theme.mjs').createTheme>} t
 * @param {string} configPath
 * @param {'approve'|'always_run'} current
 */
export function renderRunModeHelp(t, configPath, current) {
  const short = UI_COMPACT
  return [
    '',
    `  ${t.bold()}Safety mode${t.reset()} ${t.dim()}(saved)${t.reset()}`,
    ...(short
      ? []
      : [`  ${t.mutedText()}File:${t.reset()} ${t.dim()}${configPath}${t.reset()}`]),
    '',
    `  ${t.fg('green')}approve${t.reset()}      ${t.text()}Ask before risky commands.${t.reset()}`,
    `  ${t.fg('gold')}always-run${t.reset()}   ${t.text()}Run risky commands right after the preview (no triple prompt).${t.reset()}`,
    '',
    `  ${t.mutedText()}Now:${t.reset()} ${t.bold()}${current}${t.reset()}`,
    `  ${t.dim()}Type:${t.reset()} ${t.fg('rust')}approve${t.reset()} ${t.dim()}|${t.reset()} ${t.fg('rust')}always-run${t.reset()} ${t.dim()}(shortcuts — no “mode ” needed)${t.reset()}`,
    '',
  ].join('\n')
}
