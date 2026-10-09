import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from '@babel/parser'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const ast = (source) => parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] })

function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object') return
  if (node.type) visit(node, ancestors)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, [...ancestors, node])
    } else if (value && typeof value === 'object') {
      walk(value, visit, [...ancestors, node])
    }
  }
}

function sourceFiles(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(file)
    return /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.|\.d\.ts$/.test(file) ? [file] : []
  })
}

function unsafeChannels(source, file) {
  const violations = []
  walk(ast(source), (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression'
      || node.callee.property.name !== 'channel') return
    const topic = node.arguments[0]
    if (topic?.type !== 'CallExpression' || topic.callee.name !== 'uniqueChannelTopic') {
      violations.push(`${file}:${node.loc.start.line}: channel topic must use uniqueChannelTopic`)
    }
  })
  return violations
}

test('postgres realtime subscriptions in web and shared clients always own unique topics', () => {
  // All current channels are postgres_changes only; no broadcast/presence exceptions.
  const violations = [...sourceFiles('src'), ...sourceFiles('packages/rides-native')]
    .flatMap((file) => unsafeChannels(read(file), file))
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('channel guard reports fixed strings and interpolated templates with file and line', () => {
  const source = "client.channel('fixed')\nclient.channel(`trip-${id}`)\nclient.channel(uniqueChannelTopic('safe'))"
  assert.deepEqual(unsafeChannels(source, 'sample.js'), [
    'sample.js:1: channel topic must use uniqueChannelTopic',
    'sample.js:2: channel topic must use uniqueChannelTopic',
  ])
})

const watchers = [
  'RideToastWatcher', 'RiderMatchPopup', 'WeeklyCouponNotice', 'DriverOfferWatcher',
  'LostFoundWatcher', 'TripMessageBanner', 'RiderPickupStream',
  'AmbassadorAttributionSync', 'DriverBillingEntry',
]
const name = (node) => node.openingElement?.name?.name
const attribute = (node, key) => node.openingElement.attributes.find((attr) => attr.name?.name === key)

function wrappedElements() {
  const found = new Map()
  walk(ast(read('src/App.jsx')), (node, ancestors) => {
    if (node.type !== 'JSXElement' || !['Screen', ...watchers].includes(name(node))) return
    const boundary = ancestors.findLast((ancestor) => ancestor.type === 'JSXElement'
      && name(ancestor) === 'AccessibleErrorBoundary')
    assert.ok(boundary, `${name(node)} needs an AccessibleErrorBoundary`)
    found.set(name(node), boundary)
  })
  return found
}

test('Screen including booking and requested routes has a route-keyed recovery boundary', () => {
  const found = wrappedElements()
  assert.ok(found.has('Screen'))
  assert.equal(attribute(found.get('Screen'), 'key').value.expression.name, 'routeKey')
  const source = read('src/App.jsx')
  assert.match(source, /key=\{routeKey\}\s+className=/)
  assert.match(source, /case 'pick-driver':/)
  assert.match(source, /case 'requested':/)
  assert.match(source, /fallback=\{\(\{ reset \}\) => <RouteErrorFallback path=\{path\} params=\{params\} reset=\{reset\}/)
  assert.match(source, /onRetry=\{reset\}/)
  assert.match(source, /onDismiss=\{\(\) => navigate\('home'\)\}/)
  assert.match(source, /dismissLabel="Back home"/)
  assert.match(source, /path === 'requested'/)
  assert.match(source, /ride request may already be placed/)
  assert.match(source, /href=\{`#\/requested\?trip=\$\{encodeURIComponent\(params.trip\)\}`\} onClick=\{reset\}/)
})

test('each global watcher has its own boundary with a null fallback and caught errors are logged', () => {
  const found = wrappedElements()
  const boundaries = new Set()
  for (const watcher of watchers) {
    assert.ok(found.has(watcher), `${watcher} is mounted`)
    const boundary = found.get(watcher)
    boundaries.add(boundary)
    const fallback = attribute(boundary, 'fallback').value.expression
    assert.equal(fallback.type, 'ArrowFunctionExpression')
    assert.equal(fallback.body.type, 'NullLiteral')
  }
  assert.equal(boundaries.size, watchers.length)
  assert.match(read('src/components/AccessibleAlert.jsx'), /console\.error\('\[boundary\]', error, errorInfo\)/)
})
