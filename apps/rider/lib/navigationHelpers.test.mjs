import assert from 'node:assert/strict'
import test from 'node:test'
import { setAuthNext, takeAuthNext } from './authNext.ts'
import { lift } from './elevation.ts'
import { oneParam } from './oneParam.ts'

test('authNext: stores and retrieves deferred navigation route with one-time consume', () => {
  // Initially null
  assert.equal(takeAuthNext(), null)

  // Store a string path
  setAuthNext('/pick-driver')
  assert.equal(takeAuthNext(), '/pick-driver')
  // Second call must return null (consume-once guarantee)
  assert.equal(takeAuthNext(), null)

  // Store an object route
  const routeObj = { pathname: '/schedule', params: { date: '2026-09-25' } }
  setAuthNext(routeObj)
  assert.deepEqual(takeAuthNext(), routeObj)
  assert.equal(takeAuthNext(), null)
})

test('oneParam: normalizes query and search parameter strings and arrays', () => {
  assert.equal(oneParam('campus'), 'campus')
  assert.equal(oneParam(['first', 'second']), 'first')
  assert.equal(oneParam([]), '')
  assert.equal(oneParam([], 'fallback'), 'fallback')
  assert.equal(oneParam(undefined), '')
  assert.equal(oneParam(undefined, 'defaultVal'), 'defaultVal')
  assert.equal(oneParam('', 'defaultVal'), 'defaultVal')
})

test('lift: calculates elevation and shadow properties across elevation levels', () => {
  const palette = { shadow: 'rgba(0, 0, 0, 0.25)' }

  const restStyle = lift(palette, 'rest')
  assert.equal(restStyle.shadowColor, 'rgba(0, 0, 0, 0.25)')
  assert.equal(restStyle.shadowOpacity, 0.08)
  assert.equal(restStyle.shadowRadius, 12)
  assert.deepEqual(restStyle.shadowOffset, { width: 0, height: 6 })
  assert.equal(restStyle.elevation, 3)

  const floatStyle = lift(palette, 'float')
  assert.equal(floatStyle.shadowColor, 'rgba(0, 0, 0, 0.25)')
  assert.equal(floatStyle.shadowOpacity, 0.14)
  assert.equal(floatStyle.shadowRadius, 18)
  assert.deepEqual(floatStyle.shadowOffset, { width: 0, height: 10 })
  assert.equal(floatStyle.elevation, 6)

  const barStyle = lift(palette, 'bar')
  assert.equal(barStyle.shadowColor, 'rgba(0, 0, 0, 0.25)')
  assert.equal(barStyle.shadowOpacity, 0.08)
  assert.equal(barStyle.shadowRadius, 12)
  assert.deepEqual(barStyle.shadowOffset, { width: 0, height: -4 })
  assert.equal(barStyle.elevation, 8)

  // Defaults to rest level
  const defaultStyle = lift(palette)
  assert.deepEqual(defaultStyle, restStyle)
})
