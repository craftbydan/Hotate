/**
 * Consequence tier for UX: reversible / significant / irreversible.
 */

import { CONSEQUENCE_PATTERNS } from './destructive-detect.mjs'

/** @typedef {'reversible'|'significant'|'irreversible'} ConsequenceTier */

const RANK = /** @type {Record<ConsequenceTier, number>} */ ({
  reversible: 0,
  significant: 1,
  irreversible: 2,
})

const EMOJI = /** @type {Record<ConsequenceTier, string>} */ ({
  reversible: '🟡',
  significant: '🟠',
  irreversible: '🔴',
})

const LABEL = /** @type {Record<ConsequenceTier, string>} */ ({
  reversible: 'Light / read-only',
  significant: 'Can change files or settings',
  irreversible: 'Hard to undo',
})

/**
 * @typedef {{
 *   tier: ConsequenceTier,
 *   emoji: string,
 *   label: string,
 *   reasons: string[],
 *   needsFullPreview: boolean,
 *   needsSummary: boolean,
 *   needsConfirmation: boolean, // true for significant + irreversible (prompt before run)
 * }} ConsequenceClassification
 */

/**
 * @param {string} command
 * @returns {ConsequenceClassification}
 */
export function classifyConsequence(command) {
  if (!command || typeof command !== 'string') {
    return {
      tier: 'reversible',
      emoji: EMOJI.reversible,
      label: LABEL.reversible,
      reasons: [],
      needsFullPreview: false,
      needsSummary: false,
      /** Safe tier — run without the triple prompt (unless --ask / HOTATE_NO_EXEC). */
      needsConfirmation: false,
    }
  }

  /** @type {ConsequenceTier} */
  let tier = 'reversible'
  const reasons = []
  for (const { re, reason, tier: t } of CONSEQUENCE_PATTERNS) {
    if (re.test(command)) {
      if (!reasons.includes(reason)) reasons.push(reason)
      if (RANK[t] > RANK[tier]) tier = t
    }
  }

  return {
    tier,
    emoji: EMOJI[tier],
    label: LABEL[tier],
    reasons,
    needsFullPreview: tier === 'irreversible',
    needsSummary: tier === 'significant' || tier === 'irreversible',
    /** Significant + irreversible: triple prompt unless --yes or runMode always_run. */
    needsConfirmation: tier !== 'reversible',
  }
}
