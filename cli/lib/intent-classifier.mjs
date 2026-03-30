/**
 * Intent classifier: one sentence → category for assistant routing.
 * Strategy: weighted rule pass, then optional Ollama LLM fallback when confidence is low.
 */
import { llmConfig } from './generate.mjs'

export const INTENT_CATEGORIES = [
  'file_op',
  'run_program',
  'install',
  'query',
  'delete',
  'network',
]

/** [regex, category, weight] — first matches accumulate; delete/install tuned before generic verbs */
const RULES = [
  [/\b(uninstall|delete|delet(e|ing|ed)|removed?|trash|erase|wipe|purge)\b/i, 'delete', 3],
  [/\brm\b|remove all|remove the|get rid of\b/i, 'delete', 2],
  [/\b(brew install|apt[- ]?get install|apt install|yum install|dnf install|pacman -S|pip3? install|npm i\b|npm install|pnpm add|yarn add|gem install|cargo install|homebrew)\b/i, 'install', 4],
  [/\binstall(ing| ed)?\b/i, 'install', 2],
  [/\b(curl\b|wget\b|ping\b|traceroute|ssh\b|scp\b|sftp\b|nc\b\s|netcat|firewall|dns\b|proxy\b)\b/i, 'network', 3],
  [/\b(using port|listening on port|open port|port\s*[:#]?\s*\d+)\b/i, 'network', 4],
  [/\b(https?:\/\/|:443\b|:80\b|network interface|ip address)\b/i, 'network', 2],
  [/\b(run|launch|execute|npm run|npx\b|open\s+|start\s+the\s+(app|program)|double-?click)\b/i, 'run_program', 3],
  [/\.\/[\w./-]+/, 'run_program', 2],
  [/\bdaemon\b|server\b.*\brun/i, 'run_program', 2],
  [/\b(python3?\s|node\s|ruby\s|cargo run)\b/i, 'run_program', 2],
  [/\b(mv\b|\bcp\b|move|copy|rename|mkdir|organize|rsync\b.*\/[\w.-]|chmod\b|chown\b|\.zip|\.tar|folder|directory|\.(jpg|jpeg|png|pdf|txt|csv|md))\b/i, 'file_op', 2],
  [/\bfind\b.*\b(files?|photos?|images?|\.(jpg|png))\b/i, 'file_op', 2],
  [/\bsort\b.*\b(photos?|files?)\b/i, 'file_op', 2],
  [/\b(what|which|where|how many|how much|disk usage|\bdu\b|\bdf\b|show me|list all|grep\b|locate\b|search for)\b/i, 'query', 2],
  [/\b(cat|tail|head|wc\b|less\b|stat\b)\b/i, 'query', 1],
]

/**
 * Rule-based intent scoring.
 * @returns {{ category: string|null, confidence: 'high'|'medium'|'low'|'none', scores: Record<string, number> }}
 */
export function classifyRuleBased(sentence) {
  const s = sentence.trim()
  const scores = Object.fromEntries(INTENT_CATEGORIES.map((c) => [c, 0]))

  for (const [re, cat, w] of RULES) {
    if (re.test(s)) scores[cat] += w
  }

  const ranked = INTENT_CATEGORIES.map((c) => [c, scores[c]]).sort((a, b) => b[1] - a[1])
  const [top, topS] = ranked[0]
  const secondS = ranked[1][1]

  if (topS === 0) {
    return { category: null, confidence: 'none', scores }
  }

  const margin = topS - secondS
  let confidence
  if (topS >= 4 && margin >= 2) confidence = 'high'
  else if (topS >= 3 && margin >= 1) confidence = 'high'
  else if (topS >= 2 && margin >= 2) confidence = 'medium'
  else if (topS >= 2) confidence = 'medium'
  else if (margin >= 1) confidence = 'low'
  else confidence = 'low'

  return { category: top, confidence, scores }
}

const LLM_SYSTEM = `You classify a single English (or mixed) user sentence for a desktop assistant. Pick exactly ONE label:

- file_op — moving, copying, renaming, organizing local files/folders, archives, permissions on paths
- run_program — starting applications, dev servers, scripts (npm run, python, opening files with an app)
- install — installing apps, CLIs, or language packages (brew, apt, pip, npm install)
- query — questions, listings, searching text, disk/memory info, "what/how/where/how many", read-only inspection
- delete — removing files/folders, trashing, uninstalling software, destructive cleanup
- network — curl/wget, SSH, ports, connectivity, remote hosts, firewalls

Reply with ONLY the label (one word: file_op, run_program, install, query, delete, or network). No punctuation, no explanation.`

/**
 * LLM fallback via Ollama chat (same host/model as cmdgen).
 * @returns {Promise<string>}
 */
export async function classifyWithLLM(sentence) {
  const { host, model } = llmConfig()
  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: LLM_SYSTEM },
        { role: 'user', content: `Sentence: ${sentence.trim()}` },
      ],
      stream: false,
      options: { temperature: 0, num_predict: 32 },
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Ollama classify ${res.status}: ${t.slice(0, 300)}`)
  }

  const data = await res.json()
  const raw = (data?.message?.content || '').trim().toLowerCase()
  const cleaned = raw.replace(/[^a-z_]/g, '')
  for (const c of INTENT_CATEGORIES) {
    if (raw === c || cleaned.includes(c)) return c
  }
  const first = INTENT_CATEGORIES.find((c) => raw.includes(c))
  if (first) return first
  return 'query'
}

/**
 * @param {string} sentence
 * @param {{ llmFallback?: boolean, ruleConfidenceThreshold?: 'medium'|'high' }} [opts]
 *   - ruleConfidenceThreshold `high`: use rules only when confidence is `high`.
 *   - `medium` (default): use rules when confidence is `high` or `medium`.
 *   Otherwise (or when `llmFallback` is false and rules fail): see below.
 */
export async function classifyIntent(sentence, opts = {}) {
  const { llmFallback = true, ruleConfidenceThreshold = 'medium' } = opts
  const rules = classifyRuleBased(sentence)

  const trustRules =
    Boolean(rules.category) &&
    (ruleConfidenceThreshold === 'high'
      ? rules.confidence === 'high'
      : rules.confidence === 'high' || rules.confidence === 'medium')

  if (!llmFallback) {
    return {
      category: rules.category || 'query',
      source: 'rules',
      confidence: rules.confidence,
      scores: rules.scores,
    }
  }

  if (trustRules) {
    return {
      category: rules.category,
      source: 'rules',
      confidence: rules.confidence,
      scores: rules.scores,
    }
  }

  try {
    const cat = await classifyWithLLM(sentence)
    return {
      category: cat,
      source: 'llm',
      scores: rules.scores,
      ruleGuess: rules.category,
      ruleConfidence: rules.confidence,
    }
  } catch (e) {
    if (rules.category) {
      return {
        category: rules.category,
        source: 'rules',
        confidence: rules.confidence,
        scores: rules.scores,
        warn: e.message,
      }
    }
    return {
      category: 'query',
      source: 'fallback',
      scores: rules.scores,
      warn: e.message,
    }
  }
}
