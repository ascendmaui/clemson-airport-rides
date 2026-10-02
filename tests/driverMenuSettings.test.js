import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const __filename = fileURLToPath(import.meta.url)
export const REPO_ROOT = path.resolve(path.dirname(__filename), '..')

export function extractMenuRows(filePath) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath)
  const code = fs.readFileSync(resolvedPath, 'utf8')
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })

  const snapshot = {}

  function walk(node) {
    if (!node) return
    
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      const isMenuRowArray = node.id.typeAnnotation && 
        node.id.typeAnnotation.typeAnnotation && 
        node.id.typeAnnotation.typeAnnotation.type === 'TSArrayType' &&
        node.id.typeAnnotation.typeAnnotation.elementType.typeName &&
        node.id.typeAnnotation.typeAnnotation.elementType.typeName.name === 'MenuRow'
        
      if (isMenuRowArray && node.init && node.init.type === 'ArrayExpression') {
        const rows = node.init.elements.map(el => {
          if (el.type !== 'ObjectExpression') return null
          const row = {}
          for (const prop of el.properties) {
            if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') {
              if (['title', 'subtitle', 'icon'].includes(prop.key.name)) {
                if (prop.value.type === 'StringLiteral') {
                  row[prop.key.name] = prop.value.value
                } else if (prop.value.type === 'CallExpression' && prop.value.callee.type === 'Identifier') {
                  row[prop.key.name] = `[Function: ${prop.value.callee.name}]`
                } else if (prop.value.type === 'Identifier') {
                  row[prop.key.name] = `[Variable: ${prop.value.name}]`
                }
              }
            }
          }
          return row
        }).filter(Boolean)
        
        snapshot[node.id.name] = rows
      }
    }

    for (const key in node) {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          node[key].forEach(walk)
        } else {
          walk(node[key])
        }
      }
    }
  }

  walk(ast)
  return snapshot
}

test('Driver Menu snapshot', (t) => {
  const snapshot = extractMenuRows('apps/driver/app/(tabs)/menu.tsx')
  t.assert.snapshot(snapshot)
})

test('Driver Settings snapshot', (t) => {
  const snapshot = extractMenuRows('apps/driver/app/settings/index.tsx')
  t.assert.snapshot(snapshot)
})
