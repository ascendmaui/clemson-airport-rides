import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BOTTOM_CLUSTER_SHIFT, createBottomCluster } from '../apps/driver/lib/bottomCluster.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

function bottomClusterJsx(source) {
  const marker = 'styles.bottomCluster'
  const markerAt = source.indexOf(marker)
  assert.ok(markerAt > 0, 'home screen renders one bottom cluster')
  const open = source.lastIndexOf('<Animated.View', markerAt)
  const close = source.indexOf('</Animated.View>', markerAt)
  assert.ok(open >= 0 && close > markerAt, 'bottom cluster is one animated container')
  return source.slice(open, close)
}

test('tapping END minimizes the bottom cluster together and GO restores it', () => {
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const shell = read('apps/driver/components/shell.tsx')
  assert.match(shell, /\{online \? 'END' : 'GO'\}/)

  const shift = createBottomCluster(true)
  const minimized = shift.tap('END')
  assert.equal(minimized.bar, minimized.go)
  assert.equal(minimized.go, minimized.sideIcons)
  assert.equal(minimized.translateY, minimized.bar)
  assert.equal(BOTTOM_CLUSTER_SHIFT, 120)
  assert.equal(minimized.translateY, BOTTOM_CLUSTER_SHIFT)

  const cluster = bottomClusterJsx(home)
  assert.match(cluster, /translateY: clusterY/)
  assert.equal((cluster.match(/translateY/g) || []).length, 1)
  assert.match(cluster, /<GoButton/)
  assert.match(cluster, /onPress=\{toggle\}/)
  assert.equal((cluster.match(/styles\.toolCol/g) || []).length, 2)
  for (const icon of ['shield', 'sparkles', 'stats-chart', 'locate']) {
    assert.match(cluster, new RegExp(`icon="${icon}"`))
  }
  assert.match(cluster, /styles\.bar/)
  assert.doesNotMatch(cluster.slice(cluster.indexOf('styles.bar')), /translateY/)
  assert.doesNotMatch(cluster, /icon="inbox"/)
  assert.doesNotMatch(cluster, /icon="search"/)
  assert.match(home, /new Animated\.Value\(BOTTOM_CLUSTER_SHIFT\)/)
  assert.match(home, /toValue: bottomClusterTranslateY\(online\), duration: 280, useNativeDriver: true/)
  assert.match(home, /setRideAlertSurface\(\{ online \}\)/)
  assert.match(home, /if \(nextOnline\) await goOnline\(user\.id, fix\)/)
  assert.match(home, /else await goOffline\(user\.id\)/)
  assert.match(home, /pulseShift\(nextOnline \? 'GO' : 'END'\)/)
  assert.doesNotMatch(home, /barY/)

  const restored = shift.tap('GO')
  assert.deepEqual(restored, { translateY: 0, bar: 0, go: 0, sideIcons: 0 })
})
