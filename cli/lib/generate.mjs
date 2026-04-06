/**
 * Build-command generator: intent + context → shell command.
 * Prompt style and exemplar pairs follow the nl2bash / Tellina NL↔bash line.
 * https://github.com/TellinaTool/nl2bash (training reference; not bundled data).
 */

/** @returns {'macos'|'linux'|'unknown'} */
export function detectOS(explicit) {
  const v = (explicit || '').toLowerCase()
  if (v === 'macos' || v === 'darwin') return 'macos'
  if (v === 'linux') return 'linux'
  const u = process.platform
  if (u === 'darwin') return 'macos'
  if (u === 'linux') return 'linux'
  return 'unknown'
}

export function osRules(kind) {
  if (kind === 'macos') {
    return `
Target: macOS (Darwin), BSD userland, bash or zsh.
- Prefer portable POSIX when possible; otherwise macOS-specific is OK.
- sed in-place: sed -i '' 's/a/b/' file  (GNU sed uses sed -i without '').
- readlink -f is not portable; on macOS use realpath if available, or python3 -c.
- date: BSD date uses -v; not GNU date -d.
- Clipboard: pbcopy / pbpaste. Open files/URLs: open.
- Coreutils GNU variants (if installed) are often g-prefixed: gdate, gsed.
- Homebrew paths may appear under /opt/homebrew or /usr/local.
- Do not use Linux-only paths such as \`~/.config/systemd\` on macOS unless the user explicitly asked for Linux systemd. macOS uses \`launchd\` (e.g. \`~/Library/LaunchAgents\`) for services—only if they clearly want a login service.
`.trim()
  }
  if (kind === 'linux') {
    return `
Target: Linux, GNU coreutils typical.
- sed -i works; readlink -f is available.
- date -d for GNU date.
- Clipboard often: xclip -selection clipboard or wl-copy (Wayland).
- Open URL/file: xdg-open.
`.trim()
  }
  return `
Target OS unclear — generate POSIX-leaning commands and note assumptions in a trailing shell comment.
`.trim()
}

/** Curated NL→bash pairs (subset style of nl2bash). */
const NL2BASH_EXEMPLARS = `
Exemplar natural-language → bash pairs (match this brevity and literalness):

1) "list all jpg files in the current directory only"
   → find . -maxdepth 1 -type f -iname '*.jpg'

2) "show total disk usage of my home folder"
   → du -sh "$HOME"

3) "search for the word TODO recursively in all py files here"
   → grep -R --include='*.py' -n "TODO" .

4) "make a compressed tarball of the folder project excluding node_modules"
   → tar -czvf archive.tar.gz --exclude='node_modules' project

5) "print the last 20 lines of server.log and keep reading new lines"
   → tail -n 20 -f server.log

6) "rename all .txt files in this folder to .bak"
   → for f in *.txt; do [ -e "$f" ] && mv -- "$f" "\${f%.txt}.bak"; done

7) "what process is listening on port 3000"
   → lsof -nP -iTCP:3000 -sTCP:LISTEN

8) "count non-empty lines in data.csv"
   → grep -cve '^[[:space:]]*$' data.csv || awk 'NF' data.csv | wc -l

9) "what is in this folder" / "list files here" / "show me what's in the current directory"
   → ls -la

10) "install jq using homebrew"
   → brew install jq
`.trim()

export function buildSystemPrompt(osKind) {
  const osBlock = osRules(osKind)
  const osName =
    osKind === 'macos' ? 'macOS' : osKind === 'linux' ? 'Linux' : 'POSIX-leaning (OS ambiguous)'
  return `You are a precise shell command generator (natural language → bash/sh), in the spirit of the nl2bash corpus. Output ONLY the executable shell command (single logical line, or a minimal here-doc if unavoidable). No markdown fences, no backticks, no numbering, no explanation unless the user explicitly asks for a comment.

${osBlock}

Your command must run on ${osName}. Do not blend incompatible BSD vs GNU options: follow the "Target:" rules above only. If the user intent fits both platforms, pick the syntax that matches the target OS.

${NL2BASH_EXEMPLARS}

Rules:
- Prefer safe patterns: quote variables, use -- for tools that support it (where available on the target OS).
- Listing "what's here" / folder contents / files in this directory (no specific extension): use \`ls -la\` for the current directory. Do not use \`find ... | wc -l\` unless the user asked to count files.
- If the user mentions delete/remove files, stay in their working directory: do not invent paths like \`/tmp\`, \`/var\`, or \`/\` unless they named those paths. Prefer cautious patterns (e.g. limited globs, \`-i\` for interactive rm when appropriate).
- Destructive actions (rm, dd, mkfs, chmod -R on /, curl|sh): keep commands accurate but avoid extra destructive flags unless the user clearly asked.
- If the request is ambiguous, pick the most common interpretation and encode assumptions in one short trailing inline comment using #.
- Homebrew installs on macOS: use \`brew install <formula>\` (do not use apt on macOS).
- "What is listening on TCP port N": macOS → \`lsof -nP -iTCP:N -sTCP:LISTEN\`; Linux → \`ss -lptn 'sport = :N'\` or the same lsof line. Do not answer with tail, cat, or unrelated tools.
- **Do not** reply with comment-only “not a shell task” if the user mentions **folder**, **directory**, **file**, **list**, **disk**, **port**, **install**, or a concrete path — give a real command. Reserve \`:\` + \`#\` only for *pure* mode phrases (e.g. a single “always on” with no other task words).
`.trim()
}

export function buildUserMessage(intent, context, cwd) {
  let msg = `Intent: ${intent.trim()}`
  const dir = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : ''
  if (dir) msg += `\nWorking directory (the user is here now): ${dir}`
  if (context?.trim()) {
    msg += `\n\nAdditional context:\n${context.trim()}`
  }
  return msg
}

function stripFences(s) {
  let t = s.trim()
  const full = t.match(/^```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)\n```\s*$/i)
  if (full) return full[1].trim()
  t = t.replace(/^```(?:bash|sh|shell|zsh)?\s*\n?/i, '')
  t = t.replace(/\n?```\s*$/i, '')
  t = t.replace(/```/g, '')
  return t.trim()
}

/** Drop # comments and leading `$` fake prompt lines; join multiple commands with && */
export function normalizeModelCommand(s) {
  let t = stripFences(s)
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const cmds = []
  for (const l of lines) {
    if (l.startsWith('#')) continue
    cmds.push(l.replace(/^\$\s+/, ''))
  }
  if (cmds.length === 0) {
    const noComments = lines.filter((l) => !l.startsWith('#')).join('\n').trim()
    return noComments || ''
  }
  if (cmds.length === 1) return cmds[0]
  return cmds.join(' && ')
}

/** True when every non-empty line is a shell # comment (model refused to output a command). */
export function isOnlyHashCommentLines(cmd) {
  if (!cmd || typeof cmd !== 'string') return true
  const lines = cmd.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return true
  return lines.every((l) => l.startsWith('#'))
}

export function applyDeterministicFixes(intent, osKind, rawCommand) {
  return rawCommand
}

/** Default: Qwen2.5-0.5B via local Ollama (`ollama pull qwen2.5:0.5b`). */
export function llmConfig() {
  const host = (
    process.env.HOTATE_OLLAMA_URL ||
    process.env.OLLAMA_HOST ||
    'http://127.0.0.1:11434'
  ).replace(/\/$/, '')
  const model = process.env.HOTATE_LLM_MODEL || 'qwen2.5:0.5b'
  const rawNp = process.env.HOTATE_NUM_PREDICT
  const numPredict = rawNp
    ? Math.min(2048, Math.max(32, parseInt(rawNp, 10) || 512))
    : 512
  return { host, model, numPredict }
}

export async function generateCommand({
  intent,
  context,
  osKind,
  explain = false,
  cwd = '',
}) {
  const { host, model, numPredict } = llmConfig()
  const system = buildSystemPrompt(osKind)
  let user = buildUserMessage(intent, context, cwd)
  if (explain) {
    user +=
      '\n\nInclude one brief comment line starting with # before the command explaining what it does.'
  }

  const url = `${host}/api/chat`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        options: { temperature: 0.15, num_predict: numPredict },
      }),
    })
  } catch (e) {
    const err = new Error(
      `Cannot reach Ollama at ${host} (${e.cause?.code || e.message}). ` +
        `Start Ollama and run: ollama pull ${model}`
    )
    err.code = 'LLM_CONNECTION'
    throw err
  }

  if (!res.ok) {
    const text = await res.text()
    const err = new Error(
      `Ollama ${res.status} at ${url}: ${text.slice(0, 500)}. ` +
        `If the model is missing: ollama pull ${model}`
    )
    err.code = 'LLM_API'
    throw err
  }

  const data = await res.json()
  const raw = data?.message?.content
  if (!raw || typeof raw !== 'string') {
    const err = new Error('Empty model response from Ollama')
    err.code = 'EMPTY'
    throw err
  }
  let cmd = applyDeterministicFixes(intent, osKind, normalizeModelCommand(raw))
  cmd = typeof cmd === 'string' ? cmd.trim() : ''
  if (!cmd || isOnlyHashCommentLines(cmd)) return ':'
  return cmd
}
