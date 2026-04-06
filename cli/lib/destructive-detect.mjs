/**
 * Heuristic classification of shell strings that may delete, overwrite, or
 * change the system. Paired with consequence tiers (reversible / significant / irreversible).
 */

/** @typedef {{ destructive: boolean, previewRequired: boolean, reasons: string[] }} SafetyAnalysis */

/**
 * tier: irreversible = data or disk wipe, hard to undo; significant = installs / edits / overwrites;
 * matched patterns feed both safety analysis and {@link classifyConsequence}.
 * @type {{ re: RegExp, reason: string, tier: 'irreversible' | 'significant' }[]}
 */
export const CONSEQUENCE_PATTERNS = [
  // —— Irreversible (remove, wipe, run remote shell) ——
  { re: /\brm\b/, reason: 'rm', tier: 'irreversible' },
  { re: /\brmdir\b/, reason: 'rmdir', tier: 'irreversible' },
  { re: /\bunlink\b/, reason: 'unlink', tier: 'irreversible' },
  { re: /\btrash\b/, reason: 'trash', tier: 'irreversible' },
  { re: /find\s+[^\n|]*\s+-delete\b/, reason: 'find -delete', tier: 'irreversible' },
  { re: /find\s+[^\n|]*\s+-exec\s+rm\b/, reason: 'find -exec rm', tier: 'irreversible' },
  { re: /find\s+[^\n|]*\s+-execdir\s+rm\b/, reason: 'find -execdir rm', tier: 'irreversible' },
  { re: /\bgit\s+clean\s+-\S*f\S*/, reason: 'git clean (force)', tier: 'irreversible' },
  { re: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard', tier: 'irreversible' },
  {
    re: /\bdocker\s+(?:rm|rmi|network\s+rm|volume\s+rm|system\s+prune)\b/,
    reason: 'docker removal / prune',
    tier: 'irreversible',
  },
  { re: /kubectl\s+delete\b/, reason: 'kubectl delete', tier: 'irreversible' },
  { re: /\bcurl\s+[^|\n]*\|\s*(?:ba|da|z)?sh\b/, reason: 'curl|shell', tier: 'irreversible' },
  { re: /\bwget\s+[^|\n]*\|\s*(?:ba|da|z)?sh\b/, reason: 'wget|shell', tier: 'irreversible' },
  { re: /(?:^|[;&|{(\s])\s*:\s*>\s*\S/, reason: 'shell truncate (:>)', tier: 'irreversible' },
  { re: /\bdd\s+/, reason: 'dd', tier: 'irreversible' },
  { re: /\bmkfs[\w.-]*\b/, reason: 'mkfs / new filesystem', tier: 'irreversible' },
  {
    re: /\bdiskutil\s+(?:erase\w*|partitionDisk|reformat)\b/i,
    reason: 'diskutil erase/repartition',
    tier: 'irreversible',
  },
  { re: /\bshred\b/, reason: 'shred', tier: 'irreversible' },
  { re: /\btruncate\b\s+(?:-s|--size=)/, reason: 'truncate', tier: 'irreversible' },
  {
    re: /\blowlevel_format\b|\bformat\s+[a-zA-Z]:/,
    reason: 'format (disk)',
    tier: 'irreversible',
  },
  { re: /\brsync\b[^\n|]*\s--delete\b/, reason: 'rsync --delete', tier: 'irreversible' },

  // —— Significant (edits, overwrites, installs, permission changes) ——
  { re: /\bsed\s+[^\n|]*-i(?:\s|['"])/, reason: 'sed in-place (-i)', tier: 'significant' },
  { re: /\bperl\s+-\w*i\w*\b/, reason: 'perl in-place', tier: 'significant' },
  {
    re: /\s>\s+(?!\/dev\/null\b)(?:['"][^\n'"]*['"]|\S+)/,
    reason: 'overwrite (>)',
    tier: 'significant',
  },
  { re: /\bmv\s+-f\b/, reason: 'mv -f (overwrite)', tier: 'significant' },
  { re: /\bcp\s+[^\n;|]*\s-f\b/, reason: 'cp -f (overwrite)', tier: 'significant' },
  {
    re: /\binstall\s+-m\s+\d+\s+[^\s]+\s+\S/,
    reason: 'install (may overwrite)',
    tier: 'significant',
  },
  { re: /\bchmod\b/, reason: 'chmod', tier: 'significant' },
  { re: /\bchown\b/, reason: 'chown', tier: 'significant' },
  {
    re: /\bnpm\s+(?:i|install|ci|add|rm|uninstall|unpublish)\b/,
    reason: 'npm package change',
    tier: 'significant',
  },
  {
    re: /\byarn\s+(?:add|install|remove|global|link|unlink)\b/i,
    reason: 'yarn',
    tier: 'significant',
  },
  { re: /\bcp\b/, reason: 'cp', tier: 'significant' },
  { re: /\bmv\b/, reason: 'mv', tier: 'significant' },
  {
    re: /\bpnpm\s+(?:i|install|add|remove)\b/,
    reason: 'pnpm package change',
    tier: 'significant',
  },
  { re: /\bbrew\s+(?:install|uninstall|reinstall)\b/i, reason: 'Homebrew change', tier: 'significant' },
  { re: /\bpip(?:3)?\s+install\b/, reason: 'pip install', tier: 'significant' },
  {
    re: /\bapt(?:-get)?\s+install\b/,
    reason: 'apt install',
    tier: 'significant',
  },
  { re: /\bdnf\s+install\b/, reason: 'dnf install', tier: 'significant' },
  { re: /\bgit\s+commit(?:\s|$)/, reason: 'git commit', tier: 'significant' },
  { re: /\bgit\s+push(?:\s|$)/, reason: 'git push', tier: 'significant' },
  { re: /\bgit\s+pull(?:\s|$)/, reason: 'git pull', tier: 'significant' },
  { re: /\bgit\s+merge(?:\s|$)/, reason: 'git merge', tier: 'significant' },
  { re: /\bgit\s+rebase(?:\s|$)/, reason: 'git rebase', tier: 'significant' },
]

/**
 * @param {string} command
 * @returns {SafetyAnalysis}
 */
export function analyzeCommandSafety(command) {
  if (!command || typeof command !== 'string') {
    return { destructive: false, previewRequired: false, reasons: [] }
  }
  const reasons = []
  for (const { re, reason } of CONSEQUENCE_PATTERNS) {
    if (re.test(command) && !reasons.includes(reason)) reasons.push(reason)
  }
  const destructive = reasons.length > 0
  return { destructive, previewRequired: destructive, reasons }
}

/**
 * @param {string} command
 * @param {SafetyAnalysis} analysis
 * @param {string} [consequenceSummary]
 */
export function formatIrreversiblePreview(command, analysis, consequenceSummary) {
  const mid = consequenceSummary
    ? [
        '— What this would touch —',
        consequenceSummary.trim(),
        '',
        '— Command line (runs after Confirm in interactive mode) —',
        '',
      ]
    : ['', '']
  const lines = [
    '',
    '=== Hotate — 🔴 irreversible (full preview) ===',
    `Why: ${analysis.reasons.join(', ')}`,
    'Interactive hotate / hotate-cmd runs this after you Confirm (or immediately in always-run). Use --no-run, --raw, or HOTATE_NO_EXEC=1 to only print.',
    '',
    ...mid,
    command,
    '',
    '==============================================',
    '',
  ]
  return lines.join('\n')
}

/**
 * @param {string} command
 * @param {string[]} reasons
 * @param {string} [consequenceSummary]
 */
export function formatSignificantPreview(command, reasons, consequenceSummary) {
  const mid = consequenceSummary
    ? [consequenceSummary.trim(), '']
    : []
  const lines = [
    '',
    '=== Hotate — 🟠 significant (summary) ===',
    `Why this matters: ${reasons.join(', ')}`,
    '',
    ...mid,
    command,
    '',
    '========================================',
    '',
  ]
  return lines.join('\n')
}

/** @deprecated use formatIrreversiblePreview */
export function formatDestructivePreview(command, analysis, consequenceSummary) {
  return formatIrreversiblePreview(command, analysis, consequenceSummary)
}
