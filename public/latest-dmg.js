/**
 * Resolves a[data-hotate-dmg] hrefs to the latest GitHub release .dmg (public API).
 * Fallback: releases page if none published yet.
 */
const REPO = 'craftbydan/Hotate'
const FALLBACK = `https://github.com/${REPO}/releases`

function pickDmgUrl(assets) {
  if (!Array.isArray(assets) || !assets.length) return null
  const dmgs = assets.filter((a) => a && /\.dmg$/i.test(a.name))
  if (!dmgs.length) return null

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  const intelMac = /Intel Mac OS X/i.test(ua)

  if (intelMac) {
    const x64 = dmgs.find((a) => /x64|amd64/i.test(a.name))
    if (x64?.browser_download_url) return x64.browser_download_url
  }

  const arm = dmgs.find((a) => /arm64/i.test(a.name))
  if (arm?.browser_download_url) return arm.browser_download_url

  const universal = dmgs.find((a) => /universal|darwin/i.test(a.name))
  if (universal?.browser_download_url) return universal.browser_download_url

  return dmgs[0].browser_download_url || null
}

function setLabel(el, text) {
  const t = el.querySelector('[data-hotate-dl-status]')
  if (t) t.textContent = text
}

async function wireLatestDmgLinks() {
  const links = document.querySelectorAll('a[data-hotate-dmg]')
  if (!links.length) return

  links.forEach((a) => {
    setLabel(a, '…')
    a.classList.add('hotate-dl-pending')
  })

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github+json' },
      }
    )
    if (!res.ok) throw new Error(`GitHub ${res.status}`)
    const data = await res.json()
    const url = pickDmgUrl(data.assets)
    if (!url) throw new Error('No .dmg in latest release')

    links.forEach((a) => {
      a.href = url
      a.classList.remove('hotate-dl-pending')
      setLabel(a, '')
    })
  } catch {
    links.forEach((a) => {
      a.href = FALLBACK
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.classList.remove('hotate-dl-pending')
      setLabel(a, '')
    })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireLatestDmgLinks)
} else {
  wireLatestDmgLinks()
}
