import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReceiptText, money, shareReceipt } from './receiptText.js'

test('money: formats dollar amounts correctly from cents', () => {
  assert.equal(money(0), '$0.00')
  assert.equal(money(100), '$1.00')
  assert.equal(money(2550), '$25.50')
  assert.equal(money(123456), '$1,234.56')
  assert.equal(money('5000'), '$50.00')
  assert.equal(money(null), '$0.00')
})

test('buildReceiptText: returns header only for null or omitted trip', () => {
  assert.equal(buildReceiptText(null), 'Clemson RIDES receipt')
  assert.equal(buildReceiptText(undefined), 'Clemson RIDES receipt')
})

test('buildReceiptText: formats complete rider receipt without deposit', () => {
  const trip = {
    id: 'trip-abc-123',
    pickup_label: 'Tillman Hall',
    dropoff_label: 'Memorial Stadium',
    fare_cents: 1500,
    tip_cents: 300,
    completed_at: '2026-09-25T16:00:00Z',
  }
  const text = buildReceiptText(trip)
  assert.ok(text.includes('Clemson RIDES receipt'))
  assert.ok(text.includes('Trip trip-abc-123'))
  assert.ok(text.includes('From: Tillman Hall'))
  assert.ok(text.includes('To: Memorial Stadium'))
  assert.ok(text.includes('Fare: $15.00'))
  assert.ok(text.includes('Tip: $3.00'))
  assert.ok(text.includes('Total: $18.00'))
})

test('buildReceiptText: includes deposit receipt lines when airport deposit was paid', () => {
  const trip = {
    id: 'trip-gsp-456',
    pickup_label: 'Douthit Hills',
    dropoff_label: 'Greenville-Spartanburg Airport (GSP)',
    fare_cents: 9000,
    deposit_cents: 2250,
    tip_cents: 1000,
  }
  const text = buildReceiptText(trip)
  assert.ok(text.includes('Fare: $90.00'))
  assert.ok(text.includes('25% deposit: $22.50'))
  assert.ok(text.includes('Remaining balance: $67.50'))
  assert.ok(text.includes('Tip: $10.00'))
  assert.ok(text.includes('Total: $100.00'))
})

test('buildReceiptText: applies driver privacy mask when forDriver is true', () => {
  const trip = {
    id: 'trip-priv-789',
    pickup_label: '123 College Ave, Clemson, SC',
    dropoff_label: 'Cooper Library',
    fare_cents: 1200,
    tip_cents: 200,
  }
  const text = buildReceiptText(trip, { forDriver: true })
  // College Ave maps to downtown, Cooper Library maps to campus
  assert.ok(text.includes('From: Clemson · downtown'))
  assert.ok(text.includes('To: Clemson · campus'))
  assert.ok(!text.includes('123 College Ave'))
})

test('shareReceipt: returns unavailable in node environment when no navigator methods exist', async () => {
  const res = await shareReceipt({ id: 't1' })
  assert.equal(res, 'unavailable')
})

test('shareReceipt: uses navigator.share when available', async () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let sharedPayload = null
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      share: async (payload) => {
        sharedPayload = payload
      },
    },
    configurable: true,
  })
  try {
    const res = await shareReceipt({ id: 'trip-nav' }, { url: 'https://rides.clemson.edu/trip-nav' })
    assert.equal(res, 'shared')
    assert.ok(sharedPayload)
    assert.equal(sharedPayload.title, 'Clemson RIDES receipt')
    assert.equal(sharedPayload.url, 'https://rides.clemson.edu/trip-nav')
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig)
    else delete globalThis.navigator
  }
})

test('shareReceipt: handles navigator.share AbortError gracefully', async () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      share: async () => {
        const err = new Error('Share canceled by user')
        err.name = 'AbortError'
        throw err
      },
    },
    configurable: true,
  })
  try {
    const res = await shareReceipt({ id: 'trip-cancel' })
    assert.equal(res, 'dismissed')
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig)
    else delete globalThis.navigator
  }
})

test('shareReceipt: falls back to clipboard when share is unavailable', async () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let clipboardText = null
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async (text) => {
          clipboardText = text
        },
      },
    },
    configurable: true,
  })
  try {
    const res = await shareReceipt({ id: 'trip-clip' }, { url: 'https://rides.clemson.edu' })
    assert.equal(res, 'copied')
    assert.ok(clipboardText.includes('Clemson RIDES receipt'))
    assert.ok(clipboardText.includes('https://rides.clemson.edu'))
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig)
    else delete globalThis.navigator
  }
})

test('shareReceipt: falls back to mailto when navigator is absent but window exists', async () => {
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
  })
  globalThis.window = {
    location: { href: '' },
  }
  try {
    const res = await shareReceipt({ id: 'trip-mail' })
    assert.equal(res, 'mailto')
    assert.ok(globalThis.window.location.href.startsWith('mailto:?subject=Clemson%20RIDES%20receipt'))
  } finally {
    delete globalThis.window
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav)
    else delete globalThis.navigator
  }
})
