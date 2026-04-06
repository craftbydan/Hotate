/**
 * Run shell commands: human-oriented capture (default) or full TTY inherit.
 */
import { spawnSync } from 'node:child_process'

const MAX_CAPTURE = Math.min(
  parseInt(process.env.HOTATE_MAX_OUTPUT || '', 10) || 512 * 1024,
  4 * 1024 * 1024
)

function shellExecutable() {
  return process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : process.env.SHELL || '/bin/sh'
}

/**
 * @param {string} command
 * @param {{ cwd?: string }} [opts]
 * @returns {{ code: number|null, signal: NodeJS.Signals|null, skipped: boolean, error?: Error }}
 */
export function runShellCommandInherit(command, opts = {}) {
  if (process.env.HOTATE_NO_EXEC === '1') {
    return { code: null, signal: null, skipped: true }
  }
  const c = typeof command === 'string' ? command.trim() : ''
  if (!c) return { code: null, signal: null, skipped: true }

  const cwd = opts.cwd ?? process.cwd()
  const shell = shellExecutable()

  const r = spawnSync(c, {
    shell,
    cwd,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })

  if (r.error)
    return {
      code: null,
      signal: null,
      skipped: false,
      error: r.error,
    }

  return {
    code: r.status,
    signal: r.signal,
    skipped: false,
  }
}

/**
 * @typedef {{
 *   skipped: boolean,
 *   mode: 'inherit'|'capture',
 *   code: number|null,
 *   signal: NodeJS.Signals|null,
 *   stdout?: string,
 *   stderr?: string,
 *   truncated?: boolean,
 *   error?: Error,
 * }} UserRunResult
 */

/**
 * Default: capture stdout/stderr and let the UI frame it. Set HOTATE_EXEC_INHERIT=1 for raw inherit.
 * @param {string} command
 * @param {{ cwd?: string, forceInherit?: boolean }} [opts]
 * @returns {UserRunResult}
 */
export function runShellCommandForUser(command, opts = {}) {
  if (process.env.HOTATE_NO_EXEC === '1') {
    return {
      skipped: true,
      mode: 'capture',
      code: null,
      signal: null,
    }
  }
  const c = typeof command === 'string' ? command.trim() : ''
  if (!c)
    return { skipped: true, mode: 'capture', code: null, signal: null }

  const cwd = opts.cwd ?? process.cwd()
  const useInherit =
    !!opts.forceInherit || process.env.HOTATE_EXEC_INHERIT === '1'

  if (useInherit) {
    const r = runShellCommandInherit(c, { cwd })
    return {
      skipped: !!r.skipped,
      mode: 'inherit',
      code: r.code ?? null,
      signal: r.signal ?? null,
      error: r.error,
    }
  }

  const shell = shellExecutable()
  const r = spawnSync(c, {
    shell,
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: MAX_CAPTURE,
    windowsHide: true,
  })

  if (r.error) {
    return {
      skipped: false,
      mode: 'capture',
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: r.error,
    }
  }

  const stdout = r.stdout ?? ''
  const stderr = r.stderr ?? ''
  const truncated =
    typeof r.stdout === 'string' &&
    (r.stdout.length >= MAX_CAPTURE - 1 ||
      (stderr.length > 0 && stdout.length + stderr.length > MAX_CAPTURE * 0.95))

  return {
    skipped: false,
    mode: 'capture',
    code: r.status,
    signal: r.signal ?? null,
    stdout,
    stderr,
    truncated: !!truncated,
  }
}

/**
 * @param {object} [opts.flags]
 * @param {boolean} [opts.flags.json]
 * @param {boolean} [opts.flags.raw]
 * @param {boolean} [opts.flags.noRun]
 */
export function shouldExecuteInProcess(opts = {}) {
  const flags = opts.flags || {}
  if (process.env.HOTATE_NO_EXEC === '1') return false
  if (flags.json || flags.raw || flags.noRun) return false
  if (!process.stdin.isTTY) return false
  return true
}
