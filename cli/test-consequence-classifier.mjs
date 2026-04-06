#!/usr/bin/env node
import assert from 'node:assert'
import { classifyConsequence } from './lib/consequence-classifier.mjs'

const t = [
  ['ls -la', 'reversible'],
  ['pwd', 'reversible'],
  ['rm -rf _site', 'irreversible'],
  ['cp -r a b', 'significant'],
  ['brew install jq', 'significant'],
  ['echo x > out.txt', 'significant'],
  ['dd if=/dev/zero of=x bs=1 count=1', 'irreversible'],
  ['chmod +x z.sh', 'significant'],
  ['git status', 'reversible'],
  ['git commit -m hi', 'significant'],
]

for (const [cmd, want] of t) {
  const c = classifyConsequence(cmd)
  assert.strictEqual(
    c.tier,
    want,
    `${cmd}: expected ${want}, got ${c.tier} (${c.reasons})`
  )
  const needConfirm = want !== 'reversible'
  assert.strictEqual(
    c.needsConfirmation,
    needConfirm,
    `${cmd}: needsConfirmation should be ${needConfirm}`
  )
}

console.log(`consequence-classifier: ${t.length} cases OK`)
