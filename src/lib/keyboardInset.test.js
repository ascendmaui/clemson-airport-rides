import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { keyboardInsetPx, scrollFocusedFieldIntoView } from './keyboardInset.js'
import { searchFieldInputStyle, textLinkHitStyle, TOUCH_TARGET_MIN_PX } from './touchA11y.js'

test('keyboard inset is the gap Android Chrome leaves when the keyboard covers the visual viewport', () => {
  assert.equal(keyboardInsetPx(915, 595, 0), 320)
  assert.equal(keyboardInsetPx(915, 915, 0), 0)
  assert.equal(keyboardInsetPx(915, 600, 20), 295)
  assert.equal(keyboardInsetPx('nope', 100, 0), 0)
})

test('focusing a field asks the scroller to bring it into view', () => {
  const original = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => {
    fn()
    return 0
  }
  try {
    let scrolled = null
    const input = {
      matches: (selector) => selector === 'input, textarea, select',
      scrollIntoView(options) { scrolled = options },
    }
    scrollFocusedFieldIntoView({ target: input })
    assert.deepEqual(scrolled, { block: 'center', inline: 'nearest' })
    scrolled = null
    scrollFocusedFieldIntoView({ target: { matches: () => false } })
    assert.equal(scrolled, null)
  } finally {
    globalThis.requestAnimationFrame = original
  }
})

test('search field and text links meet the 44px touch minimum', () => {
  assert.equal(searchFieldInputStyle().minHeight, TOUCH_TARGET_MIN_PX)
  assert.equal(searchFieldInputStyle().fontSize, 16)
  assert.equal(textLinkHitStyle().minHeight, TOUCH_TARGET_MIN_PX)
  assert.equal(textLinkHitStyle({ color: 'purple' }).color, 'purple')
})

test('the viewport meta lets Android Chrome resize the layout when the keyboard opens', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  assert.match(html, /interactive-widget=resizes-content/)
})
