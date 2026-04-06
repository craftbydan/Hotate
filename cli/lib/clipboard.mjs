/**
 * Copy text to the system clipboard when a CLI tool is available (no extra deps).
 */
import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'

/**
 * @param {string} text
 * @returns {{ ok: boolean, reason?: string }}
 */
export function copyToClipboard(text) {
  if (process.env.HOTATE_NO_CLIPBOARD === '1')
    return { ok: false, reason: 'disabled' }
  const t = typeof text === 'string' ? text : ''
  if (!t) return { ok: false, reason: 'empty' }
  const plat = platform()
  const stdin = ['pipe', 'ignore', 'ignore']

  try {
    if (plat === 'darwin') {
      const r = spawnSync('pbcopy', { input: t, encoding: 'utf8', stdio: stdin })
      return { ok: r.status === 0 }
    }
    if (plat === 'linux') {
      let r = spawnSync('wl-copy', { input: t, encoding: 'utf8', stdio: stdin })
      if (r.status === 0) return { ok: true }
      r = spawnSync(
        'xclip',
        ['-selection', 'clipboard'],
        { input: t, encoding: 'utf8', stdio: stdin }
      )
      return { ok: r.status === 0 }
    }
  } catch {
    return { ok: false, reason: 'error' }
  }
  return { ok: false, reason: 'os' }
}
