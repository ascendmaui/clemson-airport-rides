import assert from 'node:assert/strict'
import test from 'node:test'
import { ORANGE, PURPLE, SURFACE } from '../places.js'
import {
  color,
  elevation,
  motion,
  motionDuration,
  radius,
  shadowStyle,
  space,
  type,
} from './theme.js'

test('brand colors match the rider Clemson orange, purple, and off-white surface', () => {
  assert.equal(color.orange, '#F56600')
  assert.equal(color.purple, '#522D80')
  assert.equal(color.surface, '#F7F4F0')
  assert.equal(color.orange, ORANGE)
  assert.equal(color.purple, PURPLE)
  assert.equal(color.surface, SURFACE)
  assert.equal(color.orangeBright, '#F66733')
})

test('type, space, and radius follow the rider scale', () => {
  assert.equal(type.title.fontSize, 28)
  assert.equal(type.title.letterSpacing, -0.4)
  assert.equal(type.title.fontWeight, '800')
  assert.equal(type.button.fontSize, 16)
  assert.equal(type.button.letterSpacing, -0.2)
  assert.equal(type.kicker.letterSpacing, 1.1)
  assert.equal(type.body.lineHeight, 20)
  assert.equal(space.lg, 16)
  assert.equal(space.screen, 16)
  assert.equal(radius.lg, 18)
  assert.equal(radius.xl, 22)
  assert.equal(radius.sheet, 28)
  assert.equal(radius.pill, 999)
  assert.equal(radius.control, 14)
})

test('shadows match the rider lift recipes', () => {
  const rest = shadowStyle('#1A1033', 'rest', 'light')
  assert.equal(rest.shadowOpacity, elevation.rest.shadowOpacity)
  assert.equal(rest.shadowRadius, 12)
  assert.deepEqual(rest.shadowOffset, { width: 0, height: 6 })
  assert.equal(rest.elevation, 3)
  assert.notEqual(rest.shadowOffset, elevation.rest.shadowOffset)

  const floated = shadowStyle('#1A1033', 'float', 'light')
  assert.equal(floated.shadowOpacity, 0.14)
  assert.equal(floated.shadowRadius, 18)
  assert.deepEqual(floated.shadowOffset, { width: 0, height: 10 })

  const bar = shadowStyle('#1A1033', 'bar', 'dark')
  assert.deepEqual(bar.shadowOffset, { width: 0, height: -4 })

  const night = shadowStyle('#000', 'rest', 'dark')
  assert.equal(night.shadowOpacity, elevation.darkRest.shadowOpacity)
})

test('unknown elevation fails closed', () => {
  assert.throws(() => shadowStyle('#000', 'glow'), /Unknown elevation/)
})

test('motion eases in and collapses to zero when reduced', () => {
  assert.equal(motion.enterFadeMs, 320)
  assert.equal(motion.enterRiseMs, 380)
  assert.equal(motion.enterDistance, 12)
  assert.equal(motion.pressScale, 0.985)
  assert.equal(motion.pressOpacity, 0.92)
  assert.equal(motion.disabledOpacity, 0.55)
  assert.equal(motionDuration(motion.enterFadeMs, false), 320)
  assert.equal(motionDuration(motion.enterRiseMs, true), 0)
  assert.equal(motionDuration(0, false), 0)
  assert.equal(motionDuration(Number.NaN, false), 0)
})
