#!/usr/bin/env node
import assert from 'node:assert'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { summarizeConsequences } from './lib/consequence-preview.mjs'

const tmp = join(
  '/tmp',
  `hotate-cq-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
)
await mkdir(tmp, { recursive: true })
try {
  await writeFile(join(tmp, 'a.tmp'), 'hi')
  await writeFile(join(tmp, 'b.tmp'), 'xx')

  const r1 = await summarizeConsequences({
    command: 'rm -f *.tmp',
    cwd: tmp,
  })
  assert.ok(r1.summary.includes('remove'), 'rm intent')
  assert.strictEqual(r1.structured?.fileCount, 2)

  const r2 = await summarizeConsequences({
    command: 'chmod +x deploy.sh',
    cwd: tmp,
  })
  assert.ok(
    r2.summary.includes('could not safely list') ||
      r2.summary.includes('nothing matched'),
    'chmod without file ok'
  )

  await writeFile(join(tmp, 'deploy.sh'), '#')
  const r3 = await summarizeConsequences({
    command: 'chmod +x deploy.sh',
    cwd: tmp,
  })
  assert.strictEqual(r3.structured?.fileCount, 1)
  assert.ok(r3.summary.includes('Permission') || r3.summary.includes('item'))

  console.log(`consequence-preview: OK (${tmp})`)
} finally {
  await rm(tmp, { recursive: true, force: true })
}
