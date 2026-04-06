#!/usr/bin/env node
import assert from 'node:assert'
import { parseChoice } from './lib/confirm-flow.mjs'

assert.strictEqual(parseChoice('1'), 'cancel')
assert.strictEqual(parseChoice('2'), 'show')
assert.strictEqual(parseChoice('3'), 'confirm')
assert.strictEqual(parseChoice('Cancel'), 'cancel')
assert.strictEqual(parseChoice('SHOW ME FIRST'), 'show')
assert.strictEqual(parseChoice('confirm'), 'confirm')
assert.strictEqual(parseChoice('y'), 'reject-yn')
assert.strictEqual(parseChoice('yes'), 'reject-yn')
assert.strictEqual(parseChoice('n'), 'reject-yn')
assert.strictEqual(parseChoice('no'), 'reject-yn')
assert.strictEqual(parseChoice('maybe'), null)
assert.strictEqual(parseChoice(''), null)

console.log('confirm-flow: parseChoice OK')
