/**
 * Best-effort, human-readable summary of what a shell command would touch
 * on disk (counts, sizes, date span, folder). Plain language; no shell jargon.
 */

import { homedir } from 'node:os'
import { join, resolve, relative, sep, basename, dirname } from 'node:path'
import { lstat, readdir, realpath } from 'node:fs/promises'

/** @typedef {{ files: number, dirs: number, bytes: bigint, oldestMs: number|null, newestMs: number|null }} Aggregate */

const MAX_LISTED = 8000
const MAX_DEPTH = 40

/**
 * @param {bigint|number} n
 */
function humanSize(n) {
  const b = typeof n === 'bigint' ? Number(n) : n
  if (b < 1024) return `${b} bytes`
  const kb = b / 1024
  if (kb < 1024)
    return kb < 10 ? `${kb.toFixed(1)} kilobytes` : `${Math.round(kb)} kilobytes`
  const mb = kb / 1024
  if (mb < 1024)
    return mb < 10 ? `${mb.toFixed(1)} megabytes` : `${Math.round(mb)} megabytes`
  const gb = mb / 1024
  return gb < 10 ? `${gb.toFixed(1)} gigabytes` : `${Math.round(gb)} gigabytes`
}

/**
 * @param {number} ms
 */
function sayDate(ms) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
  }).format(new Date(ms))
}

/**
 * @param {string} p
 * @param {string} cwd
 */
function expandPath(p, cwd) {
  let s = p.trim()
  if (s === '~') s = homedir()
  else if (s.startsWith('~/')) s = join(homedir(), s.slice(2))
  else if (!s) s = cwd
  if (s.startsWith('..') || (!s.startsWith(sep) && !/^[A-Za-z]:\\/.test(s)))
    return resolve(cwd, s)
  return resolve(s)
}

/**
 * Glob * ? in last segment only; dir is absolute parent.
 * @param {string} parentAbs
 * @param {string} pattern last path segment may include * ?
 */
async function expandGlobInDir(parentAbs, pattern) {
  const out = []
  let entries
  try {
    entries = await readdir(parentAbs)
  } catch {
    return out
  }
  const rx = globToRegex(pattern)
  for (const e of entries) {
    if (rx.test(e)) out.push(join(parentAbs, e))
  }
  return out
}

/**
 * @param {string} pattern
 */
function globToRegex(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (/[.+^${}()|[\]\\]/.test(c)) re += '\\' + c
    else re += c
  }
  return new RegExp(`^${re}$`)
}

/**
 * Parse "quoted" and unquoted tokens from a tail string.
 * @param {string} tail
 */
function tokenizeShellArgs(tail) {
  const args = []
  let i = 0
  const len = tail.length
  while (i < len) {
    while (i < len && /\s/.test(tail[i])) i++
    if (i >= len) break
    if (tail[i] === "'" ) {
      i++
      let s = ''
      while (i < len && tail[i] !== "'") s += tail[i++]
      if (tail[i] === "'") i++
      args.push(s)
      continue
    }
    if (tail[i] === '"') {
      i++
      let s = ''
      while (i < len && tail[i] !== '"') s += tail[i++]
      if (tail[i] === '"') i++
      args.push(s)
      continue
    }
    let s = ''
    while (i < len && !/\s/.test(tail[i])) s += tail[i++]
    if (s) args.push(s)
  }
  return args
}

/** Strip rm flags; return argument tokens (paths / globs). Operands are never eaten as flag values. */
function parseRmArgs(command) {
  const m = command.match(/\brm\b(.*)$/is)
  if (!m) return []
  let rest = m[1].trim()
  while (rest.length) {
    if (rest === '--') {
      rest = ''
      break
    }
    if (rest.startsWith('--')) {
      const long = /^(--[\w-]+)\s*/.exec(rest)
      if (long) {
        rest = rest.slice(long[0].length).trim()
        continue
      }
      break
    }
    if (rest.startsWith('-') && rest.length > 1 && /[a-zA-Z]/.test(rest[1])) {
      const shorts = /^(-[a-zA-Z]+)\s*/.exec(rest)
      if (shorts) {
        rest = rest.slice(shorts[0].length).trim()
        continue
      }
    }
    break
  }
  return tokenizeShellArgs(rest)
}

/** find ... path before other flags */
function parseFindDelete(command) {
  const u = command.replace(/\s+/g, ' ')
  if (!/\bfind\b/.test(u) || !/\s-delete\b/.test(u)) return null
  const m = u.match(/\bfind\s+(\S+)/)
  if (!m) return null
  const start = m[1]
  let nameGlob = null
  let maxDepth = null
  const nm = u.match(/-name\s+(['"])([^'"]*)\1/)
  if (nm) nameGlob = nm[2]
  else {
    const nm2 = u.match(/-name\s+(\S+)/)
    if (nm2) nameGlob = nm2[1].replace(/^['"]|['"]$/g, '')
  }
  const md = u.match(/-maxdepth\s+(\d+)/)
  if (md) maxDepth = parseInt(md[1], 10)
  return { start, nameGlob, maxDepth }
}

function parseCpMvArgs(command) {
  const kind = /\bmv\b/.test(command) ? 'move' : /\bcp\b/.test(command) ? 'copy' : null
  if (!kind) return null
  const m = command.match(/\b(?:cp|mv)\b(.*)$/is)
  if (!m) return null
  let rest = m[1].trim()
  /** @type {string[]} */
  const skipLong = new Set()
  while (rest.startsWith('-')) {
    const one = /^(-[a-zA-Z]+|--[a-z-]+)\s*/.exec(rest)
    if (!one) break
    rest = rest.slice(one[0].length).trim()
  }
  const parts = tokenizeShellArgs(rest)
  if (parts.length < 2) return null
  const dest = parts[parts.length - 1]
  const sources = parts.slice(0, -1)
  return { kind, sources, dest }
}

/**
 * Resolve a path list: globs normalize to absolute file list.
 * @param {string[]} rawArgs
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
async function resolveTargets(rawArgs, cwd) {
  /** @type {string[]} */
  const abs = []
  for (const raw of rawArgs) {
    if (!raw || raw === '-') continue
    const expanded = expandPath(raw, cwd)
    if (/[*?]/.test(basename(expanded))) {
      const parent = dirname(expanded)
      const pat = basename(expanded)
      const hits = await expandGlobInDir(parent, pat)
      abs.push(...hits)
    } else {
      abs.push(expanded)
    }
  }
  return abs
}

/**
 * @param {string} abs
 * @param {Aggregate} agg
 * @param {number} depth
 */
async function walkAggregate(abs, agg, depth) {
  if (agg.files + agg.dirs >= MAX_LISTED) return
  if (depth > MAX_DEPTH) return
  let st
  try {
    st = await lstat(abs)
  } catch {
    return
  }
  if (st.isDirectory()) {
    agg.dirs++
    let kids
    try {
      kids = await readdir(abs)
    } catch {
      return
    }
    for (const k of kids) {
      if (agg.files + agg.dirs >= MAX_LISTED) break
      await walkAggregate(join(abs, k), agg, depth + 1)
    }
  } else {
    agg.files++
    agg.bytes += BigInt(st.size)
    const t = st.mtimeMs
    if (agg.oldestMs == null || t < agg.oldestMs) agg.oldestMs = t
    if (agg.newestMs == null || t > agg.newestMs) agg.newestMs = t
  }
}

/**
 * @returns {Promise<Aggregate>}
 */
async function aggregateResolvedPaths(paths, { recurseIntoDirs = true } = {}) {
  /** @type {Aggregate} */
  const agg = {
    files: 0,
    dirs: 0,
    bytes: 0n,
    oldestMs: null,
    newestMs: null,
  }
  const seen = new Set()
  for (const p of paths) {
    let real = p
    try {
      real = await realpath(p)
    } catch {
      real = p
    }
    if (seen.has(real)) continue
    seen.add(real)
    let st
    try {
      st = await lstat(real)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (!recurseIntoDirs) {
        agg.dirs++
      } else {
        await walkAggregate(real, agg, 0)
      }
    } else {
      agg.files++
      agg.bytes += BigInt(st.size)
      const t = st.mtimeMs
      if (agg.oldestMs == null || t < agg.oldestMs) agg.oldestMs = t
      if (agg.newestMs == null || t > agg.newestMs) agg.newestMs = t
    }
  }
  return agg
}

/**
 * @param {string} cwd
 */
function friendlyFolderLine(cwd, roots) {
  if (roots.length === 0) return `Looking from: ${cwd}`
  let common = roots[0]
  for (let i = 1; i < roots.length; i++) {
    const a = common.split(sep)
    const b = roots[i].split(sep)
    let j = 0
    while (j < a.length && j < b.length && a[j] === b[j]) j++
    common = a.slice(0, j).join(sep)
  }
  if (!common) common = cwd
  const rel = relative(cwd, common) || '.'
  if (rel === '.' || rel === '')
    return `Where it applies: ${common} (the folder you are working in now).`
  if (rel === '..')
    return `Where it applies: ${common} (one level up from where you are now).`
  return `Where it applies: ${common} (under your current folder as: ${rel}).`
}

/**
 * @param {object} opts
 * @param {string} opts.command
 * @param {string} opts.cwd
 */
export async function summarizeConsequences({ command, cwd }) {
  const whereWord = 'on this computer'

  /** @type {string[]} */
  const roots = []
  let action = 'change'
  let note = ''

  if (
    /\brm\b/.test(command) ||
    (/\bfind\b/.test(command) && /\s-delete\b/.test(command))
  ) {
    action = 'remove'
  } else if (/\bmv\b/.test(command)) {
    action = 'move'
  } else if (/\bcp\b/.test(command)) {
    action = 'copy'
  }

  let targets = /** @type {string[]} */ ([])

  const fd = parseFindDelete(command)
  if (fd) {
    const base = expandPath(fd.start, cwd)
    if (fd.nameGlob) {
      const limit = fd.maxDepth != null ? fd.maxDepth : MAX_DEPTH
      /** @type {string[]} */
      const matches = []
      async function walkFind(dir, d) {
        if (matches.length >= MAX_LISTED || d > limit) return
        let entries
        try {
          entries = await readdir(dir)
        } catch {
          return
        }
        const rx = globToRegex(fd.nameGlob)
        for (const e of entries) {
          if (matches.length >= MAX_LISTED) break
          const full = join(dir, e)
          let st
          try {
            st = await lstat(full)
          } catch {
            continue
          }
          if (st.isFile() && rx.test(e)) matches.push(full)
          if (st.isDirectory() && d < limit) await walkFind(full, d + 1)
        }
      }
      await walkFind(base, 0)
      targets = matches
      roots.push(base)
      if (fd.maxDepth != null)
        note = `Only looking down to ${fd.maxDepth} levels from that folder.`
    } else {
      targets = [base]
      roots.push(base)
    }
  } else if (/\brm\b/.test(command)) {
    const args = parseRmArgs(command)
    targets = await resolveTargets(args, cwd)
    for (const t of targets) roots.push(dirname(t) === t ? t : dirname(t))
  } else if (/\bchmod\b/.test(command) || /\bchown\b/.test(command)) {
    const after = command.replace(/^[\s\S]*?\b(?:chmod|chown)\b\s+/i, '')
    const tokens = tokenizeShellArgs(after).filter((t) => !t.startsWith('-'))
    if (tokens.length) {
      const lastPath = tokens[tokens.length - 1]
      targets = await resolveTargets([lastPath], cwd)
      for (const t of targets) roots.push(t)
      action = 'change permissions on'
    }
  }

  const cpMv = parseCpMvArgs(command)
  if (!targets.length && cpMv) {
    targets = await resolveTargets(cpMv.sources, cwd)
    for (const t of targets) roots.push(dirname(t) || t)
    action = cpMv.kind === 'move' ? 'move' : 'copy'
    note =
      cpMv.kind === 'move'
        ? `Destination ends up as: ${expandPath(cpMv.dest, cwd)}.`
        : `A duplicate would land in: ${expandPath(cpMv.dest, cwd)}.`
  }

  if (!targets.length) {
    const lines = [
      'What would happen: this command changes something ' + whereWord + ', but we could not safely list exact files from the text alone.',
      'Read the command line slowly before you run it.',
    ]
    return {
      summary: lines.join('\n'),
      structured: null,
    }
  }

  const isPerm = /\b(?:chmod|chown)\b/.test(command)
  const permRecursive = /\s-R\b/.test(command)
  const agg = await aggregateResolvedPaths(targets, {
    recurseIntoDirs: !isPerm || permRecursive,
  })

  const items = agg.files + agg.dirs
  if (items === 0) {
    return {
      summary: [
        'What would happen: nothing matched yet (files may not exist here, or names do not match).',
        'If you run it as-is, it may do very little—or fail quietly.',
      ].join('\n'),
      structured: {
        fileCount: 0,
        totalBytes: 0,
        folderPath: roots[0] || cwd,
      },
    }
  }

  const capNote =
    agg.files + agg.dirs >= MAX_LISTED
      ? ` Stopped counting after about ${MAX_LISTED} items to stay quick. The full run could touch more.`
      : ''

  const folderLine = friendlyFolderLine(cwd, roots.length ? roots : [cwd])
  const sizeLine = `Together that is about ${humanSize(agg.bytes)} across ${agg.files} file${
    agg.files === 1 ? '' : 's'
  }${agg.dirs ? ` and ${agg.dirs} folder${agg.dirs === 1 ? '' : 's'}` : ''}.`
  let dateLine = ''
  if (agg.oldestMs != null && agg.newestMs != null) {
    if (agg.oldestMs === agg.newestMs)
      dateLine = `Last change date we saw: ${sayDate(agg.newestMs)}.`
    else
      dateLine = `Dates we saw run from ${sayDate(agg.oldestMs)} through ${sayDate(agg.newestMs)}.`
  }

  let verb =
    action === 'remove'
      ? 'This would remove'
      : action === 'move'
        ? 'This would move'
        : action === 'copy'
          ? 'This would copy'
          : action === 'change permissions on'
            ? 'Permission changes would apply to'
            : 'This would affect'

  let permNote = ''
  if (isPerm && !permRecursive && agg.dirs >= 1 && agg.files === 0)
    permNote =
      'Only the folder entry would change, not the files and folders inside it.'

  const body = [
    `${verb} ${items} item${items === 1 ? '' : 's'} ${whereWord}. ${sizeLine}${capNote}`,
    folderLine,
    dateLine,
    note,
    permNote,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    summary: body.trim(),
    structured: {
      fileCount: agg.files,
      dirCount: agg.dirs,
      totalBytes: Number(agg.bytes),
      oldestMs: agg.oldestMs,
      newestMs: agg.newestMs,
      folderPath: roots[0] || cwd,
    },
  }
}
