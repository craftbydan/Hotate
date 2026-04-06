/**
 * Explicit confirmation: three choices only. No bare y/n.
 */
import readline from 'node:readline/promises'

/**
 * @param {string} raw
 * @returns {'cancel'|'show'|'confirm'|'reject-yn'|null}
 */
export function parseChoice(raw) {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (/^y(es)?$/i.test(s) || /^no?$/i.test(s)) return 'reject-yn'
  if (s === '1' || s === 'cancel') return 'cancel'
  if (s === '2' || s === 'show me first') return 'show'
  if (s === '3' || s === 'confirm') return 'confirm'
  return null
}

/**
 * @typedef {ReturnType<import('./terminal-theme.mjs').createTheme>} HotateTheme
 */

/**
 * @param {object} [opts]
 * @param {import('node:stream').Readable} [opts.inputStream]
 * @param {import('node:stream').Writable} [opts.outputStream]
 * @param {HotateTheme} [opts.theme]
 * @param {import('node:readline').Interface} [opts.rl] shared interface (e.g. REPL); do not close here
 * @returns {Promise<'cancel'|'show'|'confirm'>}
 */
export async function promptTripleChoice({
  inputStream = process.stdin,
  outputStream = process.stderr,
  theme,
  rl: existingRl,
} = {}) {
  const ownRl = !existingRl
  const rl =
    existingRl ||
    readline.createInterface({ input: inputStream, output: outputStream })
  const t = theme
  const styled = !!(t && t.enabled)

  try {
    for (;;) {
      if (styled) {
        outputStream.write(`\n${t.dim()}── Next step ──${t.reset()}\n\n`)
        outputStream.write(
          `  ${t.fg('rust')}${t.bold()}1${t.reset()}  Cancel\n`
        )
        outputStream.write(
          `  ${t.fg('gold')}${t.bold()}2${t.reset()}  Show me first\n`
        )
        outputStream.write(
          `  ${t.fg('green')}${t.bold()}3${t.reset()}  Confirm — run this command\n\n`
        )
        outputStream.write(
          `${t.mutedText()}Type 1–3 or the full label. y/n is not accepted.${t.reset()}\n`
        )
        outputStream.write(`${t.fg('rust')}${t.bold()}›${t.reset()} `)
      } else {
        outputStream.write('\nWhat should happen next?\n\n')
        outputStream.write('  1. Cancel\n')
        outputStream.write('  2. Show me first\n')
        outputStream.write('  3. Confirm — run this command\n\n')
        outputStream.write(
          'Type 1, 2, or 3 — or type the full label (Cancel, Show me first, Confirm).\n'
        )
        outputStream.write('Single-letter y/n is not accepted.\n> ')
      }
      const line = await rl.question('')
      const c = parseChoice(line || '')
      if (c === 'reject-yn') {
        outputStream.write(
          styled
            ? `\n${t.fg('gold')}Pick one of the three options above.${t.reset()}\n`
            : '\nUse one of the three options above (by number or full label).\n'
        )
        continue
      }
      if (c) return c
      outputStream.write(
        styled
          ? `\n${t.mutedText()}No match — try again.${t.reset()}\n`
          : '\nThat does not match any option. Try again.\n'
      )
    }
  } finally {
    if (ownRl) rl.close()
  }
}
