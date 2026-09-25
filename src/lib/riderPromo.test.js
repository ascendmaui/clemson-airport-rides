import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RIDER_SOCIAL_REWARDS,
  RIDER_SOCIAL_TYPE,
  describeRiderSocialRewards,
  formatCents,
  normalizePromoCode,
  readStoredPromo,
  capturePromoFromLocation,
  riderFirstName,
  riderPromoShareText,
  riderPromoShareUrl,
} from './riderPromo.js'
import { WEB_ORIGIN } from '../../shared/productLinks.js'

test('constants: RIDER_SOCIAL_TYPE and DEFAULT_RIDER_SOCIAL_REWARDS', () => {
  assert.equal(RIDER_SOCIAL_TYPE, 'rider_social')
  assert.deepEqual(DEFAULT_RIDER_SOCIAL_REWARDS, {
    referrerCreditCents: 500,
    referredDiscountKind: 'percent',
    referredPercentOff: 20,
    referredCentsOff: 500,
  })
})

test('normalizePromoCode: casing, stripping non-alphanumerics, and 16-char cap', () => {
  assert.equal(normalizePromoCode('tiger2026'), 'TIGER2026')
  assert.equal(normalizePromoCode('  clem-son_ride!  '), 'CLEMSONRIDE')
  assert.equal(normalizePromoCode('DISCOUNT#50$'), 'DISCOUNT50')
  assert.equal(normalizePromoCode('🐅TIGER🏈'), 'TIGER')

  // Truncates at 16 characters
  assert.equal(normalizePromoCode('1234567890ABCDEFGHIJK'), '1234567890ABCDEF')
  assert.equal(normalizePromoCode('1234567890ABCDEF').length, 16)

  // Empty and falsy values
  assert.equal(normalizePromoCode(''), '')
  assert.equal(normalizePromoCode(null), '')
  assert.equal(normalizePromoCode(undefined), '')

  // Numeric and boolean inputs
  assert.equal(normalizePromoCode(12345), '12345')
  assert.equal(normalizePromoCode('0'), '0')

  // BUG?: Falsy numbers (0) and booleans (false) fall back to '' via `raw || ''` before String()
  assert.equal(normalizePromoCode(0), '')
  assert.equal(normalizePromoCode(false), '')
  // While truthy booleans (true) become 'TRUE'
  assert.equal(normalizePromoCode(true), 'TRUE')
})

test('riderFirstName: extracts first name, falls back to Rider for emails and blanks', () => {
  assert.equal(riderFirstName('Alice'), 'Alice')
  assert.equal(riderFirstName('Bob Smith'), 'Bob')
  assert.equal(riderFirstName('  Charlie   Brown  '), 'Charlie')
  assert.equal(riderFirstName('Diana Prince-Wayne'), 'Diana')
  assert.equal(riderFirstName('\tEvan\nDavis\t'), 'Evan')

  // Emails default to 'Rider'
  assert.equal(riderFirstName('alice@clemson.edu'), 'Rider')
  assert.equal(riderFirstName('tiger@g.clemson.edu Smith'), 'Rider')
  assert.equal(riderFirstName('@clemson.edu'), 'Rider')

  // Blanks and falsy inputs default to 'Rider'
  assert.equal(riderFirstName(''), 'Rider')
  assert.equal(riderFirstName('   '), 'Rider')
  assert.equal(riderFirstName('\n\t  '), 'Rider')
  assert.equal(riderFirstName(null), 'Rider')
  assert.equal(riderFirstName(undefined), 'Rider')
  assert.equal(riderFirstName(0), 'Rider')
  assert.equal(riderFirstName(false), 'Rider')
})

test('formatCents: dollar formatting, odd cents, zero, and invalid inputs', () => {
  assert.equal(formatCents(500), '$5.00')
  assert.equal(formatCents(1234), '$12.34')
  assert.equal(formatCents(0), '$0.00')
  assert.equal(formatCents(5), '$0.05')
  assert.equal(formatCents(50), '$0.50')
  assert.equal(formatCents(100000), '$1000.00')

  // String numeric inputs
  assert.equal(formatCents('750'), '$7.50')

  // Fractional cents formatted via toFixed(2)
  assert.equal(formatCents(500.6), '$5.01')
  assert.equal(formatCents(500.4), '$5.00')

  // Non-finite and invalid inputs return '$0.00'
  assert.equal(formatCents(NaN), '$0.00')
  assert.equal(formatCents(Infinity), '$0.00')
  assert.equal(formatCents(-Infinity), '$0.00')
  assert.equal(formatCents('not-a-number'), '$0.00')
  assert.equal(formatCents(undefined), '$0.00')
  assert.equal(formatCents(null), '$0.00') // Number(null) is 0

  // BUG?: Negative cents format with negative sign after the dollar symbol ('$-5.00' instead of '-$5.00')
  assert.equal(formatCents(-500), '$-5.00')
  assert.equal(formatCents(-125), '$-1.25')
})

test('describeRiderSocialRewards: default and custom reward configurations', () => {
  // Defaults when config is missing or empty
  const fromEmpty = describeRiderSocialRewards()
  assert.deepEqual(fromEmpty, {
    referrer: '$5.00 ride credit',
    referred: '20% of the first-ride fare as ride credit',
    kind: 'percent',
  })

  const fromNull = describeRiderSocialRewards(null)
  assert.deepEqual(fromNull, {
    referrer: '$5.00 ride credit',
    referred: '20% of the first-ride fare as ride credit',
    kind: 'percent',
  })

  // Custom percent discount
  const customPercent = describeRiderSocialRewards({
    referrer_credit_cents: 1000,
    referred_discount_kind: 'percent',
    referred_percent_off: 25,
  })
  assert.deepEqual(customPercent, {
    referrer: '$10.00 ride credit',
    referred: '25% of the first-ride fare as ride credit',
    kind: 'percent',
  })

  // Custom fixed discount
  const customFixed = describeRiderSocialRewards({
    referrer_credit_cents: 750,
    referred_discount_kind: 'fixed',
    referred_cents_off: 600,
  })
  assert.deepEqual(customFixed, {
    referrer: '$7.50 ride credit',
    referred: '$6.00 ride credit',
    kind: 'fixed',
  })

  // Unknown kind defaults to 'percent'
  const fallbackKind = describeRiderSocialRewards({
    referred_discount_kind: 'custom_promo',
    referred_percent_off: 15,
  })
  assert.equal(fallbackKind.kind, 'percent')
  assert.equal(fallbackKind.referred, '15% of the first-ride fare as ride credit')

  // Zero credits and zero percent
  const zeroRewards = describeRiderSocialRewards({
    referrer_credit_cents: 0,
    referred_discount_kind: 'fixed',
    referred_cents_off: 0,
  })
  assert.equal(zeroRewards.referrer, '$0.00 ride credit')
  assert.equal(zeroRewards.referred, '$0.00 ride credit')
})

test('riderPromoShareUrl: builds share URL with WEB_ORIGIN in Node and handles browser origin', () => {
  // In Node (typeof window === 'undefined')
  assert.equal(
    riderPromoShareUrl('TIGER2026'),
    `${WEB_ORIGIN}/#/sign-up?ref=TIGER2026`,
  )
  assert.equal(
    riderPromoShareUrl('  clem-son 26!  '),
    `${WEB_ORIGIN}/#/sign-up?ref=CLEMSON26`,
  )
  assert.equal(
    riderPromoShareUrl(''),
    `${WEB_ORIGIN}/#/sign-up?ref=`,
  )

  // In simulated browser environment with window.location.origin
  const originalWindow = globalThis.window
  try {
    globalThis.window = {
      location: {
        origin: 'https://test-browser.clemson.edu',
      },
    }
    assert.equal(
      riderPromoShareUrl('CAMPUS50'),
      'https://test-browser.clemson.edu/#/sign-up?ref=CAMPUS50',
    )
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = originalWindow
    }
  }
})

test('riderPromoShareText: produces share invitation copy with normalized code', () => {
  assert.equal(
    riderPromoShareText('TIGER2026'),
    'Join me on Clemson RIDES. Use code TIGER2026 when you sign up.',
  )
  assert.equal(
    riderPromoShareText(' clemson-fun '),
    'Join me on Clemson RIDES. Use code CLEMSONFUN when you sign up.',
  )

  // BUG?: Empty or stripped code leaves an extra space in "Use code  when you sign up."
  assert.equal(
    riderPromoShareText(''),
    'Join me on Clemson RIDES. Use code  when you sign up.',
  )
  assert.equal(
    riderPromoShareText('!!!'),
    'Join me on Clemson RIDES. Use code  when you sign up.',
  )
})

test('storage helpers in Node environment safely return empty string', () => {
  // When window is undefined (Node environment)
  assert.equal(readStoredPromo(), '')
  assert.equal(capturePromoFromLocation(), '')
})
