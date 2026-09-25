import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const TARGET_TOUCHABLES = new Set(['Pressable', 'TouchableOpacity', 'Button'])
const ALL_TARGETS = new Set(['Pressable', 'TouchableOpacity', 'Button', 'Image'])

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '..')

export const DRIVER_APP_DIR = path.join(REPO_ROOT, 'apps/driver/app')
export const DRIVER_COMPONENTS_DIR = path.join(REPO_ROOT, 'apps/driver/components')

/**
 * Baseline allowlist of known pre-existing a11y violations in the driver app.
 * Keys are formatted as `${relativePath}:${lineNumber}` or `${relativePath}`.
 */
export const ALLOWLIST = new Set([
  'apps/driver/app/(tabs)/discover.tsx:83',
  'apps/driver/app/(tabs)/earnings.tsx:129',
  'apps/driver/app/(tabs)/inbox.tsx:200',
  'apps/driver/app/(tabs)/index.tsx:395',
  'apps/driver/app/(tabs)/index.tsx:398',
  'apps/driver/app/(tabs)/index.tsx:412',
  'apps/driver/app/(tabs)/index.tsx:437',
  'apps/driver/app/(tabs)/index.tsx:491',
  'apps/driver/app/(tabs)/index.tsx:527',
  'apps/driver/app/(tabs)/index.tsx:528',
  'apps/driver/app/(tabs)/index.tsx:616',
  'apps/driver/app/account.tsx:50',
  'apps/driver/app/account.tsx:62',
  'apps/driver/app/account.tsx:65',
  'apps/driver/app/account.tsx:68',
  'apps/driver/app/account.tsx:71',
  'apps/driver/app/account.tsx:77',
  'apps/driver/app/account.tsx:81',
  'apps/driver/app/bug-report.tsx:81',
  'apps/driver/app/bug-report.tsx:90',
  'apps/driver/app/earnings-activity.tsx:77',
  'apps/driver/app/earnings-activity.tsx:83',
  'apps/driver/app/earnings-activity.tsx:102',
  'apps/driver/app/earnings-details.tsx:75',
  'apps/driver/app/earnings-details.tsx:172',
  'apps/driver/app/fleet.tsx:98',
  'apps/driver/app/fleet.tsx:102',
  'apps/driver/app/learning.tsx:166',
  'apps/driver/app/onboarding.tsx:519',
  'apps/driver/app/onboarding.tsx:548',
  'apps/driver/app/onboarding.tsx:556',
  'apps/driver/app/onboarding.tsx:567',
  'apps/driver/app/onboarding.tsx:621',
  'apps/driver/app/onboarding.tsx:646',
  'apps/driver/app/onboarding.tsx:688',
  'apps/driver/app/onboarding.tsx:735',
  'apps/driver/app/onboarding.tsx:736',
  'apps/driver/app/onboarding.tsx:740',
  'apps/driver/app/onboarding.tsx:785',
  'apps/driver/app/onboarding.tsx:830',
  'apps/driver/app/onboarding.tsx:834',
  'apps/driver/app/onboarding.tsx:839',
  'apps/driver/app/queue.tsx:75',
  'apps/driver/app/queue.tsx:208',
  'apps/driver/app/settings/[section].tsx:163',
  'apps/driver/app/trip.tsx:216',
  'apps/driver/app/trip.tsx:225',
  'apps/driver/components/SignaturePad.tsx:40',
  'apps/driver/components/chrome.tsx:49',
  'apps/driver/components/shell.tsx:102',
  'apps/driver/components/shell.tsx:132',
])

/**
 * Checks whether an attribute provides a non-empty, valid value.
 */
function hasValidProp(attr) {
  if (!attr || !attr.value) return false
  if (attr.value.type === 'StringLiteral') {
    return attr.value.value.trim().length > 0
  }
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression
    if (expr.type === 'StringLiteral') {
      return expr.value.trim().length > 0
    }
    if (expr.type === 'JSXEmptyExpression') {
      return false
    }
    return true
  }
  return true
}

/**
 * Checks whether accessible={false} is explicitly provided.
 */
function isAccessibleFalse(attr) {
  if (!attr || !attr.value) return false
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression
    return expr.type === 'BooleanLiteral' && expr.value === false
  }
  return false
}

/**
 * Statically scans TSX code for a11y violations without a React Native runtime.
 */
export function scanCode(code, filePath = '<anonymous>') {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  })

  const offenders = []

  function traverse(node) {
    if (!node || typeof node !== 'object') return

    if (node.type === 'JSXOpeningElement') {
      const tagName = node.name && node.name.type === 'JSXIdentifier' ? node.name.name : null
      if (tagName && ALL_TARGETS.has(tagName)) {
        let hasLabel = false
        let hasRole = false
        let accessibleFalse = false

        for (const attr of node.attributes) {
          if (attr.type === 'JSXAttribute' && attr.name && attr.name.type === 'JSXIdentifier') {
            const attrName = attr.name.name
            if (attrName === 'accessibilityLabel' && hasValidProp(attr)) {
              hasLabel = true
            }
            if (attrName === 'accessibilityRole' && hasValidProp(attr)) {
              hasRole = true
            }
            if (attrName === 'accessible' && isAccessibleFalse(attr)) {
              accessibleFalse = true
            }
          }
        }

        const line = node.loc ? node.loc.start.line : 1
        const relFile = filePath.replace(/\\/g, '/')

        if (tagName === 'Image') {
          if (!hasLabel && !accessibleFalse) {
            offenders.push({
              file: relFile,
              line,
              tag: tagName,
              reason: 'missing accessibilityLabel or accessible={false}',
            })
          }
        } else if (TARGET_TOUCHABLES.has(tagName)) {
          const missing = []
          if (!hasLabel) missing.push('accessibilityLabel')
          if (!hasRole) missing.push('accessibilityRole')
          if (missing.length > 0) {
            offenders.push({
              file: relFile,
              line,
              tag: tagName,
              reason: `missing ${missing.join(' and ')}`,
            })
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key !== 'loc' && Array.isArray(node[key])) {
        node[key].forEach(traverse)
      } else if (key !== 'loc' && typeof node[key] === 'object') {
        traverse(node[key])
      }
    }
  }

  traverse(ast)
  return offenders
}

/**
 * Recursively retrieves all .tsx file paths in a directory.
 */
export function findTsxFiles(dir) {
  const results = []
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTsxFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Statically scans all .tsx files under apps/driver/app and apps/driver/components.
 */
export function scanDriverA11y({
  appDir = DRIVER_APP_DIR,
  componentsDir = DRIVER_COMPONENTS_DIR,
  repoRoot = REPO_ROOT,
} = {}) {
  const files = [...findTsxFiles(appDir), ...findTsxFiles(componentsDir)].sort()
  const allOffenders = []

  for (const absFile of files) {
    const relFile = path.relative(repoRoot, absFile).replace(/\\/g, '/')
    const code = fs.readFileSync(absFile, 'utf8')
    const offenders = scanCode(code, relFile)
    allOffenders.push(...offenders)
  }

  return allOffenders
}

/**
 * Checks whether a reported violation is covered by the allowlist.
 */
export function isAllowlisted(offender, allowlist = ALLOWLIST) {
  const normFile = offender.file.replace(/\\/g, '/')
  const fileLine = `${normFile}:${offender.line}`
  if (allowlist instanceof Set) {
    return allowlist.has(fileLine) || allowlist.has(normFile)
  }
  if (Array.isArray(allowlist)) {
    return allowlist.includes(fileLine) || allowlist.includes(normFile)
  }
  return false
}

test('driver a11y static scanner scans all driver screens and components against allowlist', () => {
  const offenders = scanDriverA11y()
  console.log(`Driver a11y offenders count: ${offenders.length}`)

  const unallowlisted = offenders.filter((o) => !isAllowlisted(o, ALLOWLIST))
  assert.equal(
    unallowlisted.length,
    0,
    `Found unallowlisted a11y offenders:\n${unallowlisted.map((o) => `  ${o.file}:${o.line} [${o.tag}] ${o.reason}`).join('\n')}`,
  )
})

test('scanner flags Pressable, TouchableOpacity, Button lacking accessibilityLabel or accessibilityRole', () => {
  const noAttrs = scanCode('<Pressable onPress={fn} />')
  assert.equal(noAttrs.length, 1)
  assert.equal(noAttrs[0].reason, 'missing accessibilityLabel and accessibilityRole')

  const labelOnly = scanCode('<TouchableOpacity accessibilityLabel="Submit" />')
  assert.equal(labelOnly.length, 1)
  assert.equal(labelOnly[0].reason, 'missing accessibilityRole')

  const roleOnly = scanCode('<Button accessibilityRole="button" />')
  assert.equal(roleOnly.length, 1)
  assert.equal(roleOnly[0].reason, 'missing accessibilityLabel')

  const emptyLabel = scanCode('<Pressable accessibilityRole="button" accessibilityLabel="" />')
  assert.equal(emptyLabel.length, 1)
  assert.equal(emptyLabel[0].reason, 'missing accessibilityLabel')

  const validBoth = scanCode('<Pressable accessibilityRole="button" accessibilityLabel="Confirm trip" />')
  assert.equal(validBoth.length, 0)
})

test('scanner flags Image without accessibilityLabel or accessible={false}', () => {
  const noAttrs = scanCode('<Image source={photo} />')
  assert.equal(noAttrs.length, 1)
  assert.equal(noAttrs[0].reason, 'missing accessibilityLabel or accessible={false}')

  const accessibleTrue = scanCode('<Image source={photo} accessible={true} />')
  assert.equal(accessibleTrue.length, 1)
  assert.equal(accessibleTrue[0].reason, 'missing accessibilityLabel or accessible={false}')

  const withLabel = scanCode('<Image source={photo} accessibilityLabel="Driver portrait" />')
  assert.equal(withLabel.length, 0)

  const decorative = scanCode('<Image source={pattern} accessible={false} />')
  assert.equal(decorative.length, 0)
})
