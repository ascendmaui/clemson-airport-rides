import assert from 'node:assert/strict'
import test from 'node:test'
import * as agentChips from './agentChips.js'
import { HELP_CHIPS, SUPPORT_CHIPS, categoryLabel } from './agentChips.js'

function assertChipShape(chip) {
  assert.deepEqual(Object.keys(chip).sort(), ['label', 'text'])
  assert.equal(typeof chip.label, 'string')
  assert.ok(chip.label.trim().length > 0)
  assert.equal(typeof chip.text, 'string')
  assert.ok(chip.text.trim().length > 0)
}

test('categoryLabel formats canonical support ticket categories', () => {
  assert.equal(categoryLabel('bug'), 'Bug')
  assert.equal(categoryLabel('billing'), 'Billing')
  assert.equal(categoryLabel('ride_dispute'), 'Ride dispute')
  assert.equal(categoryLabel('account'), 'Account')
  assert.equal(categoryLabel('safety'), 'Safety')
  assert.equal(categoryLabel('other'), 'Other')
})

test('categoryLabel handles unknown, empty, and non-string inputs', () => {
  assert.equal(categoryLabel(undefined), 'Other')
  assert.equal(categoryLabel(null), 'Other')
  assert.equal(categoryLabel(''), 'Other')
  assert.equal(categoryLabel('lost_and_found'), 'lost_and_found')
  assert.equal(categoryLabel('general_question'), 'general_question')

  // BUG?: categoryLabel(0) and categoryLabel(false) evaluate falsy in ternary and return 'Other' instead of '0' or 'false'
  assert.equal(categoryLabel(0), 'Other')
  assert.equal(categoryLabel(false), 'Other')
  assert.equal(categoryLabel(123), '123')
  assert.equal(categoryLabel(true), 'true')

  // BUG?: categoryLabel does not normalize space-separated category strings such as 'ride dispute'
  assert.equal(categoryLabel('ride dispute'), 'ride dispute')

  // BUG?: canonical keys are case-sensitive, so a different case echoes back raw
  assert.equal(categoryLabel('BUG'), 'BUG')

  // Surrounding whitespace is trimmed before lookup.
  assert.equal(categoryLabel(' bug'), 'Bug')
  assert.equal(categoryLabel('safety '), 'Safety')
  assert.equal(categoryLabel('  lost_and_found  '), 'lost_and_found')
  assert.equal(categoryLabel(' ride dispute '), 'ride dispute')

  assert.equal(categoryLabel('   '), 'Other')
  assert.equal(categoryLabel('\n\t'), 'Other')

  // BUG?: NaN is falsy and collapses to 'Other'; an empty array is truthy and String([]) is ''
  assert.equal(categoryLabel(Number.NaN), 'Other')
  assert.equal(categoryLabel([]), '')
})

test('rides-native agentChips re-exports only the chip maps and categoryLabel', () => {
  assert.deepEqual(Object.keys(agentChips).sort(), ['HELP_CHIPS', 'SUPPORT_CHIPS', 'categoryLabel'])
  assert.equal(agentChips.HELP_CHIPS, HELP_CHIPS)
  assert.equal(agentChips.SUPPORT_CHIPS, SUPPORT_CHIPS)
  assert.equal(agentChips.categoryLabel, categoryLabel)
  assert.equal(typeof categoryLabel, 'function')
  assert.deepEqual(Object.keys(HELP_CHIPS).sort(), ['driver', 'rider'])
  assert.deepEqual(Object.keys(SUPPORT_CHIPS).sort(), ['driver', 'rider'])
  assert.equal(HELP_CHIPS.admin, undefined)
  assert.equal(SUPPORT_CHIPS.admin, undefined)
})

test('HELP_CHIPS contains rider and driver guide questions with label and text', () => {
  assert.ok(Array.isArray(HELP_CHIPS.rider))
  assert.ok(Array.isArray(HELP_CHIPS.driver))
  assert.equal(HELP_CHIPS.rider.length, 5)
  assert.equal(HELP_CHIPS.driver.length, 5)

  for (const chip of [...HELP_CHIPS.rider, ...HELP_CHIPS.driver]) {
    assertChipShape(chip)
  }

  const riderLabels = HELP_CHIPS.rider.map((chip) => chip.label)
  assert.deepEqual(riderLabels, [
    'Book an airport ride',
    'Add a card',
    'Student discount',
    'Ride with friends',
    'Share live location',
  ])

  const driverLabels = HELP_CHIPS.driver.map((chip) => chip.label)
  assert.deepEqual(driverLabels, [
    'Go online',
    'Driver signup',
    'Heat map',
    'Offer a carpool',
    'Earnings',
  ])
})

test('SUPPORT_CHIPS contains rider and driver issue prompts with label and text', () => {
  assert.ok(Array.isArray(SUPPORT_CHIPS.rider))
  assert.ok(Array.isArray(SUPPORT_CHIPS.driver))
  assert.equal(SUPPORT_CHIPS.rider.length, 5)
  assert.equal(SUPPORT_CHIPS.driver.length, 5)

  for (const chip of [...SUPPORT_CHIPS.rider, ...SUPPORT_CHIPS.driver]) {
    assertChipShape(chip)
  }

  const riderLabels = SUPPORT_CHIPS.rider.map((chip) => chip.label)
  assert.deepEqual(riderLabels, [
    'Billing issue',
    'Ride problem',
    'Bug report',
    'Account access',
    'Safety',
  ])

  const driverLabels = SUPPORT_CHIPS.driver.map((chip) => chip.label)
  // BUG?: Driver support chips do not include an 'account' chip, providing two bug-related chips instead ("Can't go online" and "App bug")
  assert.deepEqual(driverLabels, [
    "Can't go online",
    'Fare question',
    'Rider dispute',
    'App bug',
    'Safety',
  ])
})

test('HELP_CHIPS prompt texts are the guide questions shown for each label', () => {
  assert.deepEqual(HELP_CHIPS.rider.map((chip) => chip.text), [
    'How do I schedule a GSP or CLT ride?',
    'Where do I add a card for rides?',
    'How does the Clemson student discount work?',
    'How do friend rides and fare splits work?',
    'How do I share my live location?',
  ])
  assert.deepEqual(HELP_CHIPS.driver.map((chip) => chip.text), [
    'How do I go online and accept a ride?',
    'How do I finish driver signup and get approved?',
    'How do the heat map and map types work?',
    'How do I offer a carpool?',
    'Where do I see earnings?',
  ])
})

test('SUPPORT_CHIPS prompt texts match standard problem categories', () => {
  assert.equal(SUPPORT_CHIPS.rider[0].text, 'I have a billing issue')
  assert.equal(SUPPORT_CHIPS.rider[1].text, 'I have a ride dispute')
  assert.equal(SUPPORT_CHIPS.rider[2].text, 'I want to report a bug')
  assert.equal(SUPPORT_CHIPS.rider[3].text, 'I have an account problem')
  assert.equal(SUPPORT_CHIPS.rider[4].text, 'I have a safety concern')

  assert.equal(SUPPORT_CHIPS.driver[0].text, 'I have a bug: I cannot go online')
  assert.equal(SUPPORT_CHIPS.driver[1].text, 'I have a billing issue about a fare')
  assert.equal(SUPPORT_CHIPS.driver[2].text, 'I have a ride dispute')
  assert.equal(SUPPORT_CHIPS.driver[3].text, 'I want to report a bug')
  assert.equal(SUPPORT_CHIPS.driver[4].text, 'I have a safety concern')
})
