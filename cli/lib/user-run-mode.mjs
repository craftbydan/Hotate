/**
 * Saved preference: ~/.config/hotate/settings.json
 *   runMode: "approve" | "always_run"
 * - approve: significant + irreversible commands require Cancel / Show me first / Confirm before run
 * - always_run: those tiers run immediately after preview (no triple prompt)
 * Reversible (read-only) commands always run without that prompt (unless HOTATE_NO_EXEC, etc.).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** @typedef {'approve'|'always_run'} RunMode */

const FILE = join(homedir(), '.config', 'hotate', 'settings.json')

export function getRunModeConfigPath() {
  return FILE
}

/**
 * @returns {Promise<{ runMode: RunMode }>}
 */
export async function loadRunModeSettings() {
  try {
    const raw = await readFile(FILE, 'utf8')
    const j = JSON.parse(raw)
    const runMode = j.runMode === 'always_run' ? 'always_run' : 'approve'
    return { runMode }
  } catch {
    return { runMode: 'approve' }
  }
}

/**
 * @param {RunMode} runMode
 */
export async function saveRunModeSettings(runMode) {
  const mode = runMode === 'always_run' ? 'always_run' : 'approve'
  await mkdir(dirname(FILE), { recursive: true })
  await writeFile(
    FILE,
    JSON.stringify({ runMode: mode, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )
  return mode
}

/**
 * @param {{
 *   yes: boolean,
 *   alwaysAsk: boolean,
 *   needsConfirmation: boolean,
 *   runMode: RunMode,
 *   tier?: 'reversible'|'significant'|'irreversible',
 * }} opts
 */
export function shouldShowTripleConfirm(opts) {
  const { yes, alwaysAsk, needsConfirmation, runMode, tier } = opts
  if (yes) return false
  if (alwaysAsk) {
    if (tier === 'reversible') return false
    return true
  }
  if (!needsConfirmation) return false
  return runMode !== 'always_run'
}
