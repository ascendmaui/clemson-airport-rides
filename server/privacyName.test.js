import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayFirstName,
  fallbackDisplayFirstName,
  primeDisplayFirstName,
  redactPeerText,
  scrubMessages,
} from './privacyName.js'

test('fallbackDisplayFirstName parses various name formats and email addresses', () => {
  assert.equal(fallbackDisplayFirstName(''), '')
  assert.equal(fallbackDisplayFirstName(null), '')
  assert.equal(fallbackDisplayFirstName(undefined), '')

  // Standard full name
  assert.equal(fallbackDisplayFirstName('John Doe'), 'John')
  assert.equal(fallbackDisplayFirstName('Alice Marie Smith'), 'Alice')

  // Last, First name format
  assert.equal(fallbackDisplayFirstName('Doe, Jane'), 'Jane')
  assert.equal(fallbackDisplayFirstName('Smith, Bob Jr.'), 'Bob')

  // Email format
  assert.equal(fallbackDisplayFirstName('tiger.clemson@clemson.edu'), 'tiger')
  assert.equal(fallbackDisplayFirstName('student_test@gmail.com'), 'student')
})

test('primeDisplayFirstName resolves and primes displayFirstName function', async () => {
  const fn = await primeDisplayFirstName()
  assert.equal(typeof fn, 'function')
  assert.equal(displayFirstName('John Doe'), 'John')
  assert.equal(displayFirstName(null), 'Rider')
})

test('redactPeerText replaces peer full names and surnames with first names', () => {
  const context = {
    _peerFullNames: ['Jane Doe', 'Robert Smith'],
  }

  // Text mentioning full name
  const text1 = 'I took a ride with Jane Doe and had an issue with luggage.'
  assert.equal(
    redactPeerText(text1, context),
    'I took a ride with Jane and had an issue with luggage.',
  )

  // Text mentioning only the surname
  const text2 = 'Driver Doe was polite, but Robert was late.'
  assert.equal(
    redactPeerText(text2, context),
    'Driver Jane was polite, but Robert was late.',
  )

  // Text mentioning inverted "Smith, Robert"
  const text3 = 'Was assigned to Smith, Robert for the Clemson commute.'
  assert.equal(
    redactPeerText(text3, context),
    'Was assigned to Robert for the Clemson commute.',
  )

  // Text mentioning surname alone
  const text4 = 'Smith arrived on time.'
  assert.equal(
    redactPeerText(text4, context),
    'Robert arrived on time.',
  )

  // Text with empty or missing context
  assert.equal(redactPeerText('Hello world', null), 'Hello world')
  assert.equal(redactPeerText('Hello world', {}), 'Hello world')
})

test('scrubMessages redacts peer names across chat message histories', () => {
  const context = {
    _peerFullNames: ['Alexander Hamilton'],
  }

  const messages = [
    { role: 'user', content: 'Did Alexander Hamilton arrive yet?' },
    { role: 'assistant', content: 'Hamilton is 2 minutes away.' },
  ]

  const scrubbed = scrubMessages(messages, context)
  assert.equal(scrubbed[0].content, 'Did Alexander arrive yet?')
  assert.equal(scrubbed[1].content, 'Alexander is 2 minutes away.')
})
