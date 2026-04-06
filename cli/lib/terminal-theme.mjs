/**
 * Hotate palette for terminals (truecolor), aligned with hotate.css :root.
 * Respects NO_COLOR; disables when stream is not TTY unless FORCE_COLOR=1.
 */

/** @param {import('node:tty').WriteStream | undefined} stream */
export function colorEnabledFor(stream) {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false
  if (process.env.FORCE_COLOR === '1') return true
  return !!(stream && stream.isTTY)
}

/** Hotate CSS tokens → RGB */
export const PALETTE = {
  ink: [24, 20, 15],
  paper: [250, 247, 241],
  warm: [240, 235, 224],
  rust: [124, 59, 30],
  gold: [176, 125, 58],
  green: [46, 107, 62],
  red: [181, 34, 0],
  muted: [24, 20, 15],
  /** Readable on typical dark terminal backgrounds */
  shellInk: [218, 210, 196],
  shellMuted: [148, 138, 124],
}

const esc = (c) => `\x1b[${c}m`

/** @param {boolean} enabled */
export function createTheme(enabled) {
  if (!enabled) {
    const z = () => ''
    return {
      enabled: false,
      reset: z,
      bold: z,
      dim: z,
      italic: z,
      fg: () => '',
      bg: () => '',
      rgbFg: () => '',
      rgbBg: () => '',
      text: () => '',
      mutedText: () => '',
      tier: () => ({
        label: '',
        badge: '',
        border: '',
        accent: '',
      }),
    }
  }

  const reset = () => esc('0')
  const bold = () => esc('1')
  const dim = () => esc('2')
  const italic = () => esc('3')

  const rgbFg = (r, g, b) => esc(`38;2;${r};${g};${b}`)
  const rgbBg = (r, g, b) => esc(`48;2;${r};${g};${b}`)

  const fg = (name) => {
    const [r, g, b] = PALETTE[name] || PALETTE.ink
    return rgbFg(r, g, b)
  }

  const bg = (name) => {
    const [r, g, b] = PALETTE[name] || PALETTE.paper
    return rgbBg(r, g, b)
  }

  /**
   * @param {'reversible'|'significant'|'irreversible'} tier
   */
  const tier = (tier) => {
    if (tier === 'irreversible')
      return {
        label: rgbFg(...PALETTE.red) + bold(),
        badge: rgbFg(...PALETTE.red),
        border: rgbFg(...PALETTE.red),
        accent: rgbFg(...PALETTE.rust),
      }
    if (tier === 'significant')
      return {
        label: rgbFg(...PALETTE.gold) + bold(),
        badge: rgbFg(...PALETTE.gold),
        border: rgbFg(...PALETTE.gold),
        accent: rgbFg(...PALETTE.rust),
      }
    return {
      label: rgbFg(...PALETTE.green) + bold(),
      badge: rgbFg(...PALETTE.green),
      border: rgbFg(...PALETTE.green),
      accent: rgbFg(...PALETTE.green),
    }
  }

  return {
    enabled: true,
    reset,
    bold,
    dim,
    italic,
    fg,
    bg,
    rgbFg,
    rgbBg,
    tier,
    text: () => rgbFg(...PALETTE.shellInk),
    mutedText: () => rgbFg(...PALETTE.shellMuted),
  }
}
