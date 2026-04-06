#!/usr/bin/env node
import assert from 'node:assert'
import { analyzeCommandSafety } from './lib/destructive-detect.mjs'

const cases = [
  ['rm -f *.tmp', true, ['rm']],
  ['git status', false, []],
  ['sudo chmod +x deploy.sh', true, ['chmod']],
  ['chmod -R 755 _site', true, ['chmod']],
  ['lsof -nP -iTCP:3000 -sTCP:LISTEN', false, []],
  ['dd if=/dev/zero of=./disk.img bs=1m count=100', true, ['dd']],
  [
    'diskutil eraseDisk JHFS+ Fresh /dev/disk9',
    true,
    ['diskutil erase/repartition'],
  ],
  ['brew install jq', true, ['Homebrew change']],
  ['echo hi > /tmp/out.txt', true, ['overwrite (>)']],
  ['echo hi >> /tmp/out.txt', false, []],
  ['find . -name "*.tmp" -delete', true, ['find -delete']],
  ['sed -i "" "s/a/b/" f.txt', true, ['sed in-place (-i)']],
  ['git reset --hard', true, ['git reset --hard']],
  ['git merge-base HEAD main', false, []],
]

let failed = 0
for (const [cmd, wantDest, wantReasonSubset] of cases) {
  const a = analyzeCommandSafety(cmd)
  try {
    assert.strictEqual(
      a.destructive,
      wantDest,
      `${JSON.stringify(cmd)} destructive expected ${wantDest}`
    )
    for (const r of wantReasonSubset) {
      assert.ok(
        a.reasons.includes(r),
        `${JSON.stringify(cmd)} expected reason ${r}, got ${a.reasons}`
      )
    }
  } catch (e) {
    console.error(e.message)
    failed++
  }
}

if (failed) process.exit(1)
console.log(`destructive-detect: ${cases.length} cases OK`)
