import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('index.css includes spinner and skeleton shimmer keyframes', () => {
  const css = readSource('src/index.css')

  assert.match(css, /@keyframes\s+spin\s*\{/, 'defines @keyframes spin')
  assert.match(css, /@keyframes\s+skeletonShimmer\s*\{/, 'defines @keyframes skeletonShimmer')
  assert.match(css, /\.skeleton-pulse\s*\{/, 'defines .skeleton-pulse class')
})

test('LoadingSkeleton.jsx exports accessible spinners and skeleton components', () => {
  const code = readSource('src/components/LoadingSkeleton.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'LoadingSkeleton parses cleanly')

  // LoadingSpinner
  assert.match(code, /export function LoadingSpinner/, 'exports LoadingSpinner')
  assert.match(code, /role="status"/, 'spinner declares role="status"')
  assert.match(code, /aria-live="polite"/, 'spinner announces politely')
  assert.match(code, /aria-hidden="true"/, 'decorative spinner element is aria-hidden')

  // SkeletonRideCard
  assert.match(code, /export function SkeletonRideCard/, 'exports SkeletonRideCard')
  assert.match(code, /aria-label=\{label\}/, 'ride skeleton announces descriptive label')

  // SkeletonDriverCard
  assert.match(code, /export function SkeletonDriverCard/, 'exports SkeletonDriverCard')
  assert.match(code, /Loading available drivers/, 'driver skeleton provides accessible announcement')

  // SkeletonOfferStream
  assert.match(code, /export function SkeletonOfferStream/, 'exports SkeletonOfferStream')
  assert.match(code, /Checking for ride offers/, 'offer skeleton default copy is descriptive')
})

test('PickDriver.jsx renders SkeletonDriverCard when loading online drivers', () => {
  const code = readSource('src/screens/PickDriver.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'PickDriver parses cleanly')

  assert.match(code, /import.*SkeletonDriverCard.*from\s+['"]\.\.\/components\/LoadingSkeleton['"]/, 'imports SkeletonDriverCard')
  assert.match(code, /\{loading && <SkeletonDriverCard count=\{3\} \/>\}/, 'renders SkeletonDriverCard during loading phase')
})

test('RidesHistory.jsx renders SkeletonRideCard when loading trip history', () => {
  const code = readSource('src/screens/RidesHistory.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'RidesHistory parses cleanly')

  assert.match(code, /import.*SkeletonRideCard.*from\s+['"]\.\.\/components\/LoadingSkeleton['"]/, 'imports SkeletonRideCard')
  assert.match(code, /\{loading && \(\s*<div.*>\s*<SkeletonRideCard count=\{2\} \/>/, 'renders SkeletonRideCard during loading phase')
})

test('DriverOfferSheet.jsx exports DriverOfferSkeleton helper', () => {
  const code = readSource('src/components/DriverOfferSheet.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'DriverOfferSheet parses cleanly')

  assert.match(code, /import.*SkeletonOfferStream.*from\s+['"]\.\/LoadingSkeleton['"]/, 'imports SkeletonOfferStream')
  assert.match(code, /export function DriverOfferSkeleton\(props\)/, 'exports DriverOfferSkeleton helper')
})
