/**
 * Machine context for cmdgen: cwd, OS, PATH summary, common CLI tools (which + optional versions).
 */
import { spawnSync } from 'node:child_process'
import os from 'node:os'

/** @type {readonly string[]} */
const PROBE_TOOLS = [
  'git',
  'curl',
  'wget',
  'ssh',
  'make',
  'gcc',
  'clang',
  'brew',
  'apt-get',
  'apt',
  'yum',
  'dnf',
  'pacman',
  'zypper',
  'snap',
  'flatpak',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'corepack',
  'python3',
  'python',
  'pip3',
  'pip',
  'cargo',
  'rustc',
  'go',
  'ruby',
  'gem',
  'docker',
  'podman',
  'kubectl',
  'terraform',
  'vim',
  'nvim',
  'sed',
  'awk',
  'jq',
  'ffmpeg',
  'convert',
  'magick',
]

function which(name) {
  const r = spawnSync('which', [name], {
    encoding: 'utf8',
    env: process.env,
    timeout: 2500,
  })
  if (r.status === 0 && r.stdout) {
    const line = r.stdout.trim().split('\n')[0]
    return line || null
  }
  return null
}

function tryVersion(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: process.env,
    timeout: 4000,
  })
  if (r.error) return null
  const out = (r.stdout || r.stderr || '').trim()
  const line = out.split('\n')[0]
  if (!line) return null
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

function summarizePath(pathStr) {
  if (!pathStr || !pathStr.trim()) {
    return { count: 0, head: [], rawLength: 0 }
  }
  const parts = pathStr.split(':').filter(Boolean)
  return {
    count: parts.length,
    head: parts.slice(0, 12),
    rawLength: pathStr.length,
  }
}

/**
 * @param {{ versions?: boolean }} [opts]
 */
export function gatherMachineContext(opts = {}) {
  const { versions = true } = opts
  const pathStr = process.env.PATH || ''
  const pathInfo = summarizePath(pathStr)

  /** @type {Record<string, string | null>} */
  const tools = {}
  for (const name of PROBE_TOOLS) {
    tools[name] = which(name)
  }

  /** @type {Record<string, string | null>} */
  const toolVersions = {}
  if (versions) {
    if (tools.node) toolVersions.node = tryVersion('node', ['-v'])
    if (tools.npm) toolVersions.npm = tryVersion('npm', ['-v'])
    if (tools.python3) toolVersions.python3 = tryVersion('python3', ['--version'])
    else if (tools.python) toolVersions.python = tryVersion('python', ['--version'])
    if (tools.brew) toolVersions.brew = tryVersion('brew', ['--version'])
    if (tools.git) toolVersions.git = tryVersion('git', ['--version'])
    if (tools.docker) toolVersions.docker = tryVersion('docker', ['--version'])
    if (tools.go) toolVersions.go = tryVersion('go', ['version'])
  }

  const present = Object.entries(tools)
    .filter(([, p]) => p != null)
    .map(([n, p]) => `${n}→${p}`)

  return {
    cwd: process.cwd(),
    home: os.homedir(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    user: process.env.USER || process.env.USERNAME || null,
    shell: process.env.SHELL || null,
    path: pathStr,
    pathDirCount: pathInfo.count,
    pathHead: pathInfo.head,
    tools,
    toolVersions,
    toolsPresentList: present,
  }
}

/**
 * Text block suitable to append to hotate-cmd --context
 */
export function formatContextForPrompt(ctx) {
  const lines = [
    '## Machine context (auto-injected)',
    `- cwd: ${ctx.cwd}`,
    `- home: ${ctx.home}`,
    `- user: ${ctx.user ?? '(unknown)'}`,
    `- shell: ${ctx.shell ?? '(unknown)'}`,
    `- OS: ${ctx.platform} ${ctx.arch} (${ctx.osType} ${ctx.osRelease})`,
    `- hostname: ${ctx.hostname}`,
    `- PATH: ${ctx.pathDirCount} entries; first dirs: ${ctx.pathHead.join(':') || '(empty)'}`,
    `- CLI tools found: ${ctx.toolsPresentList.length ? ctx.toolsPresentList.join('; ') : '(none probed)'}`,
  ]
  const verEntries = Object.entries(ctx.toolVersions).filter(([, v]) => v)
  if (verEntries.length) {
    lines.push(
      `- Versions: ${verEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')}`
    )
  }
  return lines.join('\n')
}
