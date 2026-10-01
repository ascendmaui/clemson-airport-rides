import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '..')

function extractComponentJsx(filePath, componentName) {
  const code = fs.readFileSync(filePath, 'utf8')
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })

  let targetJsx = null

  function walk(node) {
    if (!node) return
    if (node.type === 'FunctionDeclaration' && node.id?.name === componentName) {
      // Find return statement
      const returnStmt = node.body.body.find(s => s.type === 'ReturnStatement')
      if (returnStmt) targetJsx = returnStmt.argument
    }
    for (const key of Object.keys(node)) {
      if (key !== 'loc' && Array.isArray(node[key])) {
        node[key].forEach(walk)
      } else if (key !== 'loc' && typeof node[key] === 'object') {
        walk(node[key])
      }
    }
  }

  walk(ast)
  return targetJsx
}

function summarizeJsx(node) {
  if (!node) return null
  if (node.type === 'JSXElement') {
    const name = node.openingElement.name.name || node.openingElement.name.property?.name
    const children = node.children.map(summarizeJsx).filter(Boolean)
    return { name, children }
  }
  if (node.type === 'JSXExpressionContainer') {
    if (node.expression.type === 'ConditionalExpression') {
      const left = summarizeJsx(node.expression.consequent)
      const right = summarizeJsx(node.expression.alternate)
      return { type: 'Conditional', branches: [left, right].filter(Boolean) }
    }
    if (node.expression.type === 'LogicalExpression' && node.expression.operator === '&&') {
      const right = summarizeJsx(node.expression.right)
      return { type: 'Conditional', branches: [right].filter(Boolean) }
    }
  }
  return null
}

test('Driver Offer Card snapshot', () => {
  const filePath = path.join(REPO_ROOT, 'apps/driver/app/(tabs)/index.tsx')
  const jsx = extractComponentJsx(filePath, 'RideCard')
  assert.ok(jsx, 'RideCard component not found or returns no JSX')
  
  const tree = summarizeJsx(jsx)
  const actual = JSON.stringify(tree, null, 2)
  
  const snapshotFile = path.join(REPO_ROOT, 'tests/driverOfferCard.test.js.snapshot')
  
  if (!fs.existsSync(snapshotFile) || process.env.UPDATE_SNAPSHOTS) {
    fs.writeFileSync(snapshotFile, `exports[\`Driver Offer Card snapshot 1\`] = \`\n${actual}\n\`;\n`)
  }
  
  const snapText = fs.readFileSync(snapshotFile, 'utf8')
  const match = snapText.match(/exports\[\`Driver Offer Card snapshot 1\`\] = \`\n([\s\S]*?)\n\`;\n/)
  assert.ok(match, 'Snapshot file is malformed')
  const expected = match[1].trim()
  assert.equal(actual.trim(), expected)
})
