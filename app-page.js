/**
 * Hotate web chat — plans steps via /api/plan (Vite dev middleware or web-bridge).
 */

const thread = document.querySelector('[data-app-thread]')
const form = document.querySelector('[data-app-form]')
const input = document.querySelector('[data-app-input]')
const chips = document.querySelector('[data-app-chips]')
const statusEl = document.querySelector('[data-app-status]')

const STARTERS = [
  'Move my Japan trip photos into a Travel folder',
  "What's using the most space on my computer?",
  'Help me open my project so I can preview it',
]

function setStatus(t) {
  if (statusEl) statusEl.textContent = t || ''
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function appendUser(text) {
  const row = document.createElement('div')
  row.className = 'chat-row chat-row-user'
  row.innerHTML = `<div class="chat-bubble chat-bubble-user">${escapeHtml(
    text
  )}</div>`
  thread.appendChild(row)
  thread.scrollTop = thread.scrollHeight
}

function appendBot(html) {
  const row = document.createElement('div')
  row.className = 'chat-row chat-row-bot'
  row.innerHTML = `<div class="chat-bubble chat-bubble-bot">${html}</div>`
  thread.appendChild(row)
  thread.scrollTop = thread.scrollHeight
}

/** @param {Record<string, unknown>} json */
function formatPlan(json) {
  if (json.error) {
    return `<strong class="chat-bot-title">Something went wrong</strong><p class="chat-bot-body">${escapeHtml(
      String(json.error)
    )}</p><p class="chat-bot-body">Check that Ollama is running and try again.</p>`
  }

  if (json.resultKind === 'repl' && json.message) {
    const text = String(json.message).trim()
    return `<strong class="chat-bot-title">Hotate</strong><p class="chat-bot-body" style="white-space: pre-wrap">${escapeHtml(text)}</p>`
  }

  const cmd = typeof json.command === 'string' ? json.command.trim() : ''
  const tier = json.consequenceLabel || json.consequenceTier || ''
  const emoji = json.consequenceEmoji || ''
  const prev = json.consequencePreview
  const reasons = Array.isArray(json.riskReasons) ? json.riskReasons : []

  let care = ''
  if (reasons.length) {
    care = `<p class="chat-bot-body chat-bot-muted">${escapeHtml(
      reasons.slice(0, 4).join(' · ')
    )}</p>`
  }
  let preview = ''
  if (typeof prev === 'string' && prev.trim()) {
    preview = `<p class="app-preview-note">${escapeHtml(prev.trim())}</p>`
  }

  const step = cmd
    ? `<div class="app-step-wrap"><div class="app-step" tabindex="0">${escapeHtml(
        cmd
      )}</div></div>`
    : `<p class="chat-bot-body">No single step was suggested. Try rephrasing?</p>`

  const fine =
    typeof window !== 'undefined' && typeof window.hotate?.plan === 'function'
      ? ''
      : 'This chat does not run anything automatically. Copy the step if you use it elsewhere.'

  const fineHtml = fine ? `<p class="chat-bot-body chat-bot-fine">${fine}</p>` : ''

  return `<strong class="chat-bot-title">${escapeHtml(
    [emoji, tier].filter(Boolean).join(' ')
  )}</strong>${preview}${care}${step}${fineHtml}`
}

async function plan(intent) {
  if (
    typeof window !== 'undefined' &&
    typeof window.hotate?.plan === 'function'
  ) {
    return window.hotate.plan(intent)
  }

  const r = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent }),
  })
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text || `HTTP ${r.status}` }
  }
}

async function go(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return
  appendUser(trimmed)
  input.value = ''
  setStatus('Thinking…')
  let json
  try {
    json = await plan(trimmed)
  } catch (e) {
    const fallback =
      typeof window.hotate?.plan === 'function'
        ? 'Could not run the planner from the menu bar app.'
        : 'Could not reach the planner. Use “npm run dev” so the local API is available.'
    json = {
      error: e.message || fallback,
    }
  }
  setStatus('')
  appendBot(formatPlan(json))
  input.focus()
}

if (form && input && thread) {
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    go(input.value)
  })

  STARTERS.forEach((label) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'try-chip'
    b.textContent = label
    b.addEventListener('click', () => go(label))
    chips?.appendChild(b)
  })
}
