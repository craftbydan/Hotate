/**
 * Map likely typos of repl shortcuts to canonical commands (single token only).
 */

/**
 * @param {string} a
 * @param {string} b
 */
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  /** @type {number[]} */
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    /** @type {number[]} */
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      )
    }
    prev = cur
  }
  return prev[n]
}

/**
 * If this looks like a mistyped built-in (e.g. approce → approve), return the canonical token.
 * @param {string} trimmed
 * @returns {string|null}
 */
export function resolveLikelyReplTypo(trimmed) {
  const t = trimmed.trim().toLowerCase()
  if (!t || /\s/.test(t)) return null
  if (t.length < 6 || t.length > 12) return null

  if (/^appr/i.test(t)) {
    const d = levenshtein(t, 'approve')
    if (d <= 2) return 'approve'
  }

  return null
}

/**
 * Very short lines that mean Hotate UI toggles, not shell tasks.
 * Stops inputs like "[always on]" from turning into bogus systemd redirects.
 *
 * @param {string} raw
 * @returns {{ action: 'always_run' | 'ask_on' | 'ask_off' } | null}
 */
export function resolveHotateSettingsPhrase(raw) {
  const s = raw
    .toLowerCase()
    .replace(/[\[\]'`´]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s.length > 48) return null

  if (/^always\s+run(\s+on)?$/.test(s)) return { action: 'always_run' }

  const two = s.split(/\s+/).filter(Boolean)
  if (
    two.length === 2 &&
    two[0] === 'always' &&
    two[1].length >= 3 &&
    levenshtein(two[1], 'run') <= 1
  )
    return { action: 'always_run' }

  if (/^always\s+approve$/.test(s)) return { action: 'saved_approve' }

  if (
    /^always\s+on$/.test(s) ||
    /^turn\s+always\s+on$/.test(s) ||
    /^always\s+confirm\s+on$/.test(s)
  )
    return { action: 'ask_on' }

  if (
    /^always\s+off$/.test(s) ||
    /^turn\s+always\s+off$/.test(s) ||
    /^always\s+confirm\s+off$/.test(s)
  )
    return { action: 'ask_off' }

  return null
}

/**
 * Phrases like "always run hotate", "approve hotate", "permission tier approve".
 * Maps to saved safety mode (when to prompt before hard-to-undo commands), not the per-command tier.
 *
 * @param {string} line
 * @returns {{ kind: 'approve' | 'always_run' } | null}
 */
export function resolveNaturalSafetyModeInput(line) {
  const s = line
    .toLowerCase()
    .replace(/[\[\]'`´]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null

  if (/^always\s+approve$/.test(s)) return null

  const hotate = /\bhotate\b/.test(s)
  const permTier = /\bpermission\s+tier\b/.test(s)
  const hasAlways =
    /\balways[\s_-]+run\b/.test(s) || /^always\s+run\b/.test(s)
  const hasApprove = /\bapprove\b/.test(s)

  if (permTier) {
    if (hasAlways && hasApprove) return null
    if (hasAlways) return { kind: 'always_run' }
    if (hasApprove) return { kind: 'approve' }
  }

  if (!hotate && !permTier) return null
  if (hasAlways && hasApprove) return null
  if (hasAlways) return { kind: 'always_run' }
  if (hasApprove) return { kind: 'approve' }

  return null
}
