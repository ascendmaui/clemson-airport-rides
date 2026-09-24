import assert from 'node:assert/strict'
import test from 'node:test'
import { darkPalette, lightPalette, paletteFor } from './palette.ts'

test('rider brand tokens stay Clemson orange and purple', () => {
  for (const palette of [lightPalette, darkPalette]) {
    assert.equal(palette.orange, '#F56600')
    assert.equal(palette.purple, '#522D80')
    assert.equal(palette.fill, '#522D80')
  }
})

test('dark mode uses the driver night field', () => {
  assert.equal(darkPalette.background, '#0E0B14')
  assert.equal(darkPalette.card, '#16121F')
  assert.equal(darkPalette.ink, '#F5F6F8')
  assert.equal(darkPalette.statusBar, 'light')
})

test('light mode stays cream with purple titles', () => {
  assert.equal(lightPalette.background, '#F7F4F0')
  assert.equal(lightPalette.title, '#522D80')
  assert.equal(lightPalette.statusBar, 'dark')
})

test('paletteFor covers both schemes', () => {
  assert.equal(paletteFor('light'), lightPalette)
  assert.equal(paletteFor('dark'), darkPalette)
})
