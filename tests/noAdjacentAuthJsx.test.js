import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'packages/rides-native/AuthScreens.jsx')

test('rides-native AuthScreens.jsx parses so the rider Metro bundle can start', () => {
  const code = readFileSync(file, 'utf8')
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  assert.equal(ast.type, 'File')
  assert.match(code, /const blocked = busy \|\| cooldownSec > 0/)
})
