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
   → macOS: lsof -nP -iTCP:3000 -sTCP:LISTEN
   → Linux: ss -lptn 'sport = :3000' || lsof -nP -iTCP:3000 -sTCP:LISTEN

8) "count non-empty lines in data.csv"
   → grep -cve '^[[:space:]]*$' data.csv || awk 'NF' data.csv | wc -l
`.trim()

export function buildSystemPrompt(osKind) {
  const osBlock = osRules(osKind)
  return `You are a precise shell command generator. Output ONLY the executable shell command (single logical line, or a minimal here-doc if unavoidable). No markdown fences, no backticks, no numbering, no explanation unless the user explicitly asks for a comment.

${osBlock}

${NL2BASH_EXEMPLARS}

Rules:
- Prefer safe patterns: quote variables, use -- for tools that support it.
- Destructive actions (rm, dd, mkfs, chmod -R on /, curl|sh): keep commands accurate but avoid extra destructive flags unless the user clearly asked.
- If the request is ambiguous, pick the most common interpretation and encode assumptions in one short trailing inline comment using #.
`.trim()
}

export function buildUserMessage(intent, context) {
  let msg = `Intent: ${intent.trim()}`
  if (context?.trim()) {
    msg += `\n\nAdditional context:\n${context.trim()}`
  }
  return msg
}

function stripFences(s) {
  const t = s.trim()
  const m = t.match(/^```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)\n```$/i)
  return m ? m[1].trim() : t
}

/** Default: Qwen2.5-0.5B via local Ollama (`ollama pull qwen2.5:0.5b`). */
export function llmConfig() {
  const host = (
    process.env.HOTATE_OLLAMA_URL ||
    process.env.OLLAMA_HOST ||
    'http://127.0.0.1:11434'
  ).replace(/\/$/, '')
  const model = process.env.HOTATE_LLM_MODEL || 'qwen2.5:0.5b'
  return { host, model }
}

export async function generateCommand({ intent, context, osKind, explain = false }) {
  const { host, model } = llmConfig()
  const system = buildSystemPrompt(osKind)
  let user = buildUserMessage(intent, context)
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
        options: { temperature: 0.15, num_predict: 800 },
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
  return stripFences(raw).trim()
}
